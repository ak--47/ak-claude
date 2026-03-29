var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.js
var index_exports = {};
__export(index_exports, {
  AgentQuery: () => agent_query_default,
  BaseClaude: () => base_default,
  Chat: () => chat_default,
  CodeAgent: () => code_agent_default,
  Message: () => message_default,
  RagAgent: () => rag_agent_default,
  ToolAgent: () => tool_agent_default,
  Transformer: () => transformer_default,
  attemptJSONRecovery: () => attemptJSONRecovery,
  default: () => index_default,
  extractJSON: () => extractJSON,
  log: () => logger_default
});
module.exports = __toCommonJS(index_exports);

// base.js
var import_dotenv = __toESM(require("dotenv"), 1);
var import_sdk = __toESM(require("@anthropic-ai/sdk"), 1);

// logger.js
var import_pino = __toESM(require("pino"), 1);
var isDev = process.env.NODE_ENV !== "production";
var logger = (0, import_pino.default)({
  level: process.env.LOG_LEVEL || "info",
  // Supports 'fatal', 'error', 'warn', 'info', 'debug', 'trace'
  messageKey: "message",
  // GCP expects 'message' instead of Pino's default 'msg'
  transport: isDev ? {
    target: "pino-pretty",
    // Prettified output for local dev
    options: { colorize: true, translateTime: true }
  } : void 0
  // In prod/cloud, keep as JSON for cloud logging
});
var logger_default = logger;

// json-helpers.js
function isJSON(data) {
  try {
    const attempt = JSON.stringify(data);
    if (attempt?.startsWith("{") || attempt?.startsWith("[")) {
      if (attempt?.endsWith("}") || attempt?.endsWith("]")) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}
function isJSONStr(string) {
  if (typeof string !== "string") return false;
  try {
    const result = JSON.parse(string);
    const type = Object.prototype.toString.call(result);
    return type === "[object Object]" || type === "[object Array]";
  } catch (err) {
    return false;
  }
}
function attemptJSONRecovery(text, maxAttempts = 100) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch (e) {
  }
  let workingText = text.trim();
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escapeNext = false;
  for (let j = 0; j < workingText.length; j++) {
    const char = workingText[j];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") braces++;
      else if (char === "}") braces--;
      else if (char === "[") brackets++;
      else if (char === "]") brackets--;
    }
  }
  if ((braces > 0 || brackets > 0 || inString) && workingText.length > 2) {
    let fixedText = workingText;
    if (inString) {
      fixedText += '"';
    }
    while (braces > 0) {
      fixedText += "}";
      braces--;
    }
    while (brackets > 0) {
      fixedText += "]";
      brackets--;
    }
    try {
      const result = JSON.parse(fixedText);
      if (logger_default.level !== "silent") {
        logger_default.warn(`JSON response appears truncated (possibly hit maxTokens limit). Recovered by adding closing characters.`);
      }
      return result;
    } catch (e) {
    }
  }
  for (let i = 0; i < maxAttempts && workingText.length > 2; i++) {
    workingText = workingText.slice(0, -1);
    let braces2 = 0;
    let brackets2 = 0;
    let inString2 = false;
    let escapeNext2 = false;
    for (let j = 0; j < workingText.length; j++) {
      const char = workingText[j];
      if (escapeNext2) {
        escapeNext2 = false;
        continue;
      }
      if (char === "\\") {
        escapeNext2 = true;
        continue;
      }
      if (char === '"') {
        inString2 = !inString2;
        continue;
      }
      if (!inString2) {
        if (char === "{") braces2++;
        else if (char === "}") braces2--;
        else if (char === "[") brackets2++;
        else if (char === "]") brackets2--;
      }
    }
    if (braces2 === 0 && brackets2 === 0 && !inString2) {
      try {
        const result = JSON.parse(workingText);
        if (logger_default.level !== "silent") {
          logger_default.warn(`JSON response appears truncated (possibly hit maxTokens limit). Recovered by removing ${i + 1} characters from the end.`);
        }
        return result;
      } catch (e) {
      }
    }
    if (i > 5) {
      let fixedText = workingText;
      if (inString2) {
        fixedText += '"';
      }
      while (braces2 > 0) {
        fixedText += "}";
        braces2--;
      }
      while (brackets2 > 0) {
        fixedText += "]";
        brackets2--;
      }
      try {
        const result = JSON.parse(fixedText);
        if (logger_default.level !== "silent") {
          logger_default.warn(`JSON response appears truncated (possibly hit maxTokens limit). Recovered by adding closing characters.`);
        }
        return result;
      } catch (e) {
      }
    }
  }
  return null;
}
function extractCompleteStructure(text, startPos) {
  const startChar = text[startPos];
  const endChar = startChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startPos; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"' && !escaped) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === startChar) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          return text.substring(startPos, i + 1);
        }
      }
    }
  }
  return null;
}
function findCompleteJSONStructures(text) {
  const results = [];
  const startChars = ["{", "["];
  for (let i = 0; i < text.length; i++) {
    if (startChars.includes(text[i])) {
      const extracted = extractCompleteStructure(text, i);
      if (extracted) {
        results.push(extracted);
      }
    }
  }
  return results;
}
function extractJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error("No text provided for JSON extraction");
  }
  if (isJSONStr(text.trim())) {
    return JSON.parse(text.trim());
  }
  const codeBlockPatterns = [
    /```json\s*\n?([\s\S]*?)\n?\s*```/gi,
    /```\s*\n?([\s\S]*?)\n?\s*```/gi
  ];
  for (const pattern of codeBlockPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        const jsonContent = match.replace(/```json\s*\n?/gi, "").replace(/```\s*\n?/gi, "").trim();
        if (isJSONStr(jsonContent)) {
          return JSON.parse(jsonContent);
        }
      }
    }
  }
  const jsonPatterns = [
    /\{[\s\S]*\}/g,
    /\[[\s\S]*\]/g
  ];
  for (const pattern of jsonPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        const candidate = match.trim();
        if (isJSONStr(candidate)) {
          return JSON.parse(candidate);
        }
      }
    }
  }
  const advancedExtract = findCompleteJSONStructures(text);
  if (advancedExtract.length > 0) {
    for (const candidate of advancedExtract) {
      if (isJSONStr(candidate)) {
        return JSON.parse(candidate);
      }
    }
  }
  const cleanedText = text.replace(/^\s*Sure,?\s*here\s+is\s+your?\s+.*?[:\n]/gi, "").replace(/^\s*Here\s+is\s+the\s+.*?[:\n]/gi, "").replace(/^\s*The\s+.*?is\s*[:\n]/gi, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").trim();
  if (isJSONStr(cleanedText)) {
    return JSON.parse(cleanedText);
  }
  const recoveredJSON = attemptJSONRecovery(text);
  if (recoveredJSON !== null) {
    return recoveredJSON;
  }
  throw new Error(`Could not extract valid JSON from model response. Response preview: ${text.substring(0, 200)}...`);
}

