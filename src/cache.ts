import { type MetadataCache, type TFile, type Vault } from 'obsidian';
import { aliasesFromCache } from './aliasResolver';

/**
 * In-memory index of file path -> aliases, plus a basename -> paths index used
 * by the search adapter's fallback mapping strategy.
 *
 * Design notes:
 * - This class is deliberately pure (no Obsidian event subscription); the
 *   plugin wires `main.ts` metadata/vault events into these methods. Keeping
 *   the event handling out makes the index fully unit-testable and guarantees
 *   no single-file metadata event triggers a full-vault rescan (each method
 *   updates only the affected entries).
 * - The basename index is maintained incrementally so it stays correct across
 *   create/rename/delete. `resolveBasename` returns a path only when exactly
 *   one file shares that basename; otherwise null (never-guess rule).
 */
export class AliasCache {
	private readonly vault: Vault;
	private readonly metadataCache: MetadataCache;
	/** path -> normalized aliases */
	private readonly byPath = new Map<string, string[]>();
	/** basename -> set of file paths sharing that basename */
	private readonly byBasename = new Map<string, Set<string>>();

	constructor(vault: Vault, metadataCache: MetadataCache) {
		this.vault = vault;
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

	/** Insert or update a single file (create or metadata change). */
	setFile(file: TFile, aliases: string[]): void {
		this.byPath.set(file.path, aliases);
		this.indexBasename(file.basename, file.path);
	}

	/** Recompute aliases for a single file from the metadata cache. */
	recompute(file: TFile): void {
		this.setFile(file, aliasesFromCache(file, this.metadataCache));
	}

	/** Remove a file entirely (delete). */
	remove(file: TFile): void {
		this.byPath.delete(file.path);
		this.unindexBasename(file.basename, file.path);
	}

	/**
	 * Relocate an entry after a rename. If the basename itself changed, the
	 * basename index is corrected; otherwise the entry is re-keyed by path.
	 */
	move(oldPath: string, newPath: string, newBasename: string): void {
		const aliases = this.byPath.get(oldPath);
		const oldBasename = this.basenameFromPath(oldPath);
		if (oldBasename !== null) {
			this.unindexBasename(oldBasename, oldPath);
		}
		if (aliases === undefined) {
			// No aliases were tracked for the old path; nothing else to do.
			return;
		}
		this.byPath.delete(oldPath);
		this.byPath.set(newPath, aliases);
		this.indexBasename(newBasename, newPath);
	}

	/** Look up aliases by file path. */
	getAliases(path: string): string[] {
		return this.byPath.get(path) ?? [];
	}

	/**
	 * True when the vault has at least one alias. Used as an early-exit
	 * optimization by the search adapter (skip all work when unused).
	 */
	hasAnyAliases(): boolean {
		for (const aliases of this.byPath.values()) {
			if (aliases.length > 0) {
				return true;
			}
		}
		return false;
	}

	/** Number of files currently tracked (useful for tests/audits). */
	get size(): number {
		return this.byPath.size;
	}

	/** Resolve a basename to a single file path; null when ambiguous or unknown. */
	resolveBasename(basename: string): string | null {
		const paths = this.byBasename.get(basename);
		if (!paths || paths.size !== 1) {
			return null;
		}
		const first = paths.values().next().value;
		return first ?? null;
	}

	/** Backing store is only exposed for tests/audits; prefer the accessors. */
	private indexBasename(basename: string, path: string): void {
		const set = this.byBasename.get(basename);
		if (!set) {
			this.byBasename.set(basename, new Set([path]));
		} else {
			set.add(path);
		}
	}

	private unindexBasename(basename: string, path: string): void {
		const set = this.byBasename.get(basename);
		if (!set) {
			return;
		}
		set.delete(path);
		if (set.size === 0) {
			this.byBasename.delete(basename);
		}
	}

	/** Approximate the old basename from a path (used by move before re-indexing). */
	private basenameFromPath(path: string): string | null {
		const base = path.split('/').pop() ?? '';
		const dot = base.lastIndexOf('.');
		return dot > 0 ? base.slice(0, dot) : base;
	}
}
