import { type View, type Workspace, type WorkspaceLeaf } from 'obsidian';
import { type AliasCache } from './cache';
import { renderAliases } from './renderer';
import { type AliasesInSearchResultsSettings } from './settings';

/**
 * ALL fragile interaction with the core Search view internals lives here, so an
 * Obsidian update only ever breaks this single module — never the rest of the
 * plugin. See `docs/phase0-search-internals.md` for the full design:
 *
 *  - §3  row→file mapping (Tier 1 `view.dom.resultDomLookup`; Tier 2 basename)
 *  - §4  observation (per-leaf MutationObserver + IntersectionObserver + rAF)
 *  - §5  cleanup / unload contract
 *
 * Behaviour contract:
 *  - Never throws into Obsidian. Any unexpected internal shape falls back to
 *    the official-API basename index, and if even that fails for a row, the row
 *    simply gets no badge (never-guess rule).
 *  - `detach()` removes every `[data-aisr]` element and disposes all observers
 *    and event listeners, so disable/reload leaves no residue.
 */

// The core Search view is not typed, so we access its internals defensively
// through this minimal, version-tolerant shape.
interface SearchViewInternals {
	dom?: {
		resultDomLookup?: unknown;
		childrenEl?: unknown;
		/**
		 * Virtualized children list. Each entry is a per-file child object that
		 * carries `file` (with `.path`) and `selfEl` — the rendered DOM element
		 * for that row. This is the reliable row→file hook across Obsidian
		 * versions (resultDomLookup's keys are result objects, not elements, on
		 * modern builds, so it can't be keyed by DOM element).
		 */
		vChildren?: {
			_children?: unknown;
		};
	};
	resultDomLookup?: unknown;
	getViewType?: () => string;
	getQuery?: () => unknown;
	searchComponent?: { value?: unknown };
}

const ROW_SELECTOR = '.search-result-file-title';
const TITLE_INNER_SELECTOR = '.tree-item-inner';
const LEAF_CONTENT_SELECTOR = '.workspace-leaf-content[data-type="search"]';
/** Elements/markers this plugin inserts; cleaned up on unload. */
const DATA_AISR = 'data-aisr';

/** Debounce delay for layout-change rebinding (pane open/close/reparent). */
const REBIND_DEBOUNCE_MS = 200;
/** IntersectionObserver rootMargin (px) to pre-wrap rows ahead of the viewport. */
const IO_ROOT_MARGIN_PX = 128;

interface BoundLeaf {
	rootEl: HTMLElement;
	view: View;
	mutationObserver: MutationObserver;
	intersectionObserver: IntersectionObserver | null;
	/** Rows the IntersectionObserver is currently watching, to unobserve on removal. */
	observedRows: Set<HTMLElement>;
}

interface PathLookup {
	resolve(titleEl: HTMLElement): string | null;
}

/**
 * Build a resolver over a per-element path map. Resolves a title row by
 * checking itself first, then bounded ancestors, then its row subtree, then
 * falls back to `undefined` (never-guess). Every returned path comes from a
 * real `.file.path` / map entry, so it never guesses which file a row is.
 */
function makeResolver(byElement: Map<Element, string>): PathLookup {
	return {
		resolve(titleEl: HTMLElement): string | null {
			let hit = byElement.get(titleEl);
			if (hit !== undefined) {
				return hit;
			}
			// `vChildren` child `.selfEl` is the row title element itself, but to
			// stay tolerant across versions also check bounded ancestors (the
			// `.tree-item`/`.tree-item-self` wrappers) and the row subtree.
			for (
				let ancestor = titleEl.parentElement, depth = 0;
				ancestor && depth < 3;
				ancestor = ancestor.parentElement, depth += 1
			) {
				hit = byElement.get(ancestor);
				if (hit !== undefined) {
					return hit;
				}
			}
			const rowRoot = titleEl.parentElement?.closest<HTMLElement>('.tree-item') ?? titleEl;
			for (const el of Array.from(rowRoot.querySelectorAll('*'))) {
				hit = byElement.get(el);
				if (hit !== undefined) {
					return hit;
				}
			}
			return null;
		},
	};
}

