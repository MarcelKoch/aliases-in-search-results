# Phase 0 — Search View Internals Spike (Findings)

Status: **Complete.** DevTools verification rounds 1–2 (user-run) closed all open items — see §9.

Sources analyzed:

- User-provided HTML snapshot of the search pane (single pane + single result), Obsidian ~1.x, **mobile/tablet layout** (drawer vault switcher present).
- Source of the shipped community plugin `obsidian-style-tags-in-search-results` (fanis), a close analog that decorates the core Search DOM. Confirms production-viable techniques: per-leaf MutationObserver + IntersectionObserver, rAF batching, row signatures, clean revert on unload.
- Community forum/dev references confirming `SearchView.resultDomLookup` is a real internal member (member names are preserved in `app.js` despite minification).
- **DevTools verification round 1 (user-run)**: `resultDomLookup` is NOT on the view itself in this Obsidian version (view class is minified, method names preserved: `getQuery`, `startSearch`, `setSortOrder`, `renderSearchInfo`, …). The view exposes own fields `searchContainerEl`, `dom`, `searchComponent`, `searchParamsContainerEl`, …
- **DevTools verification round 2 (user-run)**: `view.dom.resultDomLookup` **exists and is a `Map`** — size 3, exactly matching the 3 results of the visible search. `view.dom` also exposes: `infinityScroll` (virtualized infinite scroll: `rootMargin`, `renderBlockSize`, `lastScroll`, `scrollEl` — confirms lazy row rendering), `vChildren` (`_children` — virtual children list), `childrenEl` (results container element), `emptyStateEl`, `sortOrder`, `collapseAll`. `view.searchComponent` is just the input component (irrelevant).

---

## 1. Confirmed DOM structure

```
.workspace-leaf-content[data-type="search"]
└─ .search-row                       (input, settings)
├─ .search-info-container         (hidden)
├─ .search-params                 (hidden)
├─ .search-results-info           (result count + sort dropdown)
└─ .search-result-container.mod-global-search        ← stable results root
   └─ .search-results-children
      └─ .tree-item.search-result                      ← one per file
         ├─ .tree-item-self.search-result-file-title   ← TITLE ROW (injection point)
         │  ├─ .tree-item-icon.collapse-icon           (expand arrow)
         │  ├─ .tree-item-inner                        (title text = file basename only)
         │  └─ .tree-item-flair-outer > .tree-item-flair  (match count, right-aligned)
         └─ .search-result-file-matches
            └─ .search-result-file-match               (one per matched line)
               └─ .search-result-file-matched-text     (query highlight span)
```

### Implications

