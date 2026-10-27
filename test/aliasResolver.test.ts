import { describe, expect, it } from 'vitest';
import {
	aliasesFromCache,
	normalizeAliases,
} from '../src/aliasResolver';
import type { CachedMetadata, MetadataCache, TFile } from 'obsidian';

/** Minimal file-shaped object for tests. */
function makeFile(path: string, basename?: string): TFile {
	return { path, basename: basename ?? path.split('/').pop()?.replace(/\.md$/, '') ?? path } as TFile;
}

/** Minimal metadata-cache-shaped stub backed by a path -> frontmatter map. */
function makeCache(frontmatterByPath: Record<string, { aliases?: unknown } | undefined>): MetadataCache {
	return {
		getFileCache: (file: TFile) =>
			({ frontmatter: frontmatterByPath[file.path] }) as CachedMetadata,
	} as MetadataCache;
}

describe('normalizeAliases (pure)', () => {
	it('returns an empty list for null/undefined', () => {
		expect(normalizeAliases(null)).toEqual([]);
		expect(normalizeAliases(undefined)).toEqual([]);
	});

	it('handles a single string alias', () => {
		expect(normalizeAliases('standup')).toEqual(['standup']);
	});

	it('handles an array of aliases', () => {
		expect(normalizeAliases(['standup', 'team-sync'])).toEqual([
			'standup',
			'team-sync',
		]);
	});

	it('returns an empty array for an empty array', () => {
		expect(normalizeAliases([])).toEqual([]);
	});

	it('drops empty strings and whitespace-only entries', () => {
		expect(normalizeAliases(['', '   ', 'ok'])).toEqual(['ok']);
	});

	it('trims surrounding whitespace on each alias', () => {
		expect(normalizeAliases(['  standup  ', '\tteam-sync\n'])).toEqual([
			'standup',
			'team-sync',
		]);
	});

	it('dedupes identical aliases (exact, after trimming)', () => {
		expect(normalizeAliases(['standup', 'standup', ' Standup '])).toEqual([
			'standup',
			'Standup',
		]);
	});

	it('drops non-string entries (malformed frontmatter)', () => {
		expect(normalizeAliases(['ok', 42, {}, ['nested'], true, null])).toEqual([
			'ok',
		]);
	});
});

describe('aliasesFromCache (reads frontmatter via MetadataCache)', () => {
	it('returns aliases when frontmatter has an aliases array', () => {
		const filename = 'Daily Meeting Notes.md';
		const cache = makeCache({
			[filename]: { aliases: ['standup', 'team-sync'] },
		});
		expect(aliasesFromCache(makeFile(filename, 'Daily Meeting Notes'), cache)).toEqual([
			'standup',
			'team-sync',
		]);
	});

	it('handles a single-string aliases value', () => {
		const filename = 'Single.md';
		const cache = makeCache({ [filename]: { aliases: 'solo' } });
		expect(aliasesFromCache(makeFile(filename, 'Single'), cache)).toEqual(['solo']);
	});

	it('returns an empty list when the file has no frontmatter', () => {
		const filename = 'NoFrontmatter.md';
		const cache = makeCache({ [filename]: undefined });
		expect(aliasesFromCache(makeFile(filename, 'NoFrontmatter'), cache)).toEqual([]);
	});

	it('returns an empty list when the file is absent from the cache', () => {
		expect(
			aliasesFromCache(makeFile('Missing.md', 'Missing'), makeCache({})),
		).toEqual([]);
	});

	it('returns an empty list when aliases key is malformed (a number)', () => {
		const filename = 'Malformed.md';
		const cache = makeCache({ [filename]: { aliases: 123 as unknown } });
		expect(aliasesFromCache(makeFile(filename, 'Malformed'), cache)).toEqual([]);
	});
});
