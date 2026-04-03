# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Module Overview

**ak-claude** (v0.0.1) is a modular wrapper around Anthropic's `@anthropic-ai/sdk`. It provides 7 class exports for different AI interaction patterns (6 extending a shared `BaseClaude` base class) plus a standalone `AgentQuery` class that wraps the Claude Agent SDK.

## Architecture

### File Structure

```
ak-claude/
  index.js              <- Package entry point: re-exports all classes + helpers
  base.js               <- BaseClaude class (shared logic for all classes)
  transformer.js        <- Transformer class (JSON transformation, few-shot)
  chat.js               <- Chat class (multi-turn text conversation)
  message.js            <- Message class (stateless one-off messages)
  tool-agent.js         <- ToolAgent class (agent with user-provided tools)
  code-agent.js         <- CodeAgent class (agent that writes and executes code)
  rag-agent.js          <- RagAgent class (document Q&A via local files, media files, and in-memory data)
  agent-query.js        <- AgentQuery class (autonomous agent via Claude Agent SDK)
  json-helpers.js       <- Pure functions: extractJSON, attemptJSONRecovery, isJSON, isJSONStr
  logger.js             <- Pino-based logging with configurable levels
  types.d.ts            <- TypeScript definitions for all classes and interfaces
  index.cjs             <- Auto-generated CJS bundle via esbuild
  tests/
    base.test.js        <- Shared base class behavior
    transformer.test.js <- JSON transformation tests
    chat.test.js        <- Multi-turn conversation tests
    message.test.js     <- Stateless message tests
    tool-agent.test.js  <- Agent with user-provided tools tests
    code-agent.test.js  <- CodeAgent tests
    rag-agent.test.js   <- RagAgent tests
    json-helpers.test.js <- Pure function unit tests
```

### Class Hierarchy

All classes except `AgentQuery` extend `BaseClaude` which provides: auth, client init via `@anthropic-ai/sdk`, manual message history management, thinking config, log levels, token estimation via `countTokens()`, cost tracking, usage reporting, `seed()`, web search tool, prompt caching (`cacheSystemPrompt`), and SDK-level 429 retry (`maxRetries`).

`AgentQuery` is standalone — it wraps `@anthropic-ai/claude-agent-sdk`'s `query()` function with its own auth, session, and execution model.

| Class | Base | Primary Method | Description |
|-------|------|---------------|-------------|
| `Transformer` | `BaseClaude` | `send(payload)` | JSON transformation with few-shot, validation, retry |
| `Chat` | `BaseClaude` | `send(message)` | Multi-turn text conversation with history |
| `Message` | `BaseClaude` | `send(payload)` | Stateless one-off messages via `messages.create()` |
| `ToolAgent` | `BaseClaude` | `chat(message)` / `stream(message)` | Agent with user-provided tools |
| `CodeAgent` | `BaseClaude` | `chat(message)` / `stream(message)` | Agent that writes and executes JavaScript |
| `RagAgent` | `BaseClaude` | `chat(message)` / `stream(message)` | Document Q&A via local files, media, and in-memory data |
| `AgentQuery` | *(standalone)* | `run(prompt)` / `resume(sessionId, prompt)` | Autonomous agent via Claude Agent SDK |

### Key Design Decisions

- **Dual auth: API key or Vertex AI** — `vertexai: true` uses `@anthropic-ai/vertex-sdk` + Application Default Credentials (no API key needed). Optional `vertexProjectId` / `vertexRegion` from constructor or `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` env vars. Client is created lazily via `_ensureClient()` on first API call. Direct API key auth is also supported via `apiKey` option or `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` env vars. **Vertex AI limitation:** Vertex AI doesn't allow both `temperature` and `topP` to be specified together; when using Vertex AI, the module automatically uses only `temperature` if both are set
- **Manual history management** — Claude's Messages API is stateless; `BaseClaude` maintains `this.history[]` as a plain array and passes the full history on every `messages.create()` call (unlike Gemini's SDK which has built-in chat sessions)
- **Content blocks** — Claude responses use content block arrays (`[{ type: 'text', text: '...' }]`), not plain strings. `_extractText()` filters for `type: 'text'` blocks and joins them
- **`input_schema` aliasing** — ToolAgent accepts tools in Claude format (`input_schema`), Gemini format (`inputSchema`, `parametersJsonSchema`), and auto-maps them to Claude's `input_schema`
- **Web search tool** — `enableWebSearch` / `webSearchConfig` adds Claude's server-managed `web_search_20250305` tool, merged with any user-provided tools via `_buildTools()`
- **`cacheSystemPrompt`** — When true, wraps the system prompt in `[{ type: 'text', text: ..., cache_control: { type: 'ephemeral' } }]` for Anthropic's prompt caching
- **SDK-level retry** — 429 rate-limit retry is handled natively by the `@anthropic-ai/sdk` client via `maxRetries` (default: 5), not custom retry logic
- **`toolChoice`** — Supports Claude's tool choice types: `auto`, `any`, `tool` (with `name`), `none`, plus `disableParallelToolUse` flag
- **Citations** — RagAgent supports Claude's native citations feature via `enableCitations`, which wraps documents in `{ type: 'document', citations: { enabled: true } }` content blocks
- **Native structured output** — Message class supports `responseSchema` which uses Claude's `output_config.format.json_schema` for guaranteed valid JSON, with fallback to system prompt hacking via `responseFormat: 'json'`
- **Extended thinking** — `thinking: { type: 'enabled', budget_tokens: N }` enables Claude's thinking mode; when active, temperature must be 1 and top_p/top_k are not sent
- Default export is a namespace object: `{ Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, AgentQuery }`

