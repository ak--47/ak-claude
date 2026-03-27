import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { RagAgent } from '../index.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
let testFilePath;

beforeAll(async () => {
	tmpDir = await mkdtemp(join(os.tmpdir(), 'ak-claude-rag-test-'));
	testFilePath = join(tmpDir, 'test-doc.md');
	await writeFile(testFilePath, '# Test Document\n\nThe capital of France is Paris. The Eiffel Tower is 330 meters tall.\n\nKey facts:\n- Population: ~67 million\n- Currency: Euro\n- Official language: French');
});

afterAll(async () => {
	try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('RagAgent', () => {

	describe('Constructor', () => {
		it('should create with default options', () => {
			const agent = new RagAgent({ ...BASE_OPTIONS });
			expect(agent.localFiles).toEqual([]);
			expect(agent.localData).toEqual([]);
			expect(agent.mediaFiles).toEqual([]);
			expect(agent.enableCitations).toBe(false);
		});
		it('should accept localFiles option', () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			expect(agent.localFiles).toEqual([testFilePath]);
		});
		it('should accept localData option', () => {
			const data = [{ name: 'test', data: { key: 'value' } }];
			const agent = new RagAgent({ ...BASE_OPTIONS, localData: data });
			expect(agent.localData).toEqual(data);
		});
		it('should accept mediaFiles option', () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, mediaFiles: ['test.png'] });
			expect(agent.mediaFiles).toEqual(['test.png']);
		});
		it('should accept enableCitations option', () => {
			expect(new RagAgent({ ...BASE_OPTIONS, enableCitations: true }).enableCitations).toBe(true);
		});
		it('should have default system prompt', () => {
			const agent = new RagAgent({ ...BASE_OPTIONS });
			expect(agent.systemPrompt).toContain('helpful AI assistant');
		});
	});

	describe('init()', () => {
		it('should read local files', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			await agent.init();
			expect(agent._initialized).toBe(true);
			expect(agent._localFileContents.length).toBe(1);
			expect(agent._localFileContents[0].name).toBe('test-doc.md');
			expect(agent._localFileContents[0].content).toContain('capital of France');
		});
		it('should seed history with context', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			await agent.init();
			const history = agent.getHistory();
			expect(history.length).toBe(2); // user context + assistant ack
		});
		it('should handle local data', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localData: [{ name: 'cities', data: [{ name: 'Paris', country: 'France' }] }]
			});
			await agent.init();
			expect(agent._initialized).toBe(true);
		});
		it('should be idempotent', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			await agent.init();
			await agent.init();
			expect(agent._initialized).toBe(true);
		});
	});

	describe('chat()', () => {
		it('should answer questions from local file context', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			const response = await agent.chat('What is the capital of France according to the document?');
			expect(response.text).toBeTruthy();
			expect(response.text.toLowerCase()).toContain('paris');
			expect(response).toHaveProperty('usage');
		});

		it('should answer from local data context', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localData: [{ name: 'menu', data: { items: ['pizza', 'pasta', 'salad'] } }]
			});
			const response = await agent.chat('What items are on the menu?');
			expect(response.text).toBeTruthy();
			expect(response.text.toLowerCase()).toMatch(/pizza|pasta|salad/);
		});

		it('should include usage data', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			const response = await agent.chat('What is in the document?');
			expect(response.usage).toBeTruthy();
			expect(response.usage.promptTokens).toBeGreaterThan(0);
		});

		it('should auto-init', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			const response = await agent.chat('Tell me about the document.');
			expect(agent._initialized).toBe(true);
			expect(response.text).toBeTruthy();
		});
	});

	describe('stream()', () => {
		it('should stream text and done events', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			const events = [];
			for await (const event of agent.stream('What is in the document?')) {
				events.push(event);
			}
			expect(events.filter(e => e.type === 'text').length).toBeGreaterThan(0);
			expect(events.filter(e => e.type === 'done').length).toBe(1);
			expect(events.find(e => e.type === 'done').fullText).toBeTruthy();
		});
	});

	describe('Context Management', () => {
		it('should add local files dynamically', async () => {
			const secondFile = join(tmpDir, 'second-doc.txt');
			await writeFile(secondFile, 'The speed of light is 299792458 m/s.');

			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			await agent.init();
			expect(agent._localFileContents.length).toBe(1);

			await agent.addLocalFiles([secondFile]);
			expect(agent._localFileContents.length).toBe(2);
		});

		it('should add local data dynamically', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localData: [{ name: 'a', data: { x: 1 } }]
			});
			await agent.init();
			await agent.addLocalData([{ name: 'b', data: { y: 2 } }]);
			expect(agent.localData.length).toBe(2);
		});

		it('should return context metadata via getContext()', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localFiles: [testFilePath],
				localData: [{ name: 'test', data: { x: 1 } }]
			});
			await agent.init();

			const ctx = agent.getContext();
			expect(ctx.localFiles.length).toBe(1);
			expect(ctx.localFiles[0].name).toBe('test-doc.md');
			expect(ctx.localFiles[0]).toHaveProperty('size');
			expect(ctx.localData.length).toBe(1);
			expect(ctx.localData[0].name).toBe('test');
			expect(ctx.mediaFiles).toEqual([]);
		});
	});

	describe('Citations', () => {
		it('should accept enableCitations option', () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, enableCitations: true });
			expect(agent.enableCitations).toBe(true);
		});

		it('should include citations in response when enabled', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localFiles: [testFilePath],
				enableCitations: true
			});
			const response = await agent.chat('What is the capital of France?');
			expect(response).toHaveProperty('citations');
			expect(Array.isArray(response.citations)).toBe(true);
		});

		it('should not include citations when disabled', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localFiles: [testFilePath],
				enableCitations: false
			});
			const response = await agent.chat('What is the capital of France?');
			expect(response.citations).toBeUndefined();
		});
	});

	describe('Multi-turn', () => {
		it('should remember context across turns', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			await agent.chat('What is the capital mentioned in the document?');
			const response = await agent.chat('And what famous tower is there?');
			expect(response.text.toLowerCase()).toContain('eiffel');
		});
	});

	describe('History Management', () => {
		it('should return seeded history after init', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			await agent.init();
			expect(agent.getHistory().length).toBe(2);
		});
		it('should clear history', async () => {
			const agent = new RagAgent({ ...BASE_OPTIONS, localFiles: [testFilePath] });
			await agent.chat('Hello');
			await agent.clearHistory();
			expect(agent.getHistory().length).toBe(0);
		});
	});
});
