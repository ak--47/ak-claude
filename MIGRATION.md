# Migrating from ak-gemini to ak-claude

This guide covers everything you need to change when switching from `ak-gemini` (Google Gemini) to `ak-claude` (Anthropic Claude). Both packages share the same architecture and API surface, making migration straightforward.

**Both packages export the same class names** with the same method signatures. In most cases, migration is an import swap + env var change + model name update.

---

## Quick Summary

| Concept | ak-gemini | ak-claude |
|---|---|---|
| Package | `ak-gemini` | `ak-claude` |
| SDK dependency | `@google/genai` | `@anthropic-ai/sdk` |
| Base class | `BaseGemini` | `BaseClaude` |
| Default model | `gemini-2.5-flash` | `claude-sonnet-4-6` |
| API key env var | `GEMINI_API_KEY` | `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) |
| Transformer | `Transformer` | `Transformer` |
| Chat | `Chat` | `Chat` |
| Message | `Message` | `Message` |
| ToolAgent | `ToolAgent` | `ToolAgent` |
| CodeAgent | `CodeAgent` | `CodeAgent` |
| RagAgent | `RagAgent` | `RagAgent` |
| Embedding | `Embedding` | Not available |
| AgentQuery | Not available | `AgentQuery` |

---

## Strategy 1: Drop-in Replacement

For most use cases, migration requires only three changes: the import, the environment variable, and the model name.

### Step 1: Change the import

```javascript
// ak-gemini                                          // ak-claude
import { Transformer, Chat } from 'ak-gemini';       import { Transformer, Chat } from 'ak-claude';
import AI from 'ak-gemini';                           import AI from 'ak-claude';
const { Chat } = require('ak-gemini');                const { Chat } = require('ak-claude');
```

### Step 2: Change the environment variable

```sh
# ak-gemini                            # ak-claude
export GEMINI_API_KEY=your-key          export ANTHROPIC_API_KEY=your-key
```

### Step 3: Change the model name (or omit it)

```javascript
new Chat({ modelName: 'gemini-2.5-flash' });  // ak-gemini default
new Chat({ modelName: 'claude-sonnet-4-6' });  // ak-claude default
new Chat({ systemPrompt: 'Hello.' });          // both — omit to use default
```

### That's it for most cases

If you only use `Transformer`, `Chat`, `Message`, `ToolAgent`, or `CodeAgent`, the three changes above are all you need. The class names, method names, and option names are intentionally identical.

---

## Constructor Option Mapping

Most constructor options are shared. The table below covers the differences.

### Base Options (all classes)

| ak-gemini | ak-claude | Notes |
|---|---|---|
| `modelName` | `modelName` | Different defaults: `gemini-2.5-flash` vs `claude-sonnet-4-6` |
| `systemPrompt` | `systemPrompt` | Same |
| `apiKey` | `apiKey` | Different env var fallback |
| `maxOutputTokens` | `maxTokens` | **Renamed.** Gemini default: 50000. Claude default: 8192 |
| `thinkingConfig` | `thinking` | **Different format.** See below |
| `enableGrounding` | `enableWebSearch` | **Renamed.** See below |
| `groundingConfig` | `webSearchConfig` | **Renamed + different shape.** See below |
| `logLevel` | `logLevel` | Same |
| `resourceExhaustedRetries` | `maxRetries` | Gemini: app-level backoff. Claude: SDK-level (Anthropic SDK handles 429s natively) |
| `resourceExhaustedDelay` | Not available | Anthropic SDK handles backoff internally |
| `vertexai` | `vertexai` | Same — `true` to use Vertex AI auth via ADC |
| `project` | `vertexProjectId` | **Renamed.** Or `GOOGLE_CLOUD_PROJECT` env var |
| `location` | `vertexRegion` | **Renamed.** Or `GOOGLE_CLOUD_LOCATION` env var (default: `us-east5`) |
| `labels` | Not available | No billing labels |
| `cachedContent` | Not available | No cache CRUD API. Use `cacheSystemPrompt` instead |
| `healthCheck` | `healthCheck` | Same — opt-in connectivity check during `init()` |
| Not available | `temperature` | Claude exposes directly (default: 0.7) |
| Not available | `topP` | Claude exposes directly (default: 0.95) |
| Not available | `topK` | Claude exposes directly |
| Not available | `cacheSystemPrompt` | Prompt caching via `cache_control` on system prompt |

### Thinking Configuration

```javascript
// ak-gemini
new Chat({
  thinkingConfig: { thinkingBudget: 1024 }
});

// ak-claude
new Chat({
  thinking: { type: 'enabled', budget_tokens: 1024 }
});
```

### Web Search / Grounding

```javascript
// ak-gemini — Google Search grounding
new Chat({
  enableGrounding: true,
  groundingConfig: { excludeDomains: ['example.com'] }
});

