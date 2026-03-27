import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { Transformer, attemptJSONRecovery } from '../index.js';
import path from 'path';
import fs from 'fs';

const { ANTHROPIC_API_KEY } = process.env;
delete process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'claude-haiku-4-5-20251001',
	apiKey: ANTHROPIC_API_KEY,
	logLevel: 'warn',
	temperature: 0.1
};

describe('Transformer — Basics', () => {
	let transformer;
	const simpleExamples = [
		{ PROMPT: { x: 1 }, ANSWER: { y: 2 } },
		{ PROMPT: { x: 3 }, ANSWER: { y: 6 } }
	];

	beforeAll(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	describe('Constructor', () => {
		it('should create with default options', () => {
			const t = new Transformer({ ...BASE_OPTIONS });
			expect(t.modelName).toMatch(/claude/);
			expect(typeof t.init).toBe('function');
			expect(typeof t.send).toBe('function');
			expect(typeof t.seed).toBe('function');
		});
		it('should have onlyJSON true by default', () => {
			expect(new Transformer({ ...BASE_OPTIONS }).onlyJSON).toBe(true);
		});
		it('should throw when promptKey === answerKey', () => {
			expect(() => new Transformer({ ...BASE_OPTIONS, promptKey: 'X', answerKey: 'X' }))
				.toThrow(/same/i);
		});
	});

	describe('init', () => {
		it('should set _initialized', async () => {
			await transformer.init();
			expect(transformer._initialized).toBe(true);
		});
	});

	describe('seed', () => {
		it('should seed chat with examples', async () => {
			await transformer.seed(simpleExamples);
			const history = transformer.getHistory();
			expect(Array.isArray(history)).toBe(true);
			expect(history.length).toBeGreaterThan(0);
		});
	});

	describe('send', () => {
		it('should transform a basic payload', async () => {
			await transformer.seed(simpleExamples);
			const result = await transformer.send({ x: 10 });
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});
		it('should work with numeric payloads', async () => {
			const result = await transformer.send(123);
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});
	});

	describe('estimate', () => {
		it('should estimate input token usage', async () => {
			const count = await transformer.estimate({ foo: "bar" });
			expect(typeof count.inputTokens).toBe('number');
			expect(count.inputTokens).toBeGreaterThan(0);
		});
	});

	describe('validation', () => {
		it('should pass through an identity validator', async () => {
			const result = await transformer.send({ x: 5 }, {}, p => Promise.resolve(p));
			expect(result).toBeTruthy();
		});
		it('should support a validator on init', async () => {
			const validator = p => {
				if (p.x < 0) throw new Error("wrong try again");
				return Promise.resolve(p);
			};
			const t2 = new Transformer({ ...BASE_OPTIONS, asyncValidator: validator, maxRetries: 1 });
			await t2.init();
			const result = await t2.send({ x: 10, "operation": "multiply by two" });
			expect(result).toBeTruthy();
		});
	});

	describe('reset()', () => {
		it('should reset history', async () => {
			await transformer.seed(simpleExamples);
			expect(transformer.getHistory().length).toBeGreaterThan(0);
			await transformer.reset();
			expect(transformer.getHistory().length).toBe(0);
		});
	});

	describe('Edge cases', () => {
		it('should handle special characters', async () => {
			const result = await transformer.send({ text: "Hi \"world\"\n🚀" });
			expect(result).toBeTruthy();
		});
	});
});


describe('Transformer — CONTEXT and EXPLANATION', () => {
	let transformer;
	const contextExamples = [
		{ CONTEXT: "Add 1 to the input.", PROMPT: { value: 3 }, ANSWER: { value: 4 }, EXPLANATION: "Increment the value by 1." },
		{ CONTEXT: "Multiply the input by 2.", PROMPT: { value: 5 }, ANSWER: { value: 10 }, EXPLANATION: "Multiply the input by two." },
		{ CONTEXT: "Square the input.", PROMPT: { value: 4 }, ANSWER: { value: 16 } }
	];

	beforeAll(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should seed examples with context and explanation fields', async () => {
		await transformer.seed(contextExamples);
		const history = transformer.getHistory();
		expect(history.length).toBe(contextExamples.length * 2);

		contextExamples.forEach((example, idx) => {
			const userMsg = history[idx * 2];
			const modelMsg = history[idx * 2 + 1];
			expect(userMsg.role).toBe('user');
			expect(modelMsg.role).toBe('assistant');
			if (example.CONTEXT) {
				expect(userMsg.content).toMatch(example.CONTEXT);
			}
			const parsedModel = JSON.parse(modelMsg.content);
			expect(parsedModel.data).toEqual(example.ANSWER);
			if (example.EXPLANATION) {
				expect(parsedModel.explanation).toBe(example.EXPLANATION);
			}
		});
	});

	it('should use context in the prompt', async () => {
		await transformer.seed(contextExamples);
		const result = await transformer.send({ value: 41, CONTEXT: "Add 1 to the input. Put the answer in a key called 'value'" });
		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
		expect(Number(result.value)).toBe(42);
	});
});


