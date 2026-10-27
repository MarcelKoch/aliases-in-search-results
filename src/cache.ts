import { type MetadataCache, type TFile, type Vault } from 'obsidian';
import { aliasesFromCache } from './aliasResolver';

/**
 * In-memory index of file path -> aliases, plus a basename -> files index used
 * by the search adapter's fallback mapping strategy.
 *
 * NOTE: The event wiring (`changed`, `resolve`, `rename`, `delete`, `resolved`)
 * is implemented in Phase 2. This Phase 1 scaffold defines the index structures
 * and a full-rebuild method so the type surface is stable.
 */
export class AliasCache {
	private readonly metadataCache: MetadataCache;
	/** path -> normalized aliases */
	private readonly byPath = new Map<string, string[]>();
	/** basename -> list of file paths sharing that basename (unambiguous => length 1) */
	private readonly byBasename = new Map<string, string[]>();

	constructor(vault: Vault, metadataCache: MetadataCache) {
		this.metadataCache = metadataCache;
	}

	/** Full rebuild of both indexes over all markdown files. */
	rebuild(files: TFile[]): void {
		this.byPath.clear();
		this.byBasename.clear();
		for (const file of files) {
			this.setFile(file, aliasesFromCache(file, this.metadataCache));
		}
	}

	/** Insert or update a single file. */
	setFile(file: TFile, aliases: string[]): void {
		this.byPath.set(file.path, aliases);
		this.indexBasename(file.basename, file.path);
	}

	/** Recompute aliases for a single file from the metadata cache. */
	recompute(file: TFile): void {
		this.setFile(file, aliasesFromCache(file, this.metadataCache));
	}

	/** Remove a file by path. */
	remove(path: string): void {
		this.byPath.delete(path);
		// Rebuild basename index conservatively in Phase 2 if needed.
	}

	/** Move a file's entry from oldPath to newPath. */
	move(oldPath: string, newPath: string): void {
		const aliases = this.byPath.get(oldPath);
		this.byPath.delete(oldPath);
		if (aliases) {
			this.byPath.set(newPath, aliases);
		}
	}

	getAliases(path: string): string[] {
		return this.byPath.get(path) ?? [];
	}

	/** True when the vault has no aliases at all (early-exit optimization). */
	hasAnyAliases(): boolean {
		for (const aliases of this.byPath.values()) {
			if (aliases.length > 0) {
				return true;
			}
		}
		return false;
	}

	/** Resolve a basename; returns null when ambiguous or unknown. */
	resolveBasename(basename: string): string | null {
		const paths = this.byBasename.get(basename);
		if (!paths || paths.length !== 1) {
			return null;
		}
		const single = paths[0];
		return single ?? null;
	}

	private indexBasename(basename: string, path: string): void {
		const list = this.byBasename.get(basename);
		if (!list) {
			this.byBasename.set(basename, [path]);
			return;
		}
		if (!list.includes(path)) {
			list.push(path);
		}
	}
}