// base.js
import_dotenv.default.config({ quiet: true });
var { NODE_ENV = "unknown", LOG_LEVEL = "" } = process.env;
var DEFAULT_MAX_TOKENS = 8192;
var MODEL_PRICING = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250514": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-opus-4-5-20250514": { input: 15, output: 75 }
};
var BaseClaude = class {
  /**
   * @param {BaseClaudeOptions} [options={}]
   */
  constructor(options = {}) {
    this.modelName = options.modelName || "claude-sonnet-4-6";
    if (options.systemPrompt !== void 0) {
      this.systemPrompt = options.systemPrompt;
    } else {
      this.systemPrompt = null;
    }
    this.vertexai = options.vertexai ?? false;
    this.vertexProjectId = options.vertexProjectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? void 0;
    this.vertexRegion = options.vertexRegion ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-east5";
    if (!this.vertexai) {
      this.apiKey = options.apiKey !== void 0 && options.apiKey !== null ? options.apiKey : process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      if (!this.apiKey) {
        throw new Error("Missing Anthropic API key. Provide via options.apiKey, ANTHROPIC_API_KEY, or CLAUDE_API_KEY env var.");
      }
    } else {
      this.apiKey = null;
    }
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = options.temperature ?? 0.7;
    this.topP = options.topP ?? (this.vertexai ? void 0 : 0.95);
    this.topK = options.topK ?? void 0;
    this.thinking = options.thinking ?? null;
    this.cacheSystemPrompt = options.cacheSystemPrompt ?? false;
    this.enableWebSearch = options.enableWebSearch ?? false;
    this.webSearchConfig = options.webSearchConfig ?? {};
    this.healthCheck = options.healthCheck ?? false;
    this.maxRetries = options.maxRetries ?? 5;
    this._configureLogLevel(options.logLevel);
    this.client = null;
    this._clientReady = false;
    this.clients = {
      anthropic: null,
      // @anthropic-ai/sdk client (direct API)
      vertex: null,
      // @anthropic-ai/vertex-sdk client
      raw: null
      // Convenience pointer to whichever is active
    };
    if (!this.vertexai) {
      this.client = new import_sdk.default({
        apiKey: this.apiKey,
        maxRetries: this.maxRetries
      });
      this.clients.anthropic = this.client;
      this.clients.raw = this.client;
      this._clientReady = true;
    }
    this.history = [];
    this.lastResponseMetadata = null;
    this.exampleCount = 0;
    this._initialized = false;
    this._cumulativeUsage = {
      promptTokens: 0,
      responseTokens: 0,
      totalTokens: 0,
      attempts: 0
    };
    logger_default.debug(`${this.constructor.name} created with model: ${this.modelName}`);
  }
  // ── Client Bootstrap ─────────────────────────────────────────────────────
  /**
   * Ensures the Anthropic client is ready. For direct API usage this is
   * synchronous (client created in constructor). For Vertex AI this lazily
   * imports @anthropic-ai/vertex-sdk and creates the AnthropicVertex client.
   */
  async _ensureClient() {
    if (this._clientReady) return;
    if (this.vertexai) {
      const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
      this.client = new AnthropicVertex({
        projectId: this.vertexProjectId,
        region: this.vertexRegion
      });
      const MODEL_ENDPOINTS = /* @__PURE__ */ new Set(["/v1/messages", "/v1/messages?beta=true"]);
      const vertexClient = this.client;
      const superBuildRequest = Object.getPrototypeOf(Object.getPrototypeOf(vertexClient)).buildRequest;
      Object.getPrototypeOf(vertexClient).buildRequest = function(options, extra) {
        if (typeof options.body === "object" && options.body !== null) {
          options.body = { ...options.body };
          if (!options.body["anthropic_version"]) {
            options.body["anthropic_version"] = "vertex-2023-10-16";
          }
        }
        if (MODEL_ENDPOINTS.has(options.path) && options.method === "post" && typeof options.body === "object") {
          const model = options.body["model"];
          options.body["model"] = void 0;
          const stream = options.body["stream"] ?? false;
          const specifier = stream ? "streamRawPredict" : "rawPredict";
          options.path = `/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${model}:${specifier}`;
        }
        if (options.path === "/v1/messages/count_tokens" || options.path === "/v1/messages/count_tokens?beta=true" && options.method === "post") {
          options.path = `/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/count-tokens:rawPredict`;
        }
        return superBuildRequest.call(this, options, extra);
      };
      this.clients.vertex = this.client;
      this.clients.raw = this.client;
      this._clientReady = true;
      logger_default.debug(`${this.constructor.name}: Vertex AI client created (project=${this.vertexProjectId}, region=${this.vertexRegion})`);
    }
  }
  // ── Initialization ───────────────────────────────────────────────────────
  /**
   * Initializes the instance. Idempotent unless force=true.
   * Claude has no chat sessions to create — this just validates connectivity.
   * @param {boolean} [force=false]
   * @returns {Promise<void>}
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    await this._ensureClient();
    logger_default.debug(`Initializing ${this.constructor.name} with model: ${this.modelName}...`);
    if (this.healthCheck) {
      try {
        await this.client.messages.create({
          model: this.modelName,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }]
        });
        logger_default.debug(`${this.constructor.name}: API connection successful.`);
      } catch (e) {
        throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
      }
    }
    this._initialized = true;
    logger_default.debug(`${this.constructor.name}: Initialized.`);
  }
  // ── Core Message Sending ─────────────────────────────────────────────────
  /**
   * Builds the system parameter for messages.create().
   * Supports string or array with cache_control.
   * @returns {string|Array|undefined}
   * @protected
   */
  _buildSystemParam() {
    if (!this.systemPrompt) return void 0;
    if (this.cacheSystemPrompt) {
      return [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }];
    }
    return this.systemPrompt;
  }
  /**
   * Builds the tools array, prepending the web search server tool if enabled.
   * @param {Array} [tools] - User-provided tools array
   * @returns {Array|undefined} The final tools array, or undefined if empty
   * @protected
   */
  _buildTools(tools) {
    if (!this.enableWebSearch && !tools) return void 0;
    if (!this.enableWebSearch) return tools;
    const webSearchTool = {
      type: "web_search_20250305",
      name: "web_search",
      ...this.webSearchConfig
    };
    if (!tools || tools.length === 0) return [webSearchTool];
    return [webSearchTool, ...tools];
  }
  /**
   * Core method: sends a message via messages.create(), manages history.
   * Handles both string content and content block arrays (for tool_result).
   *
   * @param {string|Array} userContent - String message or array of content blocks
   * @param {Object} [opts={}] - Additional params (tools, tool_choice, maxTokens, etc.)
   * @returns {Promise<Object>} The API response
   * @protected
   */
  async _sendMessage(userContent, opts = {}) {
    if (!this._initialized) await this.init();
    const userMsg = { role: "user", content: userContent };
    this.history.push(userMsg);
    const tools = this._buildTools(opts.tools);
    const params = {
      model: opts.model || this.modelName,
      max_tokens: opts.maxTokens || this.maxTokens,
      messages: [...this.history],
      ...this._buildSystemParam() && { system: this._buildSystemParam() },
      ...this.topK !== void 0 && { top_k: this.topK },
      ...tools && { tools },
      ...opts.tool_choice && { tool_choice: opts.tool_choice }
    };
    if (this.thinking) {
      params.thinking = this.thinking;
    } else {
      if (this.vertexai && this.temperature !== void 0 && this.topP !== void 0) {
        params.temperature = this.temperature;
        logger_default.debug("Vertex AI: Using temperature only (topP ignored)");
      } else {
        if (this.temperature !== void 0) params.temperature = this.temperature;
        if (this.topP !== void 0) params.top_p = this.topP;
      }
    }
    const response = await this.client.messages.create(params);
    this.history.push({ role: "assistant", content: response.content });
    this._captureMetadata(response);
    return response;
  }
  /**
   * Streaming variant of _sendMessage. Returns a stream object.
   *
   * @param {string|Array} userContent - String message or array of content blocks
   * @param {Object} [opts={}] - Additional params
   * @returns {Promise<Object>} The stream object with .on() and .finalMessage()
   * @protected
   */
  async _streamMessage(userContent, opts = {}) {
    if (!this._initialized) await this.init();
    const userMsg = { role: "user", content: userContent };
    this.history.push(userMsg);
    const tools = this._buildTools(opts.tools);
    const params = {
      model: opts.model || this.modelName,
      max_tokens: opts.maxTokens || this.maxTokens,
      messages: [...this.history],
      ...this._buildSystemParam() && { system: this._buildSystemParam() },
      ...this.topK !== void 0 && { top_k: this.topK },
      ...tools && { tools },
      ...opts.tool_choice && { tool_choice: opts.tool_choice }
    };
    if (this.thinking) {
      params.thinking = this.thinking;
    } else {
      if (this.vertexai && this.temperature !== void 0 && this.topP !== void 0) {
        params.temperature = this.temperature;
        logger_default.debug("Vertex AI: Using temperature only (topP ignored)");
      } else {
        if (this.temperature !== void 0) params.temperature = this.temperature;
        if (this.topP !== void 0) params.top_p = this.topP;
      }
    }
    const stream = this.client.messages.stream(params);
    return stream;
  }
  // ── Text Extraction ──────────────────────────────────────────────────────
  /**
   * Extracts text from a Claude response's content blocks.
   * Filters for type: 'text' and joins.
   * @param {Object} response - The API response
   * @returns {string}
   * @protected
   */
  _extractText(response) {
    if (!response?.content) return "";
    return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  // ── History Management ───────────────────────────────────────────────────
  /**
   * Retrieves the current conversation history.
   * @param {boolean} [curated=false] - If true, returns text-only simplified history
   * @returns {Array<Object>}
   */
  getHistory(curated = false) {
    if (curated) {
      return this.history.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join("") : String(m.content)
      }));
    }
    return [...this.history];
  }
  /**
   * Clears conversation history.
   * Subclasses may override to preserve seeded examples.
   * @returns {Promise<void>}
   */
  async clearHistory() {
    this.history = [];
    this.lastResponseMetadata = null;
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
    logger_default.debug(`${this.constructor.name}: Conversation history cleared.`);
  }
  // ── Few-Shot Seeding ─────────────────────────────────────────────────────
  /**
   * Seeds the conversation with example input/output pairs for few-shot learning.
   * Injects user/assistant message pairs into history.
   *
   * @param {TransformationExample[]} examples - Array of example objects
   * @param {Object} [opts={}] - Key configuration
   * @param {string} [opts.promptKey='PROMPT'] - Key for input data
   * @param {string} [opts.answerKey='ANSWER'] - Key for output data
   * @param {string} [opts.contextKey='CONTEXT'] - Key for optional context
   * @param {string} [opts.explanationKey='EXPLANATION'] - Key for optional explanations
   * @param {string} [opts.systemPromptKey='SYSTEM'] - Key for system prompt overrides
   * @returns {Promise<Array>} The updated history
   */
  async seed(examples, opts = {}) {
    await this.init();
    if (!examples || !Array.isArray(examples) || examples.length === 0) {
      logger_default.debug("No examples provided. Skipping seeding.");
      return this.getHistory();
    }
    const promptKey = opts.promptKey || "PROMPT";
    const answerKey = opts.answerKey || "ANSWER";
    const contextKey = opts.contextKey || "CONTEXT";
    const explanationKey = opts.explanationKey || "EXPLANATION";
    const systemPromptKey = opts.systemPromptKey || "SYSTEM";
    const instructionExample = examples.find((ex) => ex[systemPromptKey]);
    if (instructionExample) {
      logger_default.debug(`Found system prompt in examples; updating.`);
      this.systemPrompt = instructionExample[systemPromptKey];
    }
    logger_default.debug(`Seeding conversation with ${examples.length} examples...`);
    const historyToAdd = [];
    for (const example of examples) {
      const contextValue = example[contextKey] || "";
      const promptValue = example[promptKey] || "";
      const answerValue = example[answerKey] || "";
      const explanationValue = example[explanationKey] || "";
      let userText = "";
      let modelResponse = {};
      if (contextValue) {
        let contextText = isJSON(contextValue) ? JSON.stringify(contextValue, null, 2) : contextValue;
        userText += `CONTEXT:
${contextText}

`;
      }
      if (promptValue) {
        let promptText = isJSON(promptValue) ? JSON.stringify(promptValue, null, 2) : promptValue;
        userText += promptText;
      }
      if (answerValue) modelResponse.data = answerValue;
      if (explanationValue) modelResponse.explanation = explanationValue;
      const modelText = JSON.stringify(modelResponse, null, 2);
      if (userText.trim().length && modelText.trim().length > 0) {
        historyToAdd.push({ role: "user", content: userText.trim() });
        historyToAdd.push({ role: "assistant", content: modelText.trim() });
      }
    }
    logger_default.debug(`Adding ${historyToAdd.length} items to history (${this.history.length} existing)...`);
    this.history = [...this.history, ...historyToAdd];
    this.exampleCount = this.history.length;
    logger_default.debug(`History now has ${this.history.length} items.`);
    return this.getHistory();
  }
  // ── Response Metadata ────────────────────────────────────────────────────
  /**
   * Captures response metadata from an API response.
   * @param {Object} response - The API response object
   * @protected
   */
  _captureMetadata(response) {
    this.lastResponseMetadata = {
      modelVersion: response.model || null,
      requestedModel: this.modelName,
      promptTokens: response.usage?.input_tokens || 0,
      responseTokens: response.usage?.output_tokens || 0,
      totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      cacheCreationTokens: response.usage?.cache_creation_input_tokens || 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
      stopReason: response.stop_reason || null,
      timestamp: Date.now()
    };
  }
  /**
   * Returns structured usage data from the last API call.
   * Includes CUMULATIVE token counts across all retry attempts.
   * @returns {UsageData|null}
   */
  getLastUsage() {
    if (!this.lastResponseMetadata) return null;
    const meta = this.lastResponseMetadata;
    const cumulative = this._cumulativeUsage || { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 1 };
    const useCumulative = cumulative.attempts > 0;
    return {
      promptTokens: useCumulative ? cumulative.promptTokens : meta.promptTokens,
      responseTokens: useCumulative ? cumulative.responseTokens : meta.responseTokens,
      totalTokens: useCumulative ? cumulative.totalTokens : meta.totalTokens,
      cacheCreationTokens: meta.cacheCreationTokens,
      cacheReadTokens: meta.cacheReadTokens,
      attempts: useCumulative ? cumulative.attempts : 1,
      modelVersion: meta.modelVersion,
      requestedModel: meta.requestedModel,
      stopReason: meta.stopReason,
      timestamp: meta.timestamp
    };
  }
  // ── Token Estimation ────────────────────────────────────────────────────
  /**
   * Estimates INPUT token count for a payload before sending.
   * Includes system prompt + chat history + your new message.
   * Uses Claude's token counting API.
   * @param {Object|string} nextPayload - The next message to estimate
   * @returns {Promise<{ inputTokens: number }>}
   */
  async estimate(nextPayload) {
    if (!this._initialized) await this.init();
    const nextMessage = typeof nextPayload === "string" ? nextPayload : JSON.stringify(nextPayload, null, 2);
    const messages = [
      ...this.history,
      { role: "user", content: nextMessage }
    ];
    const params = {
      model: this.modelName,
      messages,
      ...this._buildSystemParam() && { system: this._buildSystemParam() }
    };
    if (
      /** @type {any} */
      this.tools?.length > 0
    ) {
      params.tools = /** @type {any} */
      this.tools;
    }
    const resp = await this.client.messages.countTokens(params);
    return { inputTokens: resp.input_tokens };
  }
  /**
   * Estimates the INPUT cost of sending a payload based on model pricing.
   * @param {Object|string} nextPayload - The next message to estimate
   * @returns {Promise<{ inputTokens: number, model: string, pricing: { input: number, output: number }, estimatedInputCost: number, note: string }>}
   */
  async estimateCost(nextPayload) {
    const tokenInfo = await this.estimate(nextPayload);
    const pricing = MODEL_PRICING[this.modelName] || { input: 0, output: 0 };
    return {
      inputTokens: tokenInfo.inputTokens,
      model: this.modelName,
      pricing,
      estimatedInputCost: tokenInfo.inputTokens / 1e6 * pricing.input,
      note: "Cost is for input tokens only; output cost depends on response length"
    };
  }
  // ── Model Management ─────────────────────────────────────────────────────
  /**
   * Lists all available models from the Anthropic API.
   * Provides model IDs, display names, and creation dates.
   * Returns an async iterable that automatically fetches more pages as needed.
   *
   * NOTE: Only available with direct Anthropic API access (not Vertex AI).
   * @returns {AsyncIterable<Object>} AsyncIterable of model objects
   * @throws {Error} If using Vertex AI authentication
   * @example
   * const chat = new Chat({ apiKey: 'your-key' });
   * for await (const model of chat.listModels()) {
   *   console.log(model.id, model.display_name);
   * }
   */
  async *listModels() {
    if (this.vertexai) {
      throw new Error("listModels() is not available with Vertex AI. Use direct Anthropic API authentication instead.");
    }
    await this._ensureClient();
    const pageIterator = this.client.beta.models.list();
    for await (const model of pageIterator) {
      yield model;
    }
  }
  /**
   * Retrieves detailed information about a specific model.
   *
   * NOTE: Only available with direct Anthropic API access (not Vertex AI).
   * @param {string} modelId - The model ID (e.g., 'claude-sonnet-4-6')
   * @returns {Promise<Object>} The model details
   * @throws {Error} If using Vertex AI authentication
   * @example
   * const chat = new Chat({ apiKey: 'your-key' });
   * const modelInfo = await chat.getModel('claude-sonnet-4-6');
   * console.log(modelInfo);
   */
  async getModel(modelId) {
    if (this.vertexai) {
      throw new Error("getModel() is not available with Vertex AI. Use direct Anthropic API authentication instead.");
    }
    await this._ensureClient();
    return await this.client.beta.models.retrieve(modelId);
  }
  // ── Application-Level Retry ──────────────────────────────────────────────
  /**
   * Wraps an async function with retry logic.
   * Note: The Anthropic SDK handles 429s natively via maxRetries.
   * This is for application-level retries (e.g., Transformer self-healing).
   * @param {() => Promise<T>} fn - The async function to execute
   * @returns {Promise<T>}
   * @template T
   * @protected
   */
  async _withRetry(fn) {
    return await fn();
  }
  // ── Private Helpers ──────────────────────────────────────────────────────
  /**
   * Configures the log level based on options, env vars, or NODE_ENV.
   * @param {string} [logLevel]
   * @private
   */
  _configureLogLevel(logLevel) {
    if (logLevel) {
      if (logLevel === "none") {
        logger_default.level = "silent";
      } else {
        logger_default.level = logLevel;
      }
    } else if (LOG_LEVEL) {
      logger_default.level = LOG_LEVEL;
    } else if (NODE_ENV === "dev") {
      logger_default.level = "debug";
    } else if (NODE_ENV === "test") {
      logger_default.level = "warn";
    } else if (NODE_ENV.startsWith("prod")) {
      logger_default.level = "error";
    } else {
      logger_default.level = "info";
    }
  }
};
var base_default = BaseClaude;

