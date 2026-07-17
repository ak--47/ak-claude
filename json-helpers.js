/**
 * @fileoverview Pure utility functions for JSON extraction and recovery.
 * Used by Transformer and Message classes to parse AI model responses.
 */

import log from './logger.js';

/**
 * Checks if a JavaScript value is a JSON-serializable object or array.
 * @param {*} data - The value to check
 * @returns {boolean}
 */
export function isJSON(data) {
	try {
		const attempt = JSON.stringify(data);
		if (attempt?.startsWith('{') || attempt?.startsWith('[')) {
			if (attempt?.endsWith('}') || attempt?.endsWith(']')) {
				return true;
			}
		}
		return false;
	} catch (e) {
		return false;
	}
}

/**
 * Checks if a string is valid JSON that parses to an object or array.
 * @param {string} string - The string to check
 * @returns {boolean}
 */
export function isJSONStr(string) {
	if (typeof string !== 'string') return false;
	try {
		const result = JSON.parse(string);
		const type = Object.prototype.toString.call(result);
		return type === '[object Object]' || type === '[object Array]';
	} catch (err) {
		return false;
	}
}

/**
 * Attempts to recover truncated JSON by progressively removing characters from the end
 * until valid JSON is found or recovery fails.
 * @param {string} text - The potentially truncated JSON string
 * @param {number} [maxAttempts=100] - Maximum number of characters to remove
 * @returns {Object|null} - Parsed JSON object or null if recovery fails
 */
export function attemptJSONRecovery(text, maxAttempts = 100) {
	if (!text || typeof text !== 'string') return null;

	// First, try parsing as-is
	try {
		return JSON.parse(text);
	} catch (e) {
		// Continue with recovery
	}

	let workingText = text.trim();

	// First attempt: try to close unclosed structures without removing characters
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

		if (char === '\\') {
			escapeNext = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		if (!inString) {
			if (char === '{') braces++;
			else if (char === '}') braces--;
			else if (char === '[') brackets++;
			else if (char === ']') brackets--;
		}
	}

	// Try to fix by just adding closing characters
	if ((braces > 0 || brackets > 0 || inString) && workingText.length > 2) {
		let fixedText = workingText;

		if (inString) {
			fixedText += '"';
		}

		while (braces > 0) {
			fixedText += '}';
			braces--;
		}
		while (brackets > 0) {
			fixedText += ']';
			brackets--;
		}

		try {
			const result = JSON.parse(fixedText);
			if (log.level !== 'silent') {
				log.warn(`JSON response appears truncated (possibly hit maxTokens limit). Recovered by adding closing characters.`);
			}
			return result;
		} catch (e) {
			// Simple fix didn't work, continue with more aggressive recovery
		}
	}

	// Second attempt: progressively remove characters from the end
	for (let i = 0; i < maxAttempts && workingText.length > 2; i++) {
		workingText = workingText.slice(0, -1);

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

			if (char === '\\') {
				escapeNext = true;
				continue;
			}

			if (char === '"') {
				inString = !inString;
				continue;
			}

			if (!inString) {
				if (char === '{') braces++;
				else if (char === '}') braces--;
				else if (char === '[') brackets++;
				else if (char === ']') brackets--;
			}
		}

		// If we have balanced braces/brackets, try parsing
		if (braces === 0 && brackets === 0 && !inString) {
			try {
				const result = JSON.parse(workingText);
				if (log.level !== 'silent') {
					log.warn(`JSON response appears truncated (possibly hit maxTokens limit). Recovered by removing ${i + 1} characters from the end.`);
				}
				return result;
			} catch (e) {
				// Continue trying
			}
		}

		// After a few attempts, try adding closing characters
		if (i > 5) {
			let fixedText = workingText;

			if (inString) {
				fixedText += '"';
			}

			while (braces > 0) {
				fixedText += '}';
				braces--;
			}
			while (brackets > 0) {
				fixedText += ']';
				brackets--;
			}

			try {
				const result = JSON.parse(fixedText);
				if (log.level !== 'silent') {
					log.warn(`JSON response appears truncated (possibly hit maxTokens limit). Recovered by adding closing characters.`);
				}
				return result;
			} catch (e) {
				// Recovery failed, continue trying
			}
		}
	}

	return null;
}

/**
 * Extracts a complete JSON structure from text starting at a given position
 * using bracket/brace matching.
 * @param {string} text - The text containing JSON
 * @param {number} startPos - Position of the opening bracket/brace
 * @returns {string|null} - The complete JSON structure or null
 */
