// ── Shared Types ─────────────────────────────────────────────────────────────

export interface ThinkingConfig {
  type: 'enabled';
  budget_tokens: number;
}

export interface ResponseMetadata {
  modelVersion: string | null;
  requestedModel: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  stopReason: string | null;
  timestamp: number;
}

export interface UsageData {
  /** CUMULATIVE input tokens across all retry attempts */
  promptTokens: number;
  /** CUMULATIVE output tokens across all retry attempts */
  responseTokens: number;
  /** CUMULATIVE total tokens across all retry attempts */
  totalTokens: number;
  /** Tokens used to create cached content */
  cacheCreationTokens: number;
  /** Tokens read from cache */
  cacheReadTokens: number;
  /** Number of attempts (1 = first try success, 2+ = retries needed) */
  attempts: number;
  /** Actual model that responded (e.g., 'claude-sonnet-4-6-20250514') */
  modelVersion: string | null;
  /** Model you requested (e.g., 'claude-sonnet-4-6') */
  requestedModel: string;
  /** Stop reason (e.g., 'end_turn', 'tool_use', 'max_tokens') */
  stopReason: string | null;
  timestamp: number;
}

export interface TransformationExample {
  CONTEXT?: Record<string, unknown> | string;
  PROMPT?: Record<string, unknown>;
  ANSWER?: Record<string, unknown>;
  INPUT?: Record<string, unknown>;
  OUTPUT?: Record<string, unknown>;
  SYSTEM?: string;
  EXPLANATION?: string;
  [key: string]: any;
}

export type AsyncValidatorFunction = (payload: Record<string, unknown>) => Promise<unknown>;
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'none';

// ── Constructor Options ──────────────────────────────────────────────────────

export interface BaseClaudeOptions {
  /** Claude model to use (default: 'claude-sonnet-4-6') */
  modelName?: string;
  /** System prompt for the model (null or false to disable) */
  systemPrompt?: string | null | false;
  /** Log level (default: based on NODE_ENV) */
  logLevel?: LogLevel;

  // Authentication
  /** API key for Anthropic API (not required when vertexai is true) */
  apiKey?: string;

  // Vertex AI
  /** Use Vertex AI instead of direct Anthropic API (default: false). Auth via Application Default Credentials. */
  vertexai?: boolean;
  /** Google Cloud project ID for Vertex AI (or GOOGLE_CLOUD_PROJECT env var) */
  vertexProjectId?: string;
  /** Google Cloud region for Vertex AI (default: 'us-east5', or GOOGLE_CLOUD_LOCATION env var) */
  vertexRegion?: string;

  // Generation config
  /** Maximum output tokens (default: 8192) */
  maxTokens?: number;
  /** Temperature (default: 0.7). Not used with extended thinking. */
  temperature?: number;
  /** Top-P (default: 0.95). Not used with extended thinking. */
  topP?: number;
  /** Top-K (optional) */
  topK?: number;

  /** Extended thinking configuration */
  thinking?: ThinkingConfig | null;

  /** Enable prompt caching on the system prompt (default: false) */
  cacheSystemPrompt?: boolean;

  /** Max SDK-level retry attempts for 429 errors (default: 5) */
  maxRetries?: number;

  /** Run health check during init() (default: false) */
  healthCheck?: boolean;

  /** Enable Claude's server-managed web search tool (default: false) */
  enableWebSearch?: boolean;
  /** Configuration for the web search tool */
  webSearchConfig?: {
    /** Maximum number of web searches per request */
    max_uses?: number;
    /** Only search these domains */
    allowed_domains?: string[];
    /** Never search these domains */
    blocked_domains?: string[];
  };
}

export interface ToolChoiceAuto {
  type: 'auto';
  disable_parallel_tool_use?: boolean;
}

export interface ToolChoiceAny {
  type: 'any';
  disable_parallel_tool_use?: boolean;
}

export interface ToolChoiceTool {
  type: 'tool';
  name: string;
  disable_parallel_tool_use?: boolean;
}

export interface ToolChoiceNone {
  type: 'none';
}

export type ToolChoice = ToolChoiceAuto | ToolChoiceAny | ToolChoiceTool | ToolChoiceNone;