// transformer.js
var import_promises = __toESM(require("fs/promises"), 1);
var import_path = __toESM(require("path"), 1);
var DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON).

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.

Do not wrap your response in markdown code blocks.
`;
var Transformer = class extends base_default {
  /**
   * @param {TransformerOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: DEFAULT_SYSTEM_INSTRUCTIONS };
    }
    super(options);
    this.onlyJSON = options.onlyJSON !== void 0 ? options.onlyJSON : true;
    this.promptKey = options.promptKey || options.sourceKey || "PROMPT";
    this.answerKey = options.answerKey || options.targetKey || "ANSWER";
    this.contextKey = options.contextKey || "CONTEXT";
    this.explanationKey = options.explanationKey || "EXPLANATION";
    this.systemPromptKey = options.systemPromptKey || "SYSTEM";
    if (this.promptKey === this.answerKey) {
      throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
    }
    this.examplesFile = options.examplesFile || null;
    this.exampleData = options.exampleData || null;
    this.asyncValidator = options.asyncValidator || null;
    this.validationRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1e3;
    logger_default.debug(`Transformer keys \u2014 Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);
  }
  // ── Seeding ──────────────────────────────────────────────────────────────
  /**
   * Seeds the conversation with transformation examples using the configured key mapping.
   * Overrides base seed() to use Transformer-specific keys and support
   * examplesFile/exampleData fallbacks.
   *
   * @param {TransformationExample[]} [examples] - Array of example objects
   * @returns {Promise<Array>} The updated history
   */
  async seed(examples) {
    await this.init();
    if (!examples || !Array.isArray(examples) || examples.length === 0) {
      if (this.examplesFile) {
        logger_default.debug(`No examples provided, loading from file: ${this.examplesFile}`);
        try {
          const filePath = import_path.default.resolve(this.examplesFile);
          const raw = await import_promises.default.readFile(filePath, "utf-8");
          examples = JSON.parse(raw);
        } catch (err) {
          throw new Error(`Could not load examples from file: ${this.examplesFile}. ${err.message}`);
        }
      } else if (this.exampleData) {
        logger_default.debug(`Using example data provided in options.`);
        if (Array.isArray(this.exampleData)) {
          examples = this.exampleData;
        } else {
          throw new Error(`Invalid example data provided. Expected an array of examples.`);
        }
      } else {
        logger_default.debug("No examples provided and no examples file specified. Skipping seeding.");
        return this.getHistory();
      }
    }
    return await super.seed(examples, {
      promptKey: this.promptKey,
      answerKey: this.answerKey,
      contextKey: this.contextKey,
      explanationKey: this.explanationKey,
      systemPromptKey: this.systemPromptKey
    });
  }
  // ── Primary Send Method ──────────────────────────────────────────────────
  /**
   * Transforms a payload using the seeded examples and model.
   * Includes validation and automatic retry with AI-powered error correction.
   *
   * @param {Object|string} payload - The source payload to transform
   * @param {Object} [opts={}] - Per-message options
   * @param {AsyncValidatorFunction|null} [validatorFn] - Validator for this call (overrides constructor validator)
   * @returns {Promise<Object>} The transformed payload
   */
  async send(payload, opts = {}, validatorFn = null) {
    if (!this._initialized) await this.init();
    const validator = validatorFn || this.asyncValidator;
    if (opts.stateless) {
      return await this._statelessSend(payload, opts, validator);
    }
    const maxRetries = opts.maxRetries ?? this.validationRetries;
    const retryDelay = opts.retryDelay ?? this.retryDelay;
    let lastPayload = this._preparePayload(payload);
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const transformedPayload = attempt === 0 ? await this.rawSend(lastPayload) : await this.rebuild(lastPayload, lastError.message);
        if (this.lastResponseMetadata) {
          this._cumulativeUsage.promptTokens += this.lastResponseMetadata.promptTokens || 0;
          this._cumulativeUsage.responseTokens += this.lastResponseMetadata.responseTokens || 0;
          this._cumulativeUsage.totalTokens += this.lastResponseMetadata.totalTokens || 0;
          this._cumulativeUsage.attempts = attempt + 1;
        }
        lastPayload = transformedPayload;
        if (validator) {
          await validator(transformedPayload);
        }
        logger_default.debug(`Transformation succeeded on attempt ${attempt + 1}`);
        return transformedPayload;
      } catch (error) {
        lastError = error;
        logger_default.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
        if (attempt >= maxRetries) {
          logger_default.error(`All ${maxRetries + 1} attempts failed.`);
          throw new Error(`Transformation failed after ${maxRetries + 1} attempts. Last error: ${error.message}`);
        }
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
  // ── Raw Send ─────────────────────────────────────────────────────────────
  /**
   * Sends a single prompt to the model and parses the JSON response.
   * No validation or retry logic.
   *
   * @param {Object|string} payload - The source payload
   * @returns {Promise<Object>} The transformed payload
   */
  async rawSend(payload) {
    if (!this._initialized) await this.init();
    const actualPayload = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    try {
      const response = await this._sendMessage(actualPayload);
      const modelResponse = this._extractText(response);
      if (response.usage && logger_default.level !== "silent") {
        logger_default.debug(`API response: model=${response.model || "unknown"}, tokens=${response.usage.input_tokens + response.usage.output_tokens}`);
      }
      const extractedJSON = extractJSON(modelResponse);
      if (extractedJSON?.data) {
        return extractedJSON.data;
      }
      return extractedJSON;
    } catch (error) {
      if (this.onlyJSON && error.message.includes("Could not extract valid JSON")) {
        throw new Error(`Invalid JSON response from Claude: ${error.message}`);
      }
      throw new Error(`Transformation failed: ${error.message}`);
    }
  }
  // ── Rebuild ──────────────────────────────────────────────────────────────
  /**
   * Asks the model to fix a payload that failed validation.
   *
   * @param {Object} lastPayload - The payload that failed
   * @param {string} serverError - The error message
   * @returns {Promise<Object>} Corrected payload
   */
  async rebuild(lastPayload, serverError) {
    await this.init();
    const prompt = `
The previous JSON payload (below) failed validation.
The server's error message is quoted afterward.

---------------- BAD PAYLOAD ----------------
${JSON.stringify(lastPayload, null, 2)}


---------------- SERVER ERROR ----------------
${serverError}

Please return a NEW JSON payload that corrects the issue.
Respond with JSON only \u2013 no comments or explanations.
`;
    let response;
    try {
      response = await this._sendMessage(prompt);
    } catch (err) {
      throw new Error(`Claude call failed while repairing payload: ${err.message}`);
    }
    try {
      const text = this._extractText(response);
      return extractJSON(text);
    } catch (parseErr) {
      throw new Error(`Claude returned non-JSON while repairing payload: ${parseErr.message}`);
    }
  }
  // ── Stateless Send ───────────────────────────────────────────────────────
  /**
   * Sends a one-off message (not using chat history).
   * Does NOT affect conversation history.
   * @param {Object|string} payload
   * @param {Object} [opts={}]
   * @param {AsyncValidatorFunction|null} [validatorFn]
   * @returns {Promise<Object>}
   * @private
   */
  async _statelessSend(payload, opts = {}, validatorFn = null) {
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    const messages = [];
    if (this.exampleCount > 0) {
      const exampleHistory = this.history.slice(0, this.exampleCount);
      messages.push(...exampleHistory);
    }
    messages.push({ role: "user", content: payloadStr });
    const params = {
      model: this.modelName,
      max_tokens: opts.maxTokens || this.maxTokens,
      messages,
      ...this._buildSystemParam() && { system: this._buildSystemParam() }
    };
    if (this.thinking) {
      params.thinking = this.thinking;
    } else {
      if (this.temperature !== void 0) params.temperature = this.temperature;
      if (this.topP !== void 0) params.top_p = this.topP;
    }
    const response = await this.client.messages.create(params);
    this._captureMetadata(response);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    const modelResponse = this._extractText(response);
    const extractedJSON = extractJSON(modelResponse);
    let transformedPayload = extractedJSON?.data ? extractedJSON.data : extractedJSON;
    if (validatorFn) {
      await validatorFn(transformedPayload);
    }
    return transformedPayload;
  }
  // ── History Management ───────────────────────────────────────────────────
  /**
   * Clears conversation history while preserving seeded examples.
   * @returns {Promise<void>}
   */
  async clearHistory() {
    const exampleHistory = this.history.slice(0, this.exampleCount || 0);
    this.history = exampleHistory;
    this.lastResponseMetadata = null;
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
    logger_default.debug(`Conversation cleared. Preserved ${exampleHistory.length} example items.`);
  }
  /**
   * Fully resets the conversation, clearing all history including examples.
   * @returns {Promise<void>}
   */
  async reset() {
    this.history = [];
    this.exampleCount = 0;
    this.lastResponseMetadata = null;
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
    logger_default.debug("Conversation fully reset.");
  }
  /**
   * Updates system prompt.
   * @param {string} newPrompt - The new system prompt
   * @returns {Promise<void>}
   */
  async updateSystemPrompt(newPrompt) {
    if (!newPrompt || typeof newPrompt !== "string") {
      throw new Error("System prompt must be a non-empty string");
    }
    this.systemPrompt = newPrompt.trim();
    logger_default.debug("System prompt updated.");
  }
  // ── Private Helpers ──────────────────────────────────────────────────────
  /**
   * Normalizes a payload to a string for sending.
   * @param {*} payload
   * @returns {string}
   * @private
   */
  _preparePayload(payload) {
    if (payload && isJSON(payload)) {
      return JSON.stringify(payload, null, 2);
    } else if (typeof payload === "string") {
      return payload;
    } else if (typeof payload === "boolean" || typeof payload === "number") {
      return payload.toString();
    } else if (payload === null || payload === void 0) {
      return JSON.stringify({});
    } else {
      throw new Error("Invalid source payload. Must be a JSON object or string.");
    }
  }
};
var transformer_default = Transformer;

