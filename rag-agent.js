/**
 * @fileoverview RagAgent class — AI agent for document & data Q&A.
 *
 * NOTE: This is not true RAG (no vector embeddings, chunking, or similarity
 * search). It uses long-context injection — all content is placed directly
 * into the model's context window. Named "RagAgent" because it serves the
 * same purpose in spirit: grounding AI responses in user-provided data.
 *
 * Supports three input types:
 * - localFiles: read from disk as text (md, json, csv, yaml, txt, etc.)
 * - localData: in-memory objects serialized as JSON
 * - mediaFiles: images/PDFs encoded as base64 content blocks (Claude-native)
 */

import { resolve, basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import BaseClaude from './base.js';
import log from './logger.js';

/** @type {Record<string, string>} */
const MIME_TYPES = {
	// Text (read as UTF-8, injected as text)
	'.txt': 'text/plain', '.md': 'text/plain', '.csv': 'text/csv',
	'.html': 'text/html', '.htm': 'text/html', '.xml': 'text/xml',
	'.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.ts': 'text/plain', '.css': 'text/css', '.yaml': 'text/plain', '.yml': 'text/plain',
	'.py': 'text/x-python', '.rb': 'text/plain', '.sh': 'text/plain',
	// Images (base64 encoded for Claude vision)
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp',
	// Documents (base64 encoded)
	'.pdf': 'application/pdf',
};

/**
 * @typedef {import('./types').RagAgentOptions} RagAgentOptions
 * @typedef {import('./types').RagResponse} RagResponse
 * @typedef {import('./types').RagStreamEvent} RagStreamEvent
 * @typedef {import('./types').LocalDataEntry} LocalDataEntry
 */

const DEFAULT_SYSTEM_PROMPT =
	'You are a helpful AI assistant. Answer questions based on the provided documents and data. ' +
	'When referencing information, mention which document or data source it comes from.';

/**
 * AI agent that answers questions grounded in user-provided documents and data.
 *
 * @example
 * ```javascript
 * import { RagAgent } from 'ak-claude';
 *
 * const agent = new RagAgent({
 *   localFiles: ['./docs/api.md', './config.yaml'],
 *   localData: [
 *     { name: 'users', data: [{ id: 1, name: 'Alice' }] },
 *   ],
 *   mediaFiles: ['./diagram.png'],
 * });
 *
 * const result = await agent.chat('What does the API doc say about auth?');
 * console.log(result.text);
 * ```
 */
class RagAgent extends BaseClaude {
	/**
	 * @param {RagAgentOptions} [options={}]
	 */
	constructor(options = {}) {
		if (options.systemPrompt === undefined) {
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
		log.debug(`RagAgent created with ${total} context sources`);
	}

	// ── Initialization ───────────────────────────────────────────────────────

	/**
	 * Reads local files, encodes media, and seeds all context into conversation.
	 * @param {boolean} [force=false]
	 * @returns {Promise<void>}
	 */
	async init(force = false) {
		if (this._initialized && !force) return;

		// 1. Read local text files from disk
		this._localFileContents = [];
		for (const filePath of this.localFiles) {
			const resolvedPath = resolve(filePath);
			log.debug(`Reading local file: ${resolvedPath}`);

			const content = await readFile(resolvedPath, 'utf-8');
			this._localFileContents.push({
				name: basename(resolvedPath),
				content,
				path: resolvedPath
			});

			log.debug(`Local file read: ${basename(resolvedPath)} (${content.length} chars)`);
		}

		// 2. Encode media files as base64 content blocks
		this._mediaContentBlocks = [];
		for (const filePath of this.mediaFiles) {
			const resolvedPath = resolve(filePath);
			const ext = extname(resolvedPath).toLowerCase();
			const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

			log.debug(`Encoding media file: ${resolvedPath} (${mimeType})`);

			const buffer = await readFile(resolvedPath);
			const base64 = buffer.toString('base64');

			if (mimeType.startsWith('image/')) {
				this._mediaContentBlocks.push({
					type: 'image',
					source: { type: 'base64', media_type: mimeType, data: base64 }
				});
			} else if (mimeType === 'application/pdf') {
				this._mediaContentBlocks.push({
					type: 'document',
					source: { type: 'base64', media_type: mimeType, data: base64 }
				});
			}

			log.debug(`Media file encoded: ${basename(resolvedPath)}`);
		}

		// 3. Build unified context and seed into history
		/** @type {Array<Object>} */
		const contentParts = [];

		// Media content blocks (images, PDFs)
		for (let i = 0; i < this._mediaContentBlocks.length; i++) {
			const block = this._mediaContentBlocks[i];
			if (this.enableCitations && block.type === 'document') {
				contentParts.push({
					...block,
					title: basename(this.mediaFiles[i]),
					citations: { enabled: true }
				});
			} else {
				contentParts.push(block);
			}
		}

		// Local file contents
		for (const lf of this._localFileContents) {
			if (this.enableCitations) {
				contentParts.push({
					type: 'document',
					source: { type: 'text', media_type: 'text/plain', data: lf.content },
					title: lf.name,
					citations: { enabled: true }
				});
			} else {
				contentParts.push({ type: 'text', text: `--- File: ${lf.name} ---\n${lf.content}` });
			}
		}

		// Local data entries
		for (const ld of this.localData) {
			const serialized = typeof ld.data === 'string' ? ld.data : JSON.stringify(ld.data, null, 2);
			if (this.enableCitations) {
				contentParts.push({
					type: 'document',
					source: { type: 'text', media_type: 'text/plain', data: serialized },
					title: ld.name,
					citations: { enabled: true }
				});
			} else {
				contentParts.push({ type: 'text', text: `--- Data: ${ld.name} ---\n${serialized}` });
			}
		}

		if (contentParts.length > 0) {
			contentParts.push({ type: 'text', text: 'Here are the documents and data to analyze.' });

			this.history = [
				{ role: 'user', content: contentParts },
				{ role: 'assistant', content: [{ type: 'text', text: 'I have reviewed all the provided documents and data. I am ready to answer your questions about them.' }] }
			];
		}

		this._initialized = true;
		log.debug(`RagAgent initialized with ${this._localFileContents.length} local files, ${this.localData.length} data entries, ${this._mediaContentBlocks.length} media files`);
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
			if (block.type === 'text' && Array.isArray(block.citations)) {
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

		let fullText = '';
		const stream = await this._streamMessage(message, opts);
		const finalMessage = await stream.finalMessage();

		for (const block of finalMessage.content) {
			if (block.type === 'text') {
				fullText += block.text;
				yield { type: 'text', text: block.text };
			}
		}

		// Push assistant response to history
		this.history.push({ role: 'assistant', content: finalMessage.content });
		this._captureMetadata(finalMessage);

		yield {
			type: 'done',
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
			localFiles: this._localFileContents.map(lf => ({
				name: lf.name,
				path: lf.path,
				size: lf.content.length
			})),
			localData: this.localData.map(ld => ({
				name: ld.name,
				type: typeof ld.data === 'object' && ld.data !== null
					? (Array.isArray(ld.data) ? 'array' : 'object')
					: typeof ld.data
			})),
			mediaFiles: this.mediaFiles.map(f => ({
				path: resolve(f),
				name: basename(f),
				ext: extname(f).toLowerCase()
			}))
		};
	}
}

export default RagAgent;