## Key Classes & APIs

### BaseClaude (`base.js`)
Shared foundation. Not typically instantiated directly.
- `init(force?)` — Validates connectivity; runs a tiny `messages.create()` health check only if `healthCheck: true`
- `seed(examples, opts?)` — Add example pairs to chat history for few-shot learning
- `getHistory(curated?)` / `clearHistory()` — Manage chat history. `curated: true` returns text-only simplified history
- `getLastUsage()` — Structured usage data after API calls (includes `cacheCreationTokens`, `cacheReadTokens`)
- `estimate(payload)` / `estimateCost(payload)` — Token/cost estimation via `messages.countTokens()`
- `listModels()` — List all available models from the Anthropic API (direct API only, not Vertex AI)
- `getModel(modelId)` — Get detailed information about a specific model (direct API only, not Vertex AI)
- `clients` — Namespace exposing raw SDK clients: `clients.anthropic`, `clients.vertex`, `clients.raw` (for advanced use)
- `enableWebSearch` / `webSearchConfig` — Claude's server-managed web search tool (available on all classes)
- `cacheSystemPrompt` — Prompt caching via `cache_control: { type: 'ephemeral' }` (default: `false`)
- `maxRetries` — SDK-level retry for 429 errors (default: 5), handled by `@anthropic-ai/sdk` with exponential backoff
- `healthCheck` — opt-in API connectivity check during `init()` (default: `false`)
- `thinking` — Extended thinking configuration: `{ type: 'enabled', budget_tokens: N }`

### Transformer (`transformer.js`)
JSON transformation via few-shot learning. Extends BaseClaude.
- `send(payload, opts?, validatorFn?)` — Transform with validation + retry
- `rawSend(payload)` — Direct send, extract JSON
- `rebuild(payload, error)` — AI-powered error correction
- `seed(examples)` — Override with key mapping + file loading (`examplesFile`, `exampleData`)
- `clearHistory()` — Preserves seeded examples
- `reset()` — Full reset including examples
- `updateSystemPrompt(newPrompt)` — Change system prompt
- Supports `stateless` option in `send()` for one-off transforms without affecting history

### Chat (`chat.js`)
Multi-turn text conversation. Extends BaseClaude.
- `send(message, opts?)` -> `{ text, usage }`

### Message (`message.js`)
Stateless one-off messages. Uses `messages.create()` directly. Extends BaseClaude.
- `send(payload, opts?)` -> `{ text, data?, usage }`
- Supports native structured output via `responseSchema` (uses `output_config.format.json_schema`)
- Supports fallback JSON mode via `responseFormat: 'json'` (system prompt hacking)
- `getHistory()`, `clearHistory()`, `seed()` are no-ops

### ToolAgent (`tool-agent.js`)
Agent with user-provided tools. Extends BaseClaude.
- `chat(message)` -> `{ text, toolCalls, usage }`
- `stream(message)` -> AsyncGenerator yielding `{ type, text?, toolName?, args?, result? }`
- `stop()` — Cancel the agent before the next tool execution round
- Constructor requires: `tools` (ToolDeclaration[]) + `toolExecutor` (async fn)
- Optional: `maxToolRounds`, `onToolCall`, `onBeforeExecution`, `toolChoice`, `disableParallelToolUse`, `parallelToolCalls`