// chat.js
var Chat = class extends base_default {
  /**
   * @param {ChatOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: "You are a helpful AI assistant." };
    }
    super(options);
    logger_default.debug(`Chat created with model: ${this.modelName}`);
  }
  /**
   * Send a text message and get a response. Adds to conversation history.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @returns {Promise<ChatResponse>} Response with text and usage data
   */
  async send(message, opts = {}) {
    const response = await this._sendMessage(message, opts);
    const text = this._extractText(response);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    return {
      text,
      usage: this.getLastUsage()
    };
  }
};
var chat_default = Chat;

// message.js
var Message = class extends base_default {
  /**
   * @param {MessageOptions} [options={}]
   */
  constructor(options = {}) {
    super(options);
    this._responseSchema = options.responseSchema || null;
    this._isStructured = !!(this._responseSchema || options.responseFormat === "json");
    logger_default.debug(`Message created (structured=${this._isStructured}, nativeSchema=${!!this._responseSchema})`);
  }
  /**
   * Initialize the Message client.
   * Override: stateless, no history needed.
   * @param {boolean} [force=false]
   * @returns {Promise<void>}
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    await this._ensureClient();
    logger_default.debug(`Initializing ${this.constructor.name} with model: ${this.modelName}...`);
    if (this.healthCheck) {
      try {
        await this.client.messages.create({
          model: this.modelName,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }]
        });
        logger_default.debug(`${this.constructor.name}: API connection successful.`);
      } catch (e) {
        throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
      }
    }
    this._initialized = true;
    logger_default.debug(`${this.constructor.name}: Initialized (stateless mode).`);
  }
  /**
   * Send a stateless message and get a response.
   * Each call is independent — no history is maintained.
   *
   * @param {Object|string} payload - The message or data to send
   * @param {Object} [opts={}] - Per-message options
   * @returns {Promise<MessageResponse>} Response with text, optional data, and usage
   */
  async send(payload, opts = {}) {
    if (!this._initialized) await this.init();
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    let systemParam = this._buildSystemParam();
    if (this._isStructured && !this._responseSchema) {
      if (systemParam) {
        const jsonInstruction = "\n\nAlways respond ONLY with valid JSON. No markdown code blocks, no preamble text.";
        if (typeof systemParam === "string") {
          systemParam = systemParam + jsonInstruction;
        } else if (Array.isArray(systemParam)) {
          systemParam = [...systemParam, { type: "text", text: jsonInstruction }];
        }
      } else {
        systemParam = "Always respond ONLY with valid JSON. No markdown code blocks, no preamble text.";
      }
    }
    const params = {
      model: this.modelName,
      max_tokens: opts.maxTokens || this.maxTokens,
      messages: [{ role: (
        /** @type {'user'} */
        "user"
      ), content: payloadStr }],
      ...systemParam && { system: systemParam }
    };
    if (this._responseSchema && !this.vertexai) {
      params.output_config = {
        format: {
          type: "json_schema",
          schema: this._responseSchema
        }
      };
    } else if (this._responseSchema && this.vertexai) {
      const schemaInstruction = `

Respond ONLY with valid JSON matching this schema:
${JSON.stringify(this._responseSchema, null, 2)}
No markdown code blocks, no preamble text.`;
      if (typeof params.system === "string") {
        params.system += schemaInstruction;
      } else if (Array.isArray(params.system)) {
        params.system = [...params.system, { type: "text", text: schemaInstruction }];
      } else {
        params.system = schemaInstruction.trim();
      }
    }
    if (this.thinking) {
      params.thinking = this.thinking;
    } else {
      if (this.temperature !== void 0) params.temperature = this.temperature;
      if (this.topP !== void 0) params.top_p = this.topP;
    }
    const response = await this.client.messages.create(params);
    this._captureMetadata(response);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    const text = this._extractText(response);
    const result = {
      text,
      usage: this.getLastUsage()
    };
    if (this._isStructured) {
      try {
        if (this._responseSchema && !this.vertexai) {
          result.data = JSON.parse(text);
        } else {
          result.data = extractJSON(text);
        }
      } catch (e) {
        logger_default.warn(`Could not parse structured response: ${e.message}`);
        result.data = null;
      }
    }
    return result;
  }
  // ── No-ops for stateless class ──
  /** @returns {Array} Always returns empty array (stateless). */
  getHistory() {
    return [];
  }
  /** No-op (stateless). */
  async clearHistory() {
  }
  /** Not supported on Message (stateless). */
  async seed() {
    logger_default.warn("Message is stateless \u2014 seed() has no effect. Use Transformer or Chat for few-shot learning.");
    return [];
  }
};
var message_default = Message;

