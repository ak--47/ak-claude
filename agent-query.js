/**
 * @fileoverview AgentQuery class — wraps @anthropic-ai/claude-agent-sdk's query().
 *
 * Provides a simplified, declarative interface over the Claude Agent SDK.
 * This class does NOT extend BaseClaude — it wraps a completely different SDK
 * with its own auth, session, and execution model.
 *
 * The Agent SDK launches an autonomous Claude agent with built-in tools
 * (Read, Write, Edit, Bash, Glob, Grep, etc.) that can operate on files
 * and codebases directly.
 */

import log from './logger.js';

/**
 * @typedef {import('./types').AgentQueryOptions} AgentQueryOptions
 * @typedef {import('./types').AgentQueryRunOptions} AgentQueryRunOptions
 */

/**
 * Wraps the Claude Agent SDK's query() function for autonomous agent tasks.
 *
 * Unlike the other classes which use the Messages API directly, AgentQuery
 * launches a full Claude Code agent process with built-in tools for
 * file operations, shell commands, and code search.
 *
 * @example
 * ```javascript
 * import { AgentQuery } from 'ak-claude';
 *
 * const agent = new AgentQuery({
 *   cwd: '/path/to/project',
 *   allowedTools: ['Read', 'Glob', 'Grep'],
 * });
 *
 * for await (const msg of agent.run('Find all TODO comments in the codebase')) {
 *   if (msg.type === 'assistant') {
 *     console.log(msg.message.content);
 *   }
 *   if (msg.type === 'result') {
 *     console.log('Done:', msg.result);
 *     console.log('Cost:', msg.total_cost_usd);
 *   }
 * }
 * ```
 */
class AgentQuery {
	/**
	 * @param {AgentQueryOptions} [options={}]
	 */
	constructor(options = {}) {
		this.model = options.model || 'claude-sonnet-4-6';
		this.allowedTools = options.allowedTools || undefined;
		this.disallowedTools = options.disallowedTools || undefined;
		this.cwd = options.cwd || process.cwd();
		this.maxTurns = options.maxTurns || undefined;
		this.maxBudgetUsd = options.maxBudgetUsd || undefined;
		this.systemPrompt = options.systemPrompt || undefined;
		this.permissionMode = options.permissionMode || undefined;
		this.mcpServers = options.mcpServers || undefined;
		this.hooks = options.hooks || undefined;

		this._lastSessionId = null;
		this._queryFn = null;

		log.debug(`AgentQuery created with model: ${this.model}`);
	}

	/**
	 * Lazily imports the query function from claude-agent-sdk.
	 * @private
	 */
	async _getQueryFn() {
		if (this._queryFn) return this._queryFn;
		try {
			const sdk = await import(/** @type {any} */ ('@anthropic-ai/claude-agent-sdk'));
			this._queryFn = sdk.query;
			return this._queryFn;
		} catch (e) {
			throw new Error(
				`Failed to import @anthropic-ai/claude-agent-sdk. ` +
				`Install it with: npm install @anthropic-ai/claude-agent-sdk\n` +
				`Error: ${e.message}`
			);
		}
	}

	/**
	 * Run an autonomous agent query. Yields messages as they arrive.
	 *
	 * @param {string} prompt - The task for the agent
	 * @param {AgentQueryRunOptions} [opts={}] - Per-run overrides
	 * @yields {Object} Messages from the agent (system, assistant, tool_progress, result)
	 */
	async *run(prompt, opts = {}) {
		const queryFn = await this._getQueryFn();

		const options = {
			model: opts.model || this.model,
			cwd: opts.cwd || this.cwd,
			...(opts.allowedTools || this.allowedTools ? { allowedTools: opts.allowedTools || this.allowedTools } : {}),
			...(opts.disallowedTools || this.disallowedTools ? { disallowedTools: opts.disallowedTools || this.disallowedTools } : {}),
			...(opts.maxTurns || this.maxTurns ? { maxTurns: opts.maxTurns || this.maxTurns } : {}),
			...(opts.maxBudgetUsd || this.maxBudgetUsd ? { maxBudgetUsd: opts.maxBudgetUsd || this.maxBudgetUsd } : {}),
			...(opts.systemPrompt || this.systemPrompt ? { systemPrompt: opts.systemPrompt || this.systemPrompt } : {}),
			...(opts.permissionMode || this.permissionMode ? { permissionMode: opts.permissionMode || this.permissionMode } : {}),
			...(opts.mcpServers || this.mcpServers ? { mcpServers: opts.mcpServers || this.mcpServers } : {}),
			...(opts.hooks || this.hooks ? { hooks: opts.hooks || this.hooks } : {}),
			...(opts.sessionId ? { resume: opts.sessionId } : {}),
		};

		for await (const message of queryFn({ prompt, options })) {
			this._lastSessionId = message.session_id || message.sessionId || this._lastSessionId;
			yield message;
		}
	}

	/**
	 * Resume a previous agent session with a new prompt.
	 *
	 * @param {string} sessionId - The session ID to resume
	 * @param {string} prompt - The follow-up prompt
	 * @param {AgentQueryRunOptions} [opts={}]
	 * @yields {Object} Messages from the agent
	 */
	async *resume(sessionId, prompt, opts = {}) {
		yield* this.run(prompt, { ...opts, sessionId });
	}

	/**
	 * The session ID from the last run.
	 * @returns {string|null}
	 */
	get lastSessionId() {
		return this._lastSessionId;
	}
}

export default AgentQuery;
