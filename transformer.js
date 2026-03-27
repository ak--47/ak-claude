/**
 * @fileoverview Transformer class — AI-powered JSON transformation via few-shot learning.
 * Extends BaseClaude with validation, retry logic, and structured JSON output.
 */

import BaseClaude from './base.js';
import { extractJSON, isJSON } from './json-helpers.js';
import log from './logger.js';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON).

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.

Do not wrap your response in markdown code blocks.
`;

/**
 * @typedef {import('./types').TransformerOptions} TransformerOptions
 * @typedef {import('./types').AsyncValidatorFunction} AsyncValidatorFunction
 * @typedef {import('./types').TransformationExample} TransformationExample
 * @typedef {import('./types').UsageData} UsageData
 */

/**
 * AI-powered JSON transformation using few-shot learning.
 *
 * Seed with example input/output pairs, then send new payloads to transform.
 * Supports validation, automatic retry with AI-powered error correction,
 * and structured JSON output.
 *
 * @example
 * ```javascript
 * import { Transformer } from 'ak-claude';
 *
 * const t = new Transformer({
 *   promptKey: 'INPUT',
 *   answerKey: 'OUTPUT'
 * });
 *
 * await t.seed([
 *   { INPUT: { name: "Alice" }, OUTPUT: { greeting: "Hello, Alice!" } },
 *   { INPUT: { name: "Bob" },   OUTPUT: { greeting: "Hello, Bob!" } }
 * ]);
 *
 * const result = await t.send({ name: "Charlie" });
 * // => { greeting: "Hello, Charlie!" }
 * ```
 */
class Transformer extends BaseClaude {
	/**
	 * @param {TransformerOptions} [options={}]
	 */
	constructor(options = {}) {
		// Set Transformer-specific systemPrompt default before calling super
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: DEFAULT_SYSTEM_INSTRUCTIONS };
		}

		super(options);

		// ── JSON-specific config ──
		this.onlyJSON = options.onlyJSON !== undefined ? options.onlyJSON : true;

		// ── Example key mapping ──
		this.promptKey = options.promptKey || options.sourceKey || 'PROMPT';
		this.answerKey = options.answerKey || options.targetKey || 'ANSWER';
		this.contextKey = options.contextKey || 'CONTEXT';
		this.explanationKey = options.explanationKey || 'EXPLANATION';
		this.systemPromptKey = options.systemPromptKey || 'SYSTEM';

		if (this.promptKey === this.answerKey) {
			throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
		}

		// ── Examples source ──
		this.examplesFile = options.examplesFile || null;
		this.exampleData = options.exampleData || null;

		// ── Validation & retry ──
		this.asyncValidator = options.asyncValidator || null;
		this.validationRetries = options.maxRetries || 3;
		this.retryDelay = options.retryDelay || 1000;

		log.debug(`Transformer keys — Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);
	}

	// ── Seeding ──────────────────────────────────────────────────────────────

	/**
	 * Seeds the conversation with transformation examples using the configured key mapping.
	 * Overrides base seed() to use Transformer-specific keys and support
	 * examplesFile/exampleData fallbacks.
	 *
	 * @param {TransformationExample[]} [examples] - Array of example objects
	 * @returns {Promise<Array>} The updated history
	 */
	async seed(examples) {
		await this.init();

		if (!examples || !Array.isArray(examples) || examples.length === 0) {
			if (this.examplesFile) {
				log.debug(`No examples provided, loading from file: ${this.examplesFile}`);
				try {
					const filePath = path.resolve(this.examplesFile);
					const raw = await fs.readFile(filePath, 'utf-8');
					examples = JSON.parse(raw);
				} catch (err) {
					throw new Error(`Could not load examples from file: ${this.examplesFile}. ${err.message}`);
				}
			} else if (this.exampleData) {
				log.debug(`Using example data provided in options.`);
				if (Array.isArray(this.exampleData)) {
					examples = this.exampleData;
				} else {
					throw new Error(`Invalid example data provided. Expected an array of examples.`);
				}
			} else {
				log.debug("No examples provided and no examples file specified. Skipping seeding.");
				return this.getHistory();
			}
		}

		// Delegate to base.seed() with our key mapping
		return await super.seed(examples, {
			promptKey: this.promptKey,
			answerKey: this.answerKey,
			contextKey: this.contextKey,
			explanationKey: this.explanationKey,
			systemPromptKey: this.systemPromptKey
		});
	}

	// ── Primary Send Method ──────────────────────────────────────────────────

	/**
	 * Transforms a payload using the seeded examples and model.
	 * Includes validation and automatic retry with AI-powered error correction.
	 *
	 * @param {Object|string} payload - The source payload to transform
	 * @param {Object} [opts={}] - Per-message options
	 * @param {AsyncValidatorFunction|null} [validatorFn] - Validator for this call (overrides constructor validator)
	 * @returns {Promise<Object>} The transformed payload
	 */
	async send(payload, opts = {}, validatorFn = null) {
		if (!this._initialized) await this.init();

		// Use the validator from this call, or fall back to the constructor validator
		const validator = validatorFn || this.asyncValidator;

		// Handle stateless messages
		if (opts.stateless) {
			return await this._statelessSend(payload, opts, validator);
		}

		const maxRetries = opts.maxRetries ?? this.validationRetries;
		const retryDelay = opts.retryDelay ?? this.retryDelay;

		// Prepare the payload
		let lastPayload = this._preparePayload(payload);

		// Reset cumulative usage tracking
		this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };

		let lastError = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const transformedPayload = (attempt === 0)
					? await this.rawSend(lastPayload)
					: await this.rebuild(lastPayload, lastError.message);

				// Accumulate token usage
				if (this.lastResponseMetadata) {
					this._cumulativeUsage.promptTokens += this.lastResponseMetadata.promptTokens || 0;
					this._cumulativeUsage.responseTokens += this.lastResponseMetadata.responseTokens || 0;
					this._cumulativeUsage.totalTokens += this.lastResponseMetadata.totalTokens || 0;
					this._cumulativeUsage.attempts = attempt + 1;
				}

				lastPayload = transformedPayload;

				// Validate
				if (validator) {
					await validator(transformedPayload);
				}

				log.debug(`Transformation succeeded on attempt ${attempt + 1}`);
				return transformedPayload;

			} catch (error) {
				lastError = error;
				log.warn(`Attempt ${attempt + 1} failed: ${error.message}`);

				if (attempt >= maxRetries) {
					log.error(`All ${maxRetries + 1} attempts failed.`);
					throw new Error(`Transformation failed after ${maxRetries + 1} attempts. Last error: ${error.message}`);
				}

				const delay = retryDelay * Math.pow(2, attempt);
				await new Promise(res => setTimeout(res, delay));
			}
		}
	}

	// ── Raw Send ─────────────────────────────────────────────────────────────

	/**
	 * Sends a single prompt to the model and parses the JSON response.
	 * No validation or retry logic.
	 *
	 * @param {Object|string} payload - The source payload
	 * @returns {Promise<Object>} The transformed payload
	 */
	async rawSend(payload) {
		if (!this._initialized) await this.init();

		const actualPayload = typeof payload === 'string'
			? payload
			: JSON.stringify(payload, null, 2);

		try {
			const response = await this._sendMessage(actualPayload);

			const modelResponse = this._extractText(response);

			if (response.usage && log.level !== 'silent') {
				log.debug(`API response: model=${response.model || 'unknown'}, tokens=${response.usage.input_tokens + response.usage.output_tokens}`);
			}

			const extractedJSON = extractJSON(modelResponse);

			// Unwrap the 'data' property if it exists
			if (extractedJSON?.data) {
				return extractedJSON.data;
			}
			return extractedJSON;

		} catch (error) {
			if (this.onlyJSON && error.message.includes("Could not extract valid JSON")) {
				throw new Error(`Invalid JSON response from Claude: ${error.message}`);
			}
			throw new Error(`Transformation failed: ${error.message}`);
		}
	}

	// ── Rebuild ──────────────────────────────────────────────────────────────

	/**
	 * Asks the model to fix a payload that failed validation.
	 *
	 * @param {Object} lastPayload - The payload that failed
	 * @param {string} serverError - The error message
	 * @returns {Promise<Object>} Corrected payload
	 */
	async rebuild(lastPayload, serverError) {
		await this.init();
		const prompt = `
The previous JSON payload (below) failed validation.
The server's error message is quoted afterward.

---------------- BAD PAYLOAD ----------------
${JSON.stringify(lastPayload, null, 2)}


---------------- SERVER ERROR ----------------
${serverError}

Please return a NEW JSON payload that corrects the issue.
Respond with JSON only – no comments or explanations.
`;

		let response;
		try {
			response = await this._sendMessage(prompt);
		} catch (err) {
			throw new Error(`Claude call failed while repairing payload: ${err.message}`);
		}

		try {
			const text = this._extractText(response);
			return extractJSON(text);
		} catch (parseErr) {
			throw new Error(`Claude returned non-JSON while repairing payload: ${parseErr.message}`);
		}
	}

	// ── Stateless Send ───────────────────────────────────────────────────────

	/**
	 * Sends a one-off message (not using chat history).
	 * Does NOT affect conversation history.
	 * @param {Object|string} payload
	 * @param {Object} [opts={}]
	 * @param {AsyncValidatorFunction|null} [validatorFn]
	 * @returns {Promise<Object>}
	 * @private
	 */
	async _statelessSend(payload, opts = {}, validatorFn = null) {
		const payloadStr = typeof payload === 'string'
			? payload
			: JSON.stringify(payload, null, 2);

		// Build messages with seeded examples but without chat history
		const messages = [];

		// Include seeded examples
		if (this.exampleCount > 0) {
			const exampleHistory = this.history.slice(0, this.exampleCount);
			messages.push(...exampleHistory);
		}

		messages.push({ role: 'user', content: payloadStr });

		/** @type {any} */
		const params = {
			model: this.modelName,
			max_tokens: opts.maxTokens || this.maxTokens,
			messages,
			...(this._buildSystemParam() && { system: this._buildSystemParam() }),
		};

		if (this.thinking) {
			params.thinking = this.thinking;
		} else {
			if (this.temperature !== undefined) params.temperature = this.temperature;
			if (this.topP !== undefined) params.top_p = this.topP;
		}

		const response = await this.client.messages.create(params);
		this._captureMetadata(response);

		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		const modelResponse = this._extractText(response);
		const extractedJSON = extractJSON(modelResponse);
		let transformedPayload = extractedJSON?.data ? extractedJSON.data : extractedJSON;

		if (validatorFn) {
			await validatorFn(transformedPayload);
		}

		return transformedPayload;
	}

	// ── History Management ───────────────────────────────────────────────────

	/**
	 * Clears conversation history while preserving seeded examples.
	 * @returns {Promise<void>}
	 */
	async clearHistory() {
		const exampleHistory = this.history.slice(0, this.exampleCount || 0);
		this.history = exampleHistory;
		this.lastResponseMetadata = null;
		this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
		log.debug(`Conversation cleared. Preserved ${exampleHistory.length} example items.`);
	}

	/**
	 * Fully resets the conversation, clearing all history including examples.
	 * @returns {Promise<void>}
	 */
	async reset() {
		this.history = [];
		this.exampleCount = 0;
		this.lastResponseMetadata = null;
		this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
		log.debug("Conversation fully reset.");
	}

	/**
	 * Updates system prompt.
	 * @param {string} newPrompt - The new system prompt
	 * @returns {Promise<void>}
	 */
	async updateSystemPrompt(newPrompt) {
		if (!newPrompt || typeof newPrompt !== 'string') {
			throw new Error('System prompt must be a non-empty string');
		}
		this.systemPrompt = newPrompt.trim();
		log.debug('System prompt updated.');
	}

	// ── Private Helpers ──────────────────────────────────────────────────────

	/**
	 * Normalizes a payload to a string for sending.
	 * @param {*} payload
	 * @returns {string}
	 * @private
	 */
	_preparePayload(payload) {
		if (payload && isJSON(payload)) {
			return JSON.stringify(payload, null, 2);
		} else if (typeof payload === 'string') {
			return payload;
		} else if (typeof payload === 'boolean' || typeof payload === 'number') {
			return payload.toString();
		} else if (payload === null || payload === undefined) {
			return JSON.stringify({});
		} else {
			throw new Error("Invalid source payload. Must be a JSON object or string.");
		}
	}
}

export default Transformer;