describe('Transformer — System Prompt Handling', () => {
	it('should use default JSON instructions when systemPrompt not provided', () => {
		const t = new Transformer({ apiKey: ANTHROPIC_API_KEY });
		expect(t.systemPrompt).toContain('JSON transformation engine');
	});
	it('should use custom systemPrompt', () => {
		const t = new Transformer({ apiKey: ANTHROPIC_API_KEY, systemPrompt: 'You are a pirate.' });
		expect(t.systemPrompt).toBe('You are a pirate.');
	});
	it('should set systemPrompt to null when set to null', () => {
		const t = new Transformer({ apiKey: ANTHROPIC_API_KEY, systemPrompt: null });
		expect(t.systemPrompt).toBeNull();
	});
});


describe('Transformer — Custom Keys', () => {
	it('should respect custom prompt and answer keys', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS, promptKey: 'INPUT', answerKey: 'OUTPUT' });
		await transformer.seed([{ INPUT: { a: 1 }, OUTPUT: { b: 2 } }]);
		const history = transformer.getHistory();
		// In Claude, history items have content as string
		const userContent = history[0].content;
		const modelContent = JSON.parse(history[1].content);
		expect(userContent).toContain('1');
		expect(modelContent.data).toEqual({ b: 2 });
		const result = await transformer.send({ a: 10 });
		expect(result.b).toBeDefined();
	});
});


describe('Transformer — Validation & Retry', () => {
	let transformer;
	beforeEach(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should retry on validation failure', async () => {
		await transformer.seed([{ PROMPT: { value: 1 }, ANSWER: { result: 2 } }]);
		let attempts = 0;
		const validator = (payload) => {
			attempts++;
			if (attempts < 2) throw new Error("Validation failed - retry needed");
			return Promise.resolve(payload);
		};
		const result = await transformer.send({ value: 5 }, { maxRetries: 2 }, validator);
		expect(result).toBeTruthy();
		expect(attempts).toBe(2);
	});

	it('should throw after max retries exhausted', async () => {
		const validator = () => { throw new Error("Always fails"); };
		await expect(
			transformer.send({ test: 1 }, { maxRetries: 1 }, validator)
		).rejects.toThrow(/failed after 2 attempts/i);
	});
});


describe('Transformer — State & Reset', () => {
	it('should clear history on reset()', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);
		expect(transformer.getHistory().length).toBe(2);
		await transformer.reset();
		expect(transformer.getHistory().length).toBe(0);
		const result = await transformer.send({ z: 123 });
		expect(typeof result).toBe('object');
	});

	it('should preserve examples on clearHistory()', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);
		const initialCount = transformer.exampleCount;
		await transformer.send({ x: 5 });
		await transformer.clearHistory();
		expect(transformer.getHistory().length).toBe(initialCount);
	});
});


