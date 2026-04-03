# ak-claude

**Modular, type-safe wrapper for Anthropic's Claude AI.** Eight class exports for different interaction patterns — JSON transformation, chat, stateless messages, tool-using agents, code-writing agents, document Q&A, and autonomous agent queries — all sharing a common base.

```sh
npm install ak-claude
```

Requires Node.js 18+ and [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk).

---

## Quick Start

```javascript
import { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, AgentQuery } from 'ak-claude';

// Vertex AI auth (recommended for GCP deployments — uses Application Default Credentials)
new Chat({ vertexai: true });

// Or direct API key auth
// export ANTHROPIC_API_KEY=your-key
new Chat({ apiKey: 'your-key' });
```

---

## Classes

### Transformer — JSON Transformation

Transform structured data using few-shot examples with validation and retry.

```javascript
const transformer = new Transformer({
  modelName: 'claude-sonnet-4-6',
  sourceKey: 'INPUT',
  targetKey: 'OUTPUT'
});

await transformer.init();
await transformer.seed([
  {
    INPUT: { name: 'Alice' },
    OUTPUT: { name: 'Alice', role: 'engineer', emoji: '👩‍💻' }
  }
]);

const result = await transformer.send({ name: 'Bob' });
// → { name: 'Bob', role: '...', emoji: '...' }
```

**Validation & self-healing:**

```javascript
const result = await transformer.send({ name: 'Bob' }, {}, async (output) => {
  if (!output.role) throw new Error('Missing role field');
  return output;
});
```

### Chat — Multi-Turn Conversation

```javascript
const chat = new Chat({
  systemPrompt: 'You are a helpful assistant.'
});

const r1 = await chat.send('My name is Alice.');
const r2 = await chat.send('What is my name?');
// r2.text → "Alice"
```

### Message — Stateless One-Off

Each call is independent — no history maintained.

```javascript
const msg = new Message({
  systemPrompt: 'Extract entities as JSON.',
  responseSchema: {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' }
          },
          required: ['name', 'type']
        }
      }
    },
    required: ['entities']
  }
});

const result = await msg.send('Alice works at Acme Corp in New York.');
// result.data → { entities: [{ name: 'Alice', type: 'person' }, ...] }
```

When `responseSchema` is provided, the API guarantees valid JSON matching the schema via native structured output (`output_config`). For a lighter alternative without schema guarantees, use `responseFormat: 'json'` instead.

### ToolAgent — Agent with User-Provided Tools

Provide tool declarations and an executor function. The agent manages the tool-use loop automatically.

```javascript
const agent = new ToolAgent({
  systemPrompt: 'You are a research assistant.',
  tools: [
    {
      name: 'http_get',
      description: 'Fetch a URL',
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url']
      }
    }
  ],
  toolExecutor: async (toolName, args) => {
    if (toolName === 'http_get') {
      const res = await fetch(args.url);
      return { status: res.status, body: await res.text() };
    }
  },
  onBeforeExecution: async (toolName, args) => {
    console.log(`About to call ${toolName}`);
    return true; // return false to deny
  }
});

const result = await agent.chat('Fetch https://api.example.com/data');
console.log(result.text);       // Agent's summary
console.log(result.toolCalls);  // [{ name, args, result }]
```

**Streaming:**

```javascript
for await (const event of agent.stream('Fetch the data')) {
  if (event.type === 'text') process.stdout.write(event.text);
  if (event.type === 'tool_call') console.log(`Calling ${event.toolName}...`);
  if (event.type === 'tool_result') console.log(`Result:`, event.result);
  if (event.type === 'done') console.log('Done!');
}
```

### CodeAgent — Agent That Writes and Executes Code

Instead of calling tools one by one, the model writes JavaScript that can do everything — read files, write files, run commands — in a single script.

