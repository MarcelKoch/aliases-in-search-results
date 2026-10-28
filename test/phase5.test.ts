import { beforeAll, describe, expect, it } from 'vitest';
import { AliasCache } from '../src/cache';
import { normalizeAliases } from '../src/aliasResolver';
import { buildVChildrenPathMap, extractFilePath } from '../src/searchAdapter';
import type { CachedMetadata, MetadataCache, TFile, Vault } from 'obsidian';

class FakeElement {}
beforeAll(() => {
	// `buildVChildrenPathMap` checks `selfEl instanceof Element`. In the node
	// test env there is no DOM global, so install a minimal stand-in.
	(globalThis as { Element?: unknown }).Element = FakeElement;
});

// Performance/simulation-oriented Phase 5 checks. Timing assertions use generous
// absolute bounds that hold on slow CI runners: they catch gross regressions
// (e.g. an accidental per-row full-vault scan) rather than flaky micro-tuning.

function makeFile(path: string, basename?: string): TFile {
	const base = basename ?? path.split('/').pop()?.replace(/\.md$/, '') ?? path;
	return { path, basename: base, extension: 'md' } as TFile;
}

function makeMetadataCache(frontmatterByPath: Map<string, { aliases?: unknown }>): MetadataCache {
	return {
		getFileCache: (file: TFile) =>
			({ frontmatter: frontmatterByPath.get(file.path) }) as CachedMetadata,
	} as MetadataCache;
}

function makeVault(): Vault {
	return {} as Vault;
}

describe('zero-alias early exit (O(1) flag)', () => {
	it('hasAnyAliases is false when no file has aliases', () => {
		const cache = new AliasCache(makeVault(), makeMetadataCache(new Map()));
		cache.rebuild([makeFile('a.md'), makeFile('b/c.md'), makeFile('d.md')]);
		expect(cache.hasAnyAliases()).toBe(false);
	});

	it('flips to true the moment any file gains aliases', () => {
		const fm = new Map<string, { aliases?: unknown }>();
		const cache = new AliasCache(makeVault(), makeMetadataCache(fm));
		cache.rebuild([makeFile('a.md'), makeFile('b.md')]);
		expect(cache.hasAnyAliases()).toBe(false);

		fm.set('b.md', { aliases: ['standup'] });
		cache.recompute(makeFile('b.md'));
		expect(cache.hasAnyAliases()).toBe(true);
	});

	it('flips back to false when the last aliased file is cleared', () => {
		const fm = new Map<string, { aliases?: unknown }>([
			['a.md', { aliases: ['only'] }],
		]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(fm));
		cache.rebuild([makeFile('a.md'), makeFile('b.md')]);
		expect(cache.hasAnyAliases()).toBe(true);

		// Clear the only aliased file's aliases.
		fm.set('a.md', undefined);
		cache.recompute(makeFile('a.md'));
		expect(cache.hasAnyAliases()).toBe(false);
	});

	it('stays true while another file still has aliases after a delete', () => {
		const fm = new Map<string, { aliases?: unknown }>([
			['a.md', { aliases: ['one'] }],
			['b.md', { aliases: ['two'] }],
		]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(fm));
		cache.rebuild([makeFile('a.md'), makeFile('b.md')]);

		cache.remove(makeFile('a.md'));
		expect(cache.hasAnyAliases()).toBe(true);
	});

	it('hasAnyAliases stays cheap (does not rescan the vault per call)', () => {
		// Build a large index with no aliases, then confirm the accessor does not
		// allocate/scale — a per-call full scan would make this take much, much
		// longer. We assert correctness and rely on the O(1) design; the bound is
		// only a guard against a gross regression.
		const count = 200000;
		const fm = new Map<string, { aliases?: unknown }>();
		const files: TFile[] = [];
		for (let i = 0; i < count; i++) {
			files.push(makeFile(`f${i}.md`));
		}
		const cache = new AliasCache(makeVault(), makeMetadataCache(fm));
		cache.rebuild(files);
		expect(cache.size).toBe(count);

		const start = performance.now();
		for (let i = 0; i < 100000; i++) {
			cache.hasAnyAliases();
		}
		const elapsed = performance.now() - start;
		// 100k O(1) reads must finish quickly — a full-vault scan each call would
		// be 100k * 200k iterations and blow this bound.
		expect(elapsed).toBeLessThan(1000);
	});
});