export interface TransformerOptions extends BaseClaudeOptions {
  /** Path to JSON file containing transformation examples */
  examplesFile?: string;
  /** Inline examples to seed the transformer */
  exampleData?: TransformationExample[];
  /** Key for source/input data in examples (default: 'PROMPT') */
  sourceKey?: string;
  /** Alias for sourceKey */
  promptKey?: string;
  /** Key for target/output data in examples (default: 'ANSWER') */
  targetKey?: string;
  /** Alias for targetKey */
  answerKey?: string;
  /** Key for context data in examples (default: 'CONTEXT') */
  contextKey?: string;
  /** Key for explanation data in examples (default: 'EXPLANATION') */
  explanationKey?: string;
  /** Key for system prompt overrides in examples (default: 'SYSTEM') */
  systemPromptKey?: string;
  /** Maximum retry attempts for validation failures (default: 3) */
  maxRetries?: number;
  /** Initial retry delay in milliseconds (default: 1000) */
  retryDelay?: number;
  /** If true, only JSON responses are allowed (default: true) */
  onlyJSON?: boolean;
  /** Global async validator function for response validation */
  asyncValidator?: AsyncValidatorFunction;
}

export interface ChatOptions extends BaseClaudeOptions {
  // Chat uses base options only
}

export interface MessageOptions extends BaseClaudeOptions {
  /** Response format: 'json' for structured output (system prompt fallback) */
  responseFormat?: 'json';
  /** JSON Schema for native structured output via output_config. When provided, the API guarantees valid JSON matching this schema. */
  responseSchema?: Record<string, any>;
}

/** Tool declaration in Claude format */
export interface ToolDeclaration {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
  /** Alias: Gemini-compatible format (auto-mapped to input_schema) */
  inputSchema?: any;
  /** Alias: Gemini-compatible format (auto-mapped to input_schema) */
  parametersJsonSchema?: any;
}

export interface ToolAgentOptions extends BaseClaudeOptions {
  /** Tool declarations for the model */
  tools?: ToolDeclaration[];
  /** Function to execute tool calls: (toolName, args) => result */
  toolExecutor?: (toolName: string, args: Record<string, any>) => Promise<any>;
  /** Max tool-use loop iterations (default: 10) */
  maxToolRounds?: number;
  /** Callback fired when a tool is called */
  onToolCall?: (toolName: string, args: Record<string, any>) => void;
  /** Async callback before tool execution; return false to deny */
  onBeforeExecution?: (toolName: string, args: Record<string, any>) => Promise<boolean>;
  /** Tool choice configuration (default: auto) */
  toolChoice?: ToolChoice;
  /** Disable parallel tool use — forces sequential tool calls (default: false) */
  disableParallelToolUse?: boolean;
}

export interface LocalDataEntry {
  /** Label shown to the model (e.g. "users", "config") */
  name: string;
  /** Any JSON-serializable value */
  data: any;
}

export interface RagAgentOptions extends BaseClaudeOptions {
  /** Paths to local text files read from disk (md, json, csv, yaml, txt) */
  localFiles?: string[];
  /** In-memory data objects to include as context */
  localData?: LocalDataEntry[];
  /** Paths to media files (images, PDFs) encoded as base64 */
  mediaFiles?: string[];
  /** Enable Claude's built-in citations feature on document content blocks (default: false) */
  enableCitations?: boolean;
}

export interface CodeAgentOptions extends BaseClaudeOptions {
  /** Working directory for code execution (default: process.cwd()) */
  workingDirectory?: string;
  /** Max code execution loop iterations (default: 10) */
  maxRounds?: number;
  /** Per-execution timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Async callback before code execution; return false to deny */
  onBeforeExecution?: (code: string) => Promise<boolean>;
  /** Notification callback after code execution */
  onCodeExecution?: (code: string, output: { stdout: string; stderr: string; exitCode: number }) => void;
  /** Files whose contents are included in the system prompt for project context */
  importantFiles?: string[];
  /** Directory for writing script files (default: '{workingDirectory}/tmp') */
  writeDir?: string;
  /** Keep script files on disk after execution (default: false) */
  keepArtifacts?: boolean;
  /** Instruct model to write JSDoc comments in generated code (default: false) */
  comments?: boolean;
  /** Max consecutive failed executions before stopping (default: 3) */
  maxRetries?: number;
}

export interface AgentQueryOptions {
  /** Model to use (default: 'claude-sonnet-4-6') */
  model?: string;
  /** Allowed tools list (e.g., ['Read', 'Glob', 'Grep']) */
  allowedTools?: string[];
  /** Disallowed tools list */
  disallowedTools?: string[];
  /** Working directory (default: process.cwd()) */
  cwd?: string;
  /** Max agentic turns */
  maxTurns?: number;
  /** Maximum budget in USD */
  maxBudgetUsd?: number;
  /** System prompt */
  systemPrompt?: string;
  /** Permission mode */
  permissionMode?: string;
  /** MCP server configuration */
  mcpServers?: Record<string, any>;
  /** Lifecycle hooks */
  hooks?: Record<string, any>;
}