```javascript
const agent = new CodeAgent({
  workingDirectory: '/path/to/my/project',
  onCodeExecution: (code, output) => {
    console.log('Ran:', code.slice(0, 100));
    console.log('Output:', output.stdout);
  },
  onBeforeExecution: async (code) => {
    // Review code before execution
    console.log('About to run:', code);
    return true; // return false to deny
  }
});

const result = await agent.chat('Find all TODO comments in the codebase');
console.log(result.text);             // Agent's summary
console.log(result.codeExecutions);   // [{ code, output, stderr, exitCode }]
```

**How it works:**
1. On `init()`, gathers codebase context (file tree + key files like package.json)
2. Injects context into the system prompt so the model understands the project
3. Model writes JavaScript using the `execute_code` tool
4. Code runs in a Node.js child process that inherits `process.env`
5. Output (stdout/stderr) feeds back to the model
6. Model decides if more work is needed

**Streaming:**

```javascript
for await (const event of agent.stream('Refactor the auth module')) {
  if (event.type === 'text') process.stdout.write(event.text);
  if (event.type === 'code') console.log('\n[Running code...]');
  if (event.type === 'output') console.log('[Output]:', event.stdout);
  if (event.type === 'done') console.log('\nDone!');
}
```

### RagAgent — Document & Data Q&A

Ground responses in user-provided documents and data. Supports text files, in-memory data, and media files (images, PDFs) via base64 encoding. Optionally enable Claude's built-in citations feature for source attribution.

```javascript
const rag = new RagAgent({
  localFiles: ['./docs/api.md', './config.yaml'],
  localData: [
    { name: 'users', data: [{ id: 1, name: 'Alice' }] }
  ],
  mediaFiles: ['./diagram.png', './report.pdf'],
  enableCitations: true
});

const result = await rag.chat('What does the API doc say about auth?');
console.log(result.text);
console.log(result.citations); // [{ type, cited_text, document_title, ... }]
```

**Context input types:**
- **`localFiles`** — read from disk as UTF-8 text (md, json, csv, yaml, txt, js, py, etc.)
- **`localData`** — in-memory objects serialized as JSON: `{ name: string, data: any }[]`
- **`mediaFiles`** — images (png, jpg, gif, webp) and PDFs encoded as base64 content blocks

**Dynamic context:**

```javascript
await rag.addLocalFiles(['./new-doc.md']);
await rag.addMediaFiles(['./chart.png']);
await rag.addLocalData([{ name: 'metrics', data: { dau: 50000 } }]);
```

### AgentQuery — Autonomous Agent via Claude Agent SDK

Wraps `@anthropic-ai/claude-agent-sdk` to launch a full autonomous Claude agent with built-in tools (Read, Write, Edit, Bash, Glob, Grep, etc.). Unlike the other classes which use the Messages API directly, AgentQuery launches a separate agent process.

```javascript
import { AgentQuery } from 'ak-claude';

const agent = new AgentQuery({
  cwd: '/path/to/project',
  allowedTools: ['Read', 'Glob', 'Grep'],
  maxTurns: 20,
  maxBudgetUsd: 1.00
});

for await (const msg of agent.run('Find all TODO comments in the codebase')) {
  if (msg.type === 'assistant') {
    console.log(msg.message.content);
  }
  if (msg.type === 'result') {
    console.log('Done:', msg.result);
    console.log('Cost:', msg.total_cost_usd);
  }
}
```

**Resume a previous session:**

```javascript
const sessionId = agent.lastSessionId;

for await (const msg of agent.resume(sessionId, 'Now fix those TODOs')) {
  // ...
}
```

Requires separate installation: `npm install @anthropic-ai/claude-agent-sdk`

---

## Stopping Agents

Both `ToolAgent` and `CodeAgent` support a `stop()` method to cancel execution mid-loop. This is useful for implementing user-facing cancel buttons or safety limits.

```javascript
const agent = new CodeAgent({ workingDirectory: '.' });

// Stop from a callback
const agent = new ToolAgent({
  tools: [...],
  toolExecutor: myExecutor,
  onBeforeExecution: async (toolName, args) => {
    if (toolName === 'dangerous_tool') {
      agent.stop(); // Stop the agent entirely
      return false; // Deny this specific execution
    }
    return true;
  }
});

// Stop externally (e.g., from a timeout or user action)
setTimeout(() => agent.stop(), 60_000);
const result = await agent.chat('Do some work');
```

