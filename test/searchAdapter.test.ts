import { beforeAll, describe, expect, it } from 'vitest';
import {
	buildElementPathMap,
	buildVChildrenPathMap,
	extractFilePath,
} from '../src/searchAdapter';

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

	it('skips non-Element keys instead of blanking the whole map', () => {
		const a = new FakeElement();
		const map = new Map<unknown, unknown>([
			['sentinel-entry', { file: { path: 'a.md' } }],
			[a, { file: { path: 'a.md' } }],
		]);
		const result = buildElementPathMap(map);
		expect(result).not.toBeNull();
		expect(result!.get(a)).toBe('a.md');
	});

	it('returns an empty map when every key is non-Element (caller falls back)', () => {
		const map = new Map<string, unknown>([['x', { file: { path: 'a.md' } }]]);
		const result = buildElementPathMap(map as unknown as Map<unknown, unknown>);
		expect(result).toEqual(new Map());
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

describe('buildVChildrenPathMap (vChildren row->file hook)', () => {
	it('maps each child\'s selfEl to its file path', () => {
		const rowA = new FakeElement();
		const rowB = new FakeElement();
		const children = [
			{ file: { path: 'notes/a.md' }, selfEl: rowA },
			{ file: { path: 'docs/b.md' }, selfEl: rowB },
		];
		const result = buildVChildrenPathMap(children);
		expect(result).not.toBeNull();
		expect(result!.get(rowA)).toBe('notes/a.md');
		expect(result!.get(rowB)).toBe('docs/b.md');
	});

	it('disambiguates same-basename files in different folders (the bug)', () => {
		const rowRoot = new FakeElement();
		const rowNested = new FakeElement();
		const children = [
			// Root-level "Untitled.md" vs nested "Untitled/Untitled.md" share the
			// basename "Untitled" but have distinct full paths.
			{ file: { path: 'Untitled.md' }, selfEl: rowRoot },
			{ file: { path: 'Untitled/Untitled.md' }, selfEl: rowNested },
		];
		const result = buildVChildrenPathMap(children);
		expect(result).not.toBeNull();
		expect(result!.get(rowRoot)).toBe('Untitled.md');
		expect(result!.get(rowNested)).toBe('Untitled/Untitled.md');
	});

	it('skips a child without a usable selfEl', () => {
		const good = new FakeElement();
		const result = buildVChildrenPathMap([{ file: { path: 'a.md' }, selfEl: good }, { file: { path: 'b.md' } }]);
		expect(result).not.toBeNull();
		expect(result!.get(good)).toBe('a.md');
		expect(result!.size).toBe(1);
	});

	it('skips a child without a usable path', () => {
		const row = new FakeElement();
		const result = buildVChildrenPathMap([{ selfEl: row }, { file: { path: 123 }, selfEl: new FakeElement() }]);
		expect(result).not.toBeNull();
		expect(result!.size).toBe(0);
	});

	it('reads path from a nested result.file as a fallback shape', () => {
		const row = new FakeElement();
		const result = buildVChildrenPathMap([{ result: { file: { path: 'wrapped.md' } }, selfEl: row }]);
		expect(result).not.toBeNull();
		expect(result!.get(row)).toBe('wrapped.md');
	});

	it('accepts an empty children list (empty mapping)', () => {
		expect(buildVChildrenPathMap([])).toEqual(new Map());
	});
});
