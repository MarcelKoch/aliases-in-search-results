# Community submission self-review — Obsidian plugin guidelines

This file records the review pass done before submitting to
[`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases),
run against the official
[plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
The same checklist is pasted into the GitHub PR description on submission.

## Guideline checklist

### No Node APIs where an Obsidian API exists

- [x] **Verified.** All source under `src/` uses only the official `obsidian`
  API (`Plugin`, `PluginSettingTab`, `Setting`, `MetadataCache`, `Vault`,
  `Workspace`, `TFile`) plus browser DOM APIs. No `node:` built-ins are imported.
  The search adapter reads Search-view internals *only* defensively
  (`src/searchAdapter.ts`), with shape-checks and a graceful fallback —
  there is no corresponding public Obsidian API to use instead.

### No network calls

- [x] **Verified.** `grep` over `src/` finds no `fetch`, `XMLHttpRequest`,
  `navigator.sendBeacon`, WebSocket, or any HTTP client. The plugin is fully
  offline. (The `Release` GitHub Action — not runtime code — talks to GitHub.)

### No console spam / logging on every event

- [x] **Verified.** `grep "console\."` over `src/` returns nothing. The plugin
  logs nothing at load, on each search, or on each row render.

### Clean unload — no residue, no leaked DOM

- [x] **Verified.** `SearchAdapter.detach()`:
  - removes every `[data-aisr]` element (`removeAllInjectedDom`),
  - disconnects each per-leaf `MutationObserver` and `IntersectionObserver`,
  - cancels the rebind `setTimeout` and pending `requestAnimationFrame`,
  - clears the pending-row set and both `WeakMap`s.
  - It is registered through `this.register(() => this.adapter.detach())` so
    Obsidian runs it on disable/unload/reload.
  - Manual QA (Phases 3–5) confirmed disable → all injected DOM gone; re-enable →
    badges return; reload with plugin enabled → no errors, no duplicates.

### `isDesktopOnly` is correct

- [x] **Verified.** `manifest.json` has `"isDesktopOnly": false`. The plugin
  works on mobile (narrow-pane/mobile CSS included; no desktop-only Node APIs).

### No global styling leaks; theme-safe

- [x] **Verified.** `styles.css` uses only `aisr-*`-namespaced classes and Obsidian
  CSS variables (`--text-muted`, `--background-modifier-hover`, etc.) — no
  hardcoded colors — so it adapts to light/dark and community themes. Manual QA
  confirmed light, dark, and a community theme, plus narrow-pane/mobile.

### No direct DOM manipulation that breaks other plugins

- [x] **Verified.** Badges are inserted at a well-defined point
  (`.tree-item-inner` → `.tree-item-flair-outer`) using a scoped
  `data-aisr` marker and are idempotent (re-processing removes then re-adds its
  own container only). No global event listeners are added that would conflict.

### Works with the app's own restrictions (CSP, offscreen, etc.)

- [x] **Verified.** No `eval`/`new Function`, no remote asset loading, no
  `require` of anything not bundled. esbuild bundles everything, leaving only
  `obsidian`/`electron`/CodeMirror externals.

### Performance

- [x] **Verified.** Work is rAF-batched; the zero-alias early exit is O(1); the
  1000-result resolution hot path measures well under a 16 ms frame (Phase 5
  tests). No forced synchronous layout — styles are applied in the same frame as
  render; no layout reads that trigger reflow.

## Not-covered-by-reviewer notes

- The only fragile part is `src/searchAdapter.ts` reading private `vChildren`
  internals. Reviewers checking "no use of internals" should note this is
  *necessary* because Search has no official customization API; it is isolated,
  shape-checked, degrades silently, and is documented in `README.md` under
  "Compatibility note (fragile internals)".
- Screenshots referenced in `README.md` are placeholders and must be added
  before the first public release (see the release checklist).

## Recording

This self-review is captured as the PR description checklist when submitting to
`obsidianmd/obsidian-releases`, and in this document in-repo.
