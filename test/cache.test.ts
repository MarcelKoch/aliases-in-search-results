import { describe, expect, it } from 'vitest';
import { AliasCache } from '../src/cache';
import type { CachedMetadata, MetadataCache, TFile, Vault } from 'obsidian';

function makeFile(path: string): TFile {
	const base = path.split('/').pop() ?? path;
	return { path, basename: base.replace(/\.md$/, ''), extension: 'md' } as TFile;
}

/** A metadata-cache stub whose getFileCache reads from a mutable map. */
function makeMetadataCache(frontmatterByPath: Map<string, { aliases?: unknown }>): MetadataCache {
	return {
		getFileCache: (file: TFile) =>
			({ frontmatter: frontmatterByPath.get(file.path) }) as CachedMetadata,
	} as MetadataCache;
}

function makeVault(): Vault {
	return {} as Vault;
}

describe('AliasCache index maintenance', () => {
	it('rebuild populates both indexes from all files', () => {
		const frontmatter = new Map<string, { aliases?: unknown }>([
			['A.md', { aliases: ['alpha'] }],
			['B.md', { aliases: ['beta', 'Beta'] }],
			['C.md', undefined],
		]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(frontmatter));
		cache.rebuild([makeFile('A.md'), makeFile('B.md'), makeFile('C.md')]);

		expect(cache.size).toBe(3);
		expect(cache.getAliases('A.md')).toEqual(['alpha']);
		expect(cache.getAliases('B.md')).toEqual(['beta', 'Beta']);
		expect(cache.getAliases('C.md')).toEqual([]);
		expect(cache.hasAnyAliases()).toBe(true);
	});

	it('hasAnyAliases is false when no file has aliases', () => {
		const cache = new AliasCache(makeVault(), makeMetadataCache(new Map()));
		cache.rebuild([makeFile('X.md')]);
		expect(cache.hasAnyAliases()).toBe(false);
	});

	it('recompute updates a single file from the metadata cache (changed/resolve)', () => {
		const frontmatter = new Map<string, { aliases?: unknown }>([['A.md', { aliases: ['old'] }]]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(frontmatter));
		cache.rebuild([makeFile('A.md')]);
		expect(cache.getAliases('A.md')).toEqual(['old']);

		// Simulate a metadata 'changed'/'resolve' event reporting new aliases.
		frontmatter.set('A.md', { aliases: ['new', 'newer'] });
		cache.recompute(makeFile('A.md'));
		expect(cache.getAliases('A.md')).toEqual(['new', 'newer']);
	});

	it('move relocates the entry on rename (folder change keeps basename)', () => {
		const frontmatter = new Map<string, { aliases?: unknown }>([['Old/A.md', { aliases: ['alpha'] }]]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(frontmatter));
		cache.rebuild([makeFile('Old/A.md')]);

		cache.move('Old/A.md', 'New/A.md', 'A');
		expect(cache.getAliases('Old/A.md')).toEqual([]);
		expect(cache.getAliases('New/A.md')).toEqual(['alpha']);
		// Basename unchanged -> still resolveable.
		expect(cache.resolveBasename('A')).toBe('New/A.md');
	});

	it('move corrects the basename index when the basename changes', () => {
		const frontmatter = new Map<string, { aliases?: unknown }>([['A.md', { aliases: ['alpha'] }]]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(frontmatter));
		cache.rebuild([makeFile('A.md')]);

		cache.move('A.md', 'Renamed.md', 'Renamed');
		expect(cache.getAliases('Renamed.md')).toEqual(['alpha']);
		expect(cache.resolveBasename('A')).toBeNull();
		expect(cache.resolveBasename('Renamed')).toBe('Renamed.md');
	});

	it('remove deletes the entry on delete', () => {
		const frontmatter = new Map<string, { aliases?: unknown }>([['A.md', { aliases: ['alpha'] }]]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(frontmatter));
		cache.rebuild([makeFile('A.md')]);

		cache.remove(makeFile('A.md'));
		expect(cache.getAliases('A.md')).toEqual([]);
		expect(cache.resolveBasename('A')).toBeNull();
	});

	it('resolveBasename returns null for ambiguous basenames (never-guess)', () => {
		const frontmatter = new Map<string, { aliases?: unknown }>([
			['one/202504111439.md', { aliases: ['a'] }],
			['two/202504111439.md', { aliases: ['b'] }],
		]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(frontmatter));
		cache.rebuild([
			makeFile('one/202504111439.md'),
			makeFile('two/202504111439.md'),
		]);

		expect(cache.resolveBasename('202504111439')).toBeNull();
		expect(cache.size).toBe(2);
	});

	it('no full-vault rescan happens on a single-file operation (spy check)', () => {
		const frontmatter = new Map<string, { aliases?: unknown }>([['A.md', { aliases: ['alpha'] }]]);
		const cache = new AliasCache(makeVault(), makeMetadataCache(frontmatter));
		let rebuildCalls = 0;
		cache.rebuild([makeFile('A.md'), makeFile('B.md')]);
		const originalRebuild = cache.rebuild.bind(cache);
		// Spy on rebuild to ensure per-file ops don't trigger it.
		cache.rebuild = (...args: Parameters<typeof cache.rebuild>) => {
			rebuildCalls++;
			return originalRebuild(...args);
		};

		cache.recompute(makeFile('A.md'));
		cache.move('A.md', 'C.md', 'C');
		cache.remove(makeFile('C.md'));

		expect(rebuildCalls).toBe(0);
	});
});
