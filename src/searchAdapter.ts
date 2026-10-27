import { type Workspace } from 'obsidian';
import { type AliasCache } from './cache';

/**
 * ALL fragile interaction with the core Search view internals lives here, so
 * an Obsidian update only ever breaks this single module — never the rest of
 * the plugin. See `docs/phase0-search-internals.md` §3 for the row→file mapping
 * strategy (Tier 1: `view.dom.resultDomLookup`; Tier 2: basename index) and §4
 * for the observation strategy (per-leaf MutationObserver + IntersectionObserver
 * + rAF batching).
 *
 * Implemented in Phase 3. This scaffold wires the lifecycle (bind to search
 * leaves, react to layout changes, clean teardown) without decorating yet.
 */
export class SearchAdapter {
	constructor(
		private readonly workspace: Workspace,
		private readonly cache: AliasCache,
	) {}

	/** Attach observers to every open Search leaf; called on load and layout changes. */
	attach(): void {
		// Phase 3: discover leaves, observe results container, resolve rows to files.
	}

	/** Detach all observers and remove any injected DOM. Called on unload. */
	detach(): void {
		// Phase 3: disconnect observers, remove every [data-aisr] element.
	}
}