// ak-claude — server-managed web search tool
new Chat({
  enableWebSearch: true,
  webSearchConfig: {
    max_uses: 5,
    allowed_domains: ['docs.example.com'],
    blocked_domains: ['example.com']
  }
});
```

### ToolAgent Options

| ak-gemini | ak-claude | Notes |
|---|---|---|
| `tools` | `tools` | Same — but `input_schema` vs `parametersJsonSchema` (both accepted) |
| `toolExecutor` | `toolExecutor` | Same |
| `maxToolRounds` | `maxToolRounds` | Same (default: 10) |
| `onToolCall` | `onToolCall` | Same |
| `onBeforeExecution` | `onBeforeExecution` | Same |
| Not available | `toolChoice` | Claude-only: `{ type: 'auto' }`, `{ type: 'any' }`, `{ type: 'tool', name: '...' }`, `{ type: 'none' }` |
| Not available | `disableParallelToolUse` | Claude-only: force sequential tool calls |

### Message Options

| ak-gemini | ak-claude | Notes |
|---|---|---|
| `responseMimeType` | `responseFormat` | Gemini: `'application/json'`. Claude: `'json'` |
| `responseSchema` | `responseSchema` | Same purpose, different underlying mechanism |

---

## Method Mapping

All methods map one-to-one. No renames needed.

| Method | ak-gemini | ak-claude | Notes |
|---|---|---|---|
| Initialize | `init(force?)` | `init(force?)` | Same |
| Seed examples | `seed(examples)` | `seed(examples)` | Same |
| Transform (Transformer) | `send(payload, opts?, validator?)` | `send(payload, opts?, validator?)` | Same |
| Raw transform | `rawSend(payload)` | `rawSend(payload)` | Same |
| Rebuild on error | `rebuild(payload, error)` | `rebuild(payload, error)` | Same |
| Chat text (Chat) | `send(message)` | `send(message)` | Same |
| Agent chat | `chat(message)` | `chat(message)` | Same |
| Agent stream | `stream(message)` | `stream(message)` | Same |
| Stop agent | `stop()` | `stop()` | Same |
| Get history | `getHistory()` | `getHistory(curated?)` | Claude adds optional `curated` flag |
| Clear history | `clearHistory()` | `clearHistory()` | Same |
| Reset | `reset()` | `reset()` | Same |
| Update prompt | `updateSystemPrompt(str)` | `updateSystemPrompt(str)` | Same |
| Token estimate | `estimate(payload)` | `estimate(payload)` | Same shape: `{ inputTokens }` |
| Cost estimate | `estimateCost(payload)` | `estimateCost(payload)` | Same shape |
| Usage | `getLastUsage()` | `getLastUsage()` | Same shape (see Behavioral Differences) |

---

## Tool Declaration Mapping

ak-claude accepts tool declarations in Claude's native `input_schema` format, but also auto-maps the Gemini-style `parametersJsonSchema` and `inputSchema` aliases. You do not need to rename your tool schemas when migrating.

```javascript
// All three work in ak-claude (auto-mapped in ToolAgent constructor):
{ name: 'search', description: '...', parametersJsonSchema: { ... } }  // Gemini compat
{ name: 'search', description: '...', inputSchema: { ... } }           // camelCase alias
{ name: 'search', description: '...', input_schema: { ... } }          // Claude native
```

---

## Behavioral Differences

These are subtle differences in how the two packages work under the hood, even though the API surface is the same.

### 1. SDK Sessions vs Manual History

Gemini's SDK provides built-in chat sessions (`startChat()`) that manage history automatically. Claude's Messages API is stateless — ak-claude manages `this.history[]` as a plain array and passes the full conversation on every `messages.create()` call.

**Impact on you:** None. Both packages expose the same `getHistory()` / `clearHistory()` API. The difference is internal.

### 2. Response Structure

Gemini returns a single `response.text` string. Claude returns an array of content blocks (text, tool_use, thinking, etc.). ak-claude extracts and joins text blocks for you, so `result.text` works the same way in both packages.

```javascript
// Both packages
const result = await chat.send('Hello!');
console.log(result.text); // Works identically
```

However, if you access `getLastUsage()`, the fields differ slightly:

| ak-gemini Usage | ak-claude Usage |
|---|---|
| `groundingMetadata` (when grounding enabled) | Not present |
| Not present | `cacheCreationTokens` |
| Not present | `cacheReadTokens` |
| Not present | `stopReason` |

### 3. Structured Output (Message class)

Gemini uses `responseMimeType` + `responseSchema` with its built-in structured output. Claude uses `output_config` with `json_schema` format under the hood, or falls back to system prompt hacking.

```javascript
// ak-gemini
const msg = new Message({
  responseMimeType: 'application/json',
  responseSchema: { type: 'object', properties: { name: { type: 'string' } } }
});

