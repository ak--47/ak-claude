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

/** Model pricing per million tokens (as of March 2026) */
const MODEL_PRICING = {
	'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
	'claude-sonnet-4-5-20250514': { input: 3.00, output: 15.00 },
	'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
	'claude-opus-4-6': { input: 15.00, output: 75.00 },
	'claude-opus-4-5-20250514': { input: 15.00, output: 75.00 },
};

export { MODEL_PRICING, DEFAULT_MAX_TOKENS };

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
		this.modelName = options.modelName || 'claude-sonnet-4-6';

		// ── System Prompt ──
		if (options.systemPrompt !== undefined) {
			this.systemPrompt = options.systemPrompt;
		} else {
			this.systemPrompt = null; // subclasses override this default
		}

		// ── Vertex AI ──
		this.vertexai = options.vertexai ?? false;
		this.vertexProjectId = options.vertexProjectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? undefined;
		this.vertexRegion = options.vertexRegion ?? process.env.GOOGLE_CLOUD_LOCATION ?? 'us-east5';

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
		this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
		this.temperature = options.temperature ?? 0.7;
		// Vertex AI doesn't allow both temperature and topP - only set topP default for direct API
		this.topP = options.topP ?? (this.vertexai ? undefined : 0.95);
		this.topK = options.topK ?? undefined;

		// ── Extended Thinking ──
		this.thinking = options.thinking ?? null;

		// ── Prompt Caching ──
		this.cacheSystemPrompt = options.cacheSystemPrompt ?? false;

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

		if (this.healthCheck) {
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

		this._initialized = true;
		log.debug(`${this.constructor.name}: Initialized.`);
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
			return [{ type: 'text', text: this.systemPrompt, cache_control: { type: 'ephemeral' } }];
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
		/** @type {any} */
		const params = {
			model: opts.model || this.modelName,
			max_tokens: opts.maxTokens || this.maxTokens,
			messages: [...this.history],
			...(this._buildSystemParam() && { system: this._buildSystemParam() }),
			...(this.topK !== undefined && { top_k: this.topK }),
			...(tools && { tools }),
			...(opts.tool_choice && { tool_choice: opts.tool_choice }),
		};

		// Temperature/topP not allowed with extended thinking
		if (this.thinking) {
			params.thinking = this.thinking;
			// When thinking is enabled, temperature must be 1 and top_p/top_k are not supported
		} else {
			// Vertex AI doesn't allow both temperature and topP
			if (this.vertexai && this.temperature !== undefined && this.topP !== undefined) {
				// Prefer temperature, skip topP for Vertex AI
				params.temperature = this.temperature;
				log.debug('Vertex AI: Using temperature only (topP ignored)');
			} else {
				if (this.temperature !== undefined) params.temperature = this.temperature;
				if (this.topP !== undefined) params.top_p = this.topP;
			}
		}

		const response = await this.client.messages.create(params);

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

		/** @type {any} */
		const params = {
			model: opts.model || this.modelName,
			max_tokens: opts.maxTokens || this.maxTokens,
			messages: [...this.history],
			...(this._buildSystemParam() && { system: this._buildSystemParam() }),
			...(this.topK !== undefined && { top_k: this.topK }),
			...(tools && { tools }),
			...(opts.tool_choice && { tool_choice: opts.tool_choice }),
		};

		if (this.thinking) {
			params.thinking = this.thinking;
		} else {
			// Vertex AI doesn't allow both temperature and topP
			if (this.vertexai && this.temperature !== undefined && this.topP !== undefined) {
				// Prefer temperature, skip topP for Vertex AI
				params.temperature = this.temperature;
				log.debug('Vertex AI: Using temperature only (topP ignored)');
			} else {
				if (this.temperature !== undefined) params.temperature = this.temperature;
				if (this.topP !== undefined) params.top_p = this.topP;
			}
		}

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
		this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
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

			if (answerValue) modelResponse.data = answerValue;
			if (explanationValue) modelResponse.explanation = explanationValue;
			const modelText = JSON.stringify(modelResponse, null, 2);

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
		const cumulative = this._cumulativeUsage || { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 1 };
		const useCumulative = cumulative.attempts > 0;

		return {
			promptTokens: useCumulative ? cumulative.promptTokens : meta.promptTokens,
			responseTokens: useCumulative ? cumulative.responseTokens : meta.responseTokens,
			totalTokens: useCumulative ? cumulative.totalTokens : meta.totalTokens,
			cacheCreationTokens: meta.cacheCreationTokens,
			cacheReadTokens: meta.cacheReadTokens,
			attempts: useCumulative ? cumulative.attempts : 1,
			modelVersion: meta.modelVersion,
			requestedModel: meta.requestedModel,
			stopReason: meta.stopReason,
			timestamp: meta.timestamp
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
		const pricing = MODEL_PRICING[this.modelName] || { input: 0, output: 0 };

		return {
			inputTokens: tokenInfo.inputTokens,
			model: this.modelName,
			pricing,
			estimatedInputCost: (tokenInfo.inputTokens / 1_000_000) * pricing.input,
			note: 'Cost is for input tokens only; output cost depends on response length'
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
