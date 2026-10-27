import { beforeAll, describe, expect, it } from 'vitest';
import { buildElementPathMap, extractFilePath } from '../src/searchAdapter';

// `buildElementPathMap` checks `key instanceof Element`. In the node test env
// there is no DOM global, so install a minimal stand-in that supports the
// `instanceof` check used by the pure shape-validation logic.
class FakeElement {}
beforeAll(() => {
	(globalThis as { Element?: unknown }).Element = FakeElement;
});

describe('extractFilePath (resultDomLookup value shape)', () => {
	it('accepts { file: { path } }', () => {
		expect(extractFilePath({ file: { path: 'a/b.md' } })).toBe('a/b.md');
	});

	it('accepts an array of { file: { path } } match objects', () => {
		const value = [{ file: { path: 'first.md' } }, { file: { path: 'second.md' } }];
		expect(extractFilePath(value)).toBe('first.md');
	});

	it('does not descend into arbitrary wrappers (only top-level .file or arrays)', () => {
		expect(extractFilePath({ data: { file: { path: 'wrapped.md' } } })).toBe(null);
	});

	it('rejects null / non-objects', () => {
		expect(extractFilePath(null)).toBeNull();
		expect(extractFilePath(undefined)).toBeNull();
		expect(extractFilePath('str')).toBeNull();
		expect(extractFilePath(42)).toBeNull();
	});

	it('rejects { file } whose path is not a string', () => {
		expect(extractFilePath({ file: { path: 123 } })).toBeNull();
		expect(extractFilePath({ file: {} })).toBeNull();
	});

	it('rejects an empty array', () => {
		expect(extractFilePath([])).toBeNull();
	});
});

describe('buildElementPathMap (shape-check accept/reject)', () => {
	it('accepts a valid map of element -> { file }', () => {
		const a = new FakeElement();
		const b = new FakeElement();
		const map = new Map<unknown, unknown>([
			[a, { file: { path: 'a.md' } }],
			[b, [{ file: { path: 'b.md' } }]],
		]);
		const result = buildElementPathMap(map);
		expect(result).not.toBeNull();
		expect(result!.get(a)).toBe('a.md');
		expect(result!.get(b)).toBe('b.md');
	});

	it('rejects when any key is not an Element', () => {
		const map = new Map<unknown, unknown>([['not-an-element', { file: { path: 'a.md' } }]]);
		expect(buildElementPathMap(map)).toBeNull();
	});

	it('rejects when any value yields no path', () => {
		const a = new FakeElement();
		const map = new Map<unknown, unknown>([[a, { file: { path: 123 } }]]);
		expect(buildElementPathMap(map)).toBeNull();
	});

	it('accepts an empty map (produces an empty mapping)', () => {
		const result = buildElementPathMap(new Map());
		expect(result).toEqual(new Map());
	});
});
