/**
 * Offline tests — no API calls.
 * Covers seed() model-turn format: prose for Chat, JSON envelope for Transformer.
 */

import Chat from '../chat.js';
import Transformer from '../transformer.js';
import BaseClaude from '../base.js';

const apiKey = 'offline-fake-key';

describe('seed() model-turn format', () => {

	it('Chat.seed() stores assistant turns as verbatim prose (no JSON envelope)', async () => {
		const chat = new Chat({ apiKey });
		await chat.seed([{ PROMPT: 'What is 2+2?', ANSWER: 'Four.' }]);
		const history = chat.getHistory();
		const assistantTurn = history.find(h => h.role === 'assistant');
		expect(assistantTurn).toBeDefined();
		expect(assistantTurn.content).toBe('Four.');
	});

	it('Chat.seed() with object ANSWER serializes without the data envelope', async () => {
		const chat = new Chat({ apiKey });
		await chat.seed([{ PROMPT: 'Give me config', ANSWER: { retries: 3 } }]);
		const assistantTurn = chat.getHistory().find(h => h.role === 'assistant');
		const parsed = JSON.parse(assistantTurn.content);
		expect(parsed).toEqual({ retries: 3 });
		expect(parsed.data).toBeUndefined();
	});

	it('Transformer.seed() still wraps assistant turns in the {data} envelope', async () => {
		const t = new Transformer({ apiKey });
		await t.seed([{ PROMPT: { a: 1 }, ANSWER: { b: 2 } }]);
		const assistantTurn = t.getHistory().find(h => h.role === 'assistant');
		const parsed = JSON.parse(assistantTurn.content);
		expect(parsed.data).toEqual({ b: 2 });
	});

	it('BaseClaude.seed() defaults to json format (back-compat)', async () => {
		const base = new BaseClaude({ apiKey });
		await base.seed([{ PROMPT: 'in', ANSWER: 'out' }]);
		const assistantTurn = base.getHistory().find(h => h.role === 'assistant');
		const parsed = JSON.parse(assistantTurn.content);
		expect(parsed.data).toBe('out');
	});

	it('BaseClaude.seed() honors explicit format: "text"', async () => {
		const base = new BaseClaude({ apiKey });
		await base.seed([{ PROMPT: 'in', ANSWER: 'out' }], { format: 'text' });
		const assistantTurn = base.getHistory().find(h => h.role === 'assistant');
		expect(assistantTurn.content).toBe('out');
	});

});
