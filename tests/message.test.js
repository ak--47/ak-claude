import { Message } from '../index.js';
import { BASE_OPTIONS } from './setup.js';

describe('Message', () => {

	describe('Constructor', () => {
		it('should create without system prompt', () => {
			expect(new Message({ ...BASE_OPTIONS }).modelName).toBe('claude-haiku-4-5-20251001');
		});
		it('should accept custom system prompt', () => {
			expect(new Message({ ...BASE_OPTIONS, systemPrompt: 'Be brief.' }).systemPrompt).toBe('Be brief.');
		});
		it('should have send() method', () => {
			expect(typeof new Message({ ...BASE_OPTIONS }).send).toBe('function');
		});
		it('should detect structured mode via responseSchema', () => {
			expect(new Message({ ...BASE_OPTIONS })._isStructured).toBe(false);
			expect(new Message({
				...BASE_OPTIONS,
				responseSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
			})._isStructured).toBe(true);
		});
		it('should detect structured mode via responseFormat json', () => {
			expect(new Message({ ...BASE_OPTIONS, responseFormat: 'json' })._isStructured).toBe(true);
		});
	});

	describe('init()', () => {
		it('should initialize in stateless mode', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			await msg.init();
			expect(msg._initialized).toBe(true);
		});
		it('should be idempotent', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			await msg.init();
			await msg.init();
			expect(msg._initialized).toBe(true);
		});
	});

	describe('send() — text responses', () => {
		it('should return a text response', async () => {
			const msg = new Message({ ...BASE_OPTIONS, systemPrompt: 'Answer concisely.' });
			const response = await msg.send('What is the capital of France?');
			expect(response.text).toBeTruthy();
			expect(response.text.toLowerCase()).toMatch(/paris/);
			expect(response).toHaveProperty('usage');
			expect(response.data).toBeUndefined();
		});
		it('should include usage data', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			const response = await msg.send('Say hello.');
			expect(response.usage).toBeTruthy();
			expect(response.usage.promptTokens).toBeGreaterThan(0);
		});
		it('should auto-init', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			expect((await msg.send('Hello')).text).toBeTruthy();
		});
	});

	describe('send() — structured JSON responses (responseSchema)', () => {
		it('should return parsed data with responseSchema', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Extract the name and age from the text.',
				responseSchema: {
					type: 'object',
					properties: { name: { type: 'string' }, age: { type: 'number' } },
					required: ['name', 'age']
				}
			});
			const response = await msg.send('Alice is 30 years old.');
			expect(response.data).toBeTruthy();
			expect(response.data.name).toBeTruthy();
			expect(typeof response.data.age).toBe('number');
		});

		it('should return data with array schema', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Extract entities as a list.',
				responseSchema: {
					type: 'object',
					properties: { entities: { type: 'array', items: { type: 'string' } } },
					required: ['entities']
				}
			});
			const response = await msg.send('Alice works at Acme in New York.');
			expect(response.data).toBeTruthy();
			expect(Array.isArray(response.data.entities)).toBe(true);
		});
	});

	describe('send() — structured JSON responses (responseFormat fallback)', () => {
		it('should return parsed data with responseFormat json', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Extract the name from the text. Return as JSON with a "name" key.',
				responseFormat: 'json'
			});
			const response = await msg.send('Bob went to the store.');
			expect(response.data).toBeTruthy();
			expect(response.data.name).toBeTruthy();
		});
	});

	describe('Stateless behavior', () => {
		it('should not maintain history between sends', async () => {
			const msg = new Message({ ...BASE_OPTIONS, systemPrompt: 'Respond concisely.' });
			await msg.send('My name is TestUser.');
			const response = await msg.send('What is my name?');
			expect(response.text.toLowerCase()).not.toContain('testuser');
		});
		it('should return empty history always', () => {
			expect(new Message({ ...BASE_OPTIONS }).getHistory()).toEqual([]);
		});
		it('should no-op on clearHistory', async () => {
			await new Message({ ...BASE_OPTIONS }).clearHistory();
		});
		it('should warn on seed()', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			const result = await msg.seed([{ PROMPT: 'x', ANSWER: 'y' }]);
			expect(result).toEqual([]);
		});
	});

	describe('Edge Cases', () => {
		it('should handle object payloads', async () => {
			const msg = new Message({ ...BASE_OPTIONS, systemPrompt: 'Describe the object.' });
			expect((await msg.send({ key: 'value', count: 42 })).text).toBeTruthy();
		});
		it('should handle special characters', async () => {
			expect((await new Message({ ...BASE_OPTIONS }).send('Hello 🌍 "world" \n test')).text).toBeTruthy();
		});
	});

	describe('Concurrent Operations', () => {
		it('should handle concurrent sends', async () => {
			const msg = new Message({ ...BASE_OPTIONS, systemPrompt: 'Reply with one word.' });
			const responses = await Promise.all([
				msg.send('Say alpha'), msg.send('Say beta'), msg.send('Say gamma')
			]);
			responses.forEach(r => expect(r.text).toBeTruthy());
		});
	});
});