describe('Transformer — Seeding Edge Cases', () => {
	let transformer;
	beforeEach(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should handle empty examples array', async () => {
		await transformer.seed([]);
		expect(transformer.getHistory().length).toBe(0);
	});
	it('should handle null/undefined examples', async () => {
		await transformer.seed(null);
		await transformer.seed(undefined);
	});
});


describe('Transformer — updateSystemPrompt', () => {
	it('should update system prompt', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		const original = transformer.systemPrompt;
		await transformer.updateSystemPrompt('You are a math tutor.');
		expect(transformer.systemPrompt).toBe('You are a math tutor.');
		expect(transformer.systemPrompt).not.toBe(original);
	});
	it('should throw on empty/null prompt', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		await expect(transformer.updateSystemPrompt('')).rejects.toThrow(/non-empty string/);
		await expect(transformer.updateSystemPrompt(null)).rejects.toThrow(/non-empty string/);
	});
});


describe('Transformer — Stateless Send', () => {
	it('should send stateless without affecting history', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);
		const historyBefore = transformer.getHistory().length;
		const result = await transformer.send({ x: 5 }, { stateless: true });
		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
		expect(transformer.getHistory().length).toBe(historyBefore);
	});
});


describe('Transformer — rebuild', () => {
	it('should ask model to fix a bad payload', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);
		const result = await transformer.rebuild({ y: -999 }, 'Value of y must be positive and equal to x * 2');
		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
	});
});


describe('Transformer — _preparePayload', () => {
	let transformer;
	beforeAll(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should handle null payload', async () => {
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);
		const result = await transformer.send(null);
		expect(result).toBeTruthy();
	});
	it('should handle boolean payload', async () => {
		expect(await transformer.send(true)).toBeTruthy();
	});
	it('should handle string payload', async () => {
		expect(await transformer.send('transform this text')).toBeTruthy();
	});
});


describe('Transformer — exampleData option', () => {
	it('should use exampleData from constructor when seed called with no args', async () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			exampleData: [{ PROMPT: { a: 1 }, ANSWER: { b: 2 } }]
		});
		await transformer.init();
		await transformer.seed();
		expect(transformer.getHistory().length).toBe(2);
	});
	it('should throw on invalid exampleData type', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS, exampleData: 'not-an-array' });
		await transformer.init();
		await expect(transformer.seed()).rejects.toThrow(/invalid example data/i);
	});
});


describe('Transformer — File-based Examples', () => {
	const examplesFilePath = path.resolve('./tests/examples.json');
	const examplesContent = [
		{ "userInput": "What is the weather?", "assistantResponse": { "answer": "sunny" } },
		{ "userInput": "Tell a joke", "assistantResponse": { "joke": "Why did the chicken cross the road?" } }
	];

	beforeAll(() => {
		fs.writeFileSync(examplesFilePath, JSON.stringify(examplesContent, null, 4));
	});
	afterAll(() => { fs.unlinkSync(examplesFilePath); });

	it('should load examples from file', async () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			examplesFile: examplesFilePath,
			promptKey: 'userInput',
			answerKey: 'assistantResponse'
		});
		await transformer.seed();
		expect(transformer.getHistory().length).toBe(4);
	});
	it('should handle missing examples file', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS, examplesFile: './nonexistent.json' });
		await transformer.init();
		try { await transformer.seed(); } catch (error) {
			expect(error.message).toMatch(/could not load/i);
		}
	});
});


describe('Transformer — Cost Estimation', () => {
	it('should estimate cost', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		const cost = await transformer.estimateCost({ test: 'payload' });
		expect(cost).toHaveProperty('inputTokens');
		expect(cost).toHaveProperty('model');
		expect(cost).toHaveProperty('pricing');
		expect(cost).toHaveProperty('estimatedInputCost');
	});
});