export class SearchAdapter {
	private settings: AliasesInSearchResultsSettings;
	private bound = new Set<BoundLeaf>();
	private layoutChangeRef: ReturnType<Workspace['on']> | null = null;
	private rebindTimer: number | null = null;
	private rAFId: number | null = null;
	private pendingRows = new Set<HTMLElement>();

	// Cache of validated tier-1 (resultDomLookup) lookups per leaf container.
	private tier1Lookup = new WeakMap<HTMLElement, PathLookup>();
	// Per-leaf current search query terms (lowercased), used for highlight.
	private highlightTerms = new WeakMap<HTMLElement, string[]>();

	constructor(
		private readonly workspace: Workspace,
		private readonly cache: AliasCache,
		settings: AliasesInSearchResultsSettings,
	) {
		this.settings = settings;
	}

	/** Re-process all currently observed rows (used on settings change). */
	refresh(): void {
		for (const leaf of this.bound) {
			for (const row of leaf.observedRows) {
				this.enqueueRow(row);
			}
		}
	}

	/** Attach to all open Search leaves and start observing. */
	attach(): void {
		this.bindAllLeaves();
		this.layoutChangeRef = this.workspace.on('layout-change', () => {
			this.scheduleRebind();
		});
	}

	/** Dispose all observers, listeners, scheduled work, and injected DOM. */
	detach(): void {
		if (this.layoutChangeRef) {
			this.workspace.offref(this.layoutChangeRef);
			this.layoutChangeRef = null;
		}
		if (this.rebindTimer !== null) {
			window.clearTimeout(this.rebindTimer);
			this.rebindTimer = null;
		}
		this.cancelPendingWork();
		this.removeAllInjectedDom();
		for (const leaf of this.bound) {
			leaf.mutationObserver.disconnect();
			leaf.intersectionObserver?.disconnect();
		}
		this.bound.clear();
		this.tier1Lookup = new WeakMap();
		this.highlightTerms = new WeakMap();
	}

	// ------------------------------------------------------------------ bind
	private bindAllLeaves(): void {
		this.removeAllInjectedDom();
		for (const leaf of this.bound) {
			leaf.mutationObserver.disconnect();
			leaf.intersectionObserver?.disconnect();
		}
		this.bound.clear();
		this.tier1Lookup = new WeakMap();
		this.highlightTerms = new WeakMap();

		for (const workspLeaf of this.workspace.getLeavesOfType('search')) {
			this.bindLeaf(workspLeaf);
		}
	}

	private scheduleRebind(): void {
		if (this.rebindTimer !== null) {
			window.clearTimeout(this.rebindTimer);
		}
		this.rebindTimer = window.setTimeout(() => {
			this.rebindTimer = null;
			this.bindAllLeaves();
		}, REBIND_DEBOUNCE_MS);
	}

