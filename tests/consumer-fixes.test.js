/**
 * @fileoverview Offline (mocked) unit tests for the 2026-07 consumer-review fixes.
 * These do NOT hit the real API — the Anthropic client is stubbed on the instance.
 * Covers: Vertex schema validation + retry (#2), concurrency-safe per-call
 * usage (#4), estimatedCost (#5).
 */

import { jest } from '@jest/globals';
import { Message } from '../index.js';
import { validateSchema, resolvePricing, computeCost, budgetTokensToEffort, MODEL_PRICING, EFFORT_LEVELS } from '../index.js';
import Chat from '../chat.js';
import Transformer from '../transformer.js';
import ToolAgent from '../tool-agent.js';

const KEY = { apiKey: 'test-key', logLevel: 'silent' };

function textResponse(text, input, output, model = 'claude-sonnet-4-6') {
	return {
		content: [{ type: 'text', text }],
		model,
		stop_reason: 'end_turn',
		usage: { input_tokens: input, output_tokens: output }
	};
}

const SCHEMA = {
	type: 'object',
	required: ['source'],
	additionalProperties: false,
	properties: { source: { type: 'string', enum: ['web', 'db'] } }
};

describe('consumer-fixes (ak-claude)', () => {

	// ── #2 Vertex fallback: schema validation + retry ──
	describe('#2 Vertex fallback validates structured output', () => {
		it('never returns a schema-invalid object; surfaces validationErrors', async () => {
			const msg = new Message({ ...KEY, responseSchema: SCHEMA, validationRetries: 1 });
			msg.vertexai = true;          // force the prompt-paste fallback path
			msg._initialized = true;
			const create = jest.fn(async () => textResponse(JSON.stringify({ source: 'ftp' }), 5, 7));
			msg.client = { messages: { create } };

			const r = await msg.send('hi');
			expect(r.data).toBeNull();
			expect(Array.isArray(r.validationErrors)).toBe(true);
			expect(r.validationErrors.length).toBeGreaterThan(0);
			expect(create).toHaveBeenCalledTimes(2); // initial + 1 retry
			// usage accumulates across attempts (5 + 5 input)
			expect(r.usage.promptTokens).toBe(10);
			expect(r.usage.attempts).toBe(2);
		});

		it('recovers when a retry produces valid output', async () => {
			const msg = new Message({ ...KEY, responseSchema: SCHEMA, validationRetries: 2 });
			msg.vertexai = true;
			msg._initialized = true;
			const create = jest.fn()
				.mockResolvedValueOnce(textResponse(JSON.stringify({ source: 'ftp' }), 5, 5))
				.mockResolvedValueOnce(textResponse(JSON.stringify({ source: 'web' }), 5, 5));
			msg.client = { messages: { create } };

			const r = await msg.send('hi');
			expect(r.data).toEqual({ source: 'web' });
			expect(r.validationErrors).toBeUndefined();
			expect(create).toHaveBeenCalledTimes(2);
		});

		it('does not retry or validate on the native (non-Vertex) path', async () => {
			const msg = new Message({ ...KEY, responseSchema: SCHEMA });
			// vertexai stays false → native output_config path, guaranteed valid
			msg._initialized = true;
			const create = jest.fn(async () => textResponse(JSON.stringify({ source: 'web' }), 5, 5));
			msg.client = { messages: { create } };

			const r = await msg.send('hi');
			expect(r.data).toEqual({ source: 'web' });
			expect(create).toHaveBeenCalledTimes(1);
		});
	});

	// ── #4 concurrency-safe per-call usage ──
	describe('#4 concurrent send() results carry their own usage', () => {
		it('does not cross-talk usage between concurrent sends', async () => {
			const msg = new Message({ ...KEY });
			msg._initialized = true;
			const N = { A: 10, B: 20, C: 30 };
			const D = { A: 30, B: 10, C: 20 };
			const create = jest.fn(async ({ messages }) => {
				const txt = messages[0].content;
				await new Promise(r => setTimeout(r, D[txt]));
				return textResponse('r', N[txt], N[txt] * 2);
			});
			msg.client = { messages: { create } };

			const [ra, rb, rc] = await Promise.all([msg.send('A'), msg.send('B'), msg.send('C')]);
			expect(ra.usage.totalTokens).toBe(30);
			expect(rb.usage.totalTokens).toBe(60);
			expect(rc.usage.totalTokens).toBe(90);
		});
	});

	// ── #5 estimatedCost ──
	describe('#5 estimatedCost in usage', () => {
		it('computes non-null estimatedCost for a priced model', async () => {
			const msg = new Message({ ...KEY });
			msg._initialized = true;
			msg.client = { messages: { create: jest.fn(async () => textResponse('r', 1_000_000, 1_000_000, 'claude-sonnet-4-6')) } };
			const r = await msg.send('hi');
			// claude-sonnet-4-6: input 3.00, output 15.00 per M
			expect(r.usage.estimatedCost).toBeCloseTo(3.00 + 15.00, 5);
		});

		it('returns null estimatedCost when neither modelVersion nor requestedModel is priced', async () => {
			const msg = new Message({ ...KEY, modelName: 'claude-made-up' });
			msg._initialized = true;
			msg.client = { messages: { create: jest.fn(async () => textResponse('r', 100, 100, 'claude-made-up')) } };
			const r = await msg.send('hi');
			expect(r.usage.estimatedCost).toBeNull();
		});

		it('falls back to requestedModel pricing when modelVersion is unknown', async () => {
			const msg = new Message({ ...KEY, modelName: 'claude-sonnet-4-6' });
			msg._initialized = true;
			msg.client = { messages: { create: jest.fn(async () => textResponse('r', 1_000_000, 0, 'weird-unpriced-build')) } };
			const r = await msg.send('hi');
			expect(r.usage.estimatedCost).toBeCloseTo(3.00, 5);
		});

		it('resolves Vertex dated snapshots to bare-id pricing', () => {
			expect(resolvePricing('claude-opus-4-5@20250514')).toEqual(resolvePricing('claude-opus-4-5-20250514'));
			expect(computeCost('claude-haiku-4-5@20251001', 1_000_000, 0)).toBeCloseTo(1.00, 5);
			expect(resolvePricing('nope')).toBeNull();
		});

		it('resolves bare opus-4-5 / sonnet-4-5 ids (B2)', () => {
			expect(resolvePricing('claude-opus-4-5')).toMatchObject({ input: 15.00, output: 75.00 });
			expect(resolvePricing('claude-sonnet-4-5')).toMatchObject({ input: 3.00, output: 15.00 });
		});

		it('includes cache-token billing in estimatedCost (S2)', async () => {
			const msg = new Message({ ...KEY, modelName: 'claude-sonnet-4-6' });
			msg._initialized = true;
			msg.client = { messages: { create: jest.fn(async () => ({
				content: [{ type: 'text', text: 'r' }],
				model: 'claude-sonnet-4-6',
				stop_reason: 'end_turn',
				usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }
			})) } };
			const r = await msg.send('hi');
			expect(r.usage.cacheCreationTokens).toBe(1_000_000);
			// input 3.00: cache-write 1.25x = 3.75, cache-read 0.1x = 0.30
			expect(r.usage.estimatedCost).toBeCloseTo(3.75 + 0.30, 5);
		});

		it('resolves direct-API hyphen-dated builds to bare pricing', () => {
			// API echoes a dated snapshot even when the bare id is the priced one
			expect(resolvePricing('claude-sonnet-4-6-20250514')).toEqual(resolvePricing('claude-sonnet-4-6'));
			expect(resolvePricing('claude-sonnet-5@20260101')).toEqual(resolvePricing('claude-sonnet-5'));
			// single-digit version parts must NOT be stripped
			expect(resolvePricing('claude-sonnet-4-6')).not.toBeNull();
		});

		it('estimatedCost is non-null when model carries a date suffix', async () => {
			const msg = new Message({ ...KEY });
			msg._initialized = true;
			msg.client = { messages: { create: jest.fn(async () => textResponse('r', 1_000_000, 0, 'claude-sonnet-4-6-20250514')) } };
			const r = await msg.send('hi');
			expect(r.usage.estimatedCost).toBeCloseTo(3.00, 5);
		});
	});

	// ── validateSchema (shared helper) ──
	describe('validateSchema()', () => {
		it('passes valid, flags enum/required/extra/type/array-item', () => {
			const schema = {
				type: 'object',
				required: ['source', 'count'],
				additionalProperties: false,
				properties: {
					source: { type: 'string', enum: ['web', 'db'] },
					count: { type: 'integer' },
					tags: { type: 'array', items: { type: 'string' } }
				}
			};
			expect(validateSchema({ source: 'web', count: 3, tags: ['a'] }, schema)).toEqual([]);
			expect(validateSchema({ source: 'ftp', count: 1 }, schema).some(e => e.includes('enum'))).toBe(true);
			expect(validateSchema({ source: 'web' }, schema).some(e => e.includes('count'))).toBe(true);
			expect(validateSchema({ source: 'web', count: 1, extra: 1 }, schema).some(e => e.includes('extra'))).toBe(true);
			expect(validateSchema({ source: 'web', count: 'x' }, schema).some(e => e.includes('integer'))).toBe(true);
			expect(validateSchema({ source: 'web', count: 1, tags: ['a', 5] }, schema).some(e => e.includes('tags[1]'))).toBe(true);
		});

		it('handles nullable, deep-equal enum, and prototype keys (S1)', () => {
			expect(validateSchema({ note: null }, { type: 'object', properties: { note: { type: 'string', nullable: true } } })).toEqual([]);
			expect(validateSchema({ a: 1 }, { enum: [{ a: 1 }] })).toEqual([]);
			// prototype key must not satisfy required, and must be flagged as extra
			expect(validateSchema({}, { type: 'object', required: ['toString'] }).some(e => e.includes('toString'))).toBe(true);
			expect(validateSchema({ x: 1 }, { type: 'object', additionalProperties: false, properties: { x: {} } })).toEqual([]);
		});
	});

	// ── validationMode: 'warn' (B4 escape hatch) ──
	describe('validationMode warn returns parsed data + errors', () => {
		it('keeps invalid data but surfaces validationErrors', async () => {
			const msg = new Message({ ...KEY, responseSchema: SCHEMA, validationRetries: 0, validationMode: 'warn' });
			msg.vertexai = true;
			msg._initialized = true;
			msg.client = { messages: { create: jest.fn(async () => textResponse(JSON.stringify({ source: 'ftp' }), 5, 5)) } };
			const r = await msg.send('hi');
			expect(r.data).toEqual({ source: 'ftp' });   // returned despite being invalid
			expect(r.validationErrors.length).toBeGreaterThan(0);
		});
	});

	// ── S4: Vertex temperature + top_p guard ──
	describe('S4 Message on Vertex does not send temperature + top_p together', () => {
		it('sends temperature only', async () => {
			const msg = new Message({ ...KEY, topP: 0.9 });
			msg.vertexai = true;      // force Vertex guard
			msg._initialized = true;
			const create = jest.fn(async () => textResponse('r', 1, 1));
			msg.client = { messages: { create } };
			await msg.send('hi');
			const params = create.mock.calls[0][0];
			expect(params.temperature).toBeDefined();
			expect(params.top_p).toBeUndefined();
		});
	});

	// ── B1: estimateCost() uses resolvePricing ──
	describe('B1 estimateCost resolves pricing and nulls unknown', () => {
		it('non-null for a priced model, null for unknown', async () => {
			const priced = new Message({ ...KEY, modelName: 'claude-sonnet-4-6' });
			priced._initialized = true;
			priced.client = { messages: { countTokens: jest.fn(async () => ({ input_tokens: 1_000_000 })) } };
			const c1 = await priced.estimateCost('hi');
			expect(c1.estimatedInputCost).toBeCloseTo(3.00, 5);

			const unknown = new Message({ ...KEY, modelName: 'claude-made-up' });
			unknown._initialized = true;
			unknown.client = { messages: { countTokens: jest.fn(async () => ({ input_tokens: 1000 })) } };
			const c2 = await unknown.estimateCost('hi');
			expect(c2.estimatedInputCost).toBeNull();
			expect(c2.pricing).toBeNull();
		});
	});

	// ── 0.2.0: Claude 5 family sampling gate (A1/A3/A4) ──
	describe('A1/A3/A4 Claude 5 family rejects sampling params', () => {
		const FIVE = ['claude-fable-5', 'claude-mythos-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7'];

		it.each(FIVE)('sends no temperature/top_p/top_k for %s', async (modelName) => {
			const msg = new Message({ ...KEY, modelName, topP: 0.9, topK: 40 });
			msg._initialized = true;
			const create = jest.fn(async () => textResponse('r', 1, 1, modelName));
			msg.client = { messages: { create } };
			await msg.send('hi');
			const sent = create.mock.calls[0][0];
			expect(sent.temperature).toBeUndefined();
			expect(sent.top_p).toBeUndefined();
			expect(sent.top_k).toBeUndefined();
		});

		it('still sends sampling params on claude-sonnet-4-6', async () => {
			const msg = new Message({ ...KEY, modelName: 'claude-sonnet-4-6', topP: 0.9, topK: 40 });
			msg._initialized = true;
			const create = jest.fn(async () => textResponse('r', 1, 1));
			msg.client = { messages: { create } };
			await msg.send('hi');
			const sent = create.mock.calls[0][0];
			expect(sent.temperature).toBe(0.7);
			expect(sent.top_p).toBe(0.9);
			expect(sent.top_k).toBe(40);
		});

		it('null means never-send, distinct from undefined', async () => {
			const msg = new Message({ ...KEY, modelName: 'claude-sonnet-4-6', temperature: null, topP: null, topK: null });
			msg._initialized = true;
			const create = jest.fn(async () => textResponse('r', 1, 1));
			msg.client = { messages: { create } };
			await msg.send('hi');
			const sent = create.mock.calls[0][0];
			expect(sent).not.toHaveProperty('temperature');
			expect(sent).not.toHaveProperty('top_p');
			expect(sent).not.toHaveProperty('top_k');
		});

		it('A4: top_k is suppressed when thinking is active', async () => {
			const msg = new Message({ ...KEY, modelName: 'claude-sonnet-4-6', topK: 40, thinking: { type: 'adaptive' } });
			msg._initialized = true;
			const create = jest.fn(async () => textResponse('r', 1, 1));
			msg.client = { messages: { create } };
			await msg.send('hi');
			expect(create.mock.calls[0][0].top_k).toBeUndefined();
		});
	});

	// ── 0.2.0: adaptive thinking + effort (A2) ──
	describe('A2 adaptive thinking + effort', () => {
		async function sentParams(options) {
			const msg = new Message({ ...KEY, ...options });
			msg._initialized = true;
			const create = jest.fn(async () => textResponse('r', 1, 1, msg.modelName));
			msg.client = { messages: { create } };
			await msg.send('hi');
			return create.mock.calls[0][0];
		}

		it('effort produces adaptive thinking + output_config.effort', async () => {
			const sent = await sentParams({ modelName: 'claude-sonnet-5', effort: 'low' });
			expect(sent.thinking).toEqual({ type: 'adaptive' });
			expect(sent.output_config).toEqual({ effort: 'low' });
		});

		it.each([
			[0, undefined],
			[1, 'low'],
			[2048, 'low'],
			[2049, 'medium'],
			[8192, 'medium'],
			[8193, 'high'],
			[24576, 'high'],
			[24577, 'xhigh']
		])('budget_tokens %i maps to effort %s on Claude 5', async (budget, expected) => {
			const sent = await sentParams({ modelName: 'claude-sonnet-5', thinking: { type: 'enabled', budget_tokens: budget } });
			if (expected === undefined) {
				expect(sent.thinking).toBeUndefined();
				expect(sent.output_config).toBeUndefined();
			} else {
				expect(sent.thinking).toEqual({ type: 'adaptive' });
				expect(sent.output_config.effort).toBe(expected);
			}
		});

		it('budgetTokensToEffort matches the documented boundaries', () => {
			expect(budgetTokensToEffort(0)).toBeNull();
			expect(budgetTokensToEffort(2048)).toBe('low');
			expect(budgetTokensToEffort(2049)).toBe('medium');
			expect(budgetTokensToEffort(8192)).toBe('medium');
			expect(budgetTokensToEffort(8193)).toBe('high');
			expect(budgetTokensToEffort(24576)).toBe('high');
			expect(budgetTokensToEffort(24577)).toBe('xhigh');
		});

		it('4.6 keeps the legacy budget_tokens shape unless adaptiveThinking is set', async () => {
			const legacy = await sentParams({ modelName: 'claude-sonnet-4-6', thinking: { type: 'enabled', budget_tokens: 4096 } });
			expect(legacy.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
			expect(legacy.output_config).toBeUndefined();

			const optedIn = await sentParams({ modelName: 'claude-sonnet-4-6', adaptiveThinking: true, thinking: { type: 'enabled', budget_tokens: 4096 } });
			expect(optedIn.thinking).toEqual({ type: 'adaptive' });
			expect(optedIn.output_config.effort).toBe('medium');
		});

		it('clamps xhigh to high on the 4.6 family only', async () => {
			const clamped = await sentParams({ modelName: 'claude-opus-4-6', effort: 'xhigh' });
			expect(clamped.output_config.effort).toBe('high');
			const kept = await sentParams({ modelName: 'claude-opus-4-8', effort: 'xhigh' });
			expect(kept.output_config.effort).toBe('xhigh');
		});

		it('passes thinking.display through verbatim on both paths', async () => {
			const adaptive = await sentParams({ modelName: 'claude-sonnet-5', thinking: { type: 'adaptive', display: 'summarized' } });
			expect(adaptive.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
			const translated = await sentParams({ modelName: 'claude-sonnet-5', thinking: { type: 'enabled', budget_tokens: 4096, display: 'summarized' } });
			expect(translated.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
		});

		it('output_config carries BOTH format and effort (native structured output)', async () => {
			const msg = new Message({ ...KEY, modelName: 'claude-sonnet-5', responseSchema: SCHEMA, effort: 'high' });
			msg._initialized = true;
			const create = jest.fn(async () => textResponse(JSON.stringify({ source: 'web' }), 1, 1, 'claude-sonnet-5'));
			msg.client = { messages: { create } };
			await msg.send('hi');
			const sent = create.mock.calls[0][0];
			expect(sent.output_config.effort).toBe('high');
			expect(sent.output_config.format).toBeDefined();
			expect(sent.output_config.format.type).toBe('json_schema');
		});

		it('rejects an unknown effort level at construction', () => {
			expect(() => new Message({ ...KEY, effort: 'turbo' })).toThrow(/Invalid effort/);
			expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
		});
	});

	// ── 0.2.0: all call sites emit identical params (A0) ──
	describe('A0 every call site applies the same sampling/thinking helpers', () => {
		const CFG = { modelName: 'claude-sonnet-5', effort: 'medium', topK: 40 };

		function stub(instance, model = 'claude-sonnet-5') {
			const create = jest.fn(async () => textResponse('{"ok":true}', 1, 1, model));
			instance.client = { messages: { create } };
			instance._initialized = true;
			return create;
		}

		it('Message, Chat, and Transformer._statelessSend agree', async () => {
			const msg = new Message({ ...KEY, ...CFG });
			const msgCreate = stub(msg);
			await msg.send('hi');

			const chat = new Chat({ ...KEY, ...CFG });
			const chatCreate = stub(chat);
			await chat.send('hi');

			const tr = new Transformer({ ...KEY, ...CFG });
			const trCreate = stub(tr);
			await tr.send({ hi: 1 }, { stateless: true });

			for (const create of [msgCreate, chatCreate, trCreate]) {
				const sent = create.mock.calls[0][0];
				expect(sent.thinking).toEqual({ type: 'adaptive' });
				expect(sent.output_config).toMatchObject({ effort: 'medium' });
				expect(sent.temperature).toBeUndefined();
				expect(sent.top_p).toBeUndefined();
				expect(sent.top_k).toBeUndefined();
			}
		});
	});

	// ── 0.2.0: pricing table coverage + intro window (A3/A5/C) ──
	describe('A3/A5 pricing table', () => {
		it('prices every table key and classifies each against the family regex', () => {
			for (const id of Object.keys(MODEL_PRICING)) {
				const p = resolvePricing(id);
				expect(p).not.toBeNull();
				expect(typeof p.input).toBe('number');
				expect(typeof p.output).toBe('number');
				expect(p.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			}
		});

		it('includes the models the family regex now matches', () => {
			for (const id of ['claude-opus-5', 'claude-mythos-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7']) {
				expect(resolvePricing(id)).not.toBeNull();
			}
		});

		it('applies Sonnet 5 intro pricing only inside the window', () => {
			const before = resolvePricing('claude-sonnet-5', { at: '2026-07-01' });
			expect(before.input).toBe(2.00);
			expect(before.output).toBe(10.00);
			expect(before.introUntil).toBe('2026-08-31');

			const after = resolvePricing('claude-sonnet-5', { at: '2026-09-01' });
			expect(after.input).toBe(3.00);
			expect(after.output).toBe(15.00);
			expect(after.introUntil).toBeUndefined();

			expect(computeCost('claude-sonnet-5', 1_000_000, 0, 0, 0, { at: '2026-07-01' })).toBeCloseTo(2.00, 5);
			expect(computeCost('claude-sonnet-5', 1_000_000, 0, 0, 0, { at: '2026-09-01' })).toBeCloseTo(3.00, 5);
		});

		it('bills 1h cache writes at 2x and 5m writes at 1.25x (C)', () => {
			const fiveMin = computeCost('claude-sonnet-4-6', 0, 0, 1_000_000, 0);
			const oneHour = computeCost('claude-sonnet-4-6', 0, 0, 1_000_000, 0, { cacheTtl: '1h' });
			expect(fiveMin).toBeCloseTo(3.00 * 1.25, 5);
			expect(oneHour).toBeCloseTo(3.00 * 2, 5);
		});
	});

	// ── A8: ToolAgent schema validation ──
	// ── A9 cumulative usage carries cache tokens ──
	describe('A9 getLastUsage() reports cache tokens, not just the last call', () => {
		function cachedResponse(text, cacheCreate, cacheRead) {
			return {
				content: [{ type: 'text', text }],
				model: 'claude-sonnet-4-6',
				stop_reason: 'end_turn',
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cache_creation_input_tokens: cacheCreate,
					cache_read_input_tokens: cacheRead
				}
			};
		}

		it('Chat seeds cache tokens into _cumulativeUsage', async () => {
			const chat = new Chat({ ...KEY });
			chat._initialized = true;
			chat.client = { messages: { create: jest.fn(async () => cachedResponse('hi', 400, 900)) } };

			await chat.send('hello');
			const usage = chat.getLastUsage();
			expect(usage.cacheCreationTokens).toBe(400);
			expect(usage.cacheReadTokens).toBe(900);
			expect(chat._cumulativeUsage.cacheCreationTokens).toBe(400);
			expect(chat._cumulativeUsage.cacheReadTokens).toBe(900);
		});

		it('Transformer accumulates cache tokens across validation retries', async () => {
			let calls = 0;
			const validator = async () => {
				if (++calls === 1) throw new Error('nope');
			};
			const t = new Transformer({ ...KEY, validationRetries: 1, retryDelay: 0, asyncValidator: validator });
			t._initialized = true;
			const create = jest.fn(async () => cachedResponse(JSON.stringify({ source: 'web' }), 100, 200));
			t.client = { messages: { create } };

			await t.send({ q: 'x' });
			expect(create).toHaveBeenCalledTimes(2);
			const usage = t.getLastUsage();
			// Prompt tokens are summed across both attempts — cache tokens must be too.
			expect(usage.promptTokens).toBe(20);
			expect(usage.cacheCreationTokens).toBe(200);
			expect(usage.cacheReadTokens).toBe(400);
		});
	});

	describe('A8 ToolAgent rejects a tool with no parameter schema', () => {
		it('throws naming the offending tool', () => {
			expect(() => new ToolAgent({
				...KEY,
				tools: [{ name: 'lookup', description: 'x' }],
				toolExecutor: async () => ({})
			})).toThrow(/lookup/);
		});

		it('accepts any of the three schema key aliases', () => {
			const mk = (tool) => new ToolAgent({ ...KEY, tools: [tool], toolExecutor: async () => ({}) });
			const schema = { type: 'object', properties: {} };
			expect(mk({ name: 'a', input_schema: schema }).tools[0].input_schema).toEqual(schema);
			expect(mk({ name: 'b', inputSchema: schema }).tools[0].input_schema).toEqual(schema);
			expect(mk({ name: 'c', parametersJsonSchema: schema }).tools[0].input_schema).toEqual(schema);
		});
	});
});