For `CodeAgent`, `stop()` also kills any currently running child process via SIGTERM.

---

## Shared Features

All classes extend `BaseClaude` and share these features (except `AgentQuery`, which wraps the Claude Agent SDK separately).

### Raw SDK Client Access

All classes expose the underlying SDK clients via the `clients` namespace for advanced use cases:

```javascript
import { Chat } from 'ak-claude';

const chat = new Chat({ apiKey: process.env.ANTHROPIC_API_KEY });
await chat.init();

// Access raw SDK clients
console.log(chat.clients.anthropic);  // @anthropic-ai/sdk client (or null if using Vertex)
console.log(chat.clients.vertex);     // @anthropic-ai/vertex-sdk client (or null if using direct API)
console.log(chat.clients.raw);        // Convenience pointer to whichever is active

// Use raw client for SDK features not yet wrapped
for await (const model of chat.clients.raw.beta.models.list()) {
  console.log(model.id, model.display_name);
}

// Access message batches API
const batch = await chat.clients.anthropic.messages.batches.create({
  requests: [
    { custom_id: 'req1', params: { model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [...] } },
    { custom_id: 'req2', params: { model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [...] } }
  ]
});

// Count tokens directly
const tokenCount = await chat.clients.raw.messages.countTokens({
  model: 'claude-sonnet-4-6',
  messages: chat.history
});
```

**When to use:**
- Access new SDK features before they're wrapped
- Beta APIs and experimental features
- Low-level operations (message batches, etc.)
- SDK-specific functionality

**Common patterns:**

```javascript
// Check which client is active
console.log('Using Anthropic:', chat.clients.anthropic !== null);
console.log('Using Vertex:', chat.clients.vertex !== null);

// Advanced streaming
const stream = chat.clients.raw.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }]
});
stream.on('text', (delta) => process.stdout.write(delta));
await stream.finalMessage();
```

The original `client` property remains for backward compatibility (`client === clients.raw`).

### Model Discovery

List and inspect available Claude models (direct API only, not Vertex AI):

```javascript
import { Chat } from 'ak-claude';

const chat = new Chat({ apiKey: process.env.ANTHROPIC_API_KEY });

// List all available models
for await (const model of chat.listModels()) {
  console.log(model.id);          // "claude-sonnet-4-6"
  console.log(model.display_name); // "Claude 4.6 Sonnet"
  console.log(model.created_at);   // RFC 3339 datetime
}

// Get info about a specific model
const modelInfo = await chat.getModel('claude-sonnet-4-6');
console.log(modelInfo);

// Find newest model
let newestModel = null;
let newestDate = new Date(0);
for await (const model of chat.listModels()) {
  const createdAt = new Date(model.created_at);
  if (createdAt > newestDate) {
    newestDate = createdAt;
    newestModel = model;
  }
}

// Check if a model exists
async function modelExists(modelId) {
  try {
    await chat.getModel(modelId);
    return true;
  } catch (err) {
    return err.status !== 404;
  }
}
```

**Note:** These helpers only work with direct Anthropic API authentication, not Vertex AI. You can also access the models API via the raw client: `chat.clients.raw.beta.models.list()`.

### Authentication

```javascript
// Vertex AI (GCP — uses Application Default Credentials, no API key needed)
new Chat({ vertexai: true });

// Vertex AI with explicit project/region
new Chat({ vertexai: true, vertexProjectId: 'my-project', vertexRegion: 'us-central1' });

// Direct API key
new Chat({ apiKey: 'your-key' }); // or ANTHROPIC_API_KEY / CLAUDE_API_KEY env var
```

**Note:** Vertex AI doesn't allow both `temperature` and `topP` to be specified together. When using Vertex AI, the module automatically uses only `temperature` if both are set, and `topP` is not sent to the API. The default for Vertex AI is `temperature: 0.7` (no `topP`).

### Token Estimation