	private bindLeaf(leaf: WorkspaceLeaf): void {
		const view = leaf.view;
		const rootEl = this.leafRootEl(leaf);
		if (!rootEl) {
			return;
		}

		const intersectionObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						this.enqueueRow(entry.target as HTMLElement);
					}
				}
			},
			{
				root: null,
				rootMargin: `${IO_ROOT_MARGIN_PX}px 0px`,
				threshold: 0,
			},
		);

		const observedRows = new Set<HTMLElement>();
		const observeRow = (row: HTMLElement): void => {
			observedRows.add(row);
			intersectionObserver.observe(row);
		};
		const unobserveRow = (row: Element): void => {
			if (observedRows.delete(row as HTMLElement)) {
				intersectionObserver.unobserve(row);
			}
		};

		const mutationObserver = new MutationObserver((mutations) => {
			let rowsAdded = false;
			for (const mutation of mutations) {
				if (mutation.type !== 'childList') {
					continue;
				}
				for (const node of Array.from(mutation.addedNodes)) {
					if (!node.instanceOf(HTMLElement)) {
						continue;
					}
					if (node.matches(ROW_SELECTOR)) {
						rowsAdded = true;
						observeRow(node);
					} else {
						const found = Array.from(node.querySelectorAll(ROW_SELECTOR));
						if (found.length > 0) {
							rowsAdded = true;
						}
						found.forEach((row) => observeRow(row as HTMLElement));
					}
				}
				// Unobserve rows being removed (includes full container swaps on
				// re-render), so the IntersectionObserver never leaks detached rows.
				for (const node of Array.from(mutation.removedNodes)) {
					if (!node.instanceOf(HTMLElement)) {
						continue;
					}
					if (node.matches(ROW_SELECTOR)) {
						unobserveRow(node);
					} else {
						Array.from(node.querySelectorAll(ROW_SELECTOR)).forEach(unobserveRow);
					}
				}
			}
			// Rows were (re)added — the `vChildren` children list may now contain
			// rows that weren't materialized when the leaf was bound (same-name
			// files are lazily rendered). Refresh the tier-1 map so those rows
			// resolve to their exact path instead of falling back to the ambiguous
			// basename index (where collided basenames get no badge).
			if (rowsAdded) {
				this.refreshTier1(rootEl, view);
			}
		});
		mutationObserver.observe(rootEl, { childList: true, subtree: true });

		this.tier1Lookup.set(rootEl, this.makeTier1Lookup(view));
		this.highlightTerms.set(rootEl, this.queryTerms(view));

		const bound: BoundLeaf = {
			rootEl,
			view,
			mutationObserver,
			intersectionObserver,
			observedRows,
		};
		this.bound.add(bound);

		// Initial pass over already-present rows.
		Array.from(rootEl.querySelectorAll(ROW_SELECTOR)).forEach((row) =>
			observeRow(row as HTMLElement),
		);
	}

	private leafRootEl(leaf: WorkspaceLeaf): HTMLElement | null {
		const container = leaf.view.containerEl;
		if (!container) {
			return null;
		}
		const content = container.closest<HTMLElement>(LEAF_CONTENT_SELECTOR);
		return content ?? container;
	}

	/**
	 * Defensively read the current search query terms for highlight matching.
	 * Falls back to an empty list when the query can't be reached (never throws).
	 */
	private queryTerms(view: View): string[] {
		try {
			const internals = view as unknown as SearchViewInternals;
			const raw =
				typeof internals.getQuery === 'function'
					? internals.getQuery()
					: (internals as unknown as { searchComponent?: { value?: unknown } })
							?.searchComponent?.value;
			if (typeof raw === 'string') {
				return raw
					.toLowerCase()
					.split(/[^a-z0-9äöüß+.-]+/i)
					.filter((t) => t.length > 0);
			}
		} catch {
			// Ignore — highlight simply won't trigger.
		}
		return [];
	}

	// --------------------------------------------------- tier 1: row -> file
	/**
	 * Build the row->file lookup for a leaf. Prefers the reliable `vChildren`
	 * hook (each child carries `.file.path` and `.selfEl`, the rendered row
	 * element), which works even for same-basename files in different folders.
	 * Falls back to `resultDomLookup` keys only when they are actual DOM
	 * elements (the historic shape). Returns a resolver that returns null when
	 * the row can't be confidently mapped (never-guess rule).
	 */
	private makeTier1Lookup(view: View): PathLookup {
		const internals = view as unknown as SearchViewInternals;

		const children = Array.isArray(internals.dom?.vChildren?._children)
			? (internals.dom.vChildren._children as Array<unknown>)
			: null;
		if (children) {
			const byElement = buildVChildrenPathMap(children);
			if (byElement !== null && byElement.size > 0) {
				return makeResolver(byElement);
			}
		}

		// Legacy fallback: resultDomLookup keyed by DOM elements (obsidian < this
		// shape change). Defensive — resolves nothing when keys aren't Elements.
		const map = internals.dom?.resultDomLookup ?? internals.resultDomLookup;
		if (map instanceof Map) {
			const byElement = buildElementPathMap(map);
			if (byElement !== null && byElement.size > 0) {
				return makeResolver(byElement);
			}
		}

		return { resolve: () => null };
	}

	/**
	 * Rebuild the tier-1 lookup for a leaf's root. Called whenever rows are
	 * (re)added, because `vChildren._children` grows lazily — rows that weren't
	 * materialized when the leaf was bound must be resolvable once they appear
	 * (same-name files in different folders are the case that otherwise falls
	 * through to the ambiguous basename index).
	 */
	private refreshTier1(rootEl: HTMLElement, view: View): void {
		this.tier1Lookup.set(rootEl, this.makeTier1Lookup(view));
		this.highlightTerms.set(rootEl, this.queryTerms(view));
	}

	// ----------------------------------------------------- row processing
	private enqueueRow(row: HTMLElement): void {
		if (row.isConnected) {
			this.pendingRows.add(row);
			if (this.rAFId === null) {
				this.rAFId = window.requestAnimationFrame(() => {
					this.rAFId = null;
					this.flushQueue();
				});
			}
		}
	}

	private flushQueue(): void {
		const rows = Array.from(this.pendingRows);
		this.pendingRows.clear();
		for (const row of rows) {
			if (row.isConnected) {
				this.processRow(row);
			}
		}
	}

	private processRow(titleEl: HTMLElement): void {
		// Early exits (performance): disabled in settings, or vault has no aliases.
		if (!this.settings.showAliases || !this.cache.hasAnyAliases()) {
			this.removeFromRow(titleEl);
			return;
		}

		const rootEl = titleEl.closest<HTMLElement>(LEAF_CONTENT_SELECTOR) ?? titleEl;
		const path = this.resolvePath(titleEl, rootEl);
		if (path === null) {
			// Never-guess rule: ambiguous/unknown file -> no badge.
			this.removeFromRow(titleEl);
			return;
		}

		const aliases = this.cache.getAliases(path);
		const terms = this.highlightTerms.get(rootEl) ?? [];
		renderAliases(titleEl, aliases, this.settings, terms);
	}

	private resolvePath(titleEl: HTMLElement, rootEl: HTMLElement): string | null {
		const tier1 = this.tier1Lookup.get(rootEl);
		if (tier1) {
			const path = tier1.resolve(titleEl);
			if (path !== null) {
				return path;
			}
		}
		// Tier 2: basename uniqueness via the official-API cache.
		const inner = titleEl.querySelector<HTMLElement>(TITLE_INNER_SELECTOR);
		const basename = inner?.textContent?.trim();
		if (!basename) {
			return null;
		}
		return this.cache.resolveBasename(basename);
	}

	private removeFromRow(titleEl: HTMLElement): void {
		Array.from(titleEl.querySelectorAll(`[${DATA_AISR}]`)).forEach((el) => el.remove());
	}

	private cancelPendingWork(): void {
		if (this.rAFId !== null) {
			window.cancelAnimationFrame(this.rAFId);
			this.rAFId = null;
		}
		this.pendingRows.clear();
	}

	private removeAllInjectedDom(): void {
		for (const leafEl of this.workspace.getLeavesOfType('search')) {
			const root = this.leafRootEl(leafEl);
			if (root) {
				Array.from(root.querySelectorAll(`[${DATA_AISR}]`)).forEach((el) => el.remove());
			}
		}
	}
}