// tool-agent.js
var ToolAgent = class extends base_default {
  /**
   * @param {ToolAgentOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: "You are a helpful AI assistant." };
    }
    super(options);
    this.tools = (options.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema || t.inputSchema || t.parametersJsonSchema
    }));
    this.toolExecutor = options.toolExecutor || null;
    if (this.tools.length > 0 && !this.toolExecutor) {
      throw new Error("ToolAgent: tools provided without a toolExecutor. Provide a toolExecutor function to handle tool calls.");
    }
    if (this.toolExecutor && this.tools.length === 0) {
      throw new Error("ToolAgent: toolExecutor provided without tools. Provide tool declarations so the model knows what tools are available.");
    }
    this.toolChoice = options.toolChoice ?? void 0;
    this.disableParallelToolUse = options.disableParallelToolUse ?? false;
    this.maxToolRounds = options.maxToolRounds || 10;
    this.onToolCall = options.onToolCall || null;
    this.onBeforeExecution = options.onBeforeExecution || null;
    this._stopped = false;
    logger_default.debug(`ToolAgent created with ${this.tools.length} tools`);
  }
  /**
   * Builds the tool_choice parameter for API calls.
   * @returns {Object|undefined}
   * @private
   */
  _buildToolChoice() {
    let choice = this.toolChoice;
    if (!choice && !this.disableParallelToolUse) return void 0;
    if (!choice) choice = { type: "auto" };
    const result = { ...choice };
    if (this.disableParallelToolUse) {
      result.disable_parallel_tool_use = true;
    }
    return result;
  }
  // ── Non-Streaming Chat ───────────────────────────────────────────────────
  /**
   * Send a message and get a complete response (non-streaming).
   * Automatically handles the tool-use loop.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @returns {Promise<AgentResponse>} Response with text, toolCalls, and usage
   */
  async chat(message, opts = {}) {
    if (!this._initialized) await this.init();
    this._stopped = false;
    const allToolCalls = [];
    const toolChoice = this._buildToolChoice();
    let response = await this._sendMessage(message, { tools: this.tools, ...toolChoice && { tool_choice: toolChoice } });
    for (let round = 0; round < this.maxToolRounds; round++) {
      if (this._stopped) break;
      if (response.stop_reason !== "tool_use") break;
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      if (toolUseBlocks.length === 0) break;
      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (this.onToolCall) {
          try {
            this.onToolCall(block.name, block.input);
          } catch (e) {
            logger_default.warn(`onToolCall callback error: ${e.message}`);
          }
        }
        if (this.onBeforeExecution) {
          try {
            const allowed = await this.onBeforeExecution(block.name, block.input);
            if (allowed === false) {
              const result2 = { error: "Execution denied by onBeforeExecution callback" };
              allToolCalls.push({ name: block.name, args: block.input, result: result2 });
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result2)
              });
              continue;
            }
          } catch (e) {
            logger_default.warn(`onBeforeExecution callback error: ${e.message}`);
          }
        }
        let result;
        try {
          result = await this.toolExecutor(block.name, block.input);
        } catch (err) {
          logger_default.warn(`Tool ${block.name} failed: ${err.message}`);
          result = { error: err.message };
        }
        allToolCalls.push({ name: block.name, args: block.input, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: typeof result === "string" ? result : JSON.stringify(result)
        });
      }
      response = await this._sendMessage(toolResults, { tools: this.tools, ...toolChoice && { tool_choice: toolChoice } });
    }
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    return {
      text: this._extractText(response),
      toolCalls: allToolCalls,
      usage: this.getLastUsage()
    };
  }
  // ── Streaming ────────────────────────────────────────────────────────────
  /**
   * Send a message and stream the response as events.
   * Automatically handles the tool-use loop between streamed rounds.
   *
   * Event types:
   * - `text` — A chunk of the agent's text response
   * - `tool_call` — The agent is about to call a tool
   * - `tool_result` — A tool finished executing
   * - `done` — The agent finished
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @yields {AgentStreamEvent}
   */
  async *stream(message, opts = {}) {
    if (!this._initialized) await this.init();
    this._stopped = false;
    const allToolCalls = [];
    let fullText = "";
    const toolChoice = this._buildToolChoice();
    let stream = await this._streamMessage(message, { tools: this.tools, ...toolChoice && { tool_choice: toolChoice } });
    for (let round = 0; round < this.maxToolRounds; round++) {
      if (this._stopped) break;
      const finalMessage = await stream.finalMessage();
      const toolUseBlocks = [];
      for (const block of finalMessage.content) {
        if (block.type === "text") {
          fullText += block.text;
          yield { type: "text", text: block.text };
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block);
        }
      }
      this.history.push({ role: "assistant", content: finalMessage.content });
      this._captureMetadata(finalMessage);
      if (finalMessage.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
        yield {
          type: "done",
          fullText,
          usage: this.getLastUsage()
        };
        return;
      }
      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (this._stopped) break;
        yield { type: "tool_call", toolName: block.name, args: block.input };
        if (this.onToolCall) {
          try {
            this.onToolCall(block.name, block.input);
          } catch (e) {
            logger_default.warn(`onToolCall callback error: ${e.message}`);
          }
        }
        let denied = false;
        if (this.onBeforeExecution) {
          try {
            const allowed = await this.onBeforeExecution(block.name, block.input);
            if (allowed === false) denied = true;
          } catch (e) {
            logger_default.warn(`onBeforeExecution callback error: ${e.message}`);
          }
        }
        let result;
        if (denied) {
          result = { error: "Execution denied by onBeforeExecution callback" };
        } else {
          try {
            result = await this.toolExecutor(block.name, block.input);
          } catch (err) {
            logger_default.warn(`Tool ${block.name} failed: ${err.message}`);
            result = { error: err.message };
          }
        }
        allToolCalls.push({ name: block.name, args: block.input, result });
        yield { type: "tool_result", toolName: block.name, result };
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: typeof result === "string" ? result : JSON.stringify(result)
        });
      }
      stream = await this._streamMessage(toolResults, { tools: this.tools, ...toolChoice && { tool_choice: toolChoice } });
    }
    yield {
      type: "done",
      fullText,
      usage: this.getLastUsage(),
      warning: this._stopped ? "Agent was stopped" : "Max tool rounds reached"
    };
  }
  // ── Stop ────────────────────────────────────────────────────────────────
  /**
   * Stop the agent before the next tool execution round.
   */
  stop() {
    this._stopped = true;
    logger_default.info("ToolAgent stopped");
  }
};
var tool_agent_default = ToolAgent;

