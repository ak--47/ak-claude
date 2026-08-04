/**
 * @fileoverview BaseClaude class — shared foundation for all ak-claude classes.
 * Handles authentication, client initialization, message history management,
 * token tracking, few-shot seeding, and rate-limit retry.
 *
 * Unlike Gemini's SDK which has built-in chat sessions, Claude's Messages API
 * is stateless — we manage this.history[] as a plain array and pass the full
 * history on every messages.create() call.
 */

import dotenv from 'dotenv';
dotenv.config({ quiet: true });
const { NODE_ENV = "unknown", LOG_LEVEL = "" } = process.env;

import Anthropic from '@anthropic-ai/sdk';
import log from './logger.js';
import { isJSON } from './json-helpers.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 8192;

/** Date the pricing table below was last verified against Anthropic's pricing page. */
const MODEL_PRICING_AS_OF = '2026-07-28';

/**
 * Model pricing per million tokens (as of MODEL_PRICING_AS_OF).
 * Bare IDs (no date suffix) match both the direct API and Vertex AI publisher
 * model IDs for current-generation models. Vertex dated snapshots use an
 * `@` separator (e.g. claude-opus-4-5@20250514) — add entries as needed.
 *
 * An optional `intro: { input, output, until }` models promotional pricing:
 * resolvePricing() returns the intro rate up to and including `until`, then
 * falls back to the base rate. See resolvePricing({ at }).
 *
 * NOTE: a null result means pricing is UNKNOWN, not free.
 */
const MODEL_PRICING = {
	// Claude 5 family
	'claude-fable-5': { input: 10.00, output: 50.00 },
	'claude-mythos-5': { input: 10.00, output: 50.00 }, // Project Glasswing only
	'claude-opus-5': { input: 5.00, output: 25.00 },
	'claude-sonnet-5': {
		input: 3.00, output: 15.00,
		intro: { input: 2.00, output: 10.00, until: '2026-08-31' }
	},
	// Opus 4.x
	'claude-opus-4-8': { input: 5.00, output: 25.00 },
	'claude-opus-4-7': { input: 5.00, output: 25.00 },
	'claude-opus-4-6': { input: 5.00, output: 25.00 },
	'claude-opus-4-5': { input: 15.00, output: 75.00 },
	'claude-opus-4-5-20250514': { input: 15.00, output: 75.00 },
	// Sonnet 4.x
	'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
	'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
	'claude-sonnet-4-5-20250514': { input: 3.00, output: 15.00 },
	// Haiku
	'claude-haiku-4-5': { input: 1.00, output: 5.00 },
	'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
};

/**
 * Applies an active `intro` promotional window to a pricing entry.
 * The window is inclusive of `until` (compared at end-of-day UTC).
 * @param {any} entry
 * @param {Date|string|number} [at]
 * @returns {any}
 */
function _applyIntroPricing(entry, at) {
	if (!entry?.intro) return entry;
	const now = at === undefined ? new Date() : new Date(at);
	const until = new Date(`${entry.intro.until}T23:59:59.999Z`);
	if (Number.isNaN(now.getTime()) || now > until) return entry;
	return {
		...entry,
		input: entry.intro.input,
		output: entry.intro.output,
		introUntil: entry.intro.until
	};
}

/**
 * Resolves pricing for a model id.
 * Handles Vertex dated snapshots (`claude-opus-4-5@20250514`) by falling back to
 * the bare id. Returns null when the model's pricing is UNKNOWN (not free).
 * @param {string|null|undefined} modelId
 * @param {Object} [opts={}]
 * @param {Date|string|number} [opts.at] - Point in time for promotional pricing. Defaults to now.
 * @returns {{ input: number, output: number, intro?: Object, introUntil?: string, asOf: string }|null}
 */
function resolvePricing(modelId, opts = {}) {
	const entry = _lookupPricing(modelId);
	if (!entry) return null;
	return { ..._applyIntroPricing(entry, opts.at), asOf: MODEL_PRICING_AS_OF };
}

/**
 * Raw table lookup with dated-snapshot fallback. No promo/asOf handling.
 * @param {string|null|undefined} modelId
 * @returns {any|null}
 * @private
 */
function _lookupPricing(modelId) {
	if (!modelId) return null;
	if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];
	// Vertex dated snapshots use an `@` separator, e.g. claude-opus-4-5@20250514.
	// Try the hyphen-dated key first (some models have a dedicated dated price).
	if (modelId.includes('@')) {
		const hyphenated = modelId.replace('@', '-');
		if (MODEL_PRICING[hyphenated]) return MODEL_PRICING[hyphenated];
	}
	// Strip a trailing dated snapshot (@YYYYMMDD or -YYYYMMDD) and retry the bare id
	// — the direct API echoes hyphen-dated builds (claude-sonnet-4-6-20250514) even
	// when the bare id (claude-sonnet-4-6) is the priced one. `\d{6,8}` avoids
	// eating single-digit version parts like the `-6` in claude-sonnet-4-6.
	const bare = modelId.replace(/[-@]\d{6,8}$/, '');
	if (bare !== modelId && MODEL_PRICING[bare]) return MODEL_PRICING[bare];
	return null;
}

/**
 * Anthropic cache-token multipliers relative to the base input rate.
 * Cache WRITE depends on TTL: 1.25x at the default 5-minute TTL, 2x at 1 hour.
 */
const CACHE_WRITE_MULTIPLIER = 1.25; // cache_creation_input_tokens, 5m TTL
const CACHE_WRITE_MULTIPLIER_1H = 2; // cache_creation_input_tokens, ttl: '1h'
const CACHE_READ_MULTIPLIER = 0.1;   // cache_read_input_tokens