// ak-claude — native structured output (guaranteed valid JSON)
const msg = new Message({
  responseSchema: { type: 'object', properties: { name: { type: 'string' } } }
});

// ak-claude — fallback mode (no schema guarantee)
const msg = new Message({
  responseFormat: 'json'
});
```

### 4. RagAgent Context Sources

| ak-gemini | ak-claude | Notes |
|---|---|---|
| `remoteFiles` | Not available | Gemini uploads via Google Files API |
| `localFiles` | `localFiles` | Same — read from disk as text |
| `localData` | `localData` | Same — in-memory JSON objects |
| Not available | `mediaFiles` | Claude-only: images and PDFs as base64 content blocks |
| Not available | `enableCitations` | Claude-only: returns citation metadata |

```javascript
// ak-gemini
const rag = new RagAgent({
  remoteFiles: ['./report.pdf'],  // uploaded via Google Files API
  localFiles: ['./docs/api.md'],
  localData: [{ name: 'users', data: users }]
});

// ak-claude
const rag = new RagAgent({
  mediaFiles: ['./report.pdf'],   // base64 encoded, sent as document block
  localFiles: ['./docs/api.md'],
  localData: [{ name: 'users', data: users }],
  enableCitations: true           // optional: get citation metadata
});
```

### 5. Rate Limit Handling

Gemini (ak-gemini) implements custom retry logic with exponential backoff (`resourceExhaustedRetries`, `resourceExhaustedDelay`). Claude (ak-claude) delegates 429 handling to the Anthropic SDK's built-in retry (`maxRetries`), which handles backoff automatically.

```javascript
// ak-gemini
new Chat({ resourceExhaustedRetries: 10, resourceExhaustedDelay: 2000 });

// ak-claude — SDK handles backoff internally
new Chat({ maxRetries: 10 });
```

### 6. Default Token Limits

Gemini defaults to 50,000 max output tokens. Claude defaults to 8,192. If you rely on very long responses, set `maxTokens` explicitly:

```javascript
new Chat({ maxTokens: 16384 });
```

---

## Feature Parity Gaps

Features in ak-gemini that are **not available** in ak-claude:

| ak-gemini Feature | ak-claude Status | Workaround |
|---|---|---|
| `Embedding` class | Not available | Use a dedicated embedding service (OpenAI, Cohere, or Gemini embeddings directly) |
| Cache CRUD (`createCache`, `getCache`, `listCaches`, `updateCache`, `deleteCache`, `useCache`) | Not available | Use `cacheSystemPrompt: true` for automatic prompt caching |
| Vertex AI support (`vertexai`, `project`, `location`) | Available | `vertexai: true` + optional `vertexProjectId` / `vertexRegion` (same pattern as ak-gemini) |
| Billing labels (`labels`) | Not available | Track costs via Anthropic dashboard |
| Safety settings | Not available | Claude uses built-in content moderation |
| `responseMimeType` on Message | Not available | Use `responseSchema` (native) or `responseFormat: 'json'` (fallback) |
| `remoteFiles` on RagAgent (Files API upload) | Not available | Use `mediaFiles` (base64 encoded) or `localFiles` |
| `groundingMetadata` in usage | Not available | Web search results appear inline in the response text |

---

## New Capabilities

Features in ak-claude that are **not available** in ak-gemini:

### AgentQuery

Wraps the Claude Agent SDK's `query()` function for autonomous agent tasks. Unlike ToolAgent which uses your tools, AgentQuery launches a full Claude Code agent process with built-in tools (Read, Write, Edit, Bash, Glob, Grep, etc.).

```javascript
import { AgentQuery } from 'ak-claude';

const agent = new AgentQuery({
  cwd: '/path/to/project',
  allowedTools: ['Read', 'Glob', 'Grep'],
  maxTurns: 20,
  maxBudgetUsd: 1.00
});

for await (const msg of agent.run('Find all TODO comments in the codebase')) {
  if (msg.type === 'assistant') console.log(msg.message.content);
  if (msg.type === 'result') console.log('Done:', msg.result);
}

// Resume a previous session
for await (const msg of agent.resume(agent.lastSessionId, 'Now fix them')) {
  // ...
}
```

### Citations (RagAgent)

Claude's native citations feature returns structured citation metadata pointing back to specific passages in your source documents.

```javascript
const rag = new RagAgent({
  localFiles: ['./docs/api.md'],
  mediaFiles: ['./report.pdf'],
  enableCitations: true
});