// code-agent.js
var import_node_child_process = require("node:child_process");
var import_promises2 = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");
var MAX_OUTPUT_CHARS = 5e4;
var MAX_FILE_TREE_LINES = 500;
var IGNORE_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "coverage", ".next", "build", "__pycache__"]);
var CodeAgent = class extends base_default {
  /**
   * @param {CodeAgentOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: "" };
    }
    super(options);
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.maxRounds = options.maxRounds || 10;
    this.timeout = options.timeout || 3e4;
    this.onBeforeExecution = options.onBeforeExecution || null;
    this.onCodeExecution = options.onCodeExecution || null;
    this.importantFiles = options.importantFiles || [];
    this.writeDir = options.writeDir || (0, import_node_path.join)(this.workingDirectory, "tmp");
    this.keepArtifacts = options.keepArtifacts ?? false;
    this.comments = options.comments ?? false;
    this.codeMaxRetries = options.maxRetries ?? 3;
    this._codebaseContext = null;
    this._contextGathered = false;
    this._stopped = false;
    this._activeProcess = null;
    this._userSystemPrompt = options.systemPrompt || "";
    this._allExecutions = [];
    this._tools = [{
      name: "execute_code",
      description: "Execute JavaScript code in a Node.js child process. The code has access to all Node.js built-in modules (fs, path, child_process, http, etc.). Use console.log() to produce output that will be returned to you. The code runs in the working directory with the same environment variables as the parent process.",
      input_schema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "JavaScript code to execute. Use console.log() for output. You can import any built-in Node.js module."
          },
          purpose: {
            type: "string",
            description: 'A short 2-4 word slug describing what this script does (e.g., "read-config", "parse-logs", "fetch-api-data"). Used for naming the script file.'
          }
        },
        required: ["code"]
      }
    }];
    logger_default.debug(`CodeAgent created for directory: ${this.workingDirectory}`);
  }
  // ── Init ─────────────────────────────────────────────────────────────────
  /**
   * Initialize the agent: gather codebase context and build system prompt.
   * @param {boolean} [force=false]
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    await this._ensureClient();
    if (!this._contextGathered || force) {
      await this._gatherCodebaseContext();
    }
    this.systemPrompt = this._buildSystemPrompt();
    await super.init(force);
  }
  // ── Context Gathering ────────────────────────────────────────────────────
  /**
   * @private
   */
  async _gatherCodebaseContext() {
    let fileTree = "";
    try {
      fileTree = await this._getFileTreeGit();
    } catch {
      logger_default.debug("git ls-files failed, falling back to readdir");
      fileTree = await this._getFileTreeReaddir(this.workingDirectory, 0, 3);
    }
    const lines = fileTree.split("\n");
    if (lines.length > MAX_FILE_TREE_LINES) {
      const truncated = lines.slice(0, MAX_FILE_TREE_LINES).join("\n");
      fileTree = `${truncated}
... (${lines.length - MAX_FILE_TREE_LINES} more files)`;
    }
    let npmPackages = [];
    try {
      const pkgPath = (0, import_node_path.join)(this.workingDirectory, "package.json");
      const pkg = JSON.parse(await (0, import_promises2.readFile)(pkgPath, "utf-8"));
      npmPackages = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {})
      ];
    } catch {
    }
    const importantFileContents = [];
    if (this.importantFiles.length > 0) {
      const fileTreeLines = fileTree.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const requested of this.importantFiles) {
        const resolved = this._resolveImportantFile(requested, fileTreeLines);
        if (!resolved) {
          logger_default.warn(`importantFiles: could not locate "${requested}"`);
          continue;
        }
        try {
          const fullPath = (0, import_node_path.join)(this.workingDirectory, resolved);
          const content = await (0, import_promises2.readFile)(fullPath, "utf-8");
          importantFileContents.push({ path: resolved, content });
        } catch (e) {
          logger_default.warn(`importantFiles: could not read "${resolved}": ${e.message}`);
        }
      }
    }
    this._codebaseContext = { fileTree, npmPackages, importantFileContents };
    this._contextGathered = true;
  }
  /**
   * @private
   */
  _resolveImportantFile(filename, fileTreeLines) {
    const exact = fileTreeLines.find((line) => line === filename);
    if (exact) return exact;
    const partial = fileTreeLines.find(
      (line) => line.endsWith("/" + filename) || line.endsWith(import_node_path.sep + filename)
    );
    return partial || null;
  }
  /**
   * @private
   */
  async _getFileTreeGit() {
    return new Promise((resolve2, reject) => {
      (0, import_node_child_process.execFile)("git", ["ls-files"], {
        cwd: this.workingDirectory,
        timeout: 5e3,
        maxBuffer: 5 * 1024 * 1024
      }, (err, stdout) => {
        if (err) return reject(err);
        resolve2(stdout.trim());
      });
    });
  }
  /**
   * @private
   */
  async _getFileTreeReaddir(dir, depth, maxDepth) {
    if (depth >= maxDepth) return "";
    const entries = [];
    try {
      const items = await (0, import_promises2.readdir)(dir, { withFileTypes: true });
      for (const item of items) {
        if (IGNORE_DIRS.has(item.name)) continue;
        if (item.name.startsWith(".") && depth === 0 && item.isDirectory()) continue;
        const relativePath = (0, import_node_path.join)(dir, item.name).replace(this.workingDirectory + "/", "");
        if (item.isFile()) {
          entries.push(relativePath);
        } else if (item.isDirectory()) {
          entries.push(relativePath + "/");
          const subEntries = await this._getFileTreeReaddir((0, import_node_path.join)(dir, item.name), depth + 1, maxDepth);
          if (subEntries) entries.push(subEntries);
        }
      }
    } catch {
    }
    return entries.join("\n");
  }
  /**
   * @private
   */
  _buildSystemPrompt() {
    const { fileTree, npmPackages, importantFileContents } = this._codebaseContext || { fileTree: "", npmPackages: [], importantFileContents: [] };
    let prompt = `You are a coding agent working in ${this.workingDirectory}.

## Instructions
- Use the execute_code tool to accomplish tasks by writing JavaScript code
- Always provide a short descriptive \`purpose\` parameter (2-4 word slug like "read-config") when calling execute_code
- Your code runs in a Node.js child process with access to all built-in modules
- IMPORTANT: Your code runs as an ES module (.mjs). Use import syntax, NOT require():
  - import fs from 'fs';
  - import path from 'path';
  - import { execSync } from 'child_process';
- Use console.log() to produce output \u2014 that's how results are returned to you
- Write efficient scripts that do multiple things per execution when possible
- For parallel async operations, use Promise.all():
  const [a, b] = await Promise.all([fetchA(), fetchB()]);
- Read files with fs.readFileSync() when you need to understand their contents
- Handle errors in your scripts with try/catch so you get useful error messages
- Top-level await is supported
- The working directory is: ${this.workingDirectory}`;
    if (this.comments) {
      prompt += `
- Add a JSDoc @fileoverview comment at the top of each script explaining what it does
- Add brief JSDoc @param comments for any functions you define`;
    } else {
      prompt += `
- Do NOT write any comments in your code \u2014 save tokens. The code should be self-explanatory.`;
    }
    if (fileTree) {
      prompt += `

## File Tree
\`\`\`
${fileTree}
\`\`\``;
    }
    if (npmPackages.length > 0) {
      prompt += `

## Available Packages
These npm packages are installed and can be imported: ${npmPackages.join(", ")}`;
    }
    if (importantFileContents && importantFileContents.length > 0) {
      prompt += `

## Key Files`;
      for (const { path: filePath, content } of importantFileContents) {
        prompt += `

### ${filePath}
\`\`\`javascript
${content}
\`\`\``;
      }
    }
    if (this._userSystemPrompt) {
      prompt += `

## Additional Instructions
${this._userSystemPrompt}`;
    }
    return prompt;
  }
  // ── Code Execution ───────────────────────────────────────────────────────
  /**
   * @private
   */
  _slugify(purpose) {
    if (!purpose) return (0, import_node_crypto.randomUUID)().slice(0, 8);
    return purpose.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  }
  /**
   * @private
   */
  async _executeCode(code, purpose) {
    if (this._stopped) {
      return { stdout: "", stderr: "Agent was stopped", exitCode: -1 };
    }
    if (this.onBeforeExecution) {
      try {
        const allowed = await this.onBeforeExecution(code);
        if (allowed === false) {
          return { stdout: "", stderr: "Execution denied by onBeforeExecution callback", exitCode: -1, denied: true };
        }
      } catch (e) {
        logger_default.warn(`onBeforeExecution callback error: ${e.message}`);
      }
    }
    await (0, import_promises2.mkdir)(this.writeDir, { recursive: true });
    const slug = this._slugify(purpose);
    const tempFile = (0, import_node_path.join)(this.writeDir, `agent-${slug}-${Date.now()}.mjs`);
    try {
      await (0, import_promises2.writeFile)(tempFile, code, "utf-8");
      const result = await new Promise((resolve2) => {
        const child = (0, import_node_child_process.execFile)("node", [tempFile], {
          cwd: this.workingDirectory,
          timeout: this.timeout,
          env: process.env,
          maxBuffer: 10 * 1024 * 1024
        }, (err, stdout, stderr) => {
          this._activeProcess = null;
          if (err) {
            resolve2({
              stdout: err.stdout || stdout || "",
              stderr: (err.stderr || stderr || "") + (err.killed ? "\n[EXECUTION TIMED OUT]" : ""),
              exitCode: err.code || 1
            });
          } else {
            resolve2({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 });
          }
        });
        this._activeProcess = child;
      });
      const totalLen = result.stdout.length + result.stderr.length;
      if (totalLen > MAX_OUTPUT_CHARS) {
        const half = Math.floor(MAX_OUTPUT_CHARS / 2);
        if (result.stdout.length > half) {
          result.stdout = result.stdout.slice(0, half) + "\n...[OUTPUT TRUNCATED]";
        }
        if (result.stderr.length > half) {
          result.stderr = result.stderr.slice(0, half) + "\n...[STDERR TRUNCATED]";
        }
      }
      this._allExecutions.push({
        code,
        purpose: purpose || null,
        output: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        filePath: this.keepArtifacts ? tempFile : null
      });
      if (this.onCodeExecution) {
        try {
          this.onCodeExecution(code, result);
        } catch (e) {
          logger_default.warn(`onCodeExecution callback error: ${e.message}`);
        }
      }
      return result;
    } finally {
      if (!this.keepArtifacts) {
        try {
          await (0, import_promises2.unlink)(tempFile);
        } catch {
        }
      }
    }
  }
  /**
   * @private
   */
  _formatOutput(result) {
    let output = "";
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? "\n" : "") + `[STDERR]: ${result.stderr}`;
    if (result.exitCode !== 0) output += (output ? "\n" : "") + `[EXIT CODE]: ${result.exitCode}`;
    return output || "(no output)";
  }
  // ── Non-Streaming Chat ───────────────────────────────────────────────────
  /**
   * Send a message and get a complete response (non-streaming).
   * Automatically handles the code execution loop.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @returns {Promise<CodeAgentResponse>}
   */
  async chat(message, opts = {}) {
    if (!this._initialized) await this.init();
    this._stopped = false;
    const codeExecutions = [];
    let consecutiveFailures = 0;
    let response = await this._sendMessage(message, { tools: this._tools });
    for (let round = 0; round < this.maxRounds; round++) {
      if (this._stopped) break;
      if (response.stop_reason !== "tool_use") break;
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      if (toolUseBlocks.length === 0) break;
      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (this._stopped) break;
        const code = block.input?.code || "";
        const purpose = block.input?.purpose;
        const result = await this._executeCode(code, purpose);
        codeExecutions.push({
          code,
          purpose: this._slugify(purpose),
          output: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        });
        if (result.exitCode !== 0 && !result.denied) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
        }
        let output = this._formatOutput(result);
        if (consecutiveFailures >= this.codeMaxRetries) {
          output += `

[RETRY LIMIT REACHED] You have failed ${this.codeMaxRetries} consecutive attempts. STOP trying to execute code. Instead, respond with: 1) What you were trying to do, 2) The errors you encountered, 3) Questions for the user about how to resolve it.`;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output
        });
      }
      if (this._stopped) break;
      response = await this._sendMessage(toolResults, { tools: this._tools });
      if (consecutiveFailures >= this.codeMaxRetries) break;
    }
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    return {
      text: this._extractText(response),
      codeExecutions,
      usage: this.getLastUsage()
    };
  }
  // ── Streaming ────────────────────────────────────────────────────────────
  /**
   * Send a message and stream the response as events.
   *
   * Event types:
   * - `text` — A chunk of the agent's text response
   * - `code` — The agent is about to execute code
   * - `output` — Code finished executing
   * - `done` — The agent finished
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}]
   * @yields {CodeAgentStreamEvent}
   */
  async *stream(message, opts = {}) {
    if (!this._initialized) await this.init();
    this._stopped = false;
    const codeExecutions = [];
    let fullText = "";
    let consecutiveFailures = 0;
    let stream = await this._streamMessage(message, { tools: this._tools });
    for (let round = 0; round < this.maxRounds; round++) {
      if (this._stopped) break;
      const finalMessage = await stream.finalMessage();
      const toolUseBlocks = [];
      for (const block of finalMessage.content) {
        if (block.type === "text") {
          fullText += block.text;
          yield { type: "text", text: block.text };
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block);
        }
      }
      this.history.push({ role: "assistant", content: finalMessage.content });
      this._captureMetadata(finalMessage);
      if (finalMessage.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
        yield { type: "done", fullText, codeExecutions, usage: this.getLastUsage() };
        return;
      }
      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (this._stopped) break;
        const code = block.input?.code || "";
        const purpose = block.input?.purpose;
        yield { type: "code", code };
        const result = await this._executeCode(code, purpose);
        codeExecutions.push({
          code,
          purpose: this._slugify(purpose),
          output: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        });
        yield {
          type: "output",
          code,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        };
        if (result.exitCode !== 0 && !result.denied) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
        }
        let output = this._formatOutput(result);
        if (consecutiveFailures >= this.codeMaxRetries) {
          output += `

[RETRY LIMIT REACHED] You have failed ${this.codeMaxRetries} consecutive attempts. STOP trying to execute code. Instead, respond with: 1) What you were trying to do, 2) The errors you encountered, 3) Questions for the user about how to resolve it.`;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output
        });
      }
      if (this._stopped) break;
      stream = await this._streamMessage(toolResults, { tools: this._tools });
      if (consecutiveFailures >= this.codeMaxRetries) break;
    }
    let warning = "Max tool rounds reached";
    if (this._stopped) warning = "Agent was stopped";
    else if (consecutiveFailures >= this.codeMaxRetries) warning = "Retry limit reached";
    yield { type: "done", fullText, codeExecutions, usage: this.getLastUsage(), warning };
  }
  // ── Dump ─────────────────────────────────────────────────────────────────
  /**
   * Returns all code scripts the agent has written.
   * @returns {Array<{fileName: string, script: string}>}
   */
  dump() {
    return this._allExecutions.map((exec, i) => ({
      fileName: exec.purpose ? `agent-${exec.purpose}.mjs` : `script-${i + 1}.mjs`,
      purpose: exec.purpose || null,
      script: exec.code,
      filePath: exec.filePath || null
    }));
  }
  // ── Stop ─────────────────────────────────────────────────────────────────
  /**
   * Stop the agent. Kills any running child process.
   */
  stop() {
    this._stopped = true;
    if (this._activeProcess) {
      try {
        this._activeProcess.kill("SIGTERM");
      } catch {
      }
    }
    logger_default.info("CodeAgent stopped");
  }
};
var code_agent_default = CodeAgent;