/**
 * Computes estimated USD cost from token counts using MODEL_PRICING.
 *
 * Anthropic's `input_tokens` EXCLUDES cache tokens, so cache-write and cache-read
 * are ADDED on top. (ak-gemini is the opposite — its `promptTokenCount` INCLUDES
 * cached tokens and must be subtracted. Do not "unify" these.)
 *
 * @param {string|null|undefined} modelId
 * @param {number} promptTokens
 * @param {number} responseTokens
 * @param {number} [cacheCreationTokens=0]
 * @param {number} [cacheReadTokens=0]
 * @param {Object} [opts={}]
 * @param {Date|string|number} [opts.at] - Point in time for promotional pricing.
 * @param {'5m'|'1h'} [opts.cacheTtl='5m'] - TTL the cache was written with; '1h' bills writes at 2x instead of 1.25x.
 * @returns {number|null} Cost in USD, or null when pricing is UNKNOWN (not free).
 */
function computeCost(modelId, promptTokens, responseTokens, cacheCreationTokens = 0, cacheReadTokens = 0, opts = {}) {
	const pricing = resolvePricing(modelId, { at: opts.at });
	if (!pricing) return null;
	const writeMultiplier = opts.cacheTtl === '1h' ? CACHE_WRITE_MULTIPLIER_1H : CACHE_WRITE_MULTIPLIER;
	return (promptTokens / 1_000_000) * pricing.input
		+ (responseTokens / 1_000_000) * pricing.output
		+ (cacheCreationTokens / 1_000_000) * pricing.input * writeMultiplier
		+ (cacheReadTokens / 1_000_000) * pricing.input * CACHE_READ_MULTIPLIER;
}

/**
 * Vertex endpoint types that route to the current Claude 5-family models.
 * `global` (recommended, no premium), and the `us`/`eu` multi-region endpoints.
 * Any other value is a specific regional endpoint (e.g. us-east5) that only
 * serves Claude Sonnet 4.6 and earlier.
 */
const GLOBAL_OR_MULTIREGION = new Set(['global', 'us', 'eu']);

/**
 * Claude 5-family models. These:
 *  - reject `temperature` / `top_p` / `top_k` with a 400,
 *  - reject `thinking.budget_tokens` with a 400 (use adaptive thinking + effort),
 *  - require a global/multi-region Vertex endpoint (not a specific region).
 */
const CLAUDE5_FAMILY_REGEX = /^claude-(opus|sonnet|haiku)-5|^claude-opus-4-[78]|^claude-(fable-5|mythos)/;

/** Opus 4.6 / Sonnet 4.6 — support adaptive thinking, but `budget_tokens` still works (deprecated). */
const CLAUDE46_FAMILY_REGEX = /^claude-(opus|sonnet)-4-6/;

/** Valid `output_config.effort` levels. `xhigh` is NOT available on the 4.6 family. */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_LEVELS_4_6 = ['low', 'medium', 'high', 'max'];

/**
 * Maps a legacy `thinking.budget_tokens` value onto an `output_config.effort` level.
 * Returns null when thinking should be omitted entirely (budget 0 / falsy).
 * @param {number} budgetTokens
 * @returns {'low'|'medium'|'high'|'xhigh'|null}
 */
function budgetTokensToEffort(budgetTokens) {
	const n = Number(budgetTokens) || 0;
	if (n <= 0) return null;
	if (n <= 2048) return 'low';
	if (n <= 8192) return 'medium';
	if (n <= 24576) return 'high';
	return 'xhigh';
}

export {
	MODEL_PRICING,
	MODEL_PRICING_AS_OF,
	DEFAULT_MAX_TOKENS,
	EFFORT_LEVELS,
	resolvePricing,
	computeCost,
	budgetTokensToEffort
};

// ── BaseClaude Class ─────────────────────────────────────────────────────────

/**
 * @typedef {import('./types').BaseClaudeOptions} BaseClaudeOptions
 * @typedef {import('./types').UsageData} UsageData
 * @typedef {import('./types').TransformationExample} TransformationExample
 */

/**
 * Base class for all ak-claude wrappers.
 * Provides shared initialization, authentication, message history management,
 * token tracking, few-shot seeding, and usage reporting.
 *
 * Not typically instantiated directly — use Transformer, Chat, Message, ToolAgent, etc.
 */
