import { Chat, Transformer, BaseClaude, log } from '../index.js';
import { BASE_OPTIONS, USE_VERTEX } from './setup.js';

describe('BaseClaude — Shared Behavior', () => {

	describe('Authentication', () => {
		if (!USE_VERTEX) {
			it('should throw on missing API key', () => {
				expect(() => new Chat({})).toThrow(/api key/i);
			});
			it('should throw on empty string API key', () => {
				expect(() => new Chat({ apiKey: '' })).toThrow(/api key/i);
			});
			it('should accept API key via options', () => {
				const chat = new Chat({ ...BASE_OPTIONS });
				expect(chat.apiKey).toBeTruthy();
			});
		} else {
			it('should accept vertexai without API key', () => {
				const chat = new Chat({ ...BASE_OPTIONS });
				expect(chat.vertexai).toBe(true);
				expect(chat.apiKey).toBeNull();
			});
		}
	});

	describe('init()', () => {
		it('should initialize the client', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			expect(chat._initialized).toBe(true);
			expect(chat.client).toBeTruthy();
		});
		it('should be idempotent', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			const client = chat.client;
			await chat.init();
			expect(chat.client).toBe(client);
		});
		it('should reinitialize when force=true', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.init(true);
			expect(chat._initialized).toBe(true);
		});
	});

	describe('getLastUsage()', () => {
		it('should return null before any API call', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.getLastUsage()).toBeNull();
		});
		it('should return usage data after a call', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.send('Say hi.');
			const usage = chat.getLastUsage();
			expect(usage).toBeTruthy();
			expect(typeof usage.promptTokens).toBe('number');
			expect(typeof usage.responseTokens).toBe('number');
			expect(typeof usage.totalTokens).toBe('number');
			expect(usage.promptTokens).toBeGreaterThan(0);
			expect(usage.requestedModel).toBe(BASE_OPTIONS.modelName);
			expect(typeof usage.timestamp).toBe('number');
		});
	});

	describe('estimate()', () => {
		it('should estimate input tokens for a payload', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			const count = await chat.estimate({ foo: "bar" });
			expect(typeof count.inputTokens).toBe('number');
			expect(count.inputTokens).toBeGreaterThan(0);
		});
	});

	describe('estimateCost()', () => {
		it('should estimate cost based on input tokens', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			const cost = await chat.estimateCost({ test: 'payload' });
			expect(cost).toHaveProperty('inputTokens');
			expect(cost).toHaveProperty('model');
			expect(cost).toHaveProperty('pricing');
			expect(cost).toHaveProperty('estimatedInputCost');
			expect(cost.model).toBe(BASE_OPTIONS.modelName);
		});
	});

	describe('seed()', () => {
		it('should add example pairs to chat history', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.seed([
				{ PROMPT: { x: 1 }, ANSWER: { y: 2 } },
				{ PROMPT: { x: 3 }, ANSWER: { y: 6 } }
			]);
			const history = chat.getHistory();
			expect(history.length).toBe(4);
		});
		it('should handle empty or null examples', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.seed([]);
			await chat.seed(null);
			await chat.seed(undefined);
		});
	});

	describe('getHistory()', () => {
		it('should return empty array before init', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.getHistory()).toEqual([]);
		});
	});

	describe('clearHistory()', () => {
		it('should clear history', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.send('Remember this.');
			expect(chat.getHistory().length).toBeGreaterThan(0);
			await chat.clearHistory();
			expect(chat.getHistory().length).toBe(0);
			expect(chat.lastResponseMetadata).toBeNull();
		});
		it('should not throw when called before init', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.clearHistory();
		});
	});

	describe('Thinking Config', () => {
		it('should default thinking to null', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.thinking).toBeNull();
		});
		it('should accept thinking config', () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				thinking: { type: 'enabled', budget_tokens: 1024 }
			});
			expect(chat.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
		});
	});

	describe('maxTokens', () => {
		it('should use default when not specified', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.maxTokens).toBe(8192);
		});
		it('should accept custom maxTokens', () => {
			const chat = new Chat({ ...BASE_OPTIONS, maxTokens: 4096 });
			expect(chat.maxTokens).toBe(4096);
		});
	});

	describe('Log Level', () => {
		it('should accept logLevel "none" as silent', () => {
			new Chat({ ...BASE_OPTIONS, logLevel: 'none' });
			expect(log.level).toBe('silent');
		});
		it('should accept custom logLevel', () => {
			new Chat({ ...BASE_OPTIONS, logLevel: 'error' });
			expect(log.level).toBe('error');
		});
	});

	describe('Web Search', () => {
		it('should default enableWebSearch to false', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.enableWebSearch).toBe(false);
		});
		it('should accept enableWebSearch option', () => {
			const chat = new Chat({ ...BASE_OPTIONS, enableWebSearch: true });
			expect(chat.enableWebSearch).toBe(true);
		});
		it('should include web search tool when enabled via _buildTools', () => {
			const chat = new Chat({ ...BASE_OPTIONS, enableWebSearch: true });
			const tools = chat._buildTools();
			expect(tools).toBeDefined();
			expect(tools[0].type).toBe('web_search_20250305');
		});
		it('should not include web search when disabled', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat._buildTools()).toBeUndefined();
		});
		it('should merge web search with existing tools', () => {
			const chat = new Chat({ ...BASE_OPTIONS, enableWebSearch: true });
			const tools = chat._buildTools([{ name: 'test', input_schema: { type: 'object' } }]);
			expect(tools.length).toBe(2);
			expect(tools[0].type).toBe('web_search_20250305');
		});
	});

	describe('Prompt Caching', () => {
		it('should default cacheSystemPrompt to false', () => {
			expect(new Chat({ ...BASE_OPTIONS }).cacheSystemPrompt).toBe(false);
		});
		it('should accept cacheSystemPrompt option', () => {
			expect(new Chat({ ...BASE_OPTIONS, cacheSystemPrompt: true }).cacheSystemPrompt).toBe(true);
		});
		it('should return array system param with cache_control when enabled', () => {
			const chat = new Chat({ ...BASE_OPTIONS, systemPrompt: 'Test', cacheSystemPrompt: true });
			const param = chat._buildSystemParam();
			expect(Array.isArray(param)).toBe(true);
			expect(param[0].cache_control).toEqual({ type: 'ephemeral' });
		});
		it('should return string system param when cache disabled', () => {
			const chat = new Chat({ ...BASE_OPTIONS, systemPrompt: 'Test' });
			expect(typeof chat._buildSystemParam()).toBe('string');
		});
	});

	describe('Constructor', () => {
		it('should set model name', () => {
			expect(new Chat({ ...BASE_OPTIONS }).modelName).toBe(BASE_OPTIONS.modelName);
		});
		it('should have null lastResponseMetadata before any call', () => {
			expect(new Chat({ ...BASE_OPTIONS }).lastResponseMetadata).toBeNull();
		});
	});
});
