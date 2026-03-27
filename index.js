/**
 * @fileoverview ak-claude — Easy-to-use wrappers on @anthropic-ai/sdk + @anthropic-ai/claude-agent-sdk.
 *
 * Exports:
 * - Transformer — AI-powered JSON transformation via few-shot learning
 * - Chat — Multi-turn text conversation with AI
 * - Message — Stateless one-off messages to AI
 * - ToolAgent — AI agent with user-provided tools
 * - CodeAgent — AI agent that writes and executes code
 * - RagAgent — Document Q&A via context injection
 * - AgentQuery — Autonomous agent via Claude Agent SDK
 * - BaseClaude — Base class for building custom wrappers
 *
 * @example
 * ```javascript
 * import { Transformer, Chat, Message, ToolAgent } from 'ak-claude';
 * // or
 * import AI from 'ak-claude';
 * const t = new AI.Transformer({ ... });
 * ```
 */

// ── Named Exports ──

export { default as Transformer } from './transformer.js';
export { default as Chat } from './chat.js';
export { default as Message } from './message.js';
export { default as ToolAgent } from './tool-agent.js';
export { default as CodeAgent } from './code-agent.js';
export { default as RagAgent } from './rag-agent.js';
export { default as AgentQuery } from './agent-query.js';
export { default as BaseClaude } from './base.js';
export { default as log } from './logger.js';
export { extractJSON, attemptJSONRecovery } from './json-helpers.js';

// ── Default Export (namespace object) ──

import Transformer from './transformer.js';
import Chat from './chat.js';
import Message from './message.js';
import ToolAgent from './tool-agent.js';
import CodeAgent from './code-agent.js';
import RagAgent from './rag-agent.js';
import AgentQuery from './agent-query.js';

export default { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, AgentQuery };