class BaseClaude {
	/**
	 * @param {BaseClaudeOptions} [options={}]
	 */
	constructor(options = {}) {
		// ── Model ──
		this.modelName = options.modelName || 'claude-sonnet-5';

		// ── System Prompt ──
		if (options.systemPrompt !== undefined) {
			this.systemPrompt = options.systemPrompt;
		} else {
			this.systemPrompt = null; // subclasses override this default
		}

		// ── Vertex AI ──
		// Region precedence: explicit vertexRegion option > GOOGLE_CLOUD_LOCATION env > 'global'.
		// 'global' is the recommended default — it routes dynamically, serves the
		// current Claude 5-family models, and carries no 10% regional premium.
		// Specific regional endpoints (e.g. us-east5) only serve Claude Sonnet 4.6
		// and earlier; set vertexRegion explicitly if you need data residency.
		this.vertexai = options.vertexai ?? false;
		this.vertexProjectId = options.vertexProjectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? undefined;
		this.vertexRegion = options.vertexRegion ?? process.env.GOOGLE_CLOUD_LOCATION ?? 'global';

		// ── Auth ──
		if (!this.vertexai) {
			this.apiKey = options.apiKey !== undefined && options.apiKey !== null
				? options.apiKey
				: (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

			if (!this.apiKey) {
				throw new Error("Missing Anthropic API key. Provide via options.apiKey, ANTHROPIC_API_KEY, or CLAUDE_API_KEY env var.");
			}
		} else {
			this.apiKey = null;
		}

		// ── Generation Config ──
		// `undefined` means "use the default"; `null` means "never send this param".
		// The Claude 5 family rejects all three with a 400 — _applySamplingParams()
		// drops them for those models regardless of what is set here.
		this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
		this.temperature = options.temperature === null ? undefined : (options.temperature ?? 0.7);
		// Vertex AI doesn't allow both temperature and topP - only set topP default for direct API
		this.topP = options.topP === null ? undefined : (options.topP ?? (this.vertexai ? undefined : 0.95));
		this.topK = options.topK === null ? undefined : (options.topK ?? undefined);

		// ── Extended Thinking ──
		// `thinking` accepts the current shape ({ type: 'adaptive', display? }) or the
		// legacy one ({ type: 'enabled', budget_tokens }); the legacy shape is
		// translated to adaptive + effort on models that reject budget_tokens.
		this.thinking = options.thinking ?? null;
		// Reasoning depth for adaptive thinking → output_config.effort.
		// Same option name as ak-gemini (mapped there to thinkingConfig.thinkingLevel).
		this.effort = this._normalizeEffort(options.effort);
		// Opt in to translating legacy budget_tokens → adaptive on Opus/Sonnet 4.6,
		// which silences Anthropic's budget_tokens deprecation warning. Off by default
		// in 0.x — will become the default in the next major.
		this.adaptiveThinking = options.adaptiveThinking ?? false;

		// ── Prompt Caching ──
		this.cacheSystemPrompt = options.cacheSystemPrompt ?? false;
		// Cache TTL affects both the wire request and cost: writes bill at 1.25x the
		// input rate at the default 5m TTL, and 2x at 1h.
		this.cacheTtl = options.cacheTtl === '1h' ? '1h' : '5m';

		// ── Web Search ──
		this.enableWebSearch = options.enableWebSearch ?? false;
		this.webSearchConfig = options.webSearchConfig ?? {};

		// ── Health Check ──
		this.healthCheck = options.healthCheck ?? false;

		// ── Retry (SDK-level for 429s) ──
		this.maxRetries = options.maxRetries ?? 5;

		// ── Logging ──
		this._configureLogLevel(options.logLevel);

		// ── Anthropic Client ──
		// Client creation is deferred when vertexai=true (requires async import).
		// _ensureClient() is called at the start of every API method.
		this.client = null;
		this._clientReady = false;

		// ── Clients Namespace (for raw SDK access) ──
		// Exposes the underlying SDK clients for advanced use cases
		this.clients = {
			anthropic: null,  // @anthropic-ai/sdk client (direct API)
			vertex: null,     // @anthropic-ai/vertex-sdk client
			raw: null         // Convenience pointer to whichever is active
		};

		if (!this.vertexai) {
			this.client = new Anthropic({
				apiKey: this.apiKey,
				maxRetries: this.maxRetries
			});
			this.clients.anthropic = this.client;
			this.clients.raw = this.client;
			this._clientReady = true;
		}

		// ── State ──
		this.history = [];
		this.lastResponseMetadata = null;
		this.exampleCount = 0;
		this._initialized = false;
		this._cumulativeUsage = {
			promptTokens: 0,
			responseTokens: 0,
			cacheCreationTokens: 0,
			cacheReadTokens: 0,
			totalTokens: 0,
			attempts: 0
		};

		log.debug(`${this.constructor.name} created with model: ${this.modelName}`);
	}

	// ── Client Bootstrap ─────────────────────────────────────────────────────

	/**
	 * Ensures the Anthropic client is ready. For direct API usage this is
	 * synchronous (client created in constructor). For Vertex AI this lazily
	 * imports @anthropic-ai/vertex-sdk and creates the AnthropicVertex client.
	 */
	async _ensureClient() {
		if (this._clientReady) return;
		if (this.vertexai) {
			const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk');
			/** @type {any} */
			this.client = new AnthropicVertex({
				projectId: this.vertexProjectId,
				region: this.vertexRegion,
			});
			// Workaround: @anthropic-ai/vertex-sdk declares buildRequest as async,
			// but the base SDK calls it synchronously. Patch it with a sync version
			// that performs the same path rewriting.
			const MODEL_ENDPOINTS = new Set(['/v1/messages', '/v1/messages?beta=true']);
			const vertexClient = this.client;
			const superBuildRequest = Object.getPrototypeOf(Object.getPrototypeOf(vertexClient)).buildRequest;
			Object.getPrototypeOf(vertexClient).buildRequest = function(options, extra) {
				if (typeof options.body === 'object' && options.body !== null) {
					options.body = { ...options.body };
					if (!options.body['anthropic_version']) {
						options.body['anthropic_version'] = 'vertex-2023-10-16';
					}
				}
				if (MODEL_ENDPOINTS.has(options.path) && options.method === 'post' && typeof options.body === 'object') {
					const model = options.body['model'];
					options.body['model'] = undefined;
					const stream = options.body['stream'] ?? false;
					const specifier = stream ? 'streamRawPredict' : 'rawPredict';
					options.path = `/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${model}:${specifier}`;
				}
				if (options.path === '/v1/messages/count_tokens' ||
					(options.path === '/v1/messages/count_tokens?beta=true' && options.method === 'post')) {
					options.path = `/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/count-tokens:rawPredict`;
				}
				return superBuildRequest.call(this, options, extra);
			};
			this.clients.vertex = this.client;
			this.clients.raw = this.client;
			this._clientReady = true;
			log.debug(`${this.constructor.name}: Vertex AI client created (project=${this.vertexProjectId}, region=${this.vertexRegion})`);
			// Warn on a known-bad pairing: Claude 5-family models need a global/
			// multi-region endpoint; specific regional endpoints won't serve them.
			if (CLAUDE5_FAMILY_REGEX.test(this.modelName) && !GLOBAL_OR_MULTIREGION.has(this.vertexRegion)) {
				log.warn(`Model "${this.modelName}" may not be served by the regional Vertex endpoint "${this.vertexRegion}". Claude 5-family models require the "global" (recommended) or a multi-region ("us"/"eu") endpoint. Set vertexRegion: 'global' or GOOGLE_CLOUD_LOCATION=global.`);
			}
		}
	}

	/**
	 * Wraps an API call so provider-specific failures surface as actionable errors
	 * instead of raw SDK noise. Currently: the Vertex 403 you get when a publisher
	 * model requires data sharing to be enabled for the project.
	 * @param {() => Promise<T>} fn
	 * @param {string} [modelName]
	 * @returns {Promise<T>}
	 * @template T
	 * @protected
	 */
	async _callWithVertexHints(fn, modelName = this.modelName) {
		try {
			return await fn();
		} catch (e) {
			if (this.vertexai && (e?.status === 403 || /permission|403/i.test(e?.message || ''))) {
				throw new Error(
					`Vertex AI denied access to "${modelName}" (403). Some Anthropic publisher models require publisher data sharing to be enabled for your project before Vertex will serve them. Enable it for this model with:\n` +
					`  gcloud beta services vertex-ai publisher-models set-publisher-model-config anthropic/${modelName} --project=${this.vertexProjectId} --location=${this.vertexRegion} --publisher-model-config-from-file=<config>\n` +
					`(or via the Model Garden UI → the model card → "Enable"). Original error: ${e?.message || e}`,
					{ cause: e }
				);
			}
			throw e;
		}
	}

	// ── Initialization ───────────────────────────────────────────────────────

	/**
	 * Initializes the instance. Idempotent unless force=true.
	 * Claude has no chat sessions to create — this just validates connectivity.
	 * @param {boolean} [force=false]
	 * @returns {Promise<void>}
	 */
	async init(force = false) {
		if (this._initialized && !force) return;

		await this._ensureClient();
		log.debug(`Initializing ${this.constructor.name} with model: ${this.modelName}...`);

		await this._healthCheckPing();

		this._initialized = true;
		log.debug(`${this.constructor.name}: Initialized.`);
	}

	/**
	 * Opt-in connectivity check — runs a tiny messages.create() only when
	 * `healthCheck: true`. Requires the client to be ready (call after
	 * `_ensureClient()`).
	 * @returns {Promise<void>}
	 * @protected
	 */
	async _healthCheckPing() {
		if (!this.healthCheck) return;
		try {
			await this.client.messages.create({
				model: this.modelName,
				max_tokens: 1,
				messages: [{ role: 'user', content: 'hi' }]
			});
			log.debug(`${this.constructor.name}: API connection successful.`);
		} catch (e) {
			throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
		}
	}

	// ── Core Message Sending ─────────────────────────────────────────────────

	/**
	 * Builds the system parameter for messages.create().
	 * Supports string or array with cache_control.
	 * @returns {string|Array|undefined}
	 * @protected
	 */
	_buildSystemParam() {
		if (!this.systemPrompt) return undefined;
		if (this.cacheSystemPrompt) {
			const cacheControl = this.cacheTtl === '1h'
				? { type: 'ephemeral', ttl: '1h' }
				: { type: 'ephemeral' };
			return [{ type: 'text', text: this.systemPrompt, cache_control: cacheControl }];
		}
		return this.systemPrompt;
	}

	/**
	 * Builds the tools array, prepending the web search server tool if enabled.
	 * @param {Array} [tools] - User-provided tools array
	 * @returns {Array|undefined} The final tools array, or undefined if empty
	 * @protected
	 */
	_buildTools(tools) {
		if (!this.enableWebSearch && !tools) return undefined;
		if (!this.enableWebSearch) return tools;

		const webSearchTool = {
			type: 'web_search_20250305',
			name: 'web_search',
			...this.webSearchConfig
		};

		if (!tools || tools.length === 0) return [webSearchTool];
		return [webSearchTool, ...tools];
	}

	// ── Request Param Builders ───────────────────────────────────────────────

	/**
	 * Validates an `effort` option. Throws on an unknown level so a typo surfaces
	 * at construction rather than as an API 400.
	 * @param {string|null|undefined} effort
	 * @returns {'low'|'medium'|'high'|'xhigh'|'max'|null}
	 * @private
	 */
	_normalizeEffort(effort) {
		if (effort === undefined || effort === null) return null;
		const level = String(effort).toLowerCase();
		if (!EFFORT_LEVELS.includes(level)) {
			throw new Error(`Invalid effort "${effort}". Expected one of: ${EFFORT_LEVELS.join(', ')}.`);
		}
		return /** @type {any} */ (level);
	}

	/**
	 * True when the target model rejects temperature/top_p/top_k and
	 * thinking.budget_tokens (the Claude 5 family).
	 * @param {string} [modelName]
	 * @returns {boolean}
	 * @protected
	 */
	_isClaude5Family(modelName = this.modelName) {
		return CLAUDE5_FAMILY_REGEX.test(modelName || '');
	}

	/**
	 * Applies temperature / top_p / top_k to a request params object, in place.
	 *
	 * Skipped entirely when:
	 *  - the model is Claude 5-family (these params 400 there), or
	 *  - extended thinking is active (temperature is forced to 1 and top_p/top_k
	 *    are unsupported).
	 *
	 * @param {any} params - Request params, mutated in place.
	 * @param {string} [modelName] - Target model (defaults to this.modelName).
	 * @returns {any} The same params object.
	 * @protected
	 */
	_applySamplingParams(params, modelName = this.modelName) {
		if (this._isClaude5Family(modelName)) {
			const dropped = [
				this.temperature !== undefined && 'temperature',
				this.topP !== undefined && 'top_p',
				this.topK !== undefined && 'top_k'
			].filter(Boolean);
			if (dropped.length) {
				log.debug(`Model "${modelName}" rejects sampling params — dropping ${dropped.join(', ')}. Use \`effort\` to control reasoning depth instead.`);
			}
			return params;
		}

		// Extended thinking pins temperature to 1 and disallows top_p/top_k.
		if (this._resolveThinking(modelName)) return params;

		if (this.vertexai && this.temperature !== undefined && this.topP !== undefined) {
			// Vertex AI rejects temperature and top_p together — prefer temperature.
			params.temperature = this.temperature;
			log.debug('Vertex AI: Using temperature only (topP ignored)');
		} else {
			if (this.temperature !== undefined) params.temperature = this.temperature;
			if (this.topP !== undefined) params.top_p = this.topP;
		}
		if (this.topK !== undefined) params.top_k = this.topK;
		return params;
	}

	/**
	 * Resolves the thinking config to send for a model, translating the legacy
	 * `{ type: 'enabled', budget_tokens }` shape where required.
	 *
	 * Resolution order:
	 *  1. `effort` set                    → adaptive thinking at that effort
	 *  2. `thinking: { type: 'adaptive' }` → forwarded as-is
	 *  3. legacy `budget_tokens`           → translated to adaptive on models that
	 *     reject it (Claude 5 family always; 4.6 family only with adaptiveThinking)
	 *  4. otherwise                        → forwarded unchanged
	 *
	 * @param {string} [modelName]
	 * @returns {{ thinking: any, effort: string|null }|null} null when no thinking should be sent.
	 * @protected
	 */
	_resolveThinking(modelName = this.modelName) {
		const isClaude5 = this._isClaude5Family(modelName);
		const is46 = CLAUDE46_FAMILY_REGEX.test(modelName || '');
		const supportsAdaptive = isClaude5 || is46;
		const thinking = this.thinking;
		const display = thinking?.display;

		// (1) Explicit effort implies adaptive thinking.
		if (this.effort) {
			if (!supportsAdaptive) {
				log.warn(`Model "${modelName}" does not support adaptive thinking — ignoring effort: '${this.effort}'. Use thinking: { type: 'enabled', budget_tokens: N } instead.`);
				return thinking ? { thinking, effort: null } : null;
			}
			return {
				thinking: { type: 'adaptive', ...(display && { display }) },
				effort: this._clampEffort(this.effort, is46, modelName)
			};
		}

		if (!thinking) return null;

		// (2) Already adaptive — forward verbatim.
		if (thinking.type === 'adaptive') {
			if (!supportsAdaptive) {
				log.warn(`Model "${modelName}" does not support adaptive thinking. Sending it anyway — the API may reject the request.`);
			}
			return { thinking, effort: null };
		}

		// (3) Legacy budget_tokens.
		if (thinking.type === 'enabled') {
			const mustTranslate = isClaude5 || (is46 && this.adaptiveThinking);
			if (!mustTranslate) return { thinking, effort: null };

			const effort = budgetTokensToEffort(thinking.budget_tokens);
			if (!effort) {
				log.debug(`thinking.budget_tokens=${thinking.budget_tokens} on "${modelName}" — omitting thinking entirely.`);
				return null;
			}
			log.debug(`Model "${modelName}" rejects thinking.budget_tokens — translating budget_tokens=${thinking.budget_tokens} to adaptive thinking at effort '${effort}'.`);
			return {
				thinking: { type: 'adaptive', ...(display && { display }) },
				effort: this._clampEffort(effort, is46, modelName)
			};
		}

		// (4) Unknown shape — forward and let the API decide.
		return { thinking, effort: null };
	}

	/**
	 * Clamps an effort level to what the target model supports.
	 * `xhigh` is not a valid level on Opus 4.6 / Sonnet 4.6.
	 * @param {string} effort
	 * @param {boolean} is46
	 * @param {string} modelName
	 * @returns {string}
	 * @private
	 */
	_clampEffort(effort, is46, modelName) {
		if (is46 && !EFFORT_LEVELS_4_6.includes(effort)) {
			log.warn(`Effort '${effort}' is not supported on "${modelName}" (valid: ${EFFORT_LEVELS_4_6.join(', ')}). Clamping to 'high'.`);
			return 'high';
		}
		return effort;
	}

	/**
	 * Applies `thinking` and `output_config.effort` to a request params object, in place.
	 *
	 * MERGES into any pre-existing `params.output_config` — Message writes
	 * `output_config.format` for native structured output, and overwriting it
	 * would silently break `responseSchema`.
	 *
	 * @param {any} params - Request params, mutated in place.
	 * @param {string} [modelName] - Target model (defaults to this.modelName).
	 * @returns {any} The same params object.
	 * @protected
	 */
	_applyThinkingParams(params, modelName = this.modelName) {
		const resolved = this._resolveThinking(modelName);
		if (!resolved) return params;
		params.thinking = resolved.thinking;
		if (resolved.effort) {
			params.output_config = { ...(params.output_config || {}), effort: resolved.effort };
		}
		return params;
	}

	/**
	 * Core method: sends a message via messages.create(), manages history.
	 * Handles both string content and content block arrays (for tool_result).
	 *
	 * @param {string|Array} userContent - String message or array of content blocks
	 * @param {Object} [opts={}] - Additional params (tools, tool_choice, maxTokens, etc.)
	 * @returns {Promise<Object>} The API response
	 * @protected
	 */
	async _sendMessage(userContent, opts = {}) {
		if (!this._initialized) await this.init();

		// Build user message
		const userMsg = { role: 'user', content: userContent };
		this.history.push(userMsg);

		// Build tools array, prepending web search if enabled
		const tools = this._buildTools(opts.tools);

		// Build request params
		const model = opts.model || this.modelName;
		/** @type {any} */
		const params = {
			model,
			max_tokens: opts.maxTokens || this.maxTokens,
			messages: [...this.history],
			...(this._buildSystemParam() && { system: this._buildSystemParam() }),
			...(tools && { tools }),
			...(opts.tool_choice && { tool_choice: opts.tool_choice }),
		};

		this._applyThinkingParams(params, model);
		this._applySamplingParams(params, model);

		const response = await this._callWithVertexHints(() => this.client.messages.create(params), model);

		// Append assistant response to history
		this.history.push({ role: 'assistant', content: response.content });

		// Capture metadata
		this._captureMetadata(response);

		return response;
	}

	/**
	 * Streaming variant of _sendMessage. Returns a stream object.
	 *
	 * @param {string|Array} userContent - String message or array of content blocks
	 * @param {Object} [opts={}] - Additional params
	 * @returns {Promise<Object>} The stream object with .on() and .finalMessage()
	 * @protected
	 */
	async _streamMessage(userContent, opts = {}) {
		if (!this._initialized) await this.init();

		const userMsg = { role: 'user', content: userContent };
		this.history.push(userMsg);

		// Build tools array, prepending web search if enabled
		const tools = this._buildTools(opts.tools);

		const model = opts.model || this.modelName;
		/** @type {any} */
		const params = {
			model,
			max_tokens: opts.maxTokens || this.maxTokens,
			messages: [...this.history],
			...(this._buildSystemParam() && { system: this._buildSystemParam() }),
			...(tools && { tools }),
			...(opts.tool_choice && { tool_choice: opts.tool_choice }),
		};

		this._applyThinkingParams(params, model);
		this._applySamplingParams(params, model);

		const stream = this.client.messages.stream(params);
		return stream;
	}

	// ── Text Extraction ──────────────────────────────────────────────────────

	/**
	 * Extracts text from a Claude response's content blocks.
	 * Filters for type: 'text' and joins.
	 * @param {Object} response - The API response
	 * @returns {string}
	 * @protected
	 */
	_extractText(response) {
		if (!response?.content) return '';
		return response.content
			.filter(b => b.type === 'text')
			.map(b => b.text)
			.join('');
	}

	// ── History Management ───────────────────────────────────────────────────

	/**
	 * Retrieves the current conversation history.
	 * @param {boolean} [curated=false] - If true, returns text-only simplified history
	 * @returns {Array<Object>}
	 */
	getHistory(curated = false) {
		if (curated) {
			return this.history.map(m => ({
				role: m.role,
				content: typeof m.content === 'string'
					? m.content
					: Array.isArray(m.content)
						? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
						: String(m.content)
			}));
		}
		return [...this.history];
	}

	/**
	 * Clears conversation history.
	 * Subclasses may override to preserve seeded examples.
	 * @returns {Promise<void>}
	 */
	async clearHistory() {
		this.history = [];
		this.lastResponseMetadata = null;
		this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, attempts: 0 };
		log.debug(`${this.constructor.name}: Conversation history cleared.`);
	}