### CodeAgent (`code-agent.js`)
Agent that writes and executes JavaScript autonomously. Extends BaseClaude.
- `chat(message)` -> `{ text, codeExecutions, usage }`
- `stream(message)` -> AsyncGenerator yielding `{ type: 'text'|'code'|'output'|'done', ... }`
- `stop()` — Cancel the agent and kill any running child process via SIGTERM
- `dump()` — Returns all scripts with descriptive filenames and purposes
- `init()` gathers codebase context (file tree + key files + importantFiles) and injects it into system prompt
- Code executes in Node.js child processes that inherit `process.env`
- Scripts written to `writeDir` (default: `{workingDirectory}/tmp`) with names like `agent-{purpose}-{timestamp}.mjs`
- Optional: `workingDirectory`, `maxRounds`, `timeout`, `onBeforeExecution`, `onCodeExecution`, `importantFiles`, `writeDir`, `keepArtifacts`, `comments`, `maxRetries`

### RagAgent (`rag-agent.js`)
Document Q&A agent with three context input types. Extends BaseClaude.
- `chat(message)` -> `{ text, citations?, usage }`
- `stream(message)` -> AsyncGenerator yielding `{ type: 'text'|'done', text?, fullText?, usage? }`
- `init()` reads local files from disk, encodes media as base64, serializes local data, seeds all into chat history
- `addLocalFiles(paths)` — Add local text files read from disk (triggers reinit)
- `addLocalData(entries)` — Add in-memory data entries (triggers reinit)
- `addMediaFiles(paths)` — Add media files: images/PDFs encoded as base64 (triggers reinit)
- `getContext()` — Returns metadata about all context sources: `{ localFiles, localData, mediaFiles }`
- `enableCitations` — Enables Claude's native citation feature on document content blocks

### AgentQuery (`agent-query.js`)
Autonomous agent via Claude Agent SDK. Does NOT extend BaseClaude.
- `run(prompt, opts?)` -> AsyncGenerator yielding messages (system, assistant, tool_progress, result)
- `resume(sessionId, prompt, opts?)` — Resume a previous session
- `lastSessionId` — Getter for the session ID from the last run
- Lazily imports `@anthropic-ai/claude-agent-sdk` (optional peer dependency)
- Options: `model`, `allowedTools`, `disallowedTools`, `cwd`, `maxTurns`, `maxBudgetUsd`, `systemPrompt`, `permissionMode`, `mcpServers`, `hooks`

## Publishing Checklist

- **When adding new `.js` files**, always add them to the `files` array in `package.json`. This controls what gets published to npm — missing entries cause `ERR_MODULE_NOT_FOUND` for consumers.

## Development Commands

```bash
npm test                   # Run all Jest tests
npm run build:cjs          # Build CommonJS version using esbuild
npm run release            # Version bump and publish to npm
npm run typecheck          # Verify TypeScript definitions
```

## Configuration & Environment

### Environment Variables
- `ANTHROPIC_API_KEY` — Anthropic API key (primary, for direct API auth)
- `CLAUDE_API_KEY` — Anthropic API key (fallback)
- `GOOGLE_CLOUD_PROJECT` — GCP project ID (for Vertex AI auth)
- `GOOGLE_CLOUD_LOCATION` — GCP region (for Vertex AI auth, default: `us-east5`)
- `NODE_ENV` — Environment (dev/test/prod affects log levels)
- `LOG_LEVEL` — Override log level (debug/info/warn/error)

### Authentication

```javascript
// Vertex AI via Application Default Credentials (recommended for GCP deployments)
new Transformer({ vertexai: true });

// Vertex AI with explicit project/region
new Transformer({ vertexai: true, vertexProjectId: 'my-project', vertexRegion: 'us-central1' });

// API key via constructor
new Transformer({ apiKey: 'your-key' });

// API key via environment variable (ANTHROPIC_API_KEY or CLAUDE_API_KEY)
new Transformer(); // auto-detects from env
```

## Module Exports

```javascript
// Named exports
import { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, AgentQuery, BaseClaude, log } from 'ak-claude';
import { extractJSON, attemptJSONRecovery } from 'ak-claude';

// Default export (namespace object)
import AI from 'ak-claude';
new AI.Transformer({ ... });

// CommonJS
const { Transformer, Chat } = require('ak-claude');
```

## Raw SDK Client Access

All `ak-claude` classes expose the underlying SDK clients via the `clients` namespace for advanced use cases:

