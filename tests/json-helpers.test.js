import { extractJSON, attemptJSONRecovery } from '../json-helpers.js';
import { isJSON, isJSONStr } from '../json-helpers.js';

describe('json-helpers', () => {

	describe('isJSON()', () => {
		it('should return true for objects', () => { expect(isJSON({ a: 1 })).toBe(true); });
		it('should return true for arrays', () => { expect(isJSON([1, 2, 3])).toBe(true); });
		it('should return false for strings', () => { expect(isJSON('hello')).toBe(false); });
		it('should return false for numbers', () => { expect(isJSON(42)).toBe(false); });
		it('should return false for null', () => { expect(isJSON(null)).toBe(false); });
		it('should return false for undefined', () => { expect(isJSON(undefined)).toBe(false); });
		it('should return false for circular references', () => {
			const obj = {};
			obj.self = obj;
			expect(isJSON(obj)).toBe(false);
		});
	});

	describe('isJSONStr()', () => {
		it('should return true for valid JSON object string', () => { expect(isJSONStr('{"a":1}')).toBe(true); });
		it('should return true for valid JSON array string', () => { expect(isJSONStr('[1,2,3]')).toBe(true); });
		it('should return false for plain string', () => { expect(isJSONStr('"hello"')).toBe(false); });
		it('should return false for number string', () => { expect(isJSONStr('42')).toBe(false); });
		it('should return false for invalid JSON', () => { expect(isJSONStr('{bad json}')).toBe(false); });
		it('should return false for non-string input', () => {
			expect(isJSONStr(123)).toBe(false);
			expect(isJSONStr(null)).toBe(false);
			expect(isJSONStr(undefined)).toBe(false);
		});
	});

	describe('attemptJSONRecovery()', () => {
		it('should return null for null/undefined input', () => {
			expect(attemptJSONRecovery(null)).toBeNull();
			expect(attemptJSONRecovery(undefined)).toBeNull();
			expect(attemptJSONRecovery('')).toBeNull();
		});
		it('should return null for non-string input', () => { expect(attemptJSONRecovery(42)).toBeNull(); });
		it('should parse valid JSON as-is', () => { expect(attemptJSONRecovery('{"a": 1}')).toEqual({ a: 1 }); });
		it('should recover truncated JSON with missing closing brace', () => {
			const result = attemptJSONRecovery('{"name": "Alice", "age": 30');
			expect(result).not.toBeNull();
			expect(result.name).toBe('Alice');
		});
		it('should recover truncated JSON with missing closing bracket', () => {
			expect(attemptJSONRecovery('[1, 2, 3')).toEqual([1, 2, 3]);
		});
		it('should recover nested truncated JSON', () => {
			const result = attemptJSONRecovery('{"items": [{"id": 1}, {"id": 2}]');
			expect(result).not.toBeNull();
			expect(result.items).toHaveLength(2);
		});
		it('should recover JSON with unclosed string', () => {
			expect(attemptJSONRecovery('{"name": "Alice')).not.toBeNull();
		});
		it('should handle escaped characters in strings', () => {
			expect(attemptJSONRecovery('{"msg": "hello \\"world\\""}')).toEqual({ msg: 'hello "world"' });
		});
		it('should return null for completely unrecoverable text', () => {
			expect(attemptJSONRecovery('This is not JSON at all', 5)).toBeNull();
		});
		it('should recover by progressive removal when simple close fails', () => {
			expect(attemptJSONRecovery('{"a": 1, "b": 2, "c": "trunc')).not.toBeNull();
		});
	});

	describe('extractJSON()', () => {
		it('should parse plain JSON text', () => { expect(extractJSON('{"name": "Alice", "age": 30}')).toEqual({ name: 'Alice', age: 30 }); });
		it('should parse JSON array', () => { expect(extractJSON('[1, 2, 3]')).toEqual([1, 2, 3]); });
		it('should handle whitespace around JSON', () => { expect(extractJSON('  \n  {"a": 1}  \n  ')).toEqual({ a: 1 }); });
		it('should extract JSON from ```json code block', () => {
			expect(extractJSON('Here:\n```json\n{"name": "Bob"}\n```\nDone.')).toEqual({ name: 'Bob' });
		});
		it('should extract JSON from ``` code block', () => {
			expect(extractJSON('Result:\n```\n{"key": "value"}\n```')).toEqual({ key: 'value' });
		});
		it('should extract JSON embedded in surrounding text', () => {
			expect(extractJSON('The result is {"answer": 42} and that is final.')).toEqual({ answer: 42 });
		});
		it('should extract nested JSON from text', () => {
			expect(extractJSON('Prefix {"outer": {"inner": [1, 2]}} suffix')).toEqual({ outer: { inner: [1, 2] } });
		});
		it('should handle "Sure, here is your..." preamble', () => {
			expect(extractJSON('Sure, here is your JSON:\n{"result": true}')).toEqual({ result: true });
		});
		it('should recover truncated JSON as last resort', () => {
			const result = extractJSON('{"name": "Alice", "items": [1, 2, 3');
			expect(result).not.toBeNull();
			expect(result.name).toBe('Alice');
		});
		it('should throw for null/undefined input', () => {
			expect(() => extractJSON(null)).toThrow('No text provided');
			expect(() => extractJSON(undefined)).toThrow('No text provided');
			expect(() => extractJSON('')).toThrow('No text provided');
		});
		it('should throw when no JSON can be extracted', () => {
			expect(() => extractJSON('This has no JSON content whatsoever.')).toThrow(/Could not extract valid JSON/);
		});
	});
});