	// ── Few-Shot Seeding ─────────────────────────────────────────────────────

	/**
	 * Seeds the conversation with example input/output pairs for few-shot learning.
	 * Injects user/assistant message pairs into history.
	 *
	 * @param {TransformationExample[]} examples - Array of example objects
	 * @param {Object} [opts={}] - Key configuration
	 * @param {string} [opts.promptKey='PROMPT'] - Key for input data
	 * @param {string} [opts.answerKey='ANSWER'] - Key for output data
	 * @param {string} [opts.contextKey='CONTEXT'] - Key for optional context
	 * @param {string} [opts.explanationKey='EXPLANATION'] - Key for optional explanations
	 * @param {string} [opts.systemPromptKey='SYSTEM'] - Key for system prompt overrides
	 * @param {'json'|'text'} [opts.format='json'] - Assistant-turn format: 'json' wraps answers in a {data} envelope (Transformer protocol); 'text' stores ANSWER verbatim (prose agents like Chat)
	 * @returns {Promise<Array>} The updated history
	 */
	async seed(examples, opts = {}) {
		await this.init();

		if (!examples || !Array.isArray(examples) || examples.length === 0) {
			log.debug("No examples provided. Skipping seeding.");
			return this.getHistory();
		}

		const promptKey = opts.promptKey || 'PROMPT';
		const answerKey = opts.answerKey || 'ANSWER';
		const contextKey = opts.contextKey || 'CONTEXT';
		const explanationKey = opts.explanationKey || 'EXPLANATION';
		const systemPromptKey = opts.systemPromptKey || 'SYSTEM';
		const format = opts.format || 'json';

		// Check for system prompt override in examples
		const instructionExample = examples.find(ex => ex[systemPromptKey]);
		if (instructionExample) {
			log.debug(`Found system prompt in examples; updating.`);
			this.systemPrompt = instructionExample[systemPromptKey];
		}

		log.debug(`Seeding conversation with ${examples.length} examples...`);
		const historyToAdd = [];

		for (const example of examples) {
			const contextValue = example[contextKey] || "";
			const promptValue = example[promptKey] || "";
			const answerValue = example[answerKey] || "";
			const explanationValue = example[explanationKey] || "";
			let userText = "";
			let modelResponse = {};

			if (contextValue) {
				let contextText = isJSON(contextValue) ? JSON.stringify(contextValue, null, 2) : contextValue;
				userText += `CONTEXT:\n${contextText}\n\n`;
			}

			if (promptValue) {
				let promptText = isJSON(promptValue) ? JSON.stringify(promptValue, null, 2) : promptValue;
				userText += promptText;
			}

			let modelText;
			if (format === 'text') {
				modelText = isJSON(answerValue) ? JSON.stringify(answerValue, null, 2) : String(answerValue || '');
				if (explanationValue) log.warn('seed(): EXPLANATION has no representation in text format; ignored.');
			} else {
				if (answerValue) modelResponse.data = answerValue;
				if (explanationValue) modelResponse.explanation = explanationValue;
				modelText = JSON.stringify(modelResponse, null, 2);
			}

			if (userText.trim().length && modelText.trim().length > 0) {
				historyToAdd.push({ role: 'user', content: userText.trim() });
				historyToAdd.push({ role: 'assistant', content: modelText.trim() });
			}
		}

		log.debug(`Adding ${historyToAdd.length} items to history (${this.history.length} existing)...`);
		this.history = [...this.history, ...historyToAdd];
		this.exampleCount = this.history.length;

		log.debug(`History now has ${this.history.length} items.`);
		return this.getHistory();
	}