```javascript
import { Chat } from 'ak-claude';

const chat = new Chat({ apiKey: process.env.ANTHROPIC_API_KEY });
await chat.init();

// Access raw SDK clients
console.log(chat.clients.anthropic);  // @anthropic-ai/sdk client (or null if using Vertex)
console.log(chat.clients.vertex);     // @anthropic-ai/vertex-sdk client (or null if using direct API)
console.log(chat.clients.raw);        // Convenience pointer to whichever is active

// Use raw client for SDK features not yet wrapped by ak-claude
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

The `clients` namespace provides:
- `clients.anthropic` — Direct Anthropic API client (null when using Vertex AI)
- `clients.vertex` — Vertex AI client (null when using direct API)
- `clients.raw` — Convenience pointer to whichever client is active (never null)

Use this for:
- Accessing new SDK features before they're wrapped
- Beta APIs and experimental features
- Low-level operations (message batches, etc.)
- SDK-specific functionality

The original `client` property remains available for backward compatibility (`client === clients.raw`).

### Common Raw Client Use Cases

**Check which client is active:**
```javascript
const chat = new Chat({ vertexai: true });
await chat.init();
console.log('Using Anthropic:', chat.clients.anthropic !== null); // false
console.log('Using Vertex:', chat.clients.vertex !== null);       // true
console.log('Active client:', chat.clients.raw !== null);         // true
```

**Advanced streaming with SDK events:**
```javascript
const stream = chat.clients.raw.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Write a story' }]
});

stream.on('text', (delta) => process.stdout.write(delta));
stream.on('message', (message) => console.log('Final:', message));
await stream.finalMessage();
```

**Access beta features not yet wrapped:**
```javascript
// Assuming a new beta feature exists
if (chat.clients.anthropic) {
  const betaResult = await chat.clients.anthropic.beta.someNewFeature();
}
```

## Model Discovery

All classes (except AgentQuery) inherit model discovery helpers from `BaseClaude`. These methods allow you to list and inspect available Claude models.

**Important:** Model discovery only works with direct Anthropic API authentication, NOT with Vertex AI. When using Vertex AI, these methods will throw an error.

### List Available Models

```javascript
import { Chat } from 'ak-claude';

const chat = new Chat({ apiKey: process.env.ANTHROPIC_API_KEY });

for await (const model of chat.listModels()) {
  console.log(model.id);          // "claude-sonnet-4-6"
  console.log(model.display_name); // "Claude 4.6 Sonnet"
  console.log(model.created_at);   // RFC 3339 datetime string
  console.log(model.type);         // "model"
}
```

### Get Model Details

```javascript
const modelInfo = await chat.getModel('claude-sonnet-4-6');
console.log(modelInfo);
/*
{
  id: "claude-sonnet-4-6",
  display_name: "Claude 4.6 Sonnet",
  created_at: "2025-05-14T00:00:00Z",
  type: "model"
}
*/
```

### Using Raw Client (Alternative)

You can also access the models API directly via the raw client:

```javascript
// List models
for await (const model of chat.clients.raw.beta.models.list()) {
  console.log(model.id, model.display_name);
}

// Get specific model
const info = await chat.clients.raw.beta.models.retrieve('claude-haiku-4-5-20251001');
```

### Common Patterns

**Find the newest model:**
```javascript
let newestModel = null;
let newestDate = new Date(0);

for await (const model of chat.listModels()) {
  const createdAt = new Date(model.created_at);
  if (createdAt > newestDate) {
    newestDate = createdAt;
    newestModel = model;
  }
}

console.log('Newest:', newestModel.id);
```

**Check if a model exists:**
```javascript
async function modelExists(chat, modelId) {
  try {
    await chat.getModel(modelId);
    return true;
  } catch (err) {
    return err.status !== 404;
  }
}