describe('large-vault simulation', () => {
	it('rebuilds a 1000-file index quickly, under the <100ms budget', () => {
		const fm = new Map<string, { aliases?: unknown }>();
		const files: TFile[] = [];
		for (let i = 0; i < 1000; i++) {
			files.push(makeFile(`notes/file-${i}.md`));
			if (i % 3 === 0) {
				fm.set(`notes/file-${i}.md`, { aliases: [`alias-${i}`, `a${i}`] });
			}
		}
		const cache = new AliasCache(makeVault(), makeMetadataCache(fm));

		const start = performance.now();
		cache.rebuild(files);
		const elapsed = performance.now() - start;

		expect(cache.size).toBe(1000);
		expect(cache.hasAnyAliases()).toBe(true);
		// Per the Phase 5 checklist: alias index build under 100ms for 1000 files.
		expect(elapsed).toBeLessThan(100);
	});

	it('resolving basenames across a 1000-file vault stays sub-frame', () => {
		const fm = new Map<string, { aliases?: unknown }>();
		const files: TFile[] = [];
		for (let i = 0; i < 1000; i++) {
			files.push(makeFile(`folder-${i % 10}/doc-${i}.md`));
			fm.set(`folder-${i % 10}/doc-${i}.md`, { aliases: [`d${i}`] });
		}
		const cache = new AliasCache(makeVault(), makeMetadataCache(fm));
		cache.rebuild(files);

		// Measure the pure resolution loop (no per-iteration assertion/template
		// cost) so the bound reflects the hot path. Each real rAF frame batch
		// decorates only *visible* rows; 1000 unique-basename lookups is an
		// upper bound well beyond one visual frame.
		const start = performance.now();
		for (let i = 0; i < 1000; i++) {
			cache.resolveBasename(`doc-${i}`);
		}
		const elapsed = performance.now() - start;
		// A generous sub-16ms target for 1000 resolutions; a regression (e.g. an
		// O(n) scan per resolve) would blow this wide open.
		expect(elapsed).toBeLessThan(16);
		// Correctness spot-check after the timed loop.
		expect(cache.resolveBasename('doc-0')).toBe('folder-0/doc-0.md');
	});

	it('does not leak registry state across repeated rebuilds (memory stability)', () => {
		const fm = new Map<string, { aliases?: unknown }>();
		const cache = new AliasCache(makeVault(), makeMetadataCache(fm));

		const files: TFile[] = [];
		for (let i = 0; i < 1000; i++) {
			files.push(makeFile(`n${i}.md`));
			fm.set(`n${i}.md`, { aliases: [`a${i}`] });
		}

		// Simulate repeated searches: each 'search' rebuilds + resolves + scans.
		for (let round = 0; round < 10; round++) {
			cache.rebuild(files);
			for (let i = 0; i < files.length; i++) {
				cache.getAliases(files[i].path);
			}
		}
		// Structural leak check: after 10 rebuilds the index still holds exactly
		// the 1000 files — no orphaned entries accumulate across searches.
		expect(cache.size).toBe(1000);
		expect(cache.resolveBasename('n0')).toBe('n0.md');
	});
});

describe('edge cases: special characters in aliases', () => {
	it('preserves special characters, quotes, brackets and unicode', () => {
		const aliases = normalizeAliases([
			'R&D – Q3',
			'María José',
			'[brackets]',
			'{braces}',
			'comma, inside',
			"apostrophe's",
			'slash/path',
			'&:-;@#%*+~|\\<>`',
		]);
		expect(aliases).toEqual([
			'R&D – Q3',
			'María José',
			'[brackets]',
			'{braces}',
			'comma, inside',
			"apostrophe's",
			'slash/path',
			'&:-;@#%*+~|\\<>`',
		]);
	});
});

describe('performance: 1000-result batch decoration budget (<16ms/frame)', () => {
	// Pure logic that mirrors the per-row work a single rAF "frame batch" does:
	// resolve path (vChildren map) + extract file path. The actual DOM render is
	// not measurable in node, but the resolution hot-path is — and it's the part
	// that historically caused layout thrash. A 1000-row resolution pass must
	// stay well under one 16ms frame.

	it('resolves 1000 rows via the vChildren map within a 16ms frame', () => {
		const children: Array<unknown> = [];
		for (let i = 0; i < 1000; i++) {
			const row = new FakeElement();
			children.push({ file: { path: `docs/file-${i}.md` }, selfEl: row });
		}
		const map = buildVChildrenPathMap(children);
		expect(map).not.toBeNull();

		const start = performance.now();
		let hit = 0;
		for (let i = 0; i < 1000; i++) {
			const el = (children[i] as { selfEl: unknown }).selfEl as Element;
			if (typeof map!.get(el) === 'string') hit++;
		}
		const elapsed = performance.now() - start;
		expect(hit).toBe(1000);
		expect(elapsed).toBeLessThan(16);
	});

	it('extractFilePath stays cheap on a 1000-element match array', () => {
		const huge: Array<{ file: { path: string } }> = [];
		for (let i = 0; i < 1000; i++) {
			huge.push({ file: { path: 'shared.md' } });
		}
		const start = performance.now();
		for (let i = 0; i < 1000; i++) {
			expect(extractFilePath(huge)).toBe('shared.md');
		}
		const elapsed = performance.now() - start;
		expect(elapsed).toBeLessThan(100);
	});
});