| Fact | Implication for the plugin |
|---|---|
| `.tree-item-inner` contains **only the basename** — no path, no extension, no `data-*` attribute anywhere in the result tree | The DOM alone is **insufficient** to resolve a result row to a `TFile` unambiguously (duplicate basenames exist). See §3. |
| Title row is a flex container ending with a right-aligned `.tree-item-flair-outer` | Best injection point: insert our badge element **between `.tree-item-inner` and `.tree-item-flair-outer`** — aliases appear right after the title, before the match count, with zero layout hacking. |
| `.tree-item-flair` (match count) is the only existing "extra" on the title row | Confirms Obsidian itself adds flair elements there; a badge element is stylistically native. |
| Results live under `.search-result-container.mod-global-search` | Stable, class-based root selector for observation. |
| The pane HTML also contains hidden sibling leaves with `data-type="undefined"` | Always scope queries to the leaf content element (`[data-type="search"]`), **never** `document.querySelector` — must not touch other panes. |
| Placeholder divs (`width:1px`) inside the results tree + stisr's shipped IntersectionObserver logic | **Results are lazily/virtually rendered** — rows appear on scroll and are fully re-rendered on query change. A one-shot scan is not enough; we need continuous observation. |
| Search **re-renders rows on query change instead of mutating text in place** (confirmed by stisr's "row signature" comments) | `childList` MutationObserver is sufficient — no `characterData`/`subtree` text watching needed. |
| HTML is from a mobile layout (`.workspace-drawer-vault-switcher`) | Plugin must work on mobile → `manifest.isDesktopOnly: false`; avoid `window`-only assumptions, but MutationObserver/IntersectionObserver/rAF are all available in the mobile app (stisr ships this on mobile too). |
| `draggable="true"` on the title row (Obsidian sets the drag payload at dragstart) | Not a usable path-source. Ignore. |

## 2. Injection point decision (for `renderer.ts`)

Append into `.tree-item-self.search-result-file-title`:

```
[▾ collapse-icon] [Title text] [ [alias1] [alias2] ] [1] ← existing flair
                              ^^^^^^^^^^^^^^^^^ our badge container here
```

- Marker: `class="aisr-badge-container"`, plus `data-aisr="1"` attribute for idempotent cleanup/re-scan.
- Badge element: `<span class="tree-item-flair aisr-badge">alias</span>` — reusing `tree-item-flair` gives native styling; the outer container is ours.
- Truncation: show N aliases, then `+k` flair.
- All styling via Obsidian CSS variables (`--text-muted`, `--text-faint`, `--background-modifier-hover`, `--radius-s`) → theme-safe in light/dark, no global leakage, namespaced `aisr-*` prefix.

## 3. Mapping a result row → file (the core problem)

Ranked strategies for `searchAdapter.ts`:

1. **Primary — `view.dom.resultDomLookup` (internal, unofficial, CONFIRMED PRESENT).**
   `leaf.view.dom.resultDomLookup` is a `Map` maintained by the search DOM manager (`view.dom`) mapping result DOM elements → result objects carrying the `TFile`. DevTools confirmed: `Map`, size matching the number of visible results.
   - **Key/value shape still unconfirmed at time of writing** (which element is the key; whether the value is `{file}` or a match list). The adapter therefore resolves **defensively at runtime**: iterate entries, require `key instanceof Element`, and extract the file by checking for `.file` / first entry with a `File`-like value (`.path`) on the value or its items. If a shape check fails, the whole map is treated as unavailable (fall through to Tier 2). This "shape-check once per view" pattern makes the plugin version-tolerant.
   - **Access helper**: find the map via `view.dom?.resultDomLookup ?? view.resultDomLookup` — it moved from `view` to `view.dom` between versions, so probe both (this exact move is why a defensive accessor, not a hard reference, is required).
2. **Fallback — basename uniqueness index (official API only).**
   Build `Map<basename, TFile[]>` from `app.metadataCache` on `resolved`. For a row, take `.tree-item-inner` text (= basename):
   - exactly 1 candidate → resolve;
   - 0 candidates → hidden/ignore-file result, skip;
   - >1 candidates → **skip the badge for that row** (never guess wrong).
   Cost: one index rebuild + `metadataCache` event updates; lookup is O(1).
   - **Scope decision (user)**: duplicated timestamp-style basenames in the user's vault (36 pairs) are **out of scope** — no special disambiguation (no sort-order correlation, no union display). Ambiguous rows simply get no badge.
3. **Never-guess rule.** If both strategies fail for a row, render no badge. A wrong alias on a row is worse than no alias.

Tier 2 must be fully functional on its own — the plugin ships even if Tier 1's internals break.

## 4. Observation strategy (for `searchAdapter.ts`)

Validated pattern (from the shipped stisr plugin) + confirmed internals, per **open search leaf**:

- Bind to `leaf.view.containerEl` (→ `.workspace-leaf-content[data-type="search"]`), one `MutationObserver` (`childList: true, subtree: true`).
  - Added node **is or contains** the results container → treat as container swap → full scan.
  - Added node is/contains `.tree-item.search-result` rows → enqueue those rows.
- `IntersectionObserver` (rootMargin ~128px) to catch rows revealed by scrolling/virtualization that MutationObserver may already have missed. Virtualization is now **confirmed by internals**: `view.dom.infinityScroll` (with `renderBlockSize`, `rootMargin`, `scrollEl`) — rows are rendered lazily in blocks as the user scrolls.
- rAF-batched work queue (process at most once per frame) + `WeakMap` row signatures to skip already-decorated rows cheaply.
- Rebind on `workspace.on("layout-change")` (debounced) — leaves open/close, panes get re-parented.
- Debounce bursts; skip everything when the plugin is disabled in settings or no alias exists in the vault (early-exit keeps large searches at zero overhead).
- Alternative root for observation: `view.dom.childrenEl` (results container element per internals) — use it when available, else fall back to class-based lookup.

## 5. Cleanup / unload contract

- `onunload()`: remove every `[data-aisr]` element under each search leaf content, disconnect all observers, cancel pending rAF/timeout, detach event registrations (Obsidian auto-disposes `registerEvent`/`registerDomEvent`; the DOM revert is done explicitly like stisr's `_revertAllSearchLeaves`).
- Idempotent decoration: before inserting, drop any existing `[data-aisr]` in the row (handles re-scan after query changes reusing rows).

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Internals move between versions (**observed**: `resultDomLookup` lives on `view.dom` now, on `view` per older references) | Defensive accessor probes `view.dom?.resultDomLookup ?? view.resultDomLookup`; all internals access confined to `searchAdapter.ts` |
| `resultDomLookup` key/value shape changes | One-time per-view shape check (key is Element, value yields a file); on failure treat as unavailable → Tier 2 basename fallback |
| Duplicate basenames (36 timestamp pairs in user vault — out of scope per user decision) | Skip badge for ambiguous rows; no special handling |
| Virtualization flicker (badges appear late on fast scroll) | IO rootMargin pre-wrap (same knob stisr ships as "wrap ahead px") |
| Conflicts with other search-modifying plugins (e.g., stisr) | We only append our own namespaced child to the title row and never unwrap/modify Obsidian's nodes; no text-node surgery needed (unlike stisr) — conflict surface is minimal |
| Mobile perf | rAF batching + early exit when vault has no aliases |

## 7. Design consequences for the module plan

- `searchAdapter.ts`: owns leaf discovery, observers, row→file resolution (both strategies), queues.
- `renderer.ts`: pure DOM-building given `(titleEl, aliases, settings)`; idempotent, no Obsidian-internal knowledge.
- `cache.ts`/`aliasResolver.ts`: unchanged from plan; additionally expose a `basenameIndex` for the fallback strategy.

## 8. What Phase 0 does **not** need

No monkey-patching of `SearchView.prototype` methods appears necessary — DOM observation + `resultDomLookup` + basename fallback covers all needs. Prototype patching stays a documented last resort only.

## 9. DevTools verification status

Round 1 + 2 (user-run, from `scripts/phase0-devtools-verify.js` + a follow-up probe of `view.dom`/`view.searchComponent`) have **closed the spike**:

1. ✅ `resultDomLookup` exists — at `view.dom.resultDomLookup` (`Map`, size = number of results).
2. ⏳ Key/value element type not yet dumped — resolved by the runtime shape-check in the adapter (§3.1); optional one-liner to close it: `const m = app.workspace.getLeavesOfType("search")[0].view.dom.resultDomLookup; for (const [k,v] of m) console.log(k?.className, v);`
3. ✅ Virtualization confirmed via `view.dom.infinityScroll` (`renderBlockSize`, `rootMargin`).
4. ✅ Basename uniqueness measured: 1012 files / 976 unique / 36 duplicated (timestamp-style, out of scope per user decision).
5. ✅ Injection point injected successfully into the flex title row (test badge between title and match count).

**Phase 0 is complete.** Implementation can proceed per the design in §2–§5.