if (await modelExists(chat, 'claude-opus-4-6')) {
  console.log('Opus is available!');
}
```

## Testing Strategy

- "No mocks" approach — all tests use real Anthropic API calls
- **Do NOT run tests during development** — they are slow (real API calls) and expensive. Use `npm run typecheck` and `npm run build:cjs` to verify changes.
- Test timeout: 30 seconds (AI calls take 5-15 seconds)
- Rate limiting (429 errors) can cause flaky failures — retry after waiting
- Test model: use `claude-haiku-4-5-20251001` for tests (cheapest, fastest)
- Test files: `base.test.js`, `transformer.test.js`, `chat.test.js`, `message.test.js`, `tool-agent.test.js`, `code-agent.test.js`, `rag-agent.test.js`, `json-helpers.test.js`

## Key Design Patterns

### Few-Shot Learning (Transformer)
Configurable key mappings: `promptKey` (default: 'PROMPT'), `answerKey` (default: 'ANSWER'), `contextKey` (default: 'CONTEXT'), `explanationKey` (default: 'EXPLANATION'). Supports `examplesFile` (path to JSON file) and `exampleData` (inline array) as fallback sources.

### Validation & Self-Healing (Transformer)
- Custom async validator functions that throw on failure
- Automatic retry with exponential backoff (`maxRetries`/`validationRetries`, `retryDelay`)
- AI-powered payload reconstruction via `rebuild()` — sends the bad payload + error message back to Claude for correction
- `_cumulativeUsage` tracks total tokens across all retry attempts

### Code Execution (CodeAgent)
- Single `execute_code` tool with `code` + optional `purpose` params — model writes JavaScript, we execute it
- Scripts written to `writeDir` (default: `{workingDirectory}/tmp`) with names like `agent-read-config-1710000000.mjs`
- `keepArtifacts: true` preserves scripts on disk; `false` (default) deletes after execution
- `importantFiles: ['path/to/file.js']` — reads file contents into system prompt for deep project context; supports partial path matching
- `comments: true` instructs the model to write JSDoc comments; `false` (default) saves tokens
- `maxRetries: 3` (default `codeMaxRetries`) — tracks consecutive failed executions; on limit, model summarizes failures and asks for user guidance
- Child processes inherit `process.env` for full environment access
- `onBeforeExecution` async callback gates execution (return false to deny)
- `onCodeExecution` notification callback after execution
- File tree + key files + importantFiles gathered during `init()` for codebase awareness
- `stop()` kills running child processes via SIGTERM
- `dump()` returns `[{ fileName, purpose, script, filePath }]` across all executions

### Document Q&A (RagAgent)
- Three context input types combined into a single seeded chat history during `init()`:
  - `localFiles` — read from disk as UTF-8 text, seeded as labeled text parts (`--- File: name ---`)
  - `localData` — in-memory objects serialized as JSON, seeded as labeled text parts (`--- Data: name ---`)
  - `mediaFiles` — images and PDFs encoded as base64, seeded as native `image`/`document` content blocks
- When `enableCitations: true`, documents are wrapped in `{ type: 'document', citations: { enabled: true } }` blocks for Claude's native citation feature
- `addLocalFiles()`, `addLocalData()`, `addMediaFiles()` each append and call `init(true)` to reinitialize
- No tool loops — simple send/stream pattern like Chat, but with document/data context

### Agent Stop API (ToolAgent + CodeAgent)
- `agent.stop()` — sets `_stopped` flag, breaks loop before next execution
- Can be called from `onBeforeExecution` or `onToolCall` callbacks
- CodeAgent also kills any running child process on stop

### Token Management
- `estimate()` — INPUT token counts before sending, via `messages.countTokens()` API
- `getLastUsage()` — actual consumption AFTER the call (includes `cacheCreationTokens`, `cacheReadTokens`)
- `estimateCost()` — cost estimate using `MODEL_PRICING` table in `base.js`
- MODEL_PRICING covers: claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-6 (and dated variants)

### Web Search (BaseClaude)
- `enableWebSearch: true` + `webSearchConfig: {}` on any class constructor
- Uses Claude's server-managed tool: `type: 'web_search_20250305'`
- Web search tool merges with existing tools (ToolAgent/CodeAgent function declarations coexist) via `_buildTools()`
- Config options: `max_uses`, `allowed_domains`, `blocked_domains`

### Prompt Caching (BaseClaude)
- `cacheSystemPrompt: true` wraps system prompt in `cache_control: { type: 'ephemeral' }` block
- Cache token metrics available in `getLastUsage()`: `cacheCreationTokens`, `cacheReadTokens`
- No explicit cache CRUD (unlike Gemini) — Anthropic manages cache lifecycle server-side

### Autonomous Agent (AgentQuery)
- Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` function
- Launches a full Claude Code agent process with built-in tools (Read, Write, Edit, Bash, Glob, Grep)
- Supports session resumption via `resume(sessionId, prompt)`
- Lazy-imports the Agent SDK — only needed when `AgentQuery` is actually used
- Options: `allowedTools`, `disallowedTools`, `maxTurns`, `maxBudgetUsd`, `permissionMode`, `mcpServers`, `hooks`
