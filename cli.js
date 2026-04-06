#!/usr/bin/env node
/**
 * CLI for ak-claude — streams a Claude response to stdout.
 * Usage: node ak-claude/cli.js "your prompt here"
 *        MODEL=claude-opus-4-6 node ak-claude/cli.js "prompt"
 */

import { Message } from './index.js';

// Silence SDK console.debug noise
console.debug = () => {};

const prompt = process.argv.slice(2).join(' ');

if (!prompt || prompt === '-h' || prompt === '--help') {
	console.log('Usage: node ak-claude/cli.js "your prompt"');
	console.log('  MODEL env var overrides default model (claude-sonnet-4-6)');
	console.log('  Web search is enabled by default');
	process.exit(prompt ? 0 : 1);
}

try {
	const enableSearch = process.env.WEB_SEARCH === '1';
	const msg = new Message({
		modelName: process.env.MODEL || 'claude-sonnet-4-6',
		...(enableSearch && { enableWebSearch: true }),
		vertexai: true,
		vertexProjectId: process.env.GOOGLE_CLOUD_PROJECT || 'mixpanel-gtm-training',
		systemPrompt: 'Respond in plain text only. Do not use markdown formatting (no bold, italic, headers, bullet points, code fences, etc.).',
		logLevel: 'none'
	});
	await msg.init();

	const tools = msg._buildTools();
	const systemParam = msg._buildSystemParam();
	const stream = msg.client.messages.stream({
		model: msg.modelName,
		max_tokens: msg.maxTokens,
		messages: [{ role: 'user', content: prompt }],
		...(systemParam && { system: systemParam }),
		...(tools && { tools })
	});

	stream.on('text', (delta) => process.stdout.write(delta));
	await stream.finalMessage();
	process.stdout.write('\n');
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
