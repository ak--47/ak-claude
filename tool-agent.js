/**
 * @fileoverview ToolAgent class — AI agent with user-provided tools.
 * Extends BaseClaude with automatic tool-use loops for both streaming
 * and non-streaming conversations.
 *
 * Claude's tool-use flow:
 * 1. Send message with tools[] array
 * 2. Response has stop_reason: 'tool_use' and content blocks with type: 'tool_use'
 * 3. Execute tools, send back type: 'tool_result' content blocks as user message
 * 4. Repeat until stop_reason: 'end_turn'
 */

import BaseClaude from './base.js';
import log from './logger.js';

/**
 * @typedef {import('./types').ToolAgentOptions} ToolAgentOptions
 * @typedef {import('./types').AgentResponse} AgentResponse
 * @typedef {import('./types').AgentStreamEvent} AgentStreamEvent
 */

/**
 * AI agent that uses user-provided tools to accomplish tasks.
 * Automatically manages the tool-use loop: when Claude decides to call
 * a tool, the agent executes it via your toolExecutor, sends the result back,
 * and continues until Claude produces a final text response.
 *
 * Ships with zero built-in tools — you provide everything via the constructor.
 *
 * @example
 * ```javascript
 * import { ToolAgent } from 'ak-claude';
 *
 * const agent = new ToolAgent({
 *   systemPrompt: 'You are a research assistant.',
 *   tools: [
 *     {
 *       name: 'http_get',
 *       description: 'Fetch a URL and return its contents',
 *       input_schema: {
 *         type: 'object',
 *         properties: { url: { type: 'string', description: 'The URL to fetch' } },
 *         required: ['url']
 *       }
 *     }
 *   ],
 *   toolExecutor: async (toolName, args) => {
 *     if (toolName === 'http_get') {
 *       const res = await fetch(args.url);
 *       return { status: res.status, body: await res.text() };
 *     }
 *     throw new Error(`Unknown tool: ${toolName}`);
 *   }
 * });
 *
 * const result = await agent.chat('Fetch https://api.example.com/data and summarize it');
 * console.log(result.text);      // Agent's summary
 * console.log(result.toolCalls); // [{ name: 'http_get', args: {...}, result: {...} }]
 * ```
 */
