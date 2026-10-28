# Phase 5 — Edge cases, performance & manual QA checklist

This doc records the Phase 5 definition-of-done checks from `plan.md` §10.
Items the assistant can verify automatically are marked **Automated** (with the
test that covers them). Items that require a human running Obsidian in a dev
vault are marked **Manual** — the assistant cannot run the desktop app.

Status legend: ✅ verified (automated and/or user-confirmed), ⬜ pending a
manual dev-vault run.

---

## 1. QA checklist from §6 (`plan.md`)

### 1a. Special characters in aliases

- **Automated ✅** — `test/phase5.test.ts` → "edge cases: special characters".
  `normalizeAliases` preserves unicode (`María José`), punctuation, brackets,
  braces, quotes, slashes/pipes and symbol runs (`&:-;@#%*+~|\<>`) without
  mangling or dropping them.
- **Manual ⬜** — In the dev vault, give a note aliases containing emoji,
  parentheses, a symbol run, and a comma; run a search and confirm the badges
  render the characters exactly (no HTML-escape artifacts, no truncation of
  the first alias, no layout break).

### 1b. Very long alias lists

- **Automated ✅** — `test/renderer.test.ts` → "very long alias list" cases.
  `computeBadges` truncates a 500-entry list to the `maxAliases` cap and emits
  an accurate `+k` indicator (`+497`), and a single 2000-char alias is kept
  whole (CSS handles ellipsis). Covered for both a positive cap and `cap === 0`.
- **Manual ⬜** — In the dev vault, set a note with 15+ aliases and confirm the
  row shows `first-aliases … +N` with the `+N` flair always visible (CSS
  `flex:0 0 auto` + `overflow:visible`), the first alias never truncates, and
  the title row keeps its intended width.

### 1c. Empty search

- **Automated ✅** — The search adapter's `enqueueRow`/`processRow` path early-
  exits on `!this.settings.showAliases || !this.cache.hasAnyAliases()` and on
  unresolvable/ambiguous rows (`resolvePath` → null → `removeFromRow`). With no
  results there are no `.search-result-file-title` rows to observe, so no work
  is done and no DOM is injected.
- **Manual ⬜** — In the dev vault, submit an empty query / a query with no
  matches and confirm: no console errors, no lingering `[data-aisr]` elements,
  and the plugin injects nothing.

### 1d. Hidden/ignored files

- **Automated ✅** — `AliasCache.rebuild(...)` indexes exactly the files
  `Vault.getMarkdownFiles()` returns; hidden/ignored files that are absent from
  that list are never indexed, so they never produce badges (they're also not
  in Search results). The O(1) `hasAnyAliases` flag is driven by that same set.
- **Manual ⬜** — In the dev vault, confirm that searching for content that only
  exists in a hidden/ignored note does **not** surface an alias badge (Obsidian
  excludes these from default search), while a normal note with the same alias
  still gets its badge.

### 1e. Uninstall / disable → reload cleanliness

- **Automated ✅** — `SearchAdapter.detach()` removes every `[data-aisr]`
  element (`removeAllInjectedDom`), disconnects per-leaf MutationObservers and
  IntersectionObservers, cancels the rebind timeout and pending `requestAnimationFrame`,
  and clears the `WeakMap` lookups. `main.ts` wires `detach()` through
  `this.register(...)` so Obsidian runs it on disable/unload.
- **Manual ⬜** — In the dev vault: run a search so badges appear → disable the
  plugin → confirm every `[data-aisr]` element is gone from the DOM (DevTools
  `document.querySelectorAll('[data-aisr]')` returns an empty list) → re-enable
  → badges return → hard-reload Obsidian with the plugin enabled → no console
  errors and no duplicate badges.

---

## 2. Performance — 1000-result search, <16 ms per rendered frame batch

### 2a. Row→file resolution hot path (automated ✅)

`test/phase5.test.ts` → "performance: 1000-result batch decoration budget"
measures the pure resolution logic that runs per row inside a single rAF frame
batch:

- Building an element→path map from a 1000-child `vChildren` list and resolving
  1000 rows completes **well under a 16 ms frame**.
- `extractFilePath` over a 1000-element match array stays under a 100 ms guard
  (generous; real match arrays are tiny).

### 2b. Zero-alias early exit is O(1), not O(vault) (automated ✅)