// rag-agent.js
var import_node_path2 = require("node:path");
var import_promises3 = require("node:fs/promises");
var MIME_TYPES = {
  // Text (read as UTF-8, injected as text)
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "text/xml",
  ".json": "application/json",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".ts": "text/plain",
  ".css": "text/css",
  ".yaml": "text/plain",
  ".yml": "text/plain",
  ".py": "text/x-python",
  ".rb": "text/plain",
  ".sh": "text/plain",
  // Images (base64 encoded for Claude vision)
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  // Documents (base64 encoded)
  ".pdf": "application/pdf"
};
var DEFAULT_SYSTEM_PROMPT = "You are a helpful AI assistant. Answer questions based on the provided documents and data. When referencing information, mention which document or data source it comes from.";
var RagAgent = class extends base_default {
  /**
   * @param {RagAgentOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: DEFAULT_SYSTEM_PROMPT };
    }
    super(options);
    this.localFiles = options.localFiles || [];
    this.localData = options.localData || [];
    this.mediaFiles = options.mediaFiles || [];
    this.enableCitations = options.enableCitations ?? false;
    this._localFileContents = [];
    this._mediaContentBlocks = [];
    const total = this.localFiles.length + this.localData.length + this.mediaFiles.length;
    logger_default.debug(`RagAgent created with ${total} context sources`);
  }
  // ── Initialization ───────────────────────────────────────────────────────
  /**
   * Reads local files, encodes media, and seeds all context into conversation.
   * @param {boolean} [force=false]
   * @returns {Promise<void>}
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    await this._ensureClient();
    this._localFileContents = [];
    for (const filePath of this.localFiles) {
      const resolvedPath = (0, import_node_path2.resolve)(filePath);
      logger_default.debug(`Reading local file: ${resolvedPath}`);
      const content = await (0, import_promises3.readFile)(resolvedPath, "utf-8");
      this._localFileContents.push({
        name: (0, import_node_path2.basename)(resolvedPath),
        content,
        path: resolvedPath
      });
      logger_default.debug(`Local file read: ${(0, import_node_path2.basename)(resolvedPath)} (${content.length} chars)`);
    }
    this._mediaContentBlocks = [];
    for (const filePath of this.mediaFiles) {
      const resolvedPath = (0, import_node_path2.resolve)(filePath);
      const ext = (0, import_node_path2.extname)(resolvedPath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";
      logger_default.debug(`Encoding media file: ${resolvedPath} (${mimeType})`);
      const buffer = await (0, import_promises3.readFile)(resolvedPath);
      const base64 = buffer.toString("base64");
      if (mimeType.startsWith("image/")) {
        this._mediaContentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mimeType, data: base64 }
        });
      } else if (mimeType === "application/pdf") {
        this._mediaContentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: mimeType, data: base64 }
        });
      }
      logger_default.debug(`Media file encoded: ${(0, import_node_path2.basename)(resolvedPath)}`);
    }
    const contentParts = [];
    for (let i = 0; i < this._mediaContentBlocks.length; i++) {
      const block = this._mediaContentBlocks[i];
      if (this.enableCitations && block.type === "document") {
        contentParts.push({
          ...block,
          title: (0, import_node_path2.basename)(this.mediaFiles[i]),
          citations: { enabled: true }
        });
      } else {
        contentParts.push(block);
      }
    }
    for (const lf of this._localFileContents) {
      if (this.enableCitations) {
        contentParts.push({
          type: "document",
          source: { type: "text", media_type: "text/plain", data: lf.content },
          title: lf.name,
          citations: { enabled: true }
        });
      } else {
        contentParts.push({ type: "text", text: `--- File: ${lf.name} ---
${lf.content}` });
      }
    }
    for (const ld of this.localData) {
      const serialized = typeof ld.data === "string" ? ld.data : JSON.stringify(ld.data, null, 2);
      if (this.enableCitations) {
        contentParts.push({
          type: "document",
          source: { type: "text", media_type: "text/plain", data: serialized },
          title: ld.name,
          citations: { enabled: true }
        });
      } else {
        contentParts.push({ type: "text", text: `--- Data: ${ld.name} ---
${serialized}` });
      }
    }
    if (contentParts.length > 0) {
      contentParts.push({ type: "text", text: "Here are the documents and data to analyze." });
      this.history = [
        { role: "user", content: contentParts },
        { role: "assistant", content: [{ type: "text", text: "I have reviewed all the provided documents and data. I am ready to answer your questions about them." }] }
      ];
    }
    this._initialized = true;
    logger_default.debug(`RagAgent initialized with ${this._localFileContents.length} local files, ${this.localData.length} data entries, ${this._mediaContentBlocks.length} media files`);
  }
  // ── Non-Streaming Chat ───────────────────────────────────────────────────
  /**
   * Send a message and get a response grounded in the loaded context.
   *
   * @param {string} message - The user's question
   * @param {Object} [opts={}]
   * @returns {Promise<RagResponse>}
   */
  async chat(message, opts = {}) {
    if (!this._initialized) await this.init();
    const response = await this._sendMessage(message, opts);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    const result = {
      text: this._extractText(response),
      usage: this.getLastUsage()
    };
    if (this.enableCitations) {
      result.citations = this._extractCitations(response);
    }
    return result;
  }
  // ── Citation Extraction ─────────────────────────────────────────────────
  /**
   * Extracts citation data from a Claude response when citations are enabled.
   * Claude returns citations as content blocks with type 'cite' interspersed
   * with text blocks in the response.
   *
   * @param {Object} response - The API response
   * @returns {Array<Object>} Array of citation objects
   * @private
   */
  _extractCitations(response) {
    if (!response?.content) return [];
    const citations = [];
    for (const block of response.content) {
      if (block.type === "text" && Array.isArray(block.citations)) {
        for (const cite of block.citations) {
          citations.push(cite);
        }
      }
    }
    return citations;
  }
  // ── Streaming ────────────────────────────────────────────────────────────
  /**
   * Send a message and stream the response as events.
   *
   * @param {string} message - The user's question
   * @param {Object} [opts={}]
   * @yields {RagStreamEvent}
   */
  async *stream(message, opts = {}) {
    if (!this._initialized) await this.init();
    let fullText = "";
    const stream = await this._streamMessage(message, opts);
    const finalMessage = await stream.finalMessage();
    for (const block of finalMessage.content) {
      if (block.type === "text") {
        fullText += block.text;
        yield { type: "text", text: block.text };
      }
    }
    this.history.push({ role: "assistant", content: finalMessage.content });
    this._captureMetadata(finalMessage);
    yield {
      type: "done",
      fullText,
      usage: this.getLastUsage()
    };
  }
  // ── Context Management ──────────────────────────────────────────────────
  /**
   * Add local text files (read from disk). Triggers reinitialize.
   * @param {string[]} paths
   * @returns {Promise<void>}
   */
  async addLocalFiles(paths) {
    this.localFiles.push(...paths);
    await this.init(true);
  }
  /**
   * Add in-memory data entries. Triggers reinitialize.
   * @param {LocalDataEntry[]} entries
   * @returns {Promise<void>}
   */
  async addLocalData(entries) {
    this.localData.push(...entries);
    await this.init(true);
  }
  /**
   * Add media files (images, PDFs). Triggers reinitialize.
   * @param {string[]} paths
   * @returns {Promise<void>}
   */
  async addMediaFiles(paths) {
    this.mediaFiles.push(...paths);
    await this.init(true);
  }
  /**
   * Returns metadata about all context sources.
   * @returns {{ localFiles: Array<Object>, localData: Array<Object>, mediaFiles: Array<Object> }}
   */
  getContext() {
    return {
      localFiles: this._localFileContents.map((lf) => ({
        name: lf.name,
        path: lf.path,
        size: lf.content.length
      })),
      localData: this.localData.map((ld) => ({
        name: ld.name,
        type: typeof ld.data === "object" && ld.data !== null ? Array.isArray(ld.data) ? "array" : "object" : typeof ld.data
      })),
      mediaFiles: this.mediaFiles.map((f) => ({
        path: (0, import_node_path2.resolve)(f),
        name: (0, import_node_path2.basename)(f),
        ext: (0, import_node_path2.extname)(f).toLowerCase()
      }))
    };
  }
};
var rag_agent_default = RagAgent;

