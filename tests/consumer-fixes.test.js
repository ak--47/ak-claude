/**
 * @fileoverview Offline (mocked) unit tests for the 2026-07 consumer-review fixes.
 * These do NOT hit the real API — the Anthropic client is stubbed on the instance.
 * Covers: Vertex schema validation + retry (#2), concurrency-safe per-call
 * usage (#4), estimatedCost (#5).
 */

import { jest } from '@jest/globals';
import { Message } from '../index.js';
import { validateSchema, resolvePricing, computeCost } from '../index.js';

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

		it('returns null estimatedCost for an unknown model', async () => {
			const msg = new Message({ ...KEY });
			msg._initialized = true;
			msg.client = { messages: { create: jest.fn(async () => textResponse('r', 100, 100, 'claude-made-up')) } };
			const r = await msg.send('hi');
			expect(r.usage.estimatedCost).toBeNull();
		});

		it('resolves Vertex dated snapshots to bare-id pricing', () => {
			expect(resolvePricing('claude-opus-4-5@20250514')).toEqual(resolvePricing('claude-opus-4-5-20250514'));
			expect(computeCost('claude-haiku-4-5@20251001', 1_000_000, 0)).toBeCloseTo(1.00, 5);
			expect(resolvePricing('nope')).toBeNull();
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
	});
});