class ToolAgent extends BaseClaude {
	/**
	 * @param {ToolAgentOptions} [options={}]
	 */
	constructor(options = {}) {
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: 'You are a helpful AI assistant.' };
		}

		super(options);

		// ── Tools ──
		// Accept both Claude format (input_schema) and Gemini format (parametersJsonSchema)
		this.tools = (options.tools || []).map(t => ({
			name: t.name,
			description: t.description,
			input_schema: t.input_schema || t.inputSchema || t.parametersJsonSchema
		}));
		this.toolExecutor = options.toolExecutor || null;

		// Validate: if tools provided, executor is required (and vice versa)
		if (this.tools.length > 0 && !this.toolExecutor) {
			throw new Error("ToolAgent: tools provided without a toolExecutor. Provide a toolExecutor function to handle tool calls.");
		}
		if (this.toolExecutor && this.tools.length === 0) {
			throw new Error("ToolAgent: toolExecutor provided without tools. Provide tool declarations so the model knows what tools are available.");
		}

		// ── Tool choice ──
		this.toolChoice = options.toolChoice ?? undefined;
		this.disableParallelToolUse = options.disableParallelToolUse ?? false;

		// ── Tool loop config ──
		this.maxToolRounds = options.maxToolRounds || 10;
		this.onToolCall = options.onToolCall || null;
		this.onBeforeExecution = options.onBeforeExecution || null;
		this._stopped = false;

		log.debug(`ToolAgent created with ${this.tools.length} tools`);
	}

	/**
	 * Builds the tool_choice parameter for API calls.
	 * @returns {Object|undefined}
	 * @private
	 */
	_buildToolChoice() {
		let choice = this.toolChoice;
		if (!choice && !this.disableParallelToolUse) return undefined;

		// Default to auto if only disableParallelToolUse is set
		if (!choice) choice = { type: 'auto' };

		// Clone to avoid mutating the original
		/** @type {any} */
		const result = { ...choice };
		if (this.disableParallelToolUse) {
			result.disable_parallel_tool_use = true;
		}
		return result;
	}

	// ── Non-Streaming Chat ───────────────────────────────────────────────────

	/**
	 * Send a message and get a complete response (non-streaming).
	 * Automatically handles the tool-use loop.
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}] - Per-message options
	 * @returns {Promise<AgentResponse>} Response with text, toolCalls, and usage
	 */
	async chat(message, opts = {}) {
		if (!this._initialized) await this.init();
		this._stopped = false;

		const allToolCalls = [];

		const toolChoice = this._buildToolChoice();
		let response = await this._sendMessage(message, { tools: this.tools, ...(toolChoice && { tool_choice: toolChoice }) });

		for (let round = 0; round < this.maxToolRounds; round++) {
			if (this._stopped) break;
			if (response.stop_reason !== 'tool_use') break;

			// Extract tool_use blocks from response content
			const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
			if (toolUseBlocks.length === 0) break;

			// Execute tools and build tool_result content blocks
			const toolResults = [];
			for (const block of toolUseBlocks) {
				// Fire onToolCall callback
				if (this.onToolCall) {
					try { this.onToolCall(block.name, block.input); }
					catch (e) { log.warn(`onToolCall callback error: ${e.message}`); }
				}

				// Check onBeforeExecution gate
				if (this.onBeforeExecution) {
					try {
						const allowed = await this.onBeforeExecution(block.name, block.input);
						if (allowed === false) {
							const result = { error: 'Execution denied by onBeforeExecution callback' };
							allToolCalls.push({ name: block.name, args: block.input, result });
							toolResults.push({
								type: 'tool_result',
								tool_use_id: block.id,
								content: JSON.stringify(result)
							});
							continue;
						}
					} catch (e) {
						log.warn(`onBeforeExecution callback error: ${e.message}`);
					}
				}

				let result;
				try {
					result = await this.toolExecutor(block.name, block.input);
				} catch (err) {
					log.warn(`Tool ${block.name} failed: ${err.message}`);
					result = { error: err.message };
				}

				allToolCalls.push({ name: block.name, args: block.input, result });

				toolResults.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: typeof result === 'string' ? result : JSON.stringify(result)
				});
			}

			// Send tool results back to Claude as user message
			response = await this._sendMessage(toolResults, { tools: this.tools, ...(toolChoice && { tool_choice: toolChoice }) });
		}

		// Set cumulative usage
		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		return {
			text: this._extractText(response),
			toolCalls: allToolCalls,
			usage: this.getLastUsage()
		};
	}

	// ── Streaming ────────────────────────────────────────────────────────────

	/**
	 * Send a message and stream the response as events.
	 * Automatically handles the tool-use loop between streamed rounds.
	 *
	 * Event types:
	 * - `text` — A chunk of the agent's text response
	 * - `tool_call` — The agent is about to call a tool
	 * - `tool_result` — A tool finished executing
	 * - `done` — The agent finished
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}] - Per-message options
	 * @yields {AgentStreamEvent}
	 */
	async *stream(message, opts = {}) {
		if (!this._initialized) await this.init();
		this._stopped = false;

		const allToolCalls = [];
		let fullText = '';

		// First round: send user message
		const toolChoice = this._buildToolChoice();
		let stream = await this._streamMessage(message, { tools: this.tools, ...(toolChoice && { tool_choice: toolChoice }) });

		for (let round = 0; round < this.maxToolRounds; round++) {
			if (this._stopped) break;

			const finalMessage = await stream.finalMessage();

			// Yield text and collect tool_use blocks
			const toolUseBlocks = [];
			for (const block of finalMessage.content) {
				if (block.type === 'text') {
					fullText += block.text;
					yield { type: 'text', text: block.text };
				} else if (block.type === 'tool_use') {
					toolUseBlocks.push(block);
				}
			}

			// Push assistant response to history
			// (_streamMessage pushed user msg but not assistant response)
			this.history.push({ role: 'assistant', content: finalMessage.content });

			this._captureMetadata(finalMessage);

			// No tool calls — we're done
			if (finalMessage.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
				yield {
					type: 'done',
					fullText,
					usage: this.getLastUsage()
				};
				return;
			}

			// Execute tools sequentially so we can yield events
			const toolResults = [];
			for (const block of toolUseBlocks) {
				if (this._stopped) break;

				yield { type: 'tool_call', toolName: block.name, args: block.input };

				// Fire onToolCall callback
				if (this.onToolCall) {
					try { this.onToolCall(block.name, block.input); }
					catch (e) { log.warn(`onToolCall callback error: ${e.message}`); }
				}

				// Check onBeforeExecution gate
				let denied = false;
				if (this.onBeforeExecution) {
					try {
						const allowed = await this.onBeforeExecution(block.name, block.input);
						if (allowed === false) denied = true;
					} catch (e) {
						log.warn(`onBeforeExecution callback error: ${e.message}`);
					}
				}

				let result;
				if (denied) {
					result = { error: 'Execution denied by onBeforeExecution callback' };
				} else {
					try {
						result = await this.toolExecutor(block.name, block.input);
					} catch (err) {
						log.warn(`Tool ${block.name} failed: ${err.message}`);
						result = { error: err.message };
					}
				}

				allToolCalls.push({ name: block.name, args: block.input, result });
				yield { type: 'tool_result', toolName: block.name, result };

				toolResults.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: typeof result === 'string' ? result : JSON.stringify(result)
				});
			}

			// Send tool results back and get next stream
			stream = await this._streamMessage(toolResults, { tools: this.tools, ...(toolChoice && { tool_choice: toolChoice }) });
		}

		// Max rounds reached or stopped
		yield {
			type: 'done',
			fullText,
			usage: this.getLastUsage(),
			warning: this._stopped ? 'Agent was stopped' : 'Max tool rounds reached'
		};
	}

	// ── Stop ────────────────────────────────────────────────────────────────

	/**
	 * Stop the agent before the next tool execution round.
	 */
	stop() {
		this._stopped = true;
		log.info('ToolAgent stopped');
	}
}

export default ToolAgent;
