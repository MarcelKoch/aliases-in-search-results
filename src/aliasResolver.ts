import { type CachedMetadata, type MetadataCache, type TFile } from 'obsidian';

/**
 * Pure alias resolution. Given a file's cached metadata (or the metadata cache
 * + file), return the normalized list of aliases declared in the frontmatter.
 *
 * The only documented alias location is the frontmatter `aliases` key. It can
 * be a single string or an array and may be absent.
 */

/** Normalize an arbitrary frontmatter aliases value into a cleaned string array. */
export function normalizeAliases(value: unknown): string[] {
	if (value == null) {
		return [];
	}
	const rawList = Array.isArray(value) ? value : [value];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of rawList) {
		if (typeof item !== 'string') {
			continue;
		}
		const trimmed = item.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

/** Resolve aliases for a file using cached metadata directly. */
export function aliasesFromCache(file: TFile, cache: MetadataCache): string[] {
	const fileCache: CachedMetadata | null = cache.getFileCache(file);
	const frontmatter = fileCache?.frontmatter;
	return normalizeAliases(frontmatter?.aliases);
}

/** Number of aliases beyond which the list should be truncated for display. */
export const MAX_ALLOWED_ALIASES = 100;