export interface AgentQueryRunOptions {
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  permissionMode?: string;
  mcpServers?: Record<string, any>;
  hooks?: Record<string, any>;
  sessionId?: string;
}

export interface CodeExecution {
  code: string;
  purpose?: string;
  output: string;
  stderr: string;
  exitCode: number;
}

export interface CodeAgentResponse {
  text: string;
  codeExecutions: CodeExecution[];
  usage: UsageData | null;
}

export interface CodeAgentStreamEvent {
  type: 'text' | 'code' | 'output' | 'done';
  text?: string;
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  fullText?: string;
  codeExecutions?: CodeExecution[];
  usage?: UsageData | null;
  warning?: string;
}

// ── Per-Message Options ──────────────────────────────────────────────────────

export interface SendOptions {
  /** Send without affecting chat history (Transformer only) */
  stateless?: boolean;
  /** Override max retries for this message */
  maxRetries?: number;
  /** Override retry delay for this message */
  retryDelay?: number;
  /** Override max tokens for this message */
  maxTokens?: number;
  [key: string]: any;
}

// ── Response Types ───────────────────────────────────────────────────────────

export interface ChatResponse {
  text: string;
  usage: UsageData | null;
}

export interface MessageResponse {
  text: string;
  data?: any;
  usage: UsageData | null;
}

export interface RagCitation {
  /** Type of citation (e.g., 'char_location', 'page_location') */
  type: string;
  /** Title of the cited document */
  cited_text: string;
  /** Start index of the cited text within the source document */
  start?: number;
  /** End index of the cited text within the source document */
  end?: number;
  /** Document index in the content blocks */
  document_index?: number;
  /** Document title */
  document_title?: string;
  [key: string]: any;
}

export interface RagResponse {
  text: string;
  /** Citation data from Claude's citations feature (only present when enableCitations is true) */
  citations?: RagCitation[];
  usage: UsageData | null;
}

export interface RagStreamEvent {
  type: 'text' | 'done';
  text?: string;
  fullText?: string;
  usage?: UsageData | null;
}

export interface AgentResponse {
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, any>; result: any }>;
  usage: UsageData | null;
}

export interface AgentStreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'done';
  text?: string;
  toolName?: string;
  args?: Record<string, any>;
  result?: any;
  fullText?: string;
  usage?: UsageData | null;
  warning?: string;
}

// ── Seed Options ─────────────────────────────────────────────────────────────

export interface SeedOptions {
  promptKey?: string;
  answerKey?: string;
  contextKey?: string;
  explanationKey?: string;
  systemPromptKey?: string;
}

// ── Class Declarations ───────────────────────────────────────────────────────

export declare class BaseClaude {
  constructor(options?: BaseClaudeOptions);

  modelName: string;
  systemPrompt: string | null | false;
  client: any;
  history: any[];
  lastResponseMetadata: ResponseMetadata | null;
  exampleCount: number;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number | undefined;
  thinking: ThinkingConfig | null;
  cacheSystemPrompt: boolean;
  enableWebSearch: boolean;
  webSearchConfig: { max_uses?: number; allowed_domains?: string[]; blocked_domains?: string[] };

  init(force?: boolean): Promise<void>;
  seed(examples?: TransformationExample[], opts?: SeedOptions): Promise<any[]>;
  getHistory(curated?: boolean): any[];
  clearHistory(): Promise<void>;
  getLastUsage(): UsageData | null;
  estimate(nextPayload: Record<string, unknown> | string): Promise<{ inputTokens: number }>;
  estimateCost(nextPayload: Record<string, unknown> | string): Promise<{
    inputTokens: number;
    model: string;
    pricing: { input: number; output: number };
    estimatedInputCost: number;
    note: string;
  }>;
}

export declare class Transformer extends BaseClaude {
  constructor(options?: TransformerOptions);

  promptKey: string;
  answerKey: string;
  contextKey: string;
  explanationKey: string;
  onlyJSON: boolean;
  asyncValidator: AsyncValidatorFunction | null;
  validationRetries: number;
  retryDelay: number;

