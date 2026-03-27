/**
 * @fileoverview CodeAgent class — AI agent that writes and executes code.
 * Instead of traditional tool-calling with many round-trips, the model gets
 * a single `execute_code` tool and writes JavaScript that can do everything
 * (read files, write files, run commands) in a single script.
 */

import BaseClaude from './base.js';
import log from './logger.js';
import { execFile } from 'node:child_process';
import { writeFile, unlink, readdir, readFile, mkdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * @typedef {import('./types').CodeAgentOptions} CodeAgentOptions
 * @typedef {import('./types').CodeAgentResponse} CodeAgentResponse
 * @typedef {import('./types').CodeAgentStreamEvent} CodeAgentStreamEvent
 */

const MAX_OUTPUT_CHARS = 50_000;
const MAX_FILE_TREE_LINES = 500;
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', 'build', '__pycache__']);

/**
 * AI agent that writes and executes JavaScript code autonomously.
 *
 * During init, gathers codebase context (file tree + key files) and injects it
 * into the system prompt. The model uses the `execute_code` tool to run scripts
 * in a Node.js child process that inherits the parent's environment variables.
 *
 * @example
 * ```javascript
 * import { CodeAgent } from 'ak-claude';
 *
 * const agent = new CodeAgent({
 *   workingDirectory: '/path/to/my/project',
 *   onCodeExecution: (code, output) => {
 *     console.log('Executed:', code.slice(0, 100));
 *     console.log('Output:', output.stdout);
 *   }
 * });
 *
 * const result = await agent.chat('List all TODO comments in the codebase');
 * console.log(result.text);
 * console.log(`Ran ${result.codeExecutions.length} scripts`);
 * ```
 */
class CodeAgent extends BaseClaude {
	/**
	 * @param {CodeAgentOptions} [options={}]
	 */
	constructor(options = {}) {
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: '' };
		}

		super(options);

		// ── Agent config ──
		this.workingDirectory = options.workingDirectory || process.cwd();
		this.maxRounds = options.maxRounds || 10;
		this.timeout = options.timeout || 30_000;
		this.onBeforeExecution = options.onBeforeExecution || null;
		this.onCodeExecution = options.onCodeExecution || null;
		this.importantFiles = options.importantFiles || [];
		this.writeDir = options.writeDir || join(this.workingDirectory, 'tmp');
		this.keepArtifacts = options.keepArtifacts ?? false;
		this.comments = options.comments ?? false;
		this.codeMaxRetries = options.maxRetries ?? 3;

		// ── Internal state ──
		this._codebaseContext = null;
		this._contextGathered = false;
		this._stopped = false;
		this._activeProcess = null;
		this._userSystemPrompt = options.systemPrompt || '';
		this._allExecutions = [];

		// ── Single tool: execute_code (Claude format) ──
		this._tools = [{
			name: 'execute_code',
			description: 'Execute JavaScript code in a Node.js child process. The code has access to all Node.js built-in modules (fs, path, child_process, http, etc.). Use console.log() to produce output that will be returned to you. The code runs in the working directory with the same environment variables as the parent process.',
			input_schema: {
				type: 'object',
				properties: {
					code: {
						type: 'string',
						description: 'JavaScript code to execute. Use console.log() for output. You can import any built-in Node.js module.'
					},
					purpose: {
						type: 'string',
						description: 'A short 2-4 word slug describing what this script does (e.g., "read-config", "parse-logs", "fetch-api-data"). Used for naming the script file.'
					}
				},
				required: ['code']
			}
		}];

		log.debug(`CodeAgent created for directory: ${this.workingDirectory}`);
	}

	// ── Init ─────────────────────────────────────────────────────────────────

	/**
	 * Initialize the agent: gather codebase context and build system prompt.
	 * @param {boolean} [force=false]
	 */
	async init(force = false) {
		if (this._initialized && !force) return;

		await this._ensureClient();

		// Gather codebase context
		if (!this._contextGathered || force) {
			await this._gatherCodebaseContext();
		}

		// Build augmented system prompt
		this.systemPrompt = this._buildSystemPrompt();

		await super.init(force);
	}

	// ── Context Gathering ────────────────────────────────────────────────────

	/**
	 * @private
	 */
	async _gatherCodebaseContext() {
		let fileTree = '';

		try {
			fileTree = await this._getFileTreeGit();
		} catch {
			log.debug('git ls-files failed, falling back to readdir');
			fileTree = await this._getFileTreeReaddir(this.workingDirectory, 0, 3);
		}

		const lines = fileTree.split('\n');
		if (lines.length > MAX_FILE_TREE_LINES) {
			const truncated = lines.slice(0, MAX_FILE_TREE_LINES).join('\n');
			fileTree = `${truncated}\n... (${lines.length - MAX_FILE_TREE_LINES} more files)`;
		}

		let npmPackages = [];
		try {
			const pkgPath = join(this.workingDirectory, 'package.json');
			const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
			npmPackages = [
				...Object.keys(pkg.dependencies || {}),
				...Object.keys(pkg.devDependencies || {})
			];
		} catch { /* no package.json */ }

		const importantFileContents = [];
		if (this.importantFiles.length > 0) {
			const fileTreeLines = fileTree.split('\n').map(l => l.trim()).filter(Boolean);
			for (const requested of this.importantFiles) {
				const resolved = this._resolveImportantFile(requested, fileTreeLines);
				if (!resolved) {
					log.warn(`importantFiles: could not locate "${requested}"`);
					continue;
				}
				try {
					const fullPath = join(this.workingDirectory, resolved);
					const content = await readFile(fullPath, 'utf-8');
					importantFileContents.push({ path: resolved, content });
				} catch (e) {
					log.warn(`importantFiles: could not read "${resolved}": ${e.message}`);
				}
			}
		}

		this._codebaseContext = { fileTree, npmPackages, importantFileContents };
		this._contextGathered = true;
	}

	/**
	 * @private
	 */
	_resolveImportantFile(filename, fileTreeLines) {
		const exact = fileTreeLines.find(line => line === filename);
		if (exact) return exact;

		const partial = fileTreeLines.find(line =>
			line.endsWith('/' + filename) || line.endsWith(sep + filename)
		);
		return partial || null;
	}

	/**
	 * @private
	 */
	async _getFileTreeGit() {
		return new Promise((resolve, reject) => {
			execFile('git', ['ls-files'], {
				cwd: this.workingDirectory,
				timeout: 5000,
				maxBuffer: 5 * 1024 * 1024
			}, (err, stdout) => {
				if (err) return reject(err);
				resolve(stdout.trim());
			});
		});
	}

	/**
	 * @private
	 */
	async _getFileTreeReaddir(dir, depth, maxDepth) {
		if (depth >= maxDepth) return '';
		const entries = [];
		try {
			const items = await readdir(dir, { withFileTypes: true });
			for (const item of items) {
				if (IGNORE_DIRS.has(item.name)) continue;
				if (item.name.startsWith('.') && depth === 0 && item.isDirectory()) continue;

				const relativePath = join(dir, item.name).replace(this.workingDirectory + '/', '');
				if (item.isFile()) {
					entries.push(relativePath);
				} else if (item.isDirectory()) {
					entries.push(relativePath + '/');
					const subEntries = await this._getFileTreeReaddir(join(dir, item.name), depth + 1, maxDepth);
					if (subEntries) entries.push(subEntries);
				}
			}
		} catch {
			// Permission errors, etc.
		}
		return entries.join('\n');
	}

	/**
	 * @private
	 */
	_buildSystemPrompt() {
		const { fileTree, npmPackages, importantFileContents } = this._codebaseContext || { fileTree: '', npmPackages: [], importantFileContents: [] };

		let prompt = `You are a coding agent working in ${this.workingDirectory}.

## Instructions
- Use the execute_code tool to accomplish tasks by writing JavaScript code
- Always provide a short descriptive \`purpose\` parameter (2-4 word slug like "read-config") when calling execute_code
- Your code runs in a Node.js child process with access to all built-in modules
- IMPORTANT: Your code runs as an ES module (.mjs). Use import syntax, NOT require():
  - import fs from 'fs';
  - import path from 'path';
  - import { execSync } from 'child_process';
- Use console.log() to produce output — that's how results are returned to you
- Write efficient scripts that do multiple things per execution when possible
- For parallel async operations, use Promise.all():
  const [a, b] = await Promise.all([fetchA(), fetchB()]);
- Read files with fs.readFileSync() when you need to understand their contents
- Handle errors in your scripts with try/catch so you get useful error messages
- Top-level await is supported
- The working directory is: ${this.workingDirectory}`;

		if (this.comments) {
			prompt += `\n- Add a JSDoc @fileoverview comment at the top of each script explaining what it does\n- Add brief JSDoc @param comments for any functions you define`;
		} else {
			prompt += `\n- Do NOT write any comments in your code — save tokens. The code should be self-explanatory.`;
		}

		if (fileTree) {
			prompt += `\n\n## File Tree\n\`\`\`\n${fileTree}\n\`\`\``;
		}

		if (npmPackages.length > 0) {
			prompt += `\n\n## Available Packages\nThese npm packages are installed and can be imported: ${npmPackages.join(', ')}`;
		}

		if (importantFileContents && importantFileContents.length > 0) {
			prompt += `\n\n## Key Files`;
			for (const { path: filePath, content } of importantFileContents) {
				prompt += `\n\n### ${filePath}\n\`\`\`javascript\n${content}\n\`\`\``;
			}
		}

		if (this._userSystemPrompt) {
			prompt += `\n\n## Additional Instructions\n${this._userSystemPrompt}`;
		}

		return prompt;
	}

	// ── Code Execution ───────────────────────────────────────────────────────

	/**
	 * @private
	 */
	_slugify(purpose) {
		if (!purpose) return randomUUID().slice(0, 8);
		return purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
	}

	/**
	 * @private
	 */
	async _executeCode(code, purpose) {
		if (this._stopped) {
			return { stdout: '', stderr: 'Agent was stopped', exitCode: -1 };
		}

		if (this.onBeforeExecution) {
			try {
				const allowed = await this.onBeforeExecution(code);
				if (allowed === false) {
					return { stdout: '', stderr: 'Execution denied by onBeforeExecution callback', exitCode: -1, denied: true };
				}
			} catch (e) {
				log.warn(`onBeforeExecution callback error: ${e.message}`);
			}
		}

		await mkdir(this.writeDir, { recursive: true });

		const slug = this._slugify(purpose);
		const tempFile = join(this.writeDir, `agent-${slug}-${Date.now()}.mjs`);

		try {
			await writeFile(tempFile, code, 'utf-8');

			const result = await new Promise((resolve) => {
				const child = execFile('node', [tempFile], {
					cwd: this.workingDirectory,
					timeout: this.timeout,
					env: process.env,
					maxBuffer: 10 * 1024 * 1024
				}, (err, stdout, stderr) => {
					this._activeProcess = null;
					if (err) {
						resolve({
							stdout: err.stdout || stdout || '',
							stderr: (err.stderr || stderr || '') + (err.killed ? '\n[EXECUTION TIMED OUT]' : ''),
							exitCode: err.code || 1
						});
					} else {
						resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: 0 });
					}
				});
				this._activeProcess = child;
			});

			const totalLen = result.stdout.length + result.stderr.length;
			if (totalLen > MAX_OUTPUT_CHARS) {
				const half = Math.floor(MAX_OUTPUT_CHARS / 2);
				if (result.stdout.length > half) {
					result.stdout = result.stdout.slice(0, half) + '\n...[OUTPUT TRUNCATED]';
				}
				if (result.stderr.length > half) {
					result.stderr = result.stderr.slice(0, half) + '\n...[STDERR TRUNCATED]';
				}
			}

			this._allExecutions.push({
				code, purpose: purpose || null, output: result.stdout, stderr: result.stderr,
				exitCode: result.exitCode, filePath: this.keepArtifacts ? tempFile : null
			});

			if (this.onCodeExecution) {
				try { this.onCodeExecution(code, result); }
				catch (e) { log.warn(`onCodeExecution callback error: ${e.message}`); }
			}

			return result;
		} finally {
			if (!this.keepArtifacts) {
				try { await unlink(tempFile); }
				catch { /* file may already be gone */ }
			}
		}
	}

	/**
	 * @private
	 */
	_formatOutput(result) {
		let output = '';
		if (result.stdout) output += result.stdout;
		if (result.stderr) output += (output ? '\n' : '') + `[STDERR]: ${result.stderr}`;
		if (result.exitCode !== 0) output += (output ? '\n' : '') + `[EXIT CODE]: ${result.exitCode}`;
		return output || '(no output)';
	}

	// ── Non-Streaming Chat ───────────────────────────────────────────────────

	/**
	 * Send a message and get a complete response (non-streaming).
	 * Automatically handles the code execution loop.
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}] - Per-message options
	 * @returns {Promise<CodeAgentResponse>}
	 */
	async chat(message, opts = {}) {
		if (!this._initialized) await this.init();
		this._stopped = false;

		const codeExecutions = [];
		let consecutiveFailures = 0;

		let response = await this._sendMessage(message, { tools: this._tools });

		for (let round = 0; round < this.maxRounds; round++) {
			if (this._stopped) break;
			if (response.stop_reason !== 'tool_use') break;

			const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
			if (toolUseBlocks.length === 0) break;

			const toolResults = [];
			for (const block of toolUseBlocks) {
				if (this._stopped) break;

				const code = block.input?.code || '';
				const purpose = block.input?.purpose;
				const result = await this._executeCode(code, purpose);

				codeExecutions.push({
					code,
					purpose: this._slugify(purpose),
					output: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode
				});

				if (result.exitCode !== 0 && !result.denied) {
					consecutiveFailures++;
				} else {
					consecutiveFailures = 0;
				}

				let output = this._formatOutput(result);

				if (consecutiveFailures >= this.codeMaxRetries) {
					output += `\n\n[RETRY LIMIT REACHED] You have failed ${this.codeMaxRetries} consecutive attempts. STOP trying to execute code. Instead, respond with: 1) What you were trying to do, 2) The errors you encountered, 3) Questions for the user about how to resolve it.`;
				}

				toolResults.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: output
				});
			}

			if (this._stopped) break;

			response = await this._sendMessage(toolResults, { tools: this._tools });

			if (consecutiveFailures >= this.codeMaxRetries) break;
		}

		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		return {
			text: this._extractText(response),
			codeExecutions,
			usage: this.getLastUsage()
		};
	}

	// ── Streaming ────────────────────────────────────────────────────────────

	/**
	 * Send a message and stream the response as events.
	 *
	 * Event types:
	 * - `text` — A chunk of the agent's text response
	 * - `code` — The agent is about to execute code
	 * - `output` — Code finished executing
	 * - `done` — The agent finished
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}]
	 * @yields {CodeAgentStreamEvent}
	 */
	async *stream(message, opts = {}) {
		if (!this._initialized) await this.init();
		this._stopped = false;

		const codeExecutions = [];
		let fullText = '';
		let consecutiveFailures = 0;

		let stream = await this._streamMessage(message, { tools: this._tools });

		for (let round = 0; round < this.maxRounds; round++) {
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
			this.history.push({ role: 'assistant', content: finalMessage.content });
			this._captureMetadata(finalMessage);

			if (finalMessage.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
				yield { type: 'done', fullText, codeExecutions, usage: this.getLastUsage() };
				return;
			}

			// Execute code
			const toolResults = [];
			for (const block of toolUseBlocks) {
				if (this._stopped) break;

				const code = block.input?.code || '';
				const purpose = block.input?.purpose;
				yield { type: 'code', code };

				const result = await this._executeCode(code, purpose);

				codeExecutions.push({
					code,
					purpose: this._slugify(purpose),
					output: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode
				});

				yield {
					type: 'output',
					code,
					stdout: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode
				};

				if (result.exitCode !== 0 && !result.denied) {
					consecutiveFailures++;
				} else {
					consecutiveFailures = 0;
				}

				let output = this._formatOutput(result);

				if (consecutiveFailures >= this.codeMaxRetries) {
					output += `\n\n[RETRY LIMIT REACHED] You have failed ${this.codeMaxRetries} consecutive attempts. STOP trying to execute code. Instead, respond with: 1) What you were trying to do, 2) The errors you encountered, 3) Questions for the user about how to resolve it.`;
				}

				toolResults.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: output
				});
			}

			if (this._stopped) break;

			stream = await this._streamMessage(toolResults, { tools: this._tools });

			if (consecutiveFailures >= this.codeMaxRetries) break;
		}

		let warning = 'Max tool rounds reached';
		if (this._stopped) warning = 'Agent was stopped';
		else if (consecutiveFailures >= this.codeMaxRetries) warning = 'Retry limit reached';

		yield { type: 'done', fullText, codeExecutions, usage: this.getLastUsage(), warning };
	}

	// ── Dump ─────────────────────────────────────────────────────────────────

	/**
	 * Returns all code scripts the agent has written.
	 * @returns {Array<{fileName: string, script: string}>}
	 */
	dump() {
		return this._allExecutions.map((exec, i) => ({
			fileName: exec.purpose ? `agent-${exec.purpose}.mjs` : `script-${i + 1}.mjs`,
			purpose: exec.purpose || null,
			script: exec.code,
			filePath: exec.filePath || null
		}));
	}

	// ── Stop ─────────────────────────────────────────────────────────────────

	/**
	 * Stop the agent. Kills any running child process.
	 */
	stop() {
		this._stopped = true;
		if (this._activeProcess) {
			try { this._activeProcess.kill('SIGTERM'); }
			catch { /* process may already be gone */ }
		}
		log.info('CodeAgent stopped');
	}
}

export default CodeAgent;