Uses Claude's `countTokens` API for exact input token counts before sending.

```javascript
const { inputTokens } = await instance.estimate({ some: 'payload' });
const cost = await instance.estimateCost({ some: 'payload' });
// → { inputTokens, model, pricing, estimatedInputCost, note }
```

### Usage Tracking

```javascript
const usage = instance.getLastUsage();
// { promptTokens, responseTokens, totalTokens, cacheCreationTokens, cacheReadTokens,
//   attempts, modelVersion, requestedModel, stopReason, timestamp }
```

### Few-Shot Seeding

```javascript
await instance.seed([
  { PROMPT: { x: 1 }, ANSWER: { y: 2 } }
]);
```

### Extended Thinking

```javascript
new Chat({
  modelName: 'claude-sonnet-4-6',
  thinking: { type: 'enabled', budget_tokens: 1024 }
});
```

When thinking is enabled, `temperature` is forced to 1 and `top_p`/`top_k` are not sent (Anthropic API requirement).

### Web Search

Ground responses in real-time web search results. Uses Claude's built-in server-managed web search tool.

```javascript
const chat = new Chat({
  enableWebSearch: true,
  webSearchConfig: {
    max_uses: 5,
    allowed_domains: ['docs.anthropic.com'],
    blocked_domains: ['example.com']
  }
});

const result = await chat.send('What are the latest Claude model features?');
```

The web search tool is automatically prepended to any existing tools (ToolAgent/CodeAgent tool declarations coexist).

### Prompt Caching

Reduce costs by caching the system prompt. When enabled, the system prompt is sent with `cache_control: { type: 'ephemeral' }`, allowing Anthropic to cache it across requests.

```javascript
const chat = new Chat({
  systemPrompt: longSystemPrompt,
  cacheSystemPrompt: true
});

const result = await chat.send('Hello!');
const usage = chat.getLastUsage();
console.log(usage.cacheCreationTokens); // Tokens used to create cache
console.log(usage.cacheReadTokens);     // Tokens read from cache (cheaper)
```

### Rate Limit Handling (429)

The Anthropic SDK handles 429 retries natively via its built-in retry mechanism. Configure the max retry count at construction:

```javascript
// Defaults: 5 retries with SDK-managed exponential backoff
const chat = new Chat({ systemPrompt: 'Hello' });

// Customize
const transformer = new Transformer({
  maxRetries: 10  // more retries for high-throughput pipelines
});

// Disable entirely
const msg = new Message({ maxRetries: 0 });
```

---

## Constructor Options

All classes (except AgentQuery) accept `BaseClaudeOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `modelName` | string | `'claude-sonnet-4-6'` | Claude model to use |
| `systemPrompt` | string | varies by class | System prompt |
| `apiKey` | string | env var | Anthropic API key (not needed with `vertexai`) |
| `vertexai` | boolean | `false` | Use Vertex AI auth (Application Default Credentials) |
| `vertexProjectId` | string | `GOOGLE_CLOUD_PROJECT` | GCP project ID (Vertex AI only) |
| `vertexRegion` | string | `'us-east5'` | GCP region (Vertex AI only) |
| `maxTokens` | number | `8192` | Max tokens in response |
| `temperature` | number | `0.7` | Temperature (not used with thinking) |
| `topP` | number | `0.95` | Top-P (not used with thinking) |
| `topK` | number | — | Top-K (optional) |
| `thinking` | object | — | Extended thinking: `{ type: 'enabled', budget_tokens: N }` |
| `cacheSystemPrompt` | boolean | `false` | Enable prompt caching on system prompt |
| `enableWebSearch` | boolean | `false` | Enable Claude's web search tool |
| `webSearchConfig` | object | — | Web search config (`max_uses`, `allowed_domains`, `blocked_domains`) |
| `maxRetries` | number | `5` | Max SDK-level retry attempts for 429 errors |
| `healthCheck` | boolean | `false` | Run API connectivity check during `init()` |
| `logLevel` | string | based on NODE_ENV | `'trace'`\|`'debug'`\|`'info'`\|`'warn'`\|`'error'`\|`'none'` |

### Transformer-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sourceKey`/`promptKey` | string | `'PROMPT'` | Key for input in examples |
| `targetKey`/`answerKey` | string | `'ANSWER'` | Key for output in examples |
| `contextKey` | string | `'CONTEXT'` | Key for context in examples |
| `maxRetries` | number | `3` | Retry attempts for validation |
| `retryDelay` | number | `1000` | Initial retry delay (ms) |
| `onlyJSON` | boolean | `true` | Enforce JSON-only responses |
| `asyncValidator` | function | — | Global async validator |
| `examplesFile` | string | — | Path to JSON file with examples |
| `exampleData` | array | — | Inline example data |