  seed(examples?: TransformationExample[]): Promise<any[]>;
  send(payload: Record<string, unknown> | string, opts?: SendOptions, validatorFn?: AsyncValidatorFunction | null): Promise<Record<string, unknown>>;
  rawSend(payload: Record<string, unknown> | string): Promise<Record<string, unknown>>;
  rebuild(lastPayload: Record<string, unknown>, serverError: string): Promise<Record<string, unknown>>;
  reset(): Promise<void>;
  updateSystemPrompt(newPrompt: string): Promise<void>;
}

export declare class Chat extends BaseClaude {
  constructor(options?: ChatOptions);

  send(message: string, opts?: Record<string, any>): Promise<ChatResponse>;
}

export declare class Message extends BaseClaude {
  constructor(options?: MessageOptions);

  init(force?: boolean): Promise<void>;
  send(payload: Record<string, unknown> | string, opts?: Record<string, any>): Promise<MessageResponse>;
}

export declare class ToolAgent extends BaseClaude {
  constructor(options?: ToolAgentOptions);

  tools: ToolDeclaration[];
  toolExecutor: ((toolName: string, args: Record<string, any>) => Promise<any>) | null;
  maxToolRounds: number;
  onToolCall: ((toolName: string, args: Record<string, any>) => void) | null;
  onBeforeExecution: ((toolName: string, args: Record<string, any>) => Promise<boolean>) | null;
  toolChoice: ToolChoice | undefined;
  disableParallelToolUse: boolean;

  chat(message: string, opts?: Record<string, any>): Promise<AgentResponse>;
  stream(message: string, opts?: Record<string, any>): AsyncGenerator<AgentStreamEvent, void, unknown>;
  stop(): void;
}

export declare class RagAgent extends BaseClaude {
  constructor(options?: RagAgentOptions);

  localFiles: string[];
  localData: LocalDataEntry[];
  mediaFiles: string[];
  enableCitations: boolean;

  init(force?: boolean): Promise<void>;
  chat(message: string, opts?: Record<string, any>): Promise<RagResponse>;
  stream(message: string, opts?: Record<string, any>): AsyncGenerator<RagStreamEvent, void, unknown>;
  addLocalFiles(paths: string[]): Promise<void>;
  addLocalData(entries: LocalDataEntry[]): Promise<void>;
  addMediaFiles(paths: string[]): Promise<void>;
  getContext(): {
    localFiles: Array<{ name: string; path: string; size: number }>;
    localData: Array<{ name: string; type: string }>;
    mediaFiles: Array<{ path: string; name: string; ext: string }>;
  };
}

export declare class CodeAgent extends BaseClaude {
  constructor(options?: CodeAgentOptions);

  workingDirectory: string;
  maxRounds: number;
  timeout: number;
  onBeforeExecution: ((code: string) => Promise<boolean>) | null;
  onCodeExecution: ((code: string, output: { stdout: string; stderr: string; exitCode: number }) => void) | null;
  importantFiles: string[];
  writeDir: string;
  keepArtifacts: boolean;
  comments: boolean;
  codeMaxRetries: number;

  init(force?: boolean): Promise<void>;
  chat(message: string, opts?: Record<string, any>): Promise<CodeAgentResponse>;
  stream(message: string, opts?: Record<string, any>): AsyncGenerator<CodeAgentStreamEvent, void, unknown>;
  dump(): Array<{ fileName: string; purpose: string | null; script: string; filePath: string | null }>;
  stop(): void;
}

export declare class AgentQuery {
  constructor(options?: AgentQueryOptions);

  model: string;
  allowedTools: string[] | undefined;
  disallowedTools: string[] | undefined;
  cwd: string;
  maxTurns: number | undefined;
  maxBudgetUsd: number | undefined;
  systemPrompt: string | undefined;
  permissionMode: string | undefined;
  readonly lastSessionId: string | null;

  run(prompt: string, opts?: AgentQueryRunOptions): AsyncGenerator<any, void, unknown>;
  resume(sessionId: string, prompt: string, opts?: AgentQueryRunOptions): AsyncGenerator<any, void, unknown>;
}

// ── Module Exports ───────────────────────────────────────────────────────────

export declare function extractJSON(text: string): any;
export declare function attemptJSONRecovery(text: string, maxAttempts?: number): any | null;

declare const _default: {
  Transformer: typeof Transformer;
  Chat: typeof Chat;
  Message: typeof Message;
  ToolAgent: typeof ToolAgent;
  CodeAgent: typeof CodeAgent;
  RagAgent: typeof RagAgent;
  AgentQuery: typeof AgentQuery;
};

export default _default;