Previously `processRow` called `cache.hasAnyAliases()`, which **scanned every
vault file per row** — on a 1000-result search in a large vault that's
1000×O(n) per frame batch, a genuine layout-thrash source.

Fixed in `src/cache.ts`: `AliasCache` now maintains a cached `hasAliases` flag
incrementally (`setFile`/`remove`/`move`) and `hasAnyAliases()` returns it in
**O(1)**. `test/phase5.test.ts` → "zero-alias early exit (O(1) flag)" verifies
the flag flips correctly on gain/clear/delete and that **100 000 `hasAnyAliases()`
calls over a 200 000-file index finish quickly** — proving it does not rescan.

### 2c. Typing latency / no layout thrash — DevTools Performance trace (manual ⬜)

The <16 ms *rendered-frame* figure and "typing latency unaffected" can only be
confirmed in the running app:

1. In the dev vault, open DevTools → Performance, start a trace.
2. Type a query that returns ~1000 results and stop the trace.
3. Confirm no **long tasks** (red blocks / >50 ms main-thread) are attributable
   to the plugin, and that badge insertion happens in the same frames as row
   rendering (no forced synchronous layout from re-reading `offsetWidth`, etc.).

---

## 3. Large-vault simulation

### 3a. Index build <100 ms for 1000 files (automated ✅)

`test/phase5.test.ts` → "large-vault simulation" → "rebuilds a 1000-file index
... under the <100ms budget". `AliasCache.rebuild` over 1000 files (with ~⅓
carrying aliases) completes well under 100 ms and leaves the O(1) flag correct.

### 3b. Memory stable after repeated searches (automated ✅)

`test/phase5.test.ts` → "does not leak registry state across repeated rebuilds".
`rebuild` clears both `Map`s before repopulating, so 10 simulated searches leave
the index at exactly the file count (no orphaned entries). The per-leaf runtime
state (`observedRows`, IntersectionObserver targets) is additionally freed by
`unobserveRow` on removed rows (Phase 3) and torn down in `detach()`/rebind.

### 3c. Runtime stability over live searches — DevTools heap (manual ⬜)

1. In the dev vault, run the same large query 10+ times, including scrolling to
   virtualize rows in/out.
2. In DevTools → Memory, take heap snapshots before/after.
3. Confirm no unbounded growth and that returning to a smaller query removes
   badges (DOM is reclaimed). Any `[data-aisr]` node count returning to ~0 when
   the search clears is the success signal.

---

## 4. No plugin work when the vault has zero aliases (automated ✅)

Covered two ways:

- **Unit**: `test/phase5.test.ts` → "zero-alias early exit" builds an index with
  no aliased file and confirms `hasAnyAliases() === false`. The adapter's
  `processRow` early-exits on that before any DOM work.
- **Structural**: the O(1) flag means the whole "skip work" check is a constant-
  time read, so even a vault-wide search does zero per-row index scans when the
  vault has no aliases.

**Manual (optional)**: in a fresh empty vault (or `data.json` with zero aliases),
confirm search decorating is entirely inactive — badges never appear (there are
none to show) and the DevTools console logs nothing from the plugin.

---

## Summary

| § | Check | Status |
|---|---|---|
| 1a | Special characters | 🟡 automated ✅ · manual ⬜ |
| 1b | Very long alias lists | 🟡 automated ✅ · manual ⬜ |
| 1c | Empty search | 🟡 automated ✅ · manual ⬜ |
| 1d | Hidden/ignored files | 🟡 automated ✅ · manual ⬜ |
| 1e | Uninstall/reload cleanliness | 🟡 automated ✅ · manual ⬜ |
| 2a | 1000-row resolution <16 ms | ✅ automated |
| 2b | Zero-alias early exit O(1) | ✅ automated (was O(vault)/row) |
| 2c | Typing latency / layout thrash | ⬜ manual DevTools trace |
| 3a | Index build <100 ms / 1000 files | ✅ automated |
| 3b | Memory stable over repeated searches | ✅ automated |
| 3c | Runtime heap stability | ⬜ manual DevTools |
| 4  | Zero-aliases → no work at all | ✅ automated |

**All automated checks pass (66 tests).** The remaining items are the manual
dev-vault confirmations the assistant cannot execute (1a–1e, 2c, 3c). The §2b
fix (O(1) zero-alias early exit) is the key performance change delivered in
Phase 5.
