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

	it('resolves an array whose entries all point at the same file', () => {
		const value = [
			{ file: { path: 'meeting.md' } },
			{ file: { path: 'meeting.md' } },
		];
		expect(extractFilePath(value)).toBe('meeting.md');
	});

	it('rejects an array of match items across distinct files (ambiguous row)', () => {
		const value = [{ file: { path: 'folder1/meeting.md' } }, { file: { path: 'folder2/meeting.md' } }];
		expect(extractFilePath(value)).toBeNull();
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

	it('keeps the valid rows even when another row value yields no path', () => {
		const good = new FakeElement();
		const bad = new FakeElement();
		const map = new Map<unknown, unknown>([
			[good, { file: { path: 'a.md' } }],
			[bad, { file: { path: 123 } }],
		]);
		const result = buildElementPathMap(map);
		expect(result).not.toBeNull();
		// The unextractable row is dropped, not fatal for the whole view.
		expect(result!.has(bad)).toBe(false);
		expect(result!.get(good)).toBe('a.md');
	});

	it('drops an ambiguous same-basename row while keeping unambiguous ones', () => {
		const unamb = new FakeElement();
		const amb = new FakeElement();
		const map = new Map<unknown, unknown>([
			[unamb, { file: { path: 'unique.md' } }],
			[
				amb,
				[{ file: { path: 'folder1/report.md' } }, { file: { path: 'folder2/report.md' } }],
			],
		]);
		const result = buildElementPathMap(map);
		expect(result).not.toBeNull();
		expect(result!.get(unamb)).toBe('unique.md');
		expect(result!.has(amb)).toBe(false);
	});

	it('accepts an empty map (produces an empty mapping)', () => {
		const result = buildElementPathMap(new Map());
		expect(result).toEqual(new Map());
	});
});