	// ── Response Metadata ────────────────────────────────────────────────────

	/**
	 * Captures response metadata from an API response.
	 * @param {Object} response - The API response object
	 * @protected
	 */
	_captureMetadata(response) {
		this.lastResponseMetadata = {
			modelVersion: response.model || null,
			requestedModel: this.modelName,
			promptTokens: response.usage?.input_tokens || 0,
			responseTokens: response.usage?.output_tokens || 0,
			totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
			cacheCreationTokens: response.usage?.cache_creation_input_tokens || 0,
			cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
			stopReason: response.stop_reason || null,
			timestamp: Date.now()
		};
	}

	/**
	 * Returns structured usage data from the last API call.
	 * Includes CUMULATIVE token counts across all retry attempts.
	 * @returns {UsageData|null}
	 */
	getLastUsage() {
		if (!this.lastResponseMetadata) return null;

		const meta = this.lastResponseMetadata;
		const cumulative = this._cumulativeUsage || { promptTokens: 0, responseTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, attempts: 1 };
		const useCumulative = cumulative.attempts > 0;

		const promptTokens = useCumulative ? cumulative.promptTokens : meta.promptTokens;
		const responseTokens = useCumulative ? cumulative.responseTokens : meta.responseTokens;
		const totalTokens = useCumulative ? cumulative.totalTokens : meta.totalTokens;
		// Cache tokens accumulate across retries when tracked (Message); otherwise
		// fall back to the last response's values (single-call classes).
		const cacheCreationTokens = useCumulative && cumulative.cacheCreationTokens !== undefined ? cumulative.cacheCreationTokens : meta.cacheCreationTokens;
		const cacheReadTokens = useCumulative && cumulative.cacheReadTokens !== undefined ? cumulative.cacheReadTokens : meta.cacheReadTokens;

		return {
			promptTokens,
			responseTokens,
			totalTokens,
			cacheCreationTokens,
			cacheReadTokens,
			attempts: useCumulative ? cumulative.attempts : 1,
			modelVersion: meta.modelVersion,
			requestedModel: meta.requestedModel,
			stopReason: meta.stopReason,
			timestamp: meta.timestamp,
			estimatedCost: this._estimatedCost(meta.modelVersion, promptTokens, responseTokens, cacheCreationTokens, cacheReadTokens)
		};
	}

