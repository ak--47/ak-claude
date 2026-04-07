import { CodeAgent } from '../index.js';
import { BASE_OPTIONS } from './setup.js';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

let tmpDir;

beforeAll(async () => {
	tmpDir = await realpath(await mkdtemp(join(os.tmpdir(), 'ak-claude-test-')));
	await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
		name: 'test-project',
		dependencies: { lodash: '4.17.21' },
		devDependencies: { jest: '29.0.0' }
	}));
	await mkdir(join(tmpDir, 'src'), { recursive: true });
	await writeFile(join(tmpDir, 'src', 'app.js'), 'export default function app() { return "hello"; }');
	await mkdir(join(tmpDir, 'tmp'), { recursive: true });
});

afterAll(async () => {
	try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
});

function makeAgent(extraOpts = {}) {
	return new CodeAgent({
		...BASE_OPTIONS,
		workingDirectory: tmpDir,
		writeDir: join(tmpDir, 'tmp'),
		timeout: 15000,
		...extraOpts
	});
}

describe('CodeAgent', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should create with default options', () => {
			const agent = makeAgent();
			expect(agent.workingDirectory).toBe(tmpDir);
			expect(agent.maxRounds).toBe(10);
			expect(agent.timeout).toBe(15000);
			expect(agent._stopped).toBe(false);
			expect(agent.skills).toEqual([]);
			expect(agent._skillRegistry.size).toBe(0);
		});

		it('should accept custom maxRounds', () => {
			expect(makeAgent({ maxRounds: 5 }).maxRounds).toBe(5);
		});

		it('should accept custom timeout', () => {
			expect(makeAgent({ timeout: 5000 }).timeout).toBe(5000);
		});

		it('should have 5 tools by default (no skills)', () => {
			const agent = makeAgent();
			expect(agent._tools.length).toBe(5);
			const names = agent._tools.map(t => t.name);
			expect(names).toContain('write_code');
			expect(names).toContain('execute_code');
			expect(names).toContain('write_and_run_code');
			expect(names).toContain('fix_code');
			expect(names).toContain('run_bash');
			expect(names).not.toContain('use_skill');
		});

		it('should accept keepArtifacts option', () => {
			expect(makeAgent({ keepArtifacts: true }).keepArtifacts).toBe(true);
			expect(makeAgent().keepArtifacts).toBe(false);
		});

		it('should accept comments option', () => {
			expect(makeAgent({ comments: true }).comments).toBe(true);
			expect(makeAgent().comments).toBe(false);
		});

		it('should accept onBeforeExecution callback', () => {
			const cb = async () => true;
			expect(makeAgent({ onBeforeExecution: cb }).onBeforeExecution).toBe(cb);
		});

		it('should accept onCodeExecution callback', () => {
			const cb = () => {};
			expect(makeAgent({ onCodeExecution: cb }).onCodeExecution).toBe(cb);
		});

		it('should accept importantFiles option', () => {
			expect(makeAgent({ importantFiles: ['index.js'] }).importantFiles).toEqual(['index.js']);
		});

		it('should accept skills option', () => {
			expect(makeAgent({ skills: ['/path/to/skill.md'] }).skills).toEqual(['/path/to/skill.md']);
		});

		it('should default maxRetries to 3', () => {
			expect(makeAgent().codeMaxRetries).toBe(3);
		});

		it('should accept custom maxRetries', () => {
			expect(makeAgent({ maxRetries: 5 }).codeMaxRetries).toBe(5);
		});

		it('should accept custom writeDir', () => {
			const customDir = join(tmpDir, 'custom-scripts');
			expect(makeAgent({ writeDir: customDir }).writeDir).toBe(customDir);
		});

		it('should default writeDir to {workingDirectory}/tmp', () => {
			const agent = new CodeAgent({ ...BASE_OPTIONS, workingDirectory: '/some/dir' });
			expect(agent.writeDir).toBe('/some/dir/tmp');
		});

		it('should store user systemPrompt separately', () => {
			const agent = makeAgent({ systemPrompt: 'Custom instructions' });
			expect(agent._userSystemPrompt).toBe('Custom instructions');
		});

		it('should have correct tool schemas', () => {
			const agent = makeAgent();
			const fixTool = agent._tools.find(t => t.name === 'fix_code');
			expect(fixTool.input_schema.required).toEqual(['original_code', 'fixed_code']);
			expect(fixTool.input_schema.properties.execute.type).toBe('boolean');

			const bashTool = agent._tools.find(t => t.name === 'run_bash');
			expect(bashTool.input_schema.required).toEqual(['command']);
		});
	});

	// ── init() ──────────────────────────────────────────────────────────────

	describe('init()', () => {
		it('should gather codebase context', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent._initialized).toBe(true);
			expect(agent._contextGathered).toBe(true);
			expect(agent._codebaseContext).toBeTruthy();
			expect(agent._codebaseContext.fileTree).toBeDefined();
		});

		it('should be idempotent', async () => {
			const agent = makeAgent();
			await agent.init();
			const context = agent._codebaseContext;
			await agent.init();
			expect(agent._codebaseContext).toBe(context);
		});

		it('should reinitialize on force', async () => {
			const agent = makeAgent();
			await agent.init();
			await agent.init(true);
			expect(agent._initialized).toBe(true);
		});

		it('should include npm packages in context', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent._codebaseContext.npmPackages).toContain('lodash');
			expect(agent._codebaseContext.npmPackages).toContain('jest');
		});

		it('should include file tree in system prompt', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent.systemPrompt).toContain('File Tree');
			expect(agent.systemPrompt).toContain('package.json');
		});

		it('should include user systemPrompt in augmented prompt', async () => {
			const agent = makeAgent({ systemPrompt: 'Always use TypeScript' });
			await agent.init();
			expect(agent.systemPrompt).toContain('Always use TypeScript');
			expect(agent.systemPrompt).toContain('Additional Instructions');
		});

		it('should describe all tools in system prompt', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent.systemPrompt).toContain('write_code');
			expect(agent.systemPrompt).toContain('execute_code');
			expect(agent.systemPrompt).toContain('write_and_run_code');
			expect(agent.systemPrompt).toContain('fix_code');
			expect(agent.systemPrompt).toContain('run_bash');
		});
	});

	// ── Skills ───────────────────────────────────────────────────────────────

	describe('Skills', () => {
		let skillDir;

		beforeAll(async () => {
			skillDir = join(tmpDir, 'skills');
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, 'api-pattern.md'), '---\nname: api-pattern\n---\n# API Pattern\nUse fetch() for all HTTP requests.');
			await writeFile(join(skillDir, 'data-pipeline.md'), '# Data Pipeline\nProcess data in stages.');
		});

		it('should load skills during init', async () => {
			const agent = makeAgent({
				skills: [join(skillDir, 'api-pattern.md'), join(skillDir, 'data-pipeline.md')]
			});
			await agent.init();
			expect(agent._skillRegistry.size).toBe(2);
			expect(agent._skillRegistry.has('api-pattern')).toBe(true);
			expect(agent._skillRegistry.has('data-pipeline')).toBe(true);
		});

		it('should extract name from frontmatter', async () => {
			const agent = makeAgent({ skills: [join(skillDir, 'api-pattern.md')] });
			await agent.init();
			const skill = agent._skillRegistry.get('api-pattern');
			expect(skill.name).toBe('api-pattern');
			expect(skill.content).toContain('Use fetch()');
		});

		it('should fallback to filename when no frontmatter', async () => {
			const agent = makeAgent({ skills: [join(skillDir, 'data-pipeline.md')] });
			await agent.init();
			expect(agent._skillRegistry.has('data-pipeline')).toBe(true);
		});

		it('should include use_skill tool when skills are loaded', async () => {
			const agent = makeAgent({ skills: [join(skillDir, 'api-pattern.md')] });
			await agent.init();
			expect(agent._tools.length).toBe(6);
			const skillTool = agent._tools.find(t => t.name === 'use_skill');
			expect(skillTool).toBeTruthy();
			expect(skillTool.description).toContain('api-pattern');
		});

		it('should list skills in system prompt', async () => {
			const agent = makeAgent({ skills: [join(skillDir, 'api-pattern.md')] });
			await agent.init();
			expect(agent.systemPrompt).toContain('use_skill');
			expect(agent.systemPrompt).toContain('api-pattern');
		});

		it('should warn on missing skill files', async () => {
			const agent = makeAgent({ skills: ['/nonexistent/skill.md'] });
			await agent.init();
			expect(agent._skillRegistry.size).toBe(0);
		});
	});

	// ── _executeCode() ──────────────────────────────────────────────────────

	describe('_executeCode()', () => {
		it('should execute simple code and capture stdout', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeCode('console.log("hello")', 'test');
			expect(result.stdout.trim()).toBe('hello');
			expect(result.stderr).toBe('');
			expect(result.exitCode).toBe(0);
		});

		it('should capture stderr', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeCode('console.error("warning")', 'test');
			expect(result.stderr).toContain('warning');
		});

		it('should handle code with syntax errors', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeCode('const x = {{{', 'test');
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toBeTruthy();
		});

		it('should handle code that throws', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeCode('throw new Error("boom")', 'test');
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain('boom');
		});

		it('should inherit parent environment variables', async () => {
			const agent = makeAgent();
			await agent.init();
			process.env.__AK_TEST_VAR = 'test-value-123';
			const result = await agent._executeCode('console.log(process.env.__AK_TEST_VAR)', 'test');
			delete process.env.__AK_TEST_VAR;
			expect(result.stdout.trim()).toBe('test-value-123');
		});

		it('should run code as .mjs (supports top-level await)', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeCode('const x = await Promise.resolve(42); console.log(x)', 'test');
			expect(result.stdout.trim()).toBe('42');
			expect(result.exitCode).toBe(0);
		});

		it('should clean up temp files by default', async () => {
			const agent = makeAgent();
			await agent.init();
			await agent._executeCode('console.log("cleanup")', 'cleanup-test');
			const files = await readdir(join(tmpDir, 'tmp'));
			const agentFiles = files.filter(f => f.startsWith('agent-cleanup-test'));
			expect(agentFiles.length).toBe(0);
		});

		it('should use workingDirectory as cwd for child process', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeCode('console.log(process.cwd())', 'test');
			expect(result.stdout.trim()).toBe(tmpDir);
		});

		it('should return stopped result when agent is stopped', async () => {
			const agent = makeAgent();
			agent._stopped = true;
			const result = await agent._executeCode('console.log("nope")', 'test');
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain('stopped');
		});

		it('should track execution in _allExecutions', async () => {
			const agent = makeAgent();
			await agent.init();
			await agent._executeCode('console.log("tracked")', 'track-test');
			expect(agent._allExecutions.length).toBe(1);
			expect(agent._allExecutions[0].code).toContain('tracked');
			expect(agent._allExecutions[0].tool).toBeDefined();
		});

		it('should pass toolName to onBeforeExecution', async () => {
			const calls = [];
			const agent = makeAgent({
				onBeforeExecution: async (content, toolName) => { calls.push({ content, toolName }); return true; }
			});
			await agent.init();
			await agent._executeCode('console.log("test")', 'test', 'execute_code');
			expect(calls[0].toolName).toBe('execute_code');
		});
	});

	// ── _executeBash() ──────────────────────────────────────────────────────

	describe('_executeBash()', () => {
		it('should execute a bash command', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeBash('echo "hello bash"', 'test');
			expect(result.stdout.trim()).toBe('hello bash');
			expect(result.exitCode).toBe(0);
		});

		it('should capture stderr from bash', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeBash('echo "error" >&2', 'test');
			expect(result.stderr).toContain('error');
		});

		it('should handle failing commands', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeBash('exit 1', 'test');
			expect(result.exitCode).not.toBe(0);
		});

		it('should run in workingDirectory', async () => {
			const agent = makeAgent();
			await agent.init();
			const result = await agent._executeBash('pwd', 'test');
			expect(result.stdout.trim()).toBe(tmpDir);
		});

		it('should track bash in _allExecutions with tool=run_bash', async () => {
			const agent = makeAgent();
			await agent.init();
			const prevCount = agent._allExecutions.length;
			await agent._executeBash('echo test', 'test');
			const last = agent._allExecutions[agent._allExecutions.length - 1];
			expect(last.tool).toBe('run_bash');
		});

		it('should pass run_bash to onBeforeExecution', async () => {
			const calls = [];
			const agent = makeAgent({
				onBeforeExecution: async (content, toolName) => { calls.push({ content, toolName }); return true; }
			});
			await agent.init();
			await agent._executeBash('echo hi', 'test');
			expect(calls[0].toolName).toBe('run_bash');
			expect(calls[0].content).toBe('echo hi');
		});

		it('should deny bash when onBeforeExecution returns false', async () => {
			const agent = makeAgent({ onBeforeExecution: async () => false });
			await agent.init();
			const result = await agent._executeBash('echo nope', 'test');
			expect(result.denied).toBe(true);
			expect(result.exitCode).toBe(-1);
		});

		it('should return stopped result when agent is stopped', async () => {
			const agent = makeAgent();
			agent._stopped = true;
			const result = await agent._executeBash('echo nope', 'test');
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain('stopped');
		});
	});

	// ── _handleToolCall() ────────────────────────────────────────────────────

	describe('_handleToolCall()', () => {
		it('should handle write_code (no execution)', async () => {
			const agent = makeAgent();
			await agent.init();
			const { output, type, data } = await agent._handleToolCall('write_code', {
				code: 'const x = 1;', purpose: 'test', language: 'javascript'
			});
			expect(type).toBe('write');
			expect(output).toBe('Code written successfully.');
			expect(data.tool).toBe('write_code');
			expect(data.code).toBe('const x = 1;');
			expect(data.language).toBe('javascript');
		});

		it('should handle execute_code', async () => {
			const agent = makeAgent();
			await agent.init();
			const { output, type, data } = await agent._handleToolCall('execute_code', {
				code: 'console.log("exec")', purpose: 'test'
			});
			expect(type).toBe('code_execution');
			expect(data.tool).toBe('execute_code');
			expect(data.stdout).toContain('exec');
			expect(data.exitCode).toBe(0);
		});

		it('should handle write_and_run_code', async () => {
			const agent = makeAgent();
			await agent.init();
			const { type, data } = await agent._handleToolCall('write_and_run_code', {
				code: 'console.log("write-run")', purpose: 'test'
			});
			expect(type).toBe('code_execution');
			expect(data.tool).toBe('write_and_run_code');
			expect(data.stdout).toContain('write-run');
		});

		it('should handle fix_code without execute', async () => {
			const agent = makeAgent();
			await agent.init();
			const { output, type, data } = await agent._handleToolCall('fix_code', {
				original_code: 'const x = 1 +', fixed_code: 'const x = 1 + 2;', explanation: 'Missing operand'
			});
			expect(type).toBe('fix');
			expect(output).toBe('Fix recorded.');
			expect(data.executed).toBe(false);
			expect(data.fixedCode).toBe('const x = 1 + 2;');
			expect(data.explanation).toBe('Missing operand');
		});

		it('should handle fix_code with execute=true', async () => {
			const agent = makeAgent();
			await agent.init();
			const { type, data } = await agent._handleToolCall('fix_code', {
				original_code: 'consolee.log("broken")',
				fixed_code: 'console.log("fixed")',
				execute: true
			});
			expect(type).toBe('fix');
			expect(data.executed).toBe(true);
			expect(data.stdout).toContain('fixed');
			expect(data.exitCode).toBe(0);
		});

		it('should handle run_bash', async () => {
			const agent = makeAgent();
			await agent.init();
			const { type, data } = await agent._handleToolCall('run_bash', {
				command: 'echo "bash-test"', purpose: 'test'
			});
			expect(type).toBe('bash');
			expect(data.tool).toBe('run_bash');
			expect(data.stdout).toContain('bash-test');
		});

		it('should handle use_skill with valid skill', async () => {
			const agent = makeAgent();
			agent._skillRegistry.set('test-skill', { name: 'test-skill', content: '# Test Skill\nDo stuff.', path: '/fake' });
			const { type, data } = await agent._handleToolCall('use_skill', { skill_name: 'test-skill' });
			expect(type).toBe('skill');
			expect(data.found).toBe(true);
			expect(data.content).toContain('Do stuff');
		});

		it('should handle use_skill with unknown skill', async () => {
			const agent = makeAgent();
			const { output, data } = await agent._handleToolCall('use_skill', { skill_name: 'nonexistent' });
			expect(data.found).toBe(false);
			expect(output).toContain('not found');
		});

		it('should handle unknown tool name', async () => {
			const agent = makeAgent();
			const { type } = await agent._handleToolCall('unknown_tool', {});
			expect(type).toBe('unknown');
		});
	});

	// ── _slugify() ──────────────────────────────────────────────────────────

	describe('_slugify()', () => {
		it('should generate UUID slug when no purpose', () => {
			const slug = makeAgent()._slugify();
			expect(slug.length).toBe(8);
			expect(/^[a-f0-9]+$/.test(slug)).toBe(true);
		});

		it('should sanitize purpose to slug', () => {
			expect(makeAgent()._slugify('Read Config File')).toBe('read-config-file');
		});

		it('should truncate long purposes to 40 chars', () => {
			const long = 'a'.repeat(60);
			expect(makeAgent()._slugify(long).length).toBeLessThanOrEqual(40);
		});

		it('should strip leading/trailing dashes', () => {
			expect(makeAgent()._slugify('--test--')).toBe('test');
		});
	});

	// ── _formatOutput() ─────────────────────────────────────────────────────

	describe('_formatOutput()', () => {
		it('should format stdout only', () => {
			expect(makeAgent()._formatOutput({ stdout: 'hello', stderr: '', exitCode: 0 })).toBe('hello');
		});

		it('should include stderr', () => {
			const output = makeAgent()._formatOutput({ stdout: '', stderr: 'err', exitCode: 0 });
			expect(output).toContain('[STDERR]');
			expect(output).toContain('err');
		});

		it('should include exit code on failure', () => {
			const output = makeAgent()._formatOutput({ stdout: '', stderr: '', exitCode: 1 });
			expect(output).toContain('[EXIT CODE]: 1');
		});

		it('should return (no output) when empty', () => {
			expect(makeAgent()._formatOutput({ stdout: '', stderr: '', exitCode: 0 })).toBe('(no output)');
		});
	});

	// ── importantFiles ──────────────────────────────────────────────────────

	describe('importantFiles', () => {
		it('should resolve partial file paths', async () => {
			const agent = makeAgent({ importantFiles: ['app.js'] });
			await agent.init();
			expect(agent._codebaseContext.importantFileContents.length).toBe(1);
			expect(agent._codebaseContext.importantFileContents[0].content).toContain('hello');
		});

		it('should include file contents in system prompt', async () => {
			const agent = makeAgent({ importantFiles: ['app.js'] });
			await agent.init();
			expect(agent.systemPrompt).toContain('Key Files');
			expect(agent.systemPrompt).toContain('export default function app');
		});

		it('should warn on missing files without throwing', async () => {
			const agent = makeAgent({ importantFiles: ['nonexistent.js'] });
			await agent.init(); // should not throw
			expect(agent._codebaseContext.importantFileContents.length).toBe(0);
		});
	});

	// ── keepArtifacts ────────────────────────────────────────────────────────

	describe('keepArtifacts', () => {
		it('should keep files when keepArtifacts is true', async () => {
			const artifactDir = join(tmpDir, 'artifacts');
			const agent = makeAgent({ keepArtifacts: true, writeDir: artifactDir });
			await agent.init();
			await agent._executeCode('console.log("keep")', 'keep-test');
			const files = await readdir(artifactDir);
			const kept = files.filter(f => f.startsWith('agent-keep-test'));
			expect(kept.length).toBe(1);
			// Clean up
			for (const f of kept) await rm(join(artifactDir, f));
		});

		it('should delete files when keepArtifacts is false', async () => {
			const agent = makeAgent({ keepArtifacts: false });
			await agent.init();
			await agent._executeCode('console.log("del")', 'del-test');
			const files = await readdir(join(tmpDir, 'tmp'));
			const found = files.filter(f => f.startsWith('agent-del-test'));
			expect(found.length).toBe(0);
		});
	});

	// ── comments option ─────────────────────────────────────────────────────

	describe('comments option', () => {
		it('should include no-comments instruction by default', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent.systemPrompt).toContain('Do NOT write any comments');
		});

		it('should include JSDoc instruction when comments=true', async () => {
			const agent = makeAgent({ comments: true });
			await agent.init();
			expect(agent.systemPrompt).toContain('JSDoc');
		});
	});

	// ── writeDir ────────────────────────────────────────────────────────────

	describe('writeDir', () => {
		it('should create writeDir if it does not exist', async () => {
			const newDir = join(tmpDir, 'new-write-dir-' + Date.now());
			const agent = makeAgent({ writeDir: newDir });
			await agent.init();
			await agent._executeCode('console.log("mkdir")', 'test');
			const s = await stat(newDir);
			expect(s.isDirectory()).toBe(true);
			await rm(newDir, { recursive: true });
		});
	});

	// ── chat() (non-streaming) ──────────────────────────────────────────────

	describe('chat()', () => {
		it('should execute code and return result', async () => {
			const agent = makeAgent();
			const response = await agent.chat('Use the write_and_run_code tool to run: console.log("hello from test")');
			expect(response).toHaveProperty('text');
			expect(response).toHaveProperty('codeExecutions');
			expect(response).toHaveProperty('toolCalls');
			expect(response).toHaveProperty('usage');
			expect(response.codeExecutions.length).toBeGreaterThan(0);
			expect(response.codeExecutions[0].output).toContain('hello from test');
		});

		it('should include toolCalls in response', async () => {
			const agent = makeAgent();
			const response = await agent.chat('Use write_and_run_code to run: console.log("tool-calls-test")');
			expect(response.toolCalls.length).toBeGreaterThan(0);
			expect(response.toolCalls[0].tool).toBeTruthy();
		});

		it('should include usage data', async () => {
			const agent = makeAgent();
			const response = await agent.chat('Use write_and_run_code to run: console.log("test")');
			expect(response.usage).toBeTruthy();
			expect(response.usage.promptTokens).toBeGreaterThan(0);
		});

		it('should auto-init', async () => {
			const agent = makeAgent();
			const response = await agent.chat('Use write_and_run_code to run: console.log("auto-init works")');
			expect(agent._initialized).toBe(true);
			expect(response.text).toBeTruthy();
		});

		it('should handle text-only responses', async () => {
			const agent = makeAgent({ systemPrompt: 'Answer questions directly without executing code.' });
			const response = await agent.chat('What is 2+2? Just tell me the answer.');
			expect(response.text).toBeTruthy();
			expect(response.codeExecutions.length).toBe(0);
			expect(response.toolCalls.length).toBe(0);
		});
	});

	// ── stream() ────────────────────────────────────────────────────────────

	describe('stream()', () => {
		it('should stream events including code execution', async () => {
			const agent = makeAgent();
			const events = [];
			for await (const event of agent.stream('Use write_and_run_code to run: console.log("streamed")')) {
				events.push(event);
			}
			const doneEvents = events.filter(e => e.type === 'done');
			expect(doneEvents.length).toBe(1);
			expect(doneEvents[0]).toHaveProperty('fullText');
			expect(doneEvents[0]).toHaveProperty('codeExecutions');
			expect(doneEvents[0]).toHaveProperty('toolCalls');
		});

		it('should yield code and output events', async () => {
			const agent = makeAgent();
			const events = [];
			for await (const event of agent.stream('Use write_and_run_code to run: console.log("stream-test")')) {
				events.push(event);
			}
			const codeEvents = events.filter(e => e.type === 'code');
			const outputEvents = events.filter(e => e.type === 'output');
			if (codeEvents.length > 0) {
				expect(outputEvents.length).toBeGreaterThan(0);
			}
		});

		it('should auto-init during stream', async () => {
			const agent = makeAgent();
			const events = [];
			for await (const event of agent.stream('Say hello')) {
				events.push(event);
			}
			expect(agent._initialized).toBe(true);
		});

		it('should accumulate full text in done event', async () => {
			const agent = makeAgent();
			const events = [];
			for await (const event of agent.stream('Say "hello world" without running any code')) {
				events.push(event);
			}
			const done = events.find(e => e.type === 'done');
			expect(done.fullText).toBeTruthy();
		});
	});

	// ── Callbacks ────────────────────────────────────────────────────────────

	describe('Callbacks', () => {
		it('should fire onBeforeExecution callback', async () => {
			const calls = [];
			const agent = makeAgent({
				onBeforeExecution: async (content, toolName) => { calls.push({ content, toolName }); return true; }
			});
			await agent.chat('Use write_and_run_code to run: console.log("callback test")');
			expect(calls.length).toBeGreaterThan(0);
		});

		it('should deny execution when onBeforeExecution returns false', async () => {
			const agent = makeAgent({ onBeforeExecution: async () => false });
			const response = await agent.chat('Use write_and_run_code to run: console.log("denied")');
			if (response.codeExecutions.length > 0) {
				expect(response.codeExecutions[0].stderr).toContain('denied');
			}
		});

		it('should fire onCodeExecution callback', async () => {
			const executions = [];
			const agent = makeAgent({
				onCodeExecution: (code, result) => executions.push({ code, result })
			});
			await agent.chat('Use write_and_run_code to run: console.log("exec callback")');
			expect(executions.length).toBeGreaterThan(0);
		});
	});

	// ── stop() ──────────────────────────────────────────────────────────────

	describe('stop()', () => {
		it('should have stop method', () => {
			expect(typeof makeAgent().stop).toBe('function');
		});

		it('should set _stopped flag', () => {
			const agent = makeAgent();
			agent.stop();
			expect(agent._stopped).toBe(true);
		});

		it('should prevent code execution when stopped', async () => {
			const agent = makeAgent();
			await agent.init();
			agent._stopped = true;
			const result = await agent._executeCode('console.log("nope")', 'test');
			expect(result.exitCode).toBe(-1);
		});

		it('should reset _stopped at start of chat', async () => {
			const agent = makeAgent();
			agent._stopped = true;
			// chat() resets _stopped
			await agent.chat('Say hello without running code');
			expect(agent._stopped).toBe(false);
		});
	});

	// ── dump() ──────────────────────────────────────────────────────────────

	describe('dump()', () => {
		it('should return empty array before any executions', () => {
			expect(makeAgent().dump()).toEqual([]);
		});

		it('should return executions after chat', async () => {
			const agent = makeAgent();
			await agent.chat('Use write_and_run_code to run: console.log("dump test")');
			const scripts = agent.dump();
			expect(scripts.length).toBeGreaterThan(0);
			expect(scripts[0]).toHaveProperty('script');
			expect(scripts[0]).toHaveProperty('fileName');
			expect(scripts[0]).toHaveProperty('tool');
		});

		it('should use purpose in filenames', async () => {
			const agent = makeAgent();
			await agent.init();
			await agent._executeCode('console.log(1)', 'my-purpose');
			const scripts = agent.dump();
			expect(scripts[scripts.length - 1].fileName).toContain('my-purpose');
		});

		it('should include filePath when keepArtifacts is true', async () => {
			const artifactDir = join(tmpDir, 'dump-artifacts');
			const agent = makeAgent({ keepArtifacts: true, writeDir: artifactDir });
			await agent.init();
			await agent._executeCode('console.log(1)', 'artifact-test');
			const scripts = agent.dump();
			expect(scripts[scripts.length - 1].filePath).toBeTruthy();
			// Clean up
			await rm(artifactDir, { recursive: true, force: true });
		});
	});

	// ── History Management ───────────────────────────────────────────────────

	describe('History Management', () => {
		it('should return empty history before messages', () => {
			expect(makeAgent().getHistory()).toEqual([]);
		});

		it('should return non-empty history after messages', async () => {
			const agent = makeAgent();
			await agent.chat('Hello');
			expect(agent.getHistory().length).toBeGreaterThan(0);
		});

		it('should clear history', async () => {
			const agent = makeAgent();
			await agent.chat('Hello');
			await agent.clearHistory();
			expect(agent.getHistory().length).toBe(0);
		});
	});

	// ── Usage & Metadata ────────────────────────────────────────────────────

	describe('Usage & Metadata', () => {
		it('should return null usage before any call', () => {
			expect(makeAgent().getLastUsage()).toBeNull();
		});

		it('should return structured usage after chat', async () => {
			const agent = makeAgent();
			await agent.chat('Say hello');
			const usage = agent.getLastUsage();
			expect(usage).toBeTruthy();
			expect(usage.promptTokens).toBeGreaterThan(0);
			expect(usage.responseTokens).toBeGreaterThan(0);
		});
	});
});
