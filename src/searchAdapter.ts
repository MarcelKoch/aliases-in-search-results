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
	};
	resultDomLookup?: unknown;
	getViewType?: () => string;
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

export class SearchAdapter {
	private settings: AliasesInSearchResultsSettings;
	private bound = new Set<BoundLeaf>();
	private layoutChangeRef: ReturnType<Workspace['on']> | null = null;
	private rebindTimer: number | null = null;
	private rAFId: number | null = null;
	private pendingRows = new Set<HTMLElement>();

	// Cache of validated tier-1 (resultDomLookup) lookups per leaf container.
	private tier1Lookup = new WeakMap<HTMLElement, PathLookup>();

	constructor(
		private readonly workspace: Workspace,
		private readonly cache: AliasCache,
		settings: AliasesInSearchResultsSettings,
	) {
		this.settings = settings;
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
			for (const mutation of mutations) {
				if (mutation.type !== 'childList') {
					continue;
				}
				for (const node of Array.from(mutation.addedNodes)) {
					if (!node.instanceOf(HTMLElement)) {
						continue;
					}
					if (node.matches(ROW_SELECTOR)) {
						observeRow(node);
					} else {
						Array.from(node.querySelectorAll(ROW_SELECTOR)).forEach((row) =>
							observeRow(row as HTMLElement),
						);
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
		});
		mutationObserver.observe(rootEl, { childList: true, subtree: true });

		this.tier1Lookup.set(rootEl, this.makeTier1Lookup(view));

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

	// --------------------------------------------------- tier 1: resultDomLookup
	private makeTier1Lookup(view: View): PathLookup {
		const internals = view as unknown as SearchViewInternals;
		const map = internals.dom?.resultDomLookup ?? internals.resultDomLookup;
		if (!(map instanceof Map)) {
			return { resolve: () => null };
		}

		const byElement = buildElementPathMap(map);
		if (byElement === null) {
			return { resolve: () => null };
		}

		return {
			resolve(titleEl: HTMLElement): string | null {
				const direct = byElement.get(titleEl);
				if (direct !== undefined) {
					return direct;
				}
				// The key may be the row root (.tree-item) rather than the title el.
				const parent = titleEl.parentElement;
				if (parent) {
					const viaParent = byElement.get(parent);
					if (viaParent !== undefined) {
						return viaParent;
					}
				}
				return null;
			},
		};
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
		renderAliases(titleEl, aliases, this.settings);
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
 * validating its shape. Returns null when the shape is unusable (so callers can
 * fall back to the basename index rather than throw). Exported for unit tests
 * of the shape-check accept/reject paths.
 *
 * Accepts keys that are `Element`s whose values yield a file path via
 * `extractFilePath` (e.g. `{ file: TFile }` or an array of such objects).
 */
export function buildElementPathMap(map: Map<unknown, unknown>): Map<Element, string> | null {
	const byElement = new Map<Element, string>();
	for (const [key, value] of map.entries()) {
		if (!(key instanceof Element)) {
			return null;
		}
		const path = extractFilePath(value);
		if (path === null) {
			return null;
		}
		byElement.set(key, path);
	}
	return byElement;
}

/**
 * Defensively extract a file path from a resultDomLookup value, whose shape is
 * internal and version-dependent. Handles `{ file: TFile }`, arrays of such
 * objects (match lists), and single-item wrappers. Returns null when unknown.
 */
export function extractFilePath(value: unknown): string | null {
	if (Array.isArray(value)) {
		for (const item of value) {
			const path = extractFilePath(item);
			if (path !== null) {
				return path;
			}
		}
		return null;
	}
	if (value && typeof value === 'object') {
		const file = (value as { file?: { path?: unknown } }).file;
		if (file && typeof file.path === 'string') {
			return file.path;
		}
	}
	return null;
}