	/**
	 * Estimated USD cost, preferring the model id the API echoed (`modelVersion`)
	 * and falling back to the requested model when that build isn't priced.
	 * @param {string|null|undefined} modelVersion
	 * @param {number} promptTokens
	 * @param {number} responseTokens
	 * @param {number} [cacheCreationTokens=0]
	 * @param {number} [cacheReadTokens=0]
	 * @returns {number|null}
	 * @protected
	 */
	_estimatedCost(modelVersion, promptTokens, responseTokens, cacheCreationTokens = 0, cacheReadTokens = 0) {
		const opts = { cacheTtl: /** @type {'5m'|'1h'} */ (this.cacheTtl) };
		return computeCost(modelVersion, promptTokens, responseTokens, cacheCreationTokens, cacheReadTokens, opts)
			?? computeCost(this.modelName, promptTokens, responseTokens, cacheCreationTokens, cacheReadTokens, opts);
	}

	/**
	 * Builds a usage object directly from a single API response, WITHOUT reading
	 * mutable instance state (`lastResponseMetadata`/`_cumulativeUsage`). Safe to
	 * call under concurrent send() calls on a shared instance — unlike
	 * getLastUsage(), which reflects whichever call most recently mutated the
	 * instance and can cross-talk between concurrent sends.
	 * @param {Object} response - A single messages.create() response
	 * @param {number} [attempts=1] - Attempts this call consumed
	 * @returns {UsageData}
	 * @protected
	 */
	_usageFromResponse(response, attempts = 1) {
		const promptTokens = response?.usage?.input_tokens || 0;
		const responseTokens = response?.usage?.output_tokens || 0;
		const cacheCreationTokens = response?.usage?.cache_creation_input_tokens || 0;
		const cacheReadTokens = response?.usage?.cache_read_input_tokens || 0;
		const modelVersion = response?.model || null;
		return {
			promptTokens,
			responseTokens,
			totalTokens: promptTokens + responseTokens,
			cacheCreationTokens,
			cacheReadTokens,
			attempts,
			modelVersion,
			requestedModel: this.modelName,
			stopReason: response?.stop_reason || null,
			timestamp: Date.now(),
			estimatedCost: this._estimatedCost(modelVersion, promptTokens, responseTokens, cacheCreationTokens, cacheReadTokens)
		};
	}