/**
 * Build an element -> file-path map from the internal `resultDomLookup` map,
 * validating its shape. Returns null when the map is unusable (non-Element
 * keys), so callers can fall back to the basename index. Entries whose values
 * yield no file path are *skipped* (not fatal): a single odd row must not blank
 * the whole view — that's what caused same-basename rows in different folders
 * to silently lose their badges when the fallback also became ambiguous.
 *
 * Accepts keys that are `Element`s whose values yield a file path via
 * `extractFilePath` (e.g. `{ file: TFile }` or an array of such objects).
 */
export function buildElementPathMap(map: Map<unknown, unknown>): Map<Element, string> | null {
	const byElement = new Map<Element, string>();
	for (const [key, value] of map.entries()) {
		// Skip stray/sentinel keys that aren't DOM elements (Obsidian may keep a
		// non-Element entry in the map). Blanking the whole map on one such key
		// would lose Tier-1 for every row in the leaf — visible for same-basename
		// rows, which then fall to the ambiguous basename fallback and lose their
		// badges even though their real key is a perfectly good Element.
		if (!(key instanceof Element)) {
			continue;
		}
		const path = extractFilePath(value);
		if (path !== null) {
			byElement.set(key, path);
		}
	}
	return byElement;
}

/**
 * Build an element -> file-path map from the virtualized children list
 * (`view.dom.vChildren._children`). Each child is a per-file result object that
 * carries `file` (a TFile with `.path`) and `selfEl` — the rendered DOM element
 * for that row. This is the reliable row→file hook across Obsidian versions:
 * `resultDomLookup` keys are *result objects* (not DOM elements) on modern
 * builds, so they can't be keyed by element.
 *
 * Rows that don't expose a usable `.selfEl`/`.file.path` are omitted (never
 * blank the whole view). Returns null when the array shape is unusable so
 * callers fall back to the basename index.
 */