### Message-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `responseSchema` | object | — | JSON Schema for native structured output |
| `responseFormat` | string | — | `'json'` for system-prompt-based JSON mode |

### ToolAgent-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tools` | array | — | Tool declarations (`{ name, description, input_schema }`) |
| `toolExecutor` | function | — | `async (toolName, args) => result` |
| `maxToolRounds` | number | `10` | Max tool-use loop iterations |
| `onToolCall` | function | — | Notification callback when tool is called |
| `onBeforeExecution` | function | — | `async (toolName, args) => boolean` — gate execution |
| `toolChoice` | object | — | Tool choice config (`auto`, `any`, `tool`, `none`) |
| `disableParallelToolUse` | boolean | `false` | Force sequential tool calls |
| `parallelToolCalls` | boolean \| number | `true` | Parallel tool execution: `false` = sequential, `true` = unlimited, number = concurrency limit |

### CodeAgent-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `workingDirectory` | string | `process.cwd()` | Directory for code execution |
| `maxRounds` | number | `10` | Max code execution loop iterations |
| `timeout` | number | `30000` | Per-execution timeout (ms) |
| `onBeforeExecution` | function | — | `async (code) => boolean` — gate execution |
| `onCodeExecution` | function | — | Notification after execution |
| `importantFiles` | array | — | File paths to include in system prompt context |
| `writeDir` | string | `'{cwd}/tmp'` | Directory for writing script files |
| `keepArtifacts` | boolean | `false` | Keep script files on disk after execution |
| `comments` | boolean | `false` | Instruct model to write JSDoc comments |
| `maxRetries` | number | `3` | Max consecutive failures before stopping |

### RagAgent-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `localFiles` | array | — | Paths to text files read from disk |
| `localData` | array | — | In-memory data: `{ name, data }[]` |
| `mediaFiles` | array | — | Paths to images/PDFs (base64 encoded) |
| `enableCitations` | boolean | `false` | Enable Claude's built-in citations |

### AgentQuery-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | string | `'claude-sonnet-4-6'` | Model to use |
| `allowedTools` | array | — | Allowed tools (e.g., `['Read', 'Glob', 'Grep']`) |
| `disallowedTools` | array | — | Disallowed tools |
| `cwd` | string | `process.cwd()` | Working directory |
| `maxTurns` | number | — | Max agentic turns |
| `maxBudgetUsd` | number | — | Maximum budget in USD |
| `systemPrompt` | string | — | System prompt |
| `permissionMode` | string | — | Permission mode |
| `mcpServers` | object | — | MCP server configuration |
| `hooks` | object | — | Lifecycle hooks |

---

## Exports

```javascript
// Named exports
import { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, AgentQuery, BaseClaude, log } from 'ak-claude';
import { extractJSON, attemptJSONRecovery } from 'ak-claude';

// Default export (namespace)
import AI from 'ak-claude';
new AI.Transformer({ ... });
new AI.AgentQuery({ ... });

// CommonJS
const { Transformer, Chat, AgentQuery } = require('ak-claude');
```

---

## Testing

```sh
npm test
```

All tests use real Anthropic API calls (no mocks). Rate limiting (429 errors) can cause intermittent failures.

---

## Migration from ak-gemini

See [MIGRATION.md](./MIGRATION.md) for a detailed guide on migrating from ak-gemini to ak-claude.