const result = await rag.chat('What does the API doc say about auth?');
console.log(result.citations);
// [{ type: 'char_location', cited_text: '...', start: 0, end: 100, document_title: 'api.md' }]
```

### Tool Choice

Force Claude to use specific tools, any tool, or no tools at all.

```javascript
const agent = new ToolAgent({
  tools: [searchTool, calculateTool],
  toolExecutor: myExecutor,
  toolChoice: { type: 'tool', name: 'search' },     // force specific tool
  // or: toolChoice: { type: 'any' },                // force any tool use
  // or: toolChoice: { type: 'none' },               // disable tool use
  disableParallelToolUse: true                        // sequential tool calls only
});
```

### Native Structured Output (Message)

Claude's `output_config` with `json_schema` guarantees the response matches your schema exactly. Pass `responseSchema` and `r.data` is guaranteed valid JSON matching the schema.

### Web Search Tool

Claude's server-managed web search tool with domain filtering via `enableWebSearch` + `webSearchConfig` (see Constructor Option Mapping above).

### Media Files (RagAgent)

Send images and PDFs as base64-encoded content blocks via `mediaFiles` for Claude's vision and document understanding.

### Prompt Caching

Set `cacheSystemPrompt: true` to add `cache_control: { type: 'ephemeral' }` to the system prompt, reducing costs for repeated conversations.

---

## Strategy 2: Side-by-Side

If you need to support both providers simultaneously, here are patterns for dual-provider architectures.

### Factory Function

```javascript
async function createAI(provider, options = {}) {
  if (provider === 'gemini') {
    const { Chat } = await import('ak-gemini');
    return new Chat({
      modelName: options.model || 'gemini-2.5-flash',
      systemPrompt: options.systemPrompt,
      apiKey: options.apiKey || process.env.GEMINI_API_KEY,
    });
  }

  if (provider === 'claude') {
    const { Chat } = await import('ak-claude');
    return new Chat({
      modelName: options.model || 'claude-sonnet-4-6',
      systemPrompt: options.systemPrompt,
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// Usage
const ai = await createAI(process.env.AI_PROVIDER || 'claude', {
  systemPrompt: 'You are a helpful assistant.'
});
const result = await ai.send('Hello!');
```

### Adapter Wrapper

Normalize the option name differences behind a common interface:

```javascript
class AIAdapter {
  constructor(provider, options = {}) {
    this.provider = provider;
    this._options = options;
    this._instance = null;
  }

  async init() {
    const isGemini = this.provider === 'gemini';
    const mod = isGemini ? await import('ak-gemini') : await import('ak-claude');
    this._instance = new mod.Chat({
      modelName: this._options.model || (isGemini ? 'gemini-2.5-flash' : 'claude-sonnet-4-6'),
      systemPrompt: this._options.systemPrompt,
      ...(isGemini
        ? { maxOutputTokens: this._options.maxTokens, enableGrounding: this._options.webSearch }
        : { maxTokens: this._options.maxTokens, enableWebSearch: this._options.webSearch }),
    });
    await this._instance.init();
  }

  async send(message) { return this._instance.send(message); }
  async clearHistory() { return this._instance.clearHistory(); }
}
```

### RagAgent Provider Abstraction

The RagAgent has the most differences (remoteFiles vs mediaFiles, citations). Abstract them with a factory:

```javascript
async function createRagAgent(provider, options = {}) {
  if (provider === 'gemini') {
    const { RagAgent } = await import('ak-gemini');
    return new RagAgent({
      remoteFiles: options.pdfFiles || [],    // Gemini: Files API upload
      localFiles: options.textFiles || [],
      localData: options.data || [],
    });
  }
  const { RagAgent } = await import('ak-claude');
  return new RagAgent({
    mediaFiles: options.pdfFiles || [],       // Claude: base64 content blocks
    localFiles: options.textFiles || [],
    localData: options.data || [],
    enableCitations: options.citations ?? false,
  });
}
```

---

## Full Before/After Example

The only lines that change are the import, model name, and a few option names:

```javascript
// ak-gemini                                         // ak-claude
import { Transformer } from 'ak-gemini';             import { Transformer } from 'ak-claude';

const t = new Transformer({                          const t = new Transformer({
  modelName: 'gemini-2.5-flash',                       modelName: 'claude-sonnet-4-6',
  systemPrompt: 'Transform profiles.',                 systemPrompt: 'Transform profiles.',
  maxOutputTokens: 8192,                               maxTokens: 8192,
  thinkingConfig: { thinkingBudget: 1024 },            thinking: { type: 'enabled', budget_tokens: 1024 },
  enableGrounding: true,                               enableWebSearch: true,
});                                                  });

// Everything below is identical in both packages:
await t.init();
await t.seed([{ PROMPT: { name: 'Alice' }, ANSWER: { greeting: 'Hello!' } }]);
const result = await t.send({ name: 'Bob' });
const usage = t.getLastUsage();
await t.clearHistory();
```

ToolAgent code is identical (just change the import). RagAgent requires swapping `remoteFiles` to `mediaFiles` and optionally adding `enableCitations: true`.
