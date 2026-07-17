/**
 * @fileoverview Message class — stateless one-off messages to AI.
 * Uses messages.create() directly without maintaining conversation history.
 */

import BaseClaude, { computeCost } from './base.js';
import { extractJSON, validateSchema } from './json-helpers.js';
import log from './logger.js';

/**
 * @typedef {import('./types').MessageOptions} MessageOptions
 * @typedef {import('./types').MessageResponse} MessageResponse
 */

/**
 * Stateless one-off messages to AI.
 * Each send() call is independent — no conversation history is maintained.
 *
 * Optionally returns structured data via native structured outputs (responseSchema)
 * or system prompt fallback (responseFormat: 'json').
 *
 * @example
 * ```javascript
 * import { Message } from 'ak-claude';
 *
 * // Simple text response
 * const msg = new Message({
 *   systemPrompt: 'You are a helpful assistant.'
 * });
 * const r = await msg.send('What is the capital of France?');
 * console.log(r.text); // "The capital of France is Paris."
 *
 * // Native structured output (guaranteed valid JSON matching schema)
 * const schemaMsg = new Message({
 *   systemPrompt: 'Extract entities from text.',
 *   responseSchema: {
 *     type: 'object',
 *     properties: {
 *       entities: {
 *         type: 'array',
 *         items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'] }
 *       }
 *     },
 *     required: ['entities']
 *   }
 * });
 * const r2 = await schemaMsg.send('Alice works at Acme Corp in New York.');
 * console.log(r2.data); // { entities: [...] }
 *
 * // Fallback: system prompt JSON mode (no schema guarantee)
 * const jsonMsg = new Message({
 *   systemPrompt: 'Extract entities from text.',
 *   responseFormat: 'json'
 * });
 * const r3 = await jsonMsg.send('Alice works at Acme Corp in New York.');
 * console.log(r3.data); // { entities: [...] }
 * ```
 */
class Message extends BaseClaude {
	/**
	 * @param {MessageOptions} [options={}]
	 */
	constructor(options = {}) {
		super(options);

		this._responseSchema = options.responseSchema || null;
		this._isStructured = !!(this._responseSchema || options.responseFormat === 'json');

		// Extra re-send attempts when a schema-fallback response fails validation
		// (Vertex prompt-paste path only). 0 disables retry. Default 2.
		this.validationRetries = options.validationRetries ?? 2;

		log.debug(`Message created (structured=${this._isStructured}, nativeSchema=${!!this._responseSchema})`);
	}