	// ── Token Estimation ────────────────────────────────────────────────────

	/**
	 * Estimates INPUT token count for a payload before sending.
	 * Includes system prompt + chat history + your new message.
	 * Uses Claude's token counting API.
	 * @param {Object|string} nextPayload - The next message to estimate
	 * @returns {Promise<{ inputTokens: number }>}
	 */
	async estimate(nextPayload) {
		if (!this._initialized) await this.init();

		const nextMessage = typeof nextPayload === 'string'
			? nextPayload
			: JSON.stringify(nextPayload, null, 2);

		const messages = [
			...this.history,
			{ role: 'user', content: nextMessage }
		];

		/** @type {any} */
		const params = {
			model: this.modelName,
			messages,
			...(this._buildSystemParam() && { system: this._buildSystemParam() }),
		};

		// Include tools if subclass has them (e.g., ToolAgent)
		if (/** @type {any} */ (this).tools?.length > 0) {
			params.tools = /** @type {any} */ (this).tools;
		}

		const resp = await this.client.messages.countTokens(params);
		return { inputTokens: resp.input_tokens };
	}

	/**
	 * Estimates the INPUT cost of sending a payload based on model pricing.
	 * @param {Object|string} nextPayload - The next message to estimate
	 * @returns {Promise<{ inputTokens: number, model: string, pricing: { input: number, output: number }, estimatedInputCost: number, note: string }>}
	 */
	async estimateCost(nextPayload) {
		const tokenInfo = await this.estimate(nextPayload);
		const pricing = resolvePricing(this.modelName);

		return {
			inputTokens: tokenInfo.inputTokens,
			model: this.modelName,
			pricing,
			estimatedInputCost: pricing ? (tokenInfo.inputTokens / 1_000_000) * pricing.input : null,
			note: pricing
				? 'Cost is for input tokens only; output cost depends on response length'
				: `No pricing known for model "${this.modelName}"; estimatedInputCost is null`
		};
	}