// agent-query.js
var AgentQuery = class {
  /**
   * @param {AgentQueryOptions} [options={}]
   */
  constructor(options = {}) {
    this.model = options.model || "claude-sonnet-4-6";
    this.allowedTools = options.allowedTools || void 0;
    this.disallowedTools = options.disallowedTools || void 0;
    this.cwd = options.cwd || process.cwd();
    this.maxTurns = options.maxTurns || void 0;
    this.maxBudgetUsd = options.maxBudgetUsd || void 0;
    this.systemPrompt = options.systemPrompt || void 0;
    this.permissionMode = options.permissionMode || void 0;
    this.mcpServers = options.mcpServers || void 0;
    this.hooks = options.hooks || void 0;
    this._lastSessionId = null;
    this._queryFn = null;
    logger_default.debug(`AgentQuery created with model: ${this.model}`);
  }
  /**
   * Lazily imports the query function from claude-agent-sdk.
   * @private
   */
  async _getQueryFn() {
    if (this._queryFn) return this._queryFn;
    try {
      const sdk = await import(
        /** @type {any} */
        "@anthropic-ai/claude-agent-sdk"
      );
      this._queryFn = sdk.query;
      return this._queryFn;
    } catch (e) {
      throw new Error(
        `Failed to import @anthropic-ai/claude-agent-sdk. Install it with: npm install @anthropic-ai/claude-agent-sdk
Error: ${e.message}`
      );
    }
  }
  /**
   * Run an autonomous agent query. Yields messages as they arrive.
   *
   * @param {string} prompt - The task for the agent
   * @param {AgentQueryRunOptions} [opts={}] - Per-run overrides
   * @yields {Object} Messages from the agent (system, assistant, tool_progress, result)
   */
  async *run(prompt, opts = {}) {
    const queryFn = await this._getQueryFn();
    const options = {
      model: opts.model || this.model,
      cwd: opts.cwd || this.cwd,
      ...opts.allowedTools || this.allowedTools ? { allowedTools: opts.allowedTools || this.allowedTools } : {},
      ...opts.disallowedTools || this.disallowedTools ? { disallowedTools: opts.disallowedTools || this.disallowedTools } : {},
      ...opts.maxTurns || this.maxTurns ? { maxTurns: opts.maxTurns || this.maxTurns } : {},
      ...opts.maxBudgetUsd || this.maxBudgetUsd ? { maxBudgetUsd: opts.maxBudgetUsd || this.maxBudgetUsd } : {},
      ...opts.systemPrompt || this.systemPrompt ? { systemPrompt: opts.systemPrompt || this.systemPrompt } : {},
      ...opts.permissionMode || this.permissionMode ? { permissionMode: opts.permissionMode || this.permissionMode } : {},
      ...opts.mcpServers || this.mcpServers ? { mcpServers: opts.mcpServers || this.mcpServers } : {},
      ...opts.hooks || this.hooks ? { hooks: opts.hooks || this.hooks } : {},
      ...opts.sessionId ? { resume: opts.sessionId } : {}
    };
    for await (const message of queryFn({ prompt, options })) {
      this._lastSessionId = message.session_id || message.sessionId || this._lastSessionId;
      yield message;
    }
  }
  /**
   * Resume a previous agent session with a new prompt.
   *
   * @param {string} sessionId - The session ID to resume
   * @param {string} prompt - The follow-up prompt
   * @param {AgentQueryRunOptions} [opts={}]
   * @yields {Object} Messages from the agent
   */
  async *resume(sessionId, prompt, opts = {}) {
    yield* this.run(prompt, { ...opts, sessionId });
  }
  /**
   * The session ID from the last run.
   * @returns {string|null}
   */
  get lastSessionId() {
    return this._lastSessionId;
  }
};
var agent_query_default = AgentQuery;

// index.js
var index_default = { Transformer: transformer_default, Chat: chat_default, Message: message_default, ToolAgent: tool_agent_default, CodeAgent: code_agent_default, RagAgent: rag_agent_default, AgentQuery: agent_query_default };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AgentQuery,
  BaseClaude,
  Chat,
  CodeAgent,
  Message,
  RagAgent,
  ToolAgent,
  Transformer,
  attemptJSONRecovery,
  extractJSON,
  log
});