export function buildVChildrenPathMap(
	children: Array<unknown>,
): Map<Element, string> | null {
	const byElement = new Map<Element, string>();
	for (const child of children) {
		const selfEl = extractChildEl(child);
		const path = extractChildPath(child);
		if (selfEl !== null && path !== null) {
			byElement.set(selfEl, path);
		}
	}
	return byElement;
}

/** The rendered row element for a vChildren child, or null when missing. */
function extractChildEl(child: unknown): Element | null {
	const selfEl = (child as { selfEl?: unknown })?.selfEl;
	if (selfEl instanceof Element) {
		return selfEl;
	}
	// Fall back to other element-like handles if Obsidian renames them.
	const el = (child as { el?: unknown })?.el;
	return el instanceof Element ? el : null;
}

/** The file path for a vChildren child, or null when missing/invalid. */
function extractChildPath(child: unknown): string | null {
	const file = (child as { file?: { path?: unknown } })?.file;
	if (file && typeof file.path === 'string') {
		return file.path;
	}
	const result = (child as { result?: { file?: { path?: unknown } } })?.result;
	const resultFile = result?.file;
	if (resultFile && typeof resultFile.path === 'string') {
		return resultFile.path;
	}
	return null;
}

/**
 * Defensively extract a file path from a resultDomLookup value, whose shape is
 * internal and version-dependent. Handles `{ file: TFile }` and arrays of such
 * objects (match lists).
 *
 * Same-basename files in different folders appear as an array with multiple
 * distinct file paths; that is inherently ambiguous per row, so an array is
 * only accepted when every entry resolves to the *same* path (one file). This
 * keeps the never-guess invariant: never attach a badge to the wrong file.
 *
 * Returns null when unknown or ambiguous.
 */
export function extractFilePath(value: unknown): string | null {
	if (Array.isArray(value)) {
		let resolved: string | null = null;
		for (const item of value) {
			const path = extractFilePath(item);
			if (path !== null) {
				if (resolved === null) {
					resolved = path;
				} else if (resolved !== path) {
					// Multiple distinct files in one match list -> ambiguous.
					return null;
				}
			}
		}
		return resolved;
	}
	if (value && typeof value === 'object') {
		const file = (value as { file?: { path?: unknown } }).file;
		if (file && typeof file.path === 'string') {
			return file.path;
		}
	}
	return null;
}