	/**
	 * Initialize the Message client.
	 * Override: stateless, no history needed.
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
		log.debug(`${this.constructor.name}: Initialized (stateless mode).`);
	}

	/**
	 * Send a stateless message and get a response.
	 * Each call is independent — no history is maintained.
	 *
	 * @param {Object|string} payload - The message or data to send
	 * @param {Object} [opts={}] - Per-message options
	 * @returns {Promise<MessageResponse>} Response with text, optional data, and usage
	 */
	async send(payload, opts = {}) {
		if (!this._initialized) await this.init();

		const payloadStr = typeof payload === 'string'
			? payload
			: JSON.stringify(payload, null, 2);

		// Build system prompt, augmenting with JSON instruction if structured (fallback mode only)
		let systemParam = this._buildSystemParam();
		if (this._isStructured && !this._responseSchema) {
			// Fallback: no native schema, use system prompt hacking
			if (systemParam) {
				const jsonInstruction = '\n\nAlways respond ONLY with valid JSON. No markdown code blocks, no preamble text.';
				if (typeof systemParam === 'string') {
					systemParam = systemParam + jsonInstruction;
				} else if (Array.isArray(systemParam)) {
					systemParam = [...systemParam, { type: 'text', text: jsonInstruction }];
				}
			} else {
				systemParam = 'Always respond ONLY with valid JSON. No markdown code blocks, no preamble text.';
			}
		}

		// Vertex has no native structured-output enforcement here (the schema is
		// pasted into the prompt), so a fallback response can be schema-invalid.
		// Validate + retry only on that path; the native path is guaranteed valid.
		const usesFallbackSchema = !!(this._responseSchema && this.vertexai);
		const retries = Math.max(0, Number(this.validationRetries) || 0);
		const maxAttempts = usesFallbackSchema ? 1 + retries : 1;

		/** @type {any} */
		const baseParams = {
			model: this.modelName,
			max_tokens: opts.maxTokens || this.maxTokens,
			...(systemParam && { system: systemParam }),
		};

		// Native structured output via JSON Schema (direct API only, not Vertex here).
		if (this._responseSchema && !this.vertexai) {
			baseParams.output_config = {
				format: {
					type: 'json_schema',
					schema: this._responseSchema
				}
			};
		} else if (usesFallbackSchema) {
			// Fallback: inject schema into system prompt for Vertex AI.
			const schemaInstruction = `\n\nRespond ONLY with valid JSON matching this schema:\n${JSON.stringify(this._responseSchema, null, 2)}\nNo markdown code blocks, no preamble text.`;
			if (typeof baseParams.system === 'string') {
				baseParams.system += schemaInstruction;
			} else if (Array.isArray(baseParams.system)) {
				baseParams.system = [...baseParams.system, { type: 'text', text: schemaInstruction }];
			} else {
				baseParams.system = schemaInstruction.trim();
			}
		}

		if (this.thinking) {
			baseParams.thinking = this.thinking;
		} else {
			if (this.temperature !== undefined) baseParams.temperature = this.temperature;
			if (this.topP !== undefined) baseParams.top_p = this.topP;
		}

		let userContent = payloadStr;
		let text = '';
		let data;
		/** @type {string[]|null} */
		let validationErrors = null;
		/** @type {any} */
		let lastResponse = null;
		let cumPrompt = 0, cumResponse = 0, attempts = 0;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const params = { ...baseParams, messages: [{ role: /** @type {'user'} */ ('user'), content: userContent }] };
			const response = await this.client.messages.create(params);
			lastResponse = response;
			attempts = attempt;

			// Accumulate usage across retries; each read is from THIS response only
			// (concurrency-safe — never through mutable instance state after an await).
			const perCall = this._usageFromResponse(response, attempt);
			cumPrompt += perCall.promptTokens;
			cumResponse += perCall.responseTokens;

			this._captureMetadata(response);
			text = this._extractText(response);

			if (!this._isStructured) { data = undefined; break; }

			// Parse
			try {
				data = (this._responseSchema && !this.vertexai)
					? JSON.parse(text)          // native — guaranteed valid JSON
					: extractJSON(text);        // fallback — extract from messy text
			} catch (e) {
				log.warn(`Could not parse structured response: ${e.message}`);
				data = null;
			}

			// Validation + retry only on the fallback (Vertex prompt-paste) path.
			if (!usesFallbackSchema) { validationErrors = null; break; }

			if (data === null) {
				validationErrors = ['$: could not parse any JSON from the model response'];
			} else {
				const errs = validateSchema(data, this._responseSchema);
				validationErrors = errs.length ? errs : null;
			}

			if (!validationErrors) break; // valid — done

			if (attempt < maxAttempts) {
				log.warn(`Structured output failed schema validation (attempt ${attempt}/${maxAttempts}): ${validationErrors.join('; ')}. Retrying with error feedback.`);
				userContent = `${payloadStr}\n\nYour previous response did not satisfy the required JSON schema:\n${validationErrors.map(e => `- ${e}`).join('\n')}\n\nRespond ONLY with corrected JSON that matches the schema. No markdown, no preamble.`;
			} else {
				// Never return a schema-invalid object as success.
				log.warn(`Structured output still invalid after ${attempt} attempt(s). Returning data: null with validationErrors.`);
				data = null;
			}
		}

		// Update instance state for getLastUsage() back-compat (last-write-wins;
		// unsafe under concurrency — callers should prefer result.usage).
		this._cumulativeUsage = {
			promptTokens: cumPrompt,
			responseTokens: cumResponse,
			totalTokens: cumPrompt + cumResponse,
			attempts
		};

		const perCall = this._usageFromResponse(lastResponse, attempts);
		const usage = {
			...perCall,
			promptTokens: cumPrompt,
			responseTokens: cumResponse,
			totalTokens: cumPrompt + cumResponse,
			estimatedCost: computeCost(perCall.modelVersion, cumPrompt, cumResponse)
				?? computeCost(this.modelName, cumPrompt, cumResponse)
		};

		/** @type {any} */
		const result = { text, usage };
		if (this._isStructured) result.data = data;
		if (validationErrors) result.validationErrors = validationErrors;

		return result;
	}

	// ── No-ops for stateless class ──

	/** @returns {Array} Always returns empty array (stateless). */
	getHistory() { return []; }

	/** No-op (stateless). */
	async clearHistory() { }

	/** Not supported on Message (stateless). */
	async seed() {
		log.warn("Message is stateless — seed() has no effect. Use Transformer or Chat for few-shot learning.");
		return [];
	}
}

export default Message;