	// ── Model Management ─────────────────────────────────────────────────────

	/**
	 * Lists all available models from the Anthropic API.
	 * Provides model IDs, display names, and creation dates.
	 * Returns an async iterable that automatically fetches more pages as needed.
	 *
	 * NOTE: Only available with direct Anthropic API access (not Vertex AI).
	 * @returns {AsyncIterable<Object>} AsyncIterable of model objects
	 * @throws {Error} If using Vertex AI authentication
	 * @example
	 * const chat = new Chat({ apiKey: 'your-key' });
	 * for await (const model of chat.listModels()) {
	 *   console.log(model.id, model.display_name);
	 * }
	 */
	async *listModels() {
		if (this.vertexai) {
			throw new Error('listModels() is not available with Vertex AI. Use direct Anthropic API authentication instead.');
		}
		await this._ensureClient();
		const pageIterator = this.client.beta.models.list();
		for await (const model of pageIterator) {
			yield model;
		}
	}

	/**
	 * Retrieves detailed information about a specific model.
	 *
	 * NOTE: Only available with direct Anthropic API access (not Vertex AI).
	 * @param {string} modelId - The model ID (e.g., 'claude-sonnet-4-6')
	 * @returns {Promise<Object>} The model details
	 * @throws {Error} If using Vertex AI authentication
	 * @example
	 * const chat = new Chat({ apiKey: 'your-key' });
	 * const modelInfo = await chat.getModel('claude-sonnet-4-6');
	 * console.log(modelInfo);
	 */
	async getModel(modelId) {
		if (this.vertexai) {
			throw new Error('getModel() is not available with Vertex AI. Use direct Anthropic API authentication instead.');
		}
		await this._ensureClient();
		return await this.client.beta.models.retrieve(modelId);
	}

	// ── Application-Level Retry ──────────────────────────────────────────────

	/**
	 * Wraps an async function with retry logic.
	 * Note: The Anthropic SDK handles 429s natively via maxRetries.
	 * This is for application-level retries (e.g., Transformer self-healing).
	 * @param {() => Promise<T>} fn - The async function to execute
	 * @returns {Promise<T>}
	 * @template T
	 * @protected
	 */
	async _withRetry(fn) {
		return await fn();
	}

	// ── Private Helpers ──────────────────────────────────────────────────────

	/**
	 * Configures the log level based on options, env vars, or NODE_ENV.
	 * @param {string} [logLevel]
	 * @private
	 */
	_configureLogLevel(logLevel) {
		if (logLevel) {
			if (logLevel === 'none') {
				log.level = 'silent';
			} else {
				log.level = logLevel;
			}
		} else if (LOG_LEVEL) {
			log.level = LOG_LEVEL;
		} else if (NODE_ENV === 'dev') {
			log.level = 'debug';
		} else if (NODE_ENV === 'test') {
			log.level = 'warn';
		} else if (NODE_ENV.startsWith('prod')) {
			log.level = 'error';
		} else {
			log.level = 'info';
		}
	}
}

export default BaseClaude;
