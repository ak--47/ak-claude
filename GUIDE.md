# ak-claude --- Integration Guide

> A practical guide for rapidly adding AI capabilities to any Node.js codebase using `ak-claude`.
> Covers every class, common patterns, best practices, and observability hooks.

```sh
npm install ak-claude
```

**Requirements**: Node.js 18+. Auth via Vertex AI (`vertexai: true`) or an `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` env var.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Authentication](#authentication)
3. [Class Selection Guide](#class-selection-guide)
4. [Message --- Stateless AI Calls](#message--stateless-ai-calls)
5. [Chat --- Multi-Turn Conversations](#chat--multi-turn-conversations)
6. [Transformer --- Structured JSON Transformation](#transformer--structured-json-transformation)
7. [ToolAgent --- Agent with Custom Tools](#toolagent--agent-with-custom-tools)
8. [CodeAgent --- Agent That Writes and Runs Code](#codeagent--agent-that-writes-and-runs-code)
9. [RagAgent --- Document & Data Q&A](#ragagent--document--data-qa)
10. [AgentQuery --- Autonomous Agent via Claude Agent SDK](#agentquery--autonomous-agent-via-claude-agent-sdk)
11. [Web Search](#web-search)
12. [Prompt Caching](#prompt-caching)
13. [Observability & Usage Tracking](#observability--usage-tracking)
14. [Thinking Configuration](#thinking-configuration)
15. [Error Handling & Retries](#error-handling--retries)
16. [Performance Tips](#performance-tips)
17. [Common Integration Patterns](#common-integration-patterns)
18. [Quick Reference](#quick-reference)

---

## Core Concepts

Every class in ak-claude extends `BaseClaude`, which handles:

- **Authentication** --- Vertex AI via Application Default Credentials (`vertexai: true`) or Anthropic API key
- **Message history** --- Managed conversation state as a plain array (Claude's Messages API is stateless; ak-claude manages history for you)
- **Token tracking** --- Input/output token counts after every call, including cache metrics
- **Cost estimation** --- Dollar estimates before sending
- **Few-shot seeding** --- Inject example pairs to guide the model
- **Extended thinking** --- Control the model's internal reasoning budget
- **Web search** --- Built-in server-managed web search tool
- **Prompt caching** --- Mark system prompts for Anthropic's ephemeral caching

```javascript
import { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, AgentQuery } from 'ak-claude';
// or
import AI from 'ak-claude';
const t = new AI.Transformer({ ... });
```

The default model is `claude-sonnet-4-6`. Override with `modelName`:

```javascript
new Chat({ modelName: 'claude-opus-4-6' });
```

---

## Authentication

ak-claude supports two authentication methods: **Vertex AI** (GCP) and **direct API key**.

### Vertex AI (recommended for GCP deployments)

```javascript
// Uses Application Default Credentials — no API key needed
// Auth via: gcloud auth application-default login
new Chat({ vertexai: true });

// With explicit project and region
new Chat({
  vertexai: true,
  vertexProjectId: 'my-gcp-project',    // or GOOGLE_CLOUD_PROJECT env var
  vertexRegion: 'us-central1'           // or GOOGLE_CLOUD_LOCATION env var (default: 'us-east5')
});
```

When `vertexai: true`, the Anthropic client is created lazily using `@anthropic-ai/vertex-sdk` (included as a dependency). No API key is required — authentication flows through Google Cloud's Application Default Credentials (ADC). This is ideal for server deployments on GCP, CI/CD pipelines with service accounts, or local development with `gcloud auth`.

### API Key (direct Anthropic API)

```javascript
// Option 1: Environment variable
// Set ANTHROPIC_API_KEY or CLAUDE_API_KEY in your .env or shell
new Chat();

// Option 2: Explicit key
new Chat({ apiKey: 'your-key' });
```

ak-claude checks for keys in this order:
1. `options.apiKey` (constructor argument)
2. `ANTHROPIC_API_KEY` environment variable
3. `CLAUDE_API_KEY` environment variable

If `vertexai` is not set and no key is found, the constructor throws immediately.

### Rate Limit Retries

The Anthropic SDK handles 429 (rate limit) errors automatically. Control the number of retries:

```javascript
new Chat({
  maxRetries: 5 // default: 5, passed to the Anthropic SDK client
});
```

---

## Class Selection Guide

| I want to... | Use | Method |
|---|---|---|
| Get a one-off AI response (no history) | `Message` | `send()` |
| Have a back-and-forth conversation | `Chat` | `send()` |
| Transform JSON with examples + validation | `Transformer` | `send()` |
| Give the AI tools to call (APIs, DB, etc.) | `ToolAgent` | `chat()` / `stream()` |
| Let the AI write and run JavaScript | `CodeAgent` | `chat()` / `stream()` |
| Q&A over documents, files, or data | `RagAgent` | `chat()` / `stream()` |
| Launch an autonomous Claude Code agent | `AgentQuery` | `run()` / `resume()` |

**Rule of thumb**: Start with `Message` for the simplest integration. Move to `Chat` if you need history. Use `Transformer` when you need structured JSON output with validation. Use agents when the AI needs to take action. Use `AgentQuery` when you want the full Claude Code agent with built-in file and shell tools.

---

## Message --- Stateless AI Calls

The simplest class. Each `send()` call is independent --- no conversation history is maintained. Ideal for classification, extraction, summarization, and any fire-and-forget AI call.

```javascript
import { Message } from 'ak-claude';

const msg = new Message({
  systemPrompt: 'You are a sentiment classifier. Respond with: positive, negative, or neutral.'
});

const result = await msg.send('I love this product!');
console.log(result.text);  // "positive"
console.log(result.usage); // { promptTokens, responseTokens, totalTokens, ... }
```

### Structured Output (JSON Schema)

Force the model to return valid JSON matching a schema using Claude's native structured outputs:

```javascript
const extractor = new Message({
  systemPrompt: 'Extract structured data from the input text.',
  responseSchema: {
    type: 'object',
    properties: {
      people: { type: 'array', items: { type: 'string' } },
      places: { type: 'array', items: { type: 'string' } },
      sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] }
    },
    required: ['people', 'places', 'sentiment']
  }
});

const result = await extractor.send('Alice and Bob visited Paris. They had a wonderful time.');
console.log(result.data);
// { people: ['Alice', 'Bob'], places: ['Paris'], sentiment: 'positive' }
```

When `responseSchema` is provided, the API guarantees valid JSON matching your schema via `output_config`. The parsed object is available as `result.data`; the raw string is `result.text`.

### Fallback JSON Mode

If you do not need schema guarantees, use `responseFormat: 'json'` for a system-prompt-based approach:

```javascript
const jsonMsg = new Message({
  systemPrompt: 'Extract entities from text.',
  responseFormat: 'json'
});

const result = await jsonMsg.send('Alice works at Acme Corp in New York.');
console.log(result.data); // { entities: [...] } — best-effort JSON extraction
```

### When to Use Message

- Classification, tagging, or labeling
- Entity extraction
- Summarization
- Any call where previous context does not matter
- High-throughput pipelines where you process items independently

---

## Chat --- Multi-Turn Conversations

Maintains conversation history across calls. The model remembers what was said earlier.

```javascript
import { Chat } from 'ak-claude';

const chat = new Chat({
  systemPrompt: 'You are a helpful coding assistant.'
});

const r1 = await chat.send('What is a closure in JavaScript?');
console.log(r1.text);

const r2 = await chat.send('Can you give me an example?');
// The model remembers the closure topic from r1
console.log(r2.text);
```

### History Management

```javascript
// Get conversation history
const history = chat.getHistory();

// Get simplified text-only history
const curated = chat.getHistory(true);

// Clear and start fresh (preserves system prompt)
await chat.clearHistory();
```

### When to Use Chat

- Interactive assistants and chatbots
- Multi-step reasoning where later questions depend on earlier answers
- Tutoring or coaching interactions
- Any scenario where context carries across messages

---

## Transformer --- Structured JSON Transformation

The power tool for data pipelines. Show it examples of input -> output mappings, then send new inputs. Includes validation, retry, and AI-powered error correction.

```javascript
import { Transformer } from 'ak-claude';

const t = new Transformer({
  systemPrompt: 'Transform user profiles into marketing segments.',
  sourceKey: 'INPUT',   // key for input data in examples
  targetKey: 'OUTPUT',  // key for output data in examples
  maxRetries: 3,        // retry on validation failure
  retryDelay: 1000,     // ms between retries
});

// Seed with examples
await t.seed([
  {
    INPUT: { age: 25, spending: 'high', interests: ['tech', 'gaming'] },
    OUTPUT: { segment: 'young-affluent-tech', confidence: 0.9, tags: ['early-adopter'] }
  },
  {
    INPUT: { age: 55, spending: 'medium', interests: ['gardening', 'cooking'] },
    OUTPUT: { segment: 'mature-lifestyle', confidence: 0.85, tags: ['home-focused'] }
  }
]);

// Transform new data
const result = await t.send({ age: 30, spending: 'low', interests: ['books', 'hiking'] });
// result -> { segment: '...', confidence: ..., tags: [...] }
```

### Validation

Pass an async validator as the third argument to `send()`. If it throws, the Transformer retries with the error message fed back to the model:

```javascript
const result = await t.send(
  { age: 30, spending: 'low' },
  {},  // options
  async (output) => {
    if (!output.segment) throw new Error('Missing segment field');
    if (output.confidence < 0 || output.confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    return output; // return the validated (or modified) output
  }
);
```

Or set a global validator in the constructor:

```javascript
const t = new Transformer({
  asyncValidator: async (output) => {
    if (!output.id) throw new Error('Missing id');
    return output;
  }
});
```

### Self-Healing with `rebuild()`

When downstream code fails, feed the error back to the AI:

```javascript
try {
  await processPayload(result);
} catch (err) {
  const fixed = await t.rebuild(result, err.message);
  await processPayload(fixed); // try again with AI-corrected payload
}
```

### Loading Examples from a File

```javascript
const t = new Transformer({
  examplesFile: './training-data.json'
  // JSON array of { INPUT: ..., OUTPUT: ... } objects
});
await t.seed(); // loads from file automatically
```

### Stateless Sends

Send without affecting the conversation history (useful for parallel processing):

```javascript
const result = await t.send(payload, { stateless: true });
```

### History Management

```javascript
// Clear conversation history but preserve seeded examples
await t.clearHistory();

// Full reset including seeded examples
await t.reset();

// Update system prompt
await t.updateSystemPrompt('New instructions for the model.');
```

### When to Use Transformer

- ETL pipelines --- transform data between formats
- API response normalization
- Content enrichment (add tags, categories, scores)
- Any structured data transformation where you can provide examples
- Batch processing with validation guarantees

---

## ToolAgent --- Agent with Custom Tools

Give the model tools (functions) it can call. You define what tools exist and how to execute them. The agent handles the conversation loop --- sending messages, receiving tool calls, executing them, feeding results back, until the model produces a final text answer.

```javascript
import { ToolAgent } from 'ak-claude';

const agent = new ToolAgent({
  systemPrompt: 'You are a database assistant.',
  tools: [
    {
      name: 'query_db',
      description: 'Execute a read-only SQL query against the users database',
      input_schema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'The SQL query to execute' }
        },
        required: ['sql']
      }
    },
    {
      name: 'send_email',
      description: 'Send an email notification',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  ],
  toolExecutor: async (toolName, args) => {
    switch (toolName) {
      case 'query_db':
        return await db.query(args.sql);
      case 'send_email':
        await mailer.send(args);
        return { sent: true };
    }
  },
  maxToolRounds: 10 // safety limit on tool-use loop iterations
});

const result = await agent.chat('How many users signed up this week? Email the count to admin@co.com');
console.log(result.text);       // "There were 47 new signups this week. I've sent the email."
console.log(result.toolCalls);  // [{ name: 'query_db', args: {...}, result: [...] }, { name: 'send_email', ... }]
```

### Tool Schema Compatibility

ToolAgent accepts tool declarations in Claude's native format (`input_schema`) as well as Gemini-compatible formats (`inputSchema` or `parametersJsonSchema`). They are auto-mapped internally:

```javascript
// Claude format (native)
{ name: 'my_tool', description: '...', input_schema: { type: 'object', properties: { ... } } }

// Gemini-compatible format (auto-mapped)
{ name: 'my_tool', description: '...', parametersJsonSchema: { type: 'object', properties: { ... } } }
```

### Tool Choice

Control how the model selects tools:

```javascript
const agent = new ToolAgent({
  tools: [...],
  toolExecutor: myExecutor,
  toolChoice: { type: 'auto' },             // default: model decides
  // toolChoice: { type: 'any' },            // model must use a tool
  // toolChoice: { type: 'tool', name: 'query_db' }, // force a specific tool
  // toolChoice: { type: 'none' },           // disable tool use
  disableParallelToolUse: true,              // force sequential tool calls
});
```

### Streaming

Stream the agent's output in real-time --- useful for showing progress in a UI:

```javascript
for await (const event of agent.stream('Find the top 5 users by spend')) {
  switch (event.type) {
    case 'text':        process.stdout.write(event.text); break;
    case 'tool_call':   console.log(`\nCalling ${event.toolName}...`); break;
    case 'tool_result': console.log(`Result:`, event.result); break;
    case 'done':        console.log('\nUsage:', event.usage); break;
  }
}
```

### Execution Gating

Control which tool calls are allowed at runtime:

```javascript
const agent = new ToolAgent({
  tools: [...],
  toolExecutor: myExecutor,
  onBeforeExecution: async (toolName, args) => {
    if (toolName === 'delete_user') {
      console.log('Blocked dangerous tool call');
      return false; // deny execution
    }
    return true; // allow
  },
  onToolCall: (toolName, args) => {
    // Notification callback --- fires on every tool call (logging, metrics, etc.)
    metrics.increment(`tool_call.${toolName}`);
  }
});
```

### Stopping an Agent

Cancel mid-execution from a callback or externally:

```javascript
// From a callback
onBeforeExecution: async (toolName, args) => {
  if (shouldStop) {
    agent.stop(); // stop after this round
    return false;
  }
  return true;
}

// Externally (e.g., user cancel button, timeout)
setTimeout(() => agent.stop(), 60_000);
const result = await agent.chat('Do some work');
// result includes warning: "Agent was stopped"
```

### When to Use ToolAgent

- AI that needs to call APIs, query databases, or interact with external systems
- Workflow automation --- the AI orchestrates a sequence of operations
- Research assistants that fetch and synthesize data from multiple sources
- Any scenario where you want the model to decide *which* tools to use and *when*

---

## CodeAgent --- Agent That Writes and Runs Code

Instead of calling tools one by one, the model writes complete JavaScript scripts and executes them in a child process. This is powerful for tasks that require complex logic, file manipulation, or multi-step computation.

```javascript
import { CodeAgent } from 'ak-claude';

const agent = new CodeAgent({
  workingDirectory: '/path/to/project',
  importantFiles: ['package.json', 'src/config.js'], // injected into system prompt
  timeout: 30_000,    // per-execution timeout
  maxRounds: 10,      // max code execution cycles
  keepArtifacts: true, // keep script files on disk after execution
});

const result = await agent.chat('Find all files larger than 1MB and list them sorted by size');
console.log(result.text);            // Agent's summary
console.log(result.codeExecutions);  // [{ code, output, stderr, exitCode, purpose }]
```

### How It Works

1. On `init()`, the agent scans the working directory and gathers codebase context (file tree via `git ls-files`, package.json dependencies, importantFiles contents)
2. This context is injected into the system prompt so the model understands the project
3. The model writes JavaScript using an internal `execute_code` tool with a descriptive `purpose` slug
4. Code is saved to a `.mjs` file and run in a Node.js child process that inherits `process.env`
5. stdout/stderr feeds back to the model
6. The model decides if more work is needed (up to `maxRounds` cycles)

Scripts are written to `writeDir` (default: `{workingDirectory}/tmp`) with descriptive names like `agent-read-config-1710000000.mjs`.

### Streaming

```javascript
for await (const event of agent.stream('Refactor the auth module to use async/await')) {
  switch (event.type) {
    case 'text':   process.stdout.write(event.text); break;
    case 'code':   console.log('\n--- Executing code ---'); break;
    case 'output': console.log(event.stdout); break;
    case 'done':   console.log('\nDone!', event.usage); break;
  }
}
```

### Execution Gating & Notifications

```javascript
const agent = new CodeAgent({
  workingDirectory: '.',
  onBeforeExecution: async (code) => {
    // Review code before it runs
    if (code.includes('rm -rf')) return false; // deny
    return true;
  },
  onCodeExecution: (code, output) => {
    // Log every execution for audit
    logger.info({ code: code.slice(0, 200), exitCode: output.exitCode });
  }
});
```

### Retrieving Scripts

Get all scripts the agent wrote across all interactions:

```javascript
const scripts = agent.dump();
// [{ fileName: 'agent-read-config.mjs', purpose: 'read-config', script: '...', filePath: '/path/...' }]
```

### Code Style Options

```javascript
new CodeAgent({
  comments: true,  // instruct model to write JSDoc comments (default: false, saves tokens)
});
```

### When to Use CodeAgent

- File system operations --- reading, writing, transforming files
- Data analysis --- processing CSV, JSON, or log files
- Codebase exploration --- finding patterns, counting occurrences, generating reports
- Prototyping --- quickly testing ideas by having the AI write and run code
- Any task where the AI needs more flexibility than predefined tools provide

---

## RagAgent --- Document & Data Q&A

Load documents and data into the model's context for grounded Q&A. Supports three input types that can be used together:

| Input Type | Option | What It Does |
|---|---|---|
| **Local files** | `localFiles` | Read from disk as UTF-8 text --- for md, json, csv, yaml, txt |
| **Local data** | `localData` | In-memory objects serialized as JSON |
| **Media files** | `mediaFiles` | Base64-encoded images and PDFs for Claude's vision |

```javascript
import { RagAgent } from 'ak-claude';

const agent = new RagAgent({
  // Text files read directly from disk
  localFiles: ['./docs/api-reference.md', './docs/architecture.md'],

  // In-memory data
  localData: [
    { name: 'users', data: await db.query('SELECT * FROM users LIMIT 100') },
    { name: 'config', data: JSON.parse(await fs.readFile('./config.json', 'utf-8')) },
  ],

  // Images and PDFs (base64 encoded, supports Claude vision)
  mediaFiles: ['./diagrams/architecture.png', './reports/q4.pdf'],
});

const result = await agent.chat('What authentication method does the API use?');
console.log(result.text);  // Grounded answer citing the api-reference.md
```

### Citations

Enable Claude's built-in citations feature for source attribution:

```javascript
const agent = new RagAgent({
  localFiles: ['./docs/api.md'],
  mediaFiles: ['./reports/q4.pdf'],
  enableCitations: true, // enables document-level citations
});

const result = await agent.chat('What were Q4 revenue numbers?');
console.log(result.text);
console.log(result.citations);
// [{ type: 'char_location', cited_text: '...', document_title: 'q4.pdf', ... }]
```

When `enableCitations` is true, all context sources (local files, local data, media files) are injected as `document` content blocks with `citations: { enabled: true }`, allowing Claude to return structured citation metadata.

### Dynamic Context

Add more context after initialization (each triggers a reinit):

```javascript
await agent.addLocalFiles(['./new-doc.md']);
await agent.addLocalData([{ name: 'metrics', data: { uptime: 99.9 } }]);
await agent.addMediaFiles(['./new-chart.png']);
```

### Inspecting Context

```javascript
const ctx = agent.getContext();
// {
//   localFiles: [{ name, path, size }],
//   localData: [{ name, type }],
//   mediaFiles: [{ path, name, ext }]
// }
```

### Streaming

```javascript
for await (const event of agent.stream('Summarize the architecture document')) {
  if (event.type === 'text') process.stdout.write(event.text);
  if (event.type === 'done') console.log('\nUsage:', event.usage);
}
```

### When to Use RagAgent

- Documentation Q&A --- let users ask questions about your docs
- Data exploration --- load database results or CSV exports and ask questions
- Code review --- load source files and ask about patterns, bugs, or architecture
- Report analysis --- load PDF reports and extract insights
- Any scenario where the AI needs to answer questions grounded in specific data

### Choosing Input Types

| Data | Use |
|---|---|
| Plain text files (md, txt, json, csv, yaml) | `localFiles` --- read as UTF-8, fastest |
| In-memory objects, DB results, API responses | `localData` --- serialized as JSON |
| Images (png, jpg, gif, webp) | `mediaFiles` --- base64 encoded for vision |
| PDFs | `mediaFiles` --- base64 encoded as document blocks |

Prefer `localFiles` and `localData` when possible --- they are fastest to initialize and have no size overhead beyond the text itself.

---

## AgentQuery --- Autonomous Agent via Claude Agent SDK

AgentQuery wraps the `@anthropic-ai/claude-agent-sdk` to launch a full autonomous Claude Code agent with built-in tools for file operations, shell commands, and code search. Unlike the other classes, AgentQuery does **not** extend BaseClaude --- it uses a completely different SDK with its own execution model.

```javascript
import { AgentQuery } from 'ak-claude';

const agent = new AgentQuery({
  cwd: '/path/to/project',
  allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
  maxTurns: 20,
  maxBudgetUsd: 0.50,
});

for await (const msg of agent.run('Find all TODO comments and summarize them')) {
  if (msg.type === 'assistant') {
    console.log(msg.message.content);
  }
  if (msg.type === 'result') {
    console.log('Done:', msg.result);
    console.log('Cost:', msg.total_cost_usd);
  }
}
```

### Built-in Tools

The Claude Agent SDK provides tools that the agent can use autonomously:

- **Read** --- Read file contents
- **Write** --- Write files
- **Edit** --- Edit files with diffs
- **Bash** --- Execute shell commands
- **Glob** --- Find files by pattern
- **Grep** --- Search file contents
- **NotebookEdit** --- Edit Jupyter notebooks

Control access with `allowedTools` and `disallowedTools`:

```javascript
// Restrict to read-only operations
new AgentQuery({
  allowedTools: ['Read', 'Glob', 'Grep'],
});

// Allow everything except destructive operations
new AgentQuery({
  disallowedTools: ['Write', 'Edit', 'Bash'],
});
```

### Session Resumption

Resume a previous agent session to continue where it left off:

```javascript
const agent = new AgentQuery({ cwd: '/my/project' });

// First run
for await (const msg of agent.run('Analyze the codebase structure')) {
  // ... process messages
}

const sessionId = agent.lastSessionId;

// Later: resume with follow-up
for await (const msg of agent.resume(sessionId, 'Now refactor the auth module')) {
  // ... process messages
}
```

### MCP Server Configuration

Connect external MCP (Model Context Protocol) servers for additional tool capabilities:

```javascript
new AgentQuery({
  mcpServers: {
    database: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    }
  }
});
```

### Budget and Turn Limits

```javascript
new AgentQuery({
  maxTurns: 30,        // max agentic turns before stopping
  maxBudgetUsd: 1.00,  // hard spending cap in USD
});
```

### When to Use AgentQuery

- Complex multi-file codebase tasks (refactoring, analysis, migration)
- Tasks that need shell access, file editing, and code search combined
- Autonomous workflows where you want Claude Code's full capabilities
- Situations where you want budget controls and turn limits

---

## Web Search

Ground model responses in real-time web search results. Available on **all classes** via `enableWebSearch` --- Claude's server-managed web search tool is injected automatically.

### Basic Usage

```javascript
import { Chat } from 'ak-claude';

const chat = new Chat({
  enableWebSearch: true
});

const result = await chat.send('What happened in tech news today?');
console.log(result.text); // Response grounded in current search results
```

### Web Search Configuration

```javascript
const chat = new Chat({
  enableWebSearch: true,
  webSearchConfig: {
    max_uses: 5,                              // max searches per request
    allowed_domains: ['docs.python.org'],     // only search these domains
    blocked_domains: ['reddit.com'],          // never search these domains
  }
});
```

### Web Search with ToolAgent

Web search works alongside user-defined tools --- both are merged into the tools array automatically:

```javascript
const agent = new ToolAgent({
  enableWebSearch: true,
  tools: [
    {
      name: 'save_result',
      description: 'Save a research result',
      input_schema: {
        type: 'object',
        properties: { title: { type: 'string' }, summary: { type: 'string' } },
        required: ['title', 'summary']
      }
    }
  ],
  toolExecutor: async (name, args) => {
    if (name === 'save_result') return await db.insert(args);
  }
});

// The agent can search the web AND call your tools
const result = await agent.chat('Research the latest AI safety developments and save the key findings');
```

### When to Use Web Search

- Questions about current events, recent news, or real-time data
- Fact-checking or verification tasks
- Research assistants that need up-to-date information
- Any scenario where the model's training data cutoff is a limitation

---

## Prompt Caching

Mark system prompts for Anthropic's ephemeral prompt caching to reduce costs when making many API calls with the same large context. Cached tokens are billed at a reduced rate.

### When Prompt Caching Helps

- **Large system prompts** reused across many calls
- **RagAgent** with the same document set serving many queries
- **ToolAgent** with many tool definitions
- Any scenario with high token count in repeated context

### Enable Caching

```javascript
import { Chat } from 'ak-claude';

const chat = new Chat({
  systemPrompt: veryLongSystemPrompt,  // e.g., 10,000+ tokens
  cacheSystemPrompt: true              // adds cache_control: { type: 'ephemeral' }
});

// First call creates the cache (pay cache creation cost)
const r1 = await chat.send('Hello');

// Subsequent calls within the cache TTL use cached tokens at reduced cost
const r2 = await chat.send('Tell me more');
```

When `cacheSystemPrompt: true`, the system prompt is sent as a content block array with `cache_control: { type: 'ephemeral' }` attached. Anthropic automatically manages the cache lifetime.

### Monitoring Cache Usage

Cache token metrics are included in usage data:

```javascript
const usage = chat.getLastUsage();
console.log(usage.cacheCreationTokens); // tokens used to create the cache (first call)
console.log(usage.cacheReadTokens);     // tokens read from cache (subsequent calls)
```

### Cost Savings

Cached input tokens are billed at a discount compared to regular input tokens. The exact savings depend on the model --- check [Anthropic's pricing page](https://docs.anthropic.com/en/docs/about-claude/models) for current rates. The trade-off is a small cache creation cost on the first call.

**Rule of thumb**: Caching pays off when you make many calls with the same large context (system prompt + seeded examples) within the cache TTL (typically 5 minutes for ephemeral caches).

---

## Observability & Usage Tracking

Every class provides consistent observability hooks.

### Token Usage

After every API call, get detailed token counts:

```javascript
const usage = instance.getLastUsage();
// {
//   promptTokens: 1250,         // input tokens (cumulative across retries)
//   responseTokens: 340,        // output tokens (cumulative across retries)
//   totalTokens: 1590,          // total (cumulative)
//   cacheCreationTokens: 0,     // tokens used to create cache
//   cacheReadTokens: 0,         // tokens read from cache
//   attempts: 1,                // 1 = first try, 2+ = retries needed
//   modelVersion: 'claude-sonnet-4-6-20250514',  // actual model that responded
//   requestedModel: 'claude-sonnet-4-6',          // model you requested
//   stopReason: 'end_turn',     // 'end_turn', 'tool_use', 'max_tokens'
//   timestamp: 1710000000000
// }
```

### Cost Estimation

Estimate cost *before* sending using Claude's token counting API:

```javascript
const estimate = await instance.estimateCost('What is the meaning of life?');
// {
//   inputTokens: 8,
//   model: 'claude-sonnet-4-6',
//   pricing: { input: 3.00, output: 15.00 },  // per million tokens
//   estimatedInputCost: 0.000024,
//   note: 'Cost is for input tokens only; output cost depends on response length'
// }
```

Or just get the token count:

```javascript
const { inputTokens } = await instance.estimate('some payload');
```

### Logging

All classes use [pino](https://github.com/pinojs/pino) for structured logging. Control the level:

```javascript
// Per-instance
new Chat({ logLevel: 'debug' });

// Via environment
LOG_LEVEL=debug node app.js

// Via NODE_ENV (dev -> debug, test -> warn, prod -> error)

// Silence all logging
new Chat({ logLevel: 'none' });
```

### Agent Callbacks

ToolAgent and CodeAgent provide execution callbacks for building audit trails, metrics, and approval flows:

```javascript
// ToolAgent
new ToolAgent({
  onToolCall: (toolName, args) => {
    // Fires on every tool call --- use for logging, metrics
    logger.info({ event: 'tool_call', tool: toolName, args });
  },
  onBeforeExecution: async (toolName, args) => {
    // Fires before execution --- return false to deny
    // Use for approval flows, safety checks, rate limiting
    return !blocklist.includes(toolName);
  }
});

// CodeAgent
new CodeAgent({
  onCodeExecution: (code, output) => {
    // Fires after every code execution
    logger.info({ event: 'code_exec', exitCode: output.exitCode, lines: code.split('\n').length });
  },
  onBeforeExecution: async (code) => {
    // Review code before execution
    if (code.includes('process.exit')) return false;
    return true;
  }
});
```

---

## Thinking Configuration

Claude models support extended thinking --- internal reasoning before answering. This produces higher quality results for complex tasks at the cost of additional tokens and latency.

```javascript
// Enable thinking with a token budget
new Chat({
  thinking: {
    type: 'enabled',
    budget_tokens: 4096
  }
});
```

**Important constraints** when thinking is enabled:

- `temperature` is ignored (internally set to 1)
- `top_p` and `top_k` are not supported
- The `budget_tokens` must be less than `maxTokens`

```javascript
// Example: complex reasoning task
const reasoner = new Chat({
  systemPrompt: 'You are an expert mathematician.',
  thinking: { type: 'enabled', budget_tokens: 8192 },
  maxTokens: 16384, // must be greater than budget_tokens
});

const result = await reasoner.send('Prove that the square root of 2 is irrational.');
console.log(result.text); // Detailed proof with internal reasoning
```

**When to enable thinking**: Complex reasoning, math, multi-step logic, code generation, nuanced analysis. **When to skip it**: Simple classification, extraction, or chat where speed matters.

---

## Error Handling & Retries

### SDK-Level Rate Limit Retries

The Anthropic SDK automatically retries on 429 (rate limit) and certain 5xx errors. Control the retry count:

```javascript
new Chat({
  maxRetries: 5 // default: 5, with exponential backoff
});
```

This is handled entirely by the `@anthropic-ai/sdk` client --- you do not need to implement retry logic for rate limits.

### Transformer Validation Retries

The Transformer has its own retry mechanism for validation failures. This is separate from SDK-level retries:

```javascript
const t = new Transformer({
  maxRetries: 3,   // default: 3 validation retries
  retryDelay: 1000 // default: 1000ms, doubles each retry (exponential backoff)
});
```

Each retry feeds the validation error back to the model via `rebuild()`, giving it a chance to self-correct. The `usage` object reports cumulative tokens across all attempts:

```javascript
const result = await t.send(payload, {}, validator);
const usage = t.getLastUsage();
console.log(usage.attempts); // 2 = needed one retry
```

### CodeAgent Failure Limits

CodeAgent tracks consecutive failed code executions. After `maxRetries` (default: 3) consecutive failures, the model is instructed to stop executing code and summarize what went wrong:

```javascript
new CodeAgent({
  maxRetries: 5, // allow more failures before stopping
});
```

### General Error Handling

```javascript
try {
  const result = await chat.send('Hello');
} catch (err) {
  if (err.status === 400) {
    console.error('Bad request:', err.message);
  } else if (err.status === 401) {
    console.error('Invalid API key');
  } else if (err.status === 429) {
    // Normally handled by SDK retries, but thrown after maxRetries exhausted
    console.error('Rate limited after all retries');
  } else {
    console.error('Unexpected error:', err.message);
  }
}
```

---

## Performance Tips

### Reuse Instances

Each instance maintains conversation history. Creating a new instance for every request wastes system prompt tokens. Reuse instances when possible:

```javascript
// Bad --- creates a new instance every call
app.post('/classify', async (req, res) => {
  const msg = new Message({ systemPrompt: '...' }); // new instance every request!
  const result = await msg.send(req.body.text);
  res.json(result);
});

// Good --- reuse the instance
const classifier = new Message({ systemPrompt: '...' });
app.post('/classify', async (req, res) => {
  const result = await classifier.send(req.body.text);
  res.json(result);
});
```

### Choose the Right Model

| Model | Speed | Cost | Best For |
|---|---|---|---|
| `claude-haiku-4-5-20251001` | Fastest | Cheapest | Classification, extraction, simple tasks |
| `claude-sonnet-4-6` | Fast | Medium | General purpose, good quality (default) |
| `claude-opus-4-6` | Slower | Highest | Complex reasoning, code, deep analysis |

### Use `Message` for Stateless Workloads

`Message` sends each request independently --- no history accumulation. For pipelines processing thousands of items independently, `Message` is the right choice. It avoids the growing token cost of conversation history.

### Use `localFiles` / `localData` over `mediaFiles`

For text-based content, `localFiles` and `localData` are injected as plain text --- no base64 encoding overhead. They initialize faster and use fewer tokens than `mediaFiles`.

### Enable Prompt Caching for Large System Prompts

If your system prompt is large (1000+ tokens) and you make many calls, `cacheSystemPrompt: true` reduces input costs on subsequent calls:

```javascript
const classifier = new Message({
  systemPrompt: veryLongInstructions,
  cacheSystemPrompt: true
});
```

### Disable Thinking for Simple Tasks

Extended thinking tokens cost money and add latency. For classification, extraction, or simple formatting tasks, omit the `thinking` option entirely (the default).

### Use Stateless Sends for Parallel Processing

When using Transformer for batch processing, `stateless: true` prevents history from growing:

```javascript
const results = await Promise.all(
  records.map(r => transformer.send(r, { stateless: true }))
);
```

---

## Common Integration Patterns

### Pattern: API Endpoint Classifier

```javascript
import { Message } from 'ak-claude';

const classifier = new Message({
  modelName: 'claude-haiku-4-5-20251001', // fast + cheap
  systemPrompt: 'Classify support tickets. Respond with exactly one of: billing, technical, account, other.',
});

app.post('/api/classify-ticket', async (req, res) => {
  const result = await classifier.send(req.body.text);
  res.json({ category: result.text.trim().toLowerCase() });
});
```

### Pattern: ETL Pipeline with Validation

```javascript
import { Transformer } from 'ak-claude';

const normalizer = new Transformer({
  sourceKey: 'RAW',
  targetKey: 'NORMALIZED',
  maxRetries: 3,
  asyncValidator: async (output) => {
    if (!output.email?.includes('@')) throw new Error('Invalid email');
    if (!output.name?.trim()) throw new Error('Name is required');
    return output;
  }
});

await normalizer.seed([
  { RAW: { nm: 'alice', mail: 'alice@co.com' }, NORMALIZED: { name: 'Alice', email: 'alice@co.com' } },
]);

for (const record of rawRecords) {
  const clean = await normalizer.send(record, { stateless: true });
  await db.insert('users', clean);
}
```

### Pattern: Conversational Assistant with Tools

```javascript
import { ToolAgent } from 'ak-claude';

const assistant = new ToolAgent({
  systemPrompt: `You are a customer support agent for Acme Corp.
You can look up orders and issue refunds. Always confirm before issuing refunds.`,
  tools: [
    {
      name: 'lookup_order',
      description: 'Look up an order by ID or customer email',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          email: { type: 'string' }
        }
      }
    },
    {
      name: 'issue_refund',
      description: 'Issue a refund for an order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          amount: { type: 'number' },
          reason: { type: 'string' }
        },
        required: ['order_id', 'amount', 'reason']
      }
    }
  ],
  toolExecutor: async (toolName, args) => {
    if (toolName === 'lookup_order') return await orderService.lookup(args);
    if (toolName === 'issue_refund') return await orderService.refund(args);
  },
  onBeforeExecution: async (toolName, args) => {
    // Only allow refunds under $100 without human approval
    if (toolName === 'issue_refund' && args.amount > 100) {
      return false;
    }
    return true;
  }
});

// In a chat endpoint
const result = await assistant.chat(userMessage);
```

### Pattern: Code Analysis Agent

```javascript
import { CodeAgent } from 'ak-claude';

const analyst = new CodeAgent({
  workingDirectory: '/path/to/project',
  importantFiles: ['package.json', 'tsconfig.json'],
  maxRounds: 15,
  timeout: 60_000,
  onCodeExecution: (code, output) => {
    console.log(`[CodeAgent] exitCode=${output.exitCode}, stdout=${output.stdout.length} chars`);
  }
});

const result = await analyst.chat('Find all unused exports in this project and list them.');
console.log(result.text);
console.log(`Executed ${result.codeExecutions.length} scripts`);
```

### Pattern: Document Q&A Service

```javascript
import { RagAgent } from 'ak-claude';

const docs = new RagAgent({
  localFiles: [
    './docs/getting-started.md',
    './docs/api-reference.md',
    './docs/faq.md',
  ],
  enableCitations: true,
  systemPrompt: 'You are a documentation assistant. Answer questions based on the docs. If the answer is not in the docs, say so.',
});

app.post('/api/ask', async (req, res) => {
  const result = await docs.chat(req.body.question);
  res.json({ answer: result.text, citations: result.citations, usage: result.usage });
});
```

### Pattern: Provider Abstraction Layer

ak-claude and ak-gemini share a compatible API surface. You can build a provider-agnostic wrapper:

```javascript
// ai-provider.js
import { Chat as ClaudeChat, Transformer as ClaudeTransformer } from 'ak-claude';
import { Chat as GeminiChat, Transformer as GeminiTransformer } from 'ak-gemini';

const PROVIDER = process.env.AI_PROVIDER || 'claude';

export function createChat(opts) {
  if (PROVIDER === 'gemini') {
    return new GeminiChat({ modelName: 'gemini-2.5-flash', ...opts });
  }
  return new ClaudeChat({ modelName: 'claude-sonnet-4-6', ...opts });
}

export function createTransformer(opts) {
  if (PROVIDER === 'gemini') {
    return new GeminiTransformer({ modelName: 'gemini-2.5-flash', ...opts });
  }
  return new ClaudeTransformer({ modelName: 'claude-sonnet-4-6', ...opts });
}

// Usage --- works with either provider
const chat = createChat({ systemPrompt: 'You are a helpful assistant.' });
const result = await chat.send('Hello!');
console.log(result.text);
console.log(result.usage); // same shape: { promptTokens, responseTokens, totalTokens, ... }
```

Both libraries share these APIs: `send()`, `chat()`, `stream()`, `seed()`, `getHistory()`, `clearHistory()`, `getLastUsage()`, `estimate()`, `estimateCost()`.

### Pattern: Few-Shot Any Class

Every class (except Message) supports `seed()` for few-shot learning --- not just Transformer:

```javascript
import { Chat } from 'ak-claude';

const chat = new Chat({ systemPrompt: 'You are a SQL expert.' });
await chat.seed([
  { PROMPT: 'Get all users', ANSWER: 'SELECT * FROM users;' },
  { PROMPT: 'Count orders by status', ANSWER: 'SELECT status, COUNT(*) FROM orders GROUP BY status;' },
]);

const result = await chat.send('Find users who signed up in the last 7 days');
// Model follows the SQL-only response pattern from the examples
```

### Pattern: Data-Grounded Analysis

```javascript
import { RagAgent } from 'ak-claude';

const analyst = new RagAgent({
  modelName: 'claude-opus-4-6', // use a smarter model for analysis
  localData: [
    { name: 'sales_q4', data: await db.query('SELECT * FROM sales WHERE quarter = 4') },
    { name: 'targets', data: await db.query('SELECT * FROM quarterly_targets') },
  ],
  systemPrompt: 'You are a business analyst. Analyze the provided data and answer questions with specific numbers.',
});

const result = await analyst.chat('Which regions missed their Q4 targets? By how much?');
```

---

## Quick Reference

### Imports

```javascript
// Named exports
import { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, AgentQuery, BaseClaude, log } from 'ak-claude';
import { extractJSON, attemptJSONRecovery } from 'ak-claude';

// Default export (namespace)
import AI from 'ak-claude';

// CommonJS
const { Transformer, Chat } = require('ak-claude');
```

### Constructor Options (All Classes)

| Option | Type | Default |
|---|---|---|
| `modelName` | string | `'claude-sonnet-4-6'` |
| `systemPrompt` | string \| null \| false | varies by class |
| `apiKey` | string | `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` env var (not needed with `vertexai`) |
| `vertexai` | boolean | `false` (use Vertex AI auth via ADC) |
| `vertexProjectId` | string | `GOOGLE_CLOUD_PROJECT` env var |
| `vertexRegion` | string | `'us-east5'` or `GOOGLE_CLOUD_LOCATION` env var |
| `maxTokens` | number | `8192` |
| `temperature` | number | `0.7` (ignored with thinking) |
| `topP` | number | `0.95` (ignored with thinking) |
| `topK` | number \| undefined | `undefined` |
| `thinking` | `{ type: 'enabled', budget_tokens: number }` \| null | `null` |
| `cacheSystemPrompt` | boolean | `false` |
| `enableWebSearch` | boolean | `false` |
| `webSearchConfig` | `{ max_uses?, allowed_domains?, blocked_domains? }` | `{}` |
| `maxRetries` | number | `5` (SDK-level 429 retries) |
| `healthCheck` | boolean | `false` |
| `logLevel` | string | based on `NODE_ENV` |

### Methods Available on All Classes

| Method | Returns | Description |
|---|---|---|
| `init(force?)` | `Promise<void>` | Initialize instance |
| `seed(examples, opts?)` | `Promise<Array>` | Add few-shot examples |
| `getHistory(curated?)` | `Array` | Get conversation history |
| `clearHistory()` | `Promise<void>` | Clear conversation history |
| `getLastUsage()` | `UsageData \| null` | Token usage from last call |
| `estimate(payload)` | `Promise<{ inputTokens }>` | Estimate input tokens |
| `estimateCost(payload)` | `Promise<object>` | Estimate cost in dollars |

### Class-Specific Methods

| Class | Method | Returns |
|---|---|---|
| `Message` | `send(payload, opts?)` | `{ text, data?, usage }` |
| `Chat` | `send(message, opts?)` | `{ text, usage }` |
| `Transformer` | `send(payload, opts?, validator?)` | `Object` (transformed JSON) |
| `Transformer` | `rawSend(payload)` | `Object` (no validation) |
| `Transformer` | `rebuild(payload, error)` | `Object` (AI-corrected) |
| `Transformer` | `reset()` | `Promise<void>` |
| `Transformer` | `updateSystemPrompt(prompt)` | `Promise<void>` |
| `ToolAgent` | `chat(message, opts?)` | `{ text, toolCalls, usage }` |
| `ToolAgent` | `stream(message, opts?)` | `AsyncGenerator<AgentStreamEvent>` |
| `ToolAgent` | `stop()` | `void` |
| `CodeAgent` | `chat(message, opts?)` | `{ text, codeExecutions, usage }` |
| `CodeAgent` | `stream(message, opts?)` | `AsyncGenerator<CodeAgentStreamEvent>` |
| `CodeAgent` | `dump()` | `Array<{ fileName, purpose, script, filePath }>` |
| `CodeAgent` | `stop()` | `void` |
| `RagAgent` | `chat(message, opts?)` | `{ text, citations?, usage }` |
| `RagAgent` | `stream(message, opts?)` | `AsyncGenerator<RagStreamEvent>` |
| `RagAgent` | `addLocalFiles(paths)` | `Promise<void>` |
| `RagAgent` | `addLocalData(entries)` | `Promise<void>` |
| `RagAgent` | `addMediaFiles(paths)` | `Promise<void>` |
| `RagAgent` | `getContext()` | `{ localFiles, localData, mediaFiles }` |
| `AgentQuery` | `run(prompt, opts?)` | `AsyncGenerator<message>` |
| `AgentQuery` | `resume(sessionId, prompt, opts?)` | `AsyncGenerator<message>` |
| `AgentQuery` | `lastSessionId` | `string \| null` (getter) |

### Model Pricing (per million tokens)

| Model | Input | Output |
|---|---|---|
| `claude-haiku-4-5-20251001` | $0.80 | $4.00 |
| `claude-sonnet-4-6` | $3.00 | $15.00 |
| `claude-opus-4-6` | $15.00 | $75.00 |