function extractCompleteStructure(text, startPos) {
	const startChar = text[startPos];
	const endChar = startChar === '{' ? '}' : ']';
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = startPos; i < text.length; i++) {
		const char = text[i];

		if (escaped) {
			escaped = false;
			continue;
		}

		if (char === '\\' && inString) {
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

/**
 * Finds all complete JSON structures (objects and arrays) in text.
 * @param {string} text - The text to search
 * @returns {string[]} - Array of JSON structure strings
 */
function findCompleteJSONStructures(text) {
	const results = [];
	const startChars = ['{', '['];

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

/**
 * Validates a parsed value against a (subset of) JSON Schema. Dependency-light —
 * intended to guard fallback structured-output paths where the model isn't forced
 * to emit schema-valid JSON (e.g. Vertex prompt-paste).
 *
 * Supported keywords: `type` (string or array of strings; 'integer' checks for
 * whole numbers), `required`, `properties`, `additionalProperties: false`,
 * `items` (single schema), `enum`. Unknown keywords are ignored (lenient).
 *
 * @param {*} data - The parsed value to validate
 * @param {Object} schema - JSON Schema object
 * @param {string} [path='$'] - Internal: JSON path prefix for error messages
 * @returns {string[]} Array of human-readable error strings; empty means valid.
 */
export function validateSchema(data, schema, path = '$') {
	const errors = [];
	if (!schema || typeof schema !== 'object') return errors;

	// ── nullable (OpenAPI-style) ── a null value is valid on a nullable node.
	if (data === null && schema.nullable === true) return errors;

	// ── enum ── strict equality first, then deep-equal for object/array members.
	if (Array.isArray(schema.enum)) {
		const target = JSON.stringify(data);
		const ok = schema.enum.some(v => v === data || JSON.stringify(v) === target);
		if (!ok) errors.push(`${path}: value ${JSON.stringify(data)} is not one of allowed enum values ${JSON.stringify(schema.enum)}`);
	}

	// ── type ──
	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		if (schema.nullable === true) types.push('null');
		if (!types.some(t => matchesType(data, t))) {
			errors.push(`${path}: expected type ${types.join('|')} but got ${describeType(data)}`);
			// If the type is wrong, deeper checks are meaningless — stop here for this node.
			return errors;
		}
	}

	// ── object ── (Object.hasOwn avoids prototype-chain keys like 'toString')
	const isObject = data !== null && typeof data === 'object' && !Array.isArray(data);
	if (isObject && (schema.properties || schema.required || schema.additionalProperties === false)) {
		const props = schema.properties || {};

		if (Array.isArray(schema.required)) {
			for (const key of schema.required) {
				if (!Object.hasOwn(data, key)) errors.push(`${path}: missing required property "${key}"`);
			}
		}

		if (schema.additionalProperties === false) {
			for (const key of Object.keys(data)) {
				if (!Object.hasOwn(props, key)) errors.push(`${path}: unexpected property "${key}" (additionalProperties is false)`);
			}
		}

		for (const [key, subSchema] of Object.entries(props)) {
			if (Object.hasOwn(data, key)) {
				errors.push(...validateSchema(data[key], /** @type {any} */ (subSchema), `${path}.${key}`));
			}
		}
	}

	// ── array ──
	if (Array.isArray(data) && schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
		data.forEach((item, i) => {
			errors.push(...validateSchema(item, schema.items, `${path}[${i}]`));
		});
	}

	return errors;
}

/**
 * @param {*} value
 * @param {string} type - JSON Schema type name
 * @returns {boolean}
 */
function matchesType(value, type) {
	switch (type) {
		case 'string': return typeof value === 'string';
		case 'number': return typeof value === 'number' && !Number.isNaN(value);
		case 'integer': return typeof value === 'number' && Number.isInteger(value);
		case 'boolean': return typeof value === 'boolean';
		case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
		case 'array': return Array.isArray(value);
		case 'null': return value === null;
		default: return true; // unknown type keyword — be lenient
	}
}

/**
 * @param {*} value
 * @returns {string}
 */
function describeType(value) {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

/**
 * Extracts valid JSON from model response text using multiple strategies.
 * @param {string} text - The model response text
 * @returns {Object} - Parsed JSON object
 * @throws {Error} If no valid JSON can be extracted
 */
export function extractJSON(text) {
	if (!text || typeof text !== 'string') {
		throw new Error('No text provided for JSON extraction');
	}

	// Strategy 1: Try parsing the entire response as JSON
	if (isJSONStr(text.trim())) {
		return JSON.parse(text.trim());
	}

	// Strategy 2: Look for JSON code blocks (```json...``` or ```...```)
	const codeBlockPatterns = [
		/```json\s*\n?([\s\S]*?)\n?\s*```/gi,
		/```\s*\n?([\s\S]*?)\n?\s*```/gi
	];

	for (const pattern of codeBlockPatterns) {
		const matches = text.match(pattern);
		if (matches) {
			for (const match of matches) {
				const jsonContent = match.replace(/```json\s*\n?/gi, '').replace(/```\s*\n?/gi, '').trim();
				if (isJSONStr(jsonContent)) {
					return JSON.parse(jsonContent);
				}
			}
		}
	}

	// Strategy 3: Look for JSON objects/arrays using bracket matching
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

	// Strategy 4: Advanced bracket matching for nested structures
	const advancedExtract = findCompleteJSONStructures(text);
	if (advancedExtract.length > 0) {
		for (const candidate of advancedExtract) {
			if (isJSONStr(candidate)) {
				return JSON.parse(candidate);
			}
		}
	}

	// Strategy 5: Clean up common formatting issues and retry
	const cleanedText = text
		.replace(/^\s*Sure,?\s*here\s+is\s+your?\s+.*?[:\n]/gi, '')
		.replace(/^\s*Here\s+is\s+the\s+.*?[:\n]/gi, '')
		.replace(/^\s*The\s+.*?is\s*[:\n]/gi, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '')
		.trim();

	if (isJSONStr(cleanedText)) {
		return JSON.parse(cleanedText);
	}

	// Strategy 6: Last resort - attempt recovery for potentially truncated JSON
	const recoveredJSON = attemptJSONRecovery(text);
	if (recoveredJSON !== null) {
		return recoveredJSON;
	}

	throw new Error(`Could not extract valid JSON from model response. Response preview: ${text.substring(0, 200)}...`);
}
