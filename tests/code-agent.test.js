import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { CodeAgent } from '../index.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

const { ANTHROPIC_API_KEY } = process.env;
delete process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'claude-haiku-4-5-20251001',
	apiKey: ANTHROPIC_API_KEY,
	logLevel: 'warn'
};

let tmpDir;

beforeAll(async () => {
	tmpDir = await mkdtemp(join(os.tmpdir(), 'ak-claude-test-'));
	// Create a minimal package.json so init() has something to read
	await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-project', dependencies: {} }));
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

	describe('Constructor', () => {
		it('should create with default options', () => {
			const agent = makeAgent();
			expect(agent.workingDirectory).toBe(tmpDir);
			expect(agent.maxRounds).toBe(10);
			expect(agent.timeout).toBe(15000);
			expect(agent._stopped).toBe(false);
		});
		it('should accept custom maxRounds', () => {
			expect(makeAgent({ maxRounds: 5 }).maxRounds).toBe(5);
		});
		it('should accept custom timeout', () => {
			expect(makeAgent({ timeout: 5000 }).timeout).toBe(5000);
		});
		it('should have execute_code tool', () => {
			const agent = makeAgent();
			expect(agent._tools.length).toBe(1);
			expect(agent._tools[0].name).toBe('execute_code');
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
	});

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
	});

	describe('chat()', () => {
		it('should execute code and return result', async () => {
			const agent = makeAgent();
			const response = await agent.chat('Use the execute_code tool to run: console.log("hello from test")');
			expect(response).toHaveProperty('text');
			expect(response).toHaveProperty('codeExecutions');
			expect(response).toHaveProperty('usage');
			expect(response.codeExecutions.length).toBeGreaterThan(0);
			expect(response.codeExecutions[0].output).toContain('hello from test');
		});

		it('should include usage data', async () => {
			const agent = makeAgent();
			const response = await agent.chat('Run console.log("test") using execute_code');
			expect(response.usage).toBeTruthy();
			expect(response.usage.promptTokens).toBeGreaterThan(0);
		});

		it('should auto-init', async () => {
			const agent = makeAgent();
			const response = await agent.chat('Execute: console.log("auto-init works")');
			expect(agent._initialized).toBe(true);
			expect(response.text).toBeTruthy();
		});
	});

	describe('stream()', () => {
		it('should stream events including code execution', async () => {
			const agent = makeAgent();
			const events = [];
			for await (const event of agent.stream('Use execute_code to run: console.log("streamed")')) {
				events.push(event);
			}
			const doneEvents = events.filter(e => e.type === 'done');
			expect(doneEvents.length).toBe(1);
			expect(doneEvents[0]).toHaveProperty('fullText');
			expect(doneEvents[0]).toHaveProperty('codeExecutions');
		});

		it('should yield code and output events', async () => {
			const agent = makeAgent();
			const events = [];
			for await (const event of agent.stream('Run console.log("stream-test") using execute_code')) {
				events.push(event);
			}
			const codeEvents = events.filter(e => e.type === 'code');
			const outputEvents = events.filter(e => e.type === 'output');
			// May or may not have code events depending on model behavior
			if (codeEvents.length > 0) {
				expect(outputEvents.length).toBeGreaterThan(0);
			}
		});
	});

	describe('Callbacks', () => {
		it('should fire onBeforeExecution callback', async () => {
			const calls = [];
			const agent = makeAgent({
				onBeforeExecution: async (code) => { calls.push(code); return true; }
			});
			await agent.chat('Run console.log("callback test") using execute_code');
			expect(calls.length).toBeGreaterThan(0);
		});

		it('should deny execution when onBeforeExecution returns false', async () => {
			const agent = makeAgent({ onBeforeExecution: async () => false });
			const response = await agent.chat('Run console.log("denied") using execute_code');
			if (response.codeExecutions.length > 0) {
				expect(response.codeExecutions[0].stderr).toContain('denied');
			}
		});

		it('should fire onCodeExecution callback', async () => {
			const executions = [];
			const agent = makeAgent({
				onCodeExecution: (code, result) => executions.push({ code, result })
			});
			await agent.chat('Run console.log("exec callback") using execute_code');
			expect(executions.length).toBeGreaterThan(0);
		});
	});

	describe('stop()', () => {
		it('should have stop method', () => {
			expect(typeof makeAgent().stop).toBe('function');
		});
		it('should set _stopped flag', () => {
			const agent = makeAgent();
			agent.stop();
			expect(agent._stopped).toBe(true);
		});
	});

	describe('dump()', () => {
		it('should return empty array before any executions', () => {
			expect(makeAgent().dump()).toEqual([]);
		});
		it('should return executions after chat', async () => {
			const agent = makeAgent();
			await agent.chat('Run console.log("dump test") using execute_code');
			const scripts = agent.dump();
			expect(scripts.length).toBeGreaterThan(0);
			expect(scripts[0]).toHaveProperty('script');
			expect(scripts[0]).toHaveProperty('fileName');
		});
	});

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
});
