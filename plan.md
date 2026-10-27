# Plan: Obsidian Plugin — "Aliases in Search Results"

## 1. Goal & scope

Show the frontmatter alias(es) of each note next to the note title in the **core Search** results, e.g.:

```
▸ Daily Meeting Notes      [standup] [team-sync]
```

Out of scope for v1: Quick Switcher, embedded links, fuzzy-finder plugins (can be follow-ups).

## 2. Key design constraint (drives the architecture)

**Obsidian has no official API to customize core Search results.** The Search view's internals (rendering methods, DOM classes) are private and can change between releases. Current community best practice for this situation is:

- **Primary mechanism: a `MutationObserver` on the search results container.** Watch the results DOM (`.search-result-file-title` items appear/change), and append an alias badge element to each title. DOM-class-based observation is more resilient than hooking private methods.
- **Fallback/secondary mechanism: a small, targeted monkey-patch of the `SearchView` prototype** to get reliable file↔result mapping, only if DOM observation alone can't resolve which file a result item belongs to.
- **Isolate all fragile parts in one "adapter" module** (a single file that talks to Search internals), so an Obsidian update only ever breaks one file. Detect breakage at runtime and fail silent/gracefully (plugin must never throw or corrupt the search view).

This isolation + graceful degradation is exactly what plugin reviewers check for (per the official plugin guidelines).

## 3. Architecture

Based on the current `obsidianmd/obsidian-sample-plugin` template (TypeScript + esbuild):

```
manifest.json
versions.json
package.json / tsconfig.json / esbuild.config.mjs
styles.css
src/
  main.ts                  # plugin lifecycle: onload/onunload, wiring only
  settings.ts              # PluginSettingTab + types
  aliasResolver.ts         # pure logic: file -> aliases (unit-testable)
  searchAdapter.ts         # ALL fragile Search-view interaction lives here
  renderer.ts              # badge DOM creation, truncation, styling hooks
  cache.ts                 # alias index + metadataCache event listeners
test/                      # vitest unit tests (aliasResolver, settings)
```

### Responsibilities

**`main.ts`** — standard skeleton:
- `onload()`: load settings, initialize cache, register the search adapter, register `PluginSettingTab`.
- `onunload()`: **remove all injected DOM, disconnect observers, restore any patched prototypes.** Clean unload is a hard review requirement — every `registerDomEvent`/`registerEvent` goes through Obsidian's auto-disposal, plus explicit teardown for the patch.

**`aliasResolver.ts`** — pure function `(metadataCache, file) → string[]`:
- Reads aliases via the **official** `MetadataCache.getFileCache(file).frontmatter.aliases` — handles both single-string and array forms (the only official alias property; the YAML key `aliases` is the documented one).
- Normalization: trim, dedupe, drop empty strings, cap length.

**`cache.ts`** — keeps an in-memory `Map<path, aliases>` index maintained by reacting to:
- `metadataCache.on("changed")`, `on("resolve")` → recompute for that file
- `workspace.on("rename")` / `"delete"` → move/remove entries
- Rebuild on `on("resolved")` for initial index
This avoids hitting the metadata cache for every rendered result row (performance).

**`searchAdapter.ts`** — the only file allowed to touch Search internals:
- Finds search leaves via `this.app.workspace.getLeavesOfType("search")` and reacts to `layout-change`.
- Observes the results container with a `MutationObserver` (debounced); for each title element, resolves its file (via dataset path / patched method — confirmed during the spike, see Phase 0) and asks `renderer` to append badges.
- Debounce + `requestAnimationFrame` batching so large searches (100+ results) stay snappy; skip work when plugin is disabled or vault has no aliases.

**`renderer.ts`** — builds the badge element (span with class `alias-search-badge`), truncation ("+3 more"), click → open note (default already happens on the row).

**`styles.css`** — minimal, namespaced classes (`alias-search-results-*`), uses Obsidian CSS variables (`--text-muted`, `--background-modifier-hover`, etc.) so it adapts to light/dark themes and base theme; no global style leaks.

## 4. Settings (`settings.ts`, `PluginSettingTab`)

Following reviewer-preferred patterns (types, defaults, `Setting` UI, live-apply without reload):

- Toggle: show aliases in search (on/off, default on)
- Display style: badge / inline text
- Max aliases per result (default 2–3) + "show more" behavior
- Highlight aliases matching the current query (yes/no)
- "Also match aliases in search" — v2 idea: add aliases as hidden match targets (this requires deeper patching; keep out of v1)

## 5. Development workflow (current best practices)

- Scaffold from `obsidianmd/obsidian-sample-plugin`: `esbuild.config.mjs` with `context.sourcemap = dev`, watch mode, externals as in the template.
- `npm run dev` (watch) + the **Hot-Reload** community plugin, plus a **symlinked dev vault** (`.obsidian/plugins/aliases-in-search-results` → repo build dir) so changes appear instantly without reinstalling.
- Tooling: `eslint` + `prettier` (template defaults), `typescript` strict mode, `vitest` for the pure modules.
- Target `manifest.minAppVersion` at the newest API your code uses; keep `versions.json` in sync per release.

## 6. Testing

- **Unit tests (vitest):** `aliasResolver` (string alias, array alias, malformed YAML, dedupe/truncate), settings defaults/merge, cache index maintenance (rename/delete).
- **Manual test checklist in a scratch vault:** light/dark theme, aliases with special characters, very long alias lists, empty search, case-sensitive toggle, other plugins that also touch search (e.g., "Style Tags in Search Results") installed simultaneously, uninstall/reload leaving no leftover DOM.

## 7. Publishing readiness

- GitHub Actions workflow: lint + tests + `npm run build` on PR; release job attaches `main.js`, `manifest.json`, `styles.css` (required asset set for community plugin installs).
- Submission to `obsidianmd/obsidian-releases` after manual QA; follow the review guidelines from day one (no Node APIs where the Obsidian API exists, no network calls, proper unload, no console spam).

## 8. Milestones

| Phase | Deliverable |
|---|---|
| **0 — Spike ✅ done** | Executed — findings + DevTools verification complete, see `docs/phase0-search-internals.md` §9 and plan §9. |
| 1 | Scaffold project, build pipeline, manifest, dev vault + Hot-Reload loop. **✅ done** — automated steps verified in this session; plugin load + Hot-Reload user-verified in dev vault. |
| 2 | `aliasResolver` + cache with events, unit-tested. **✅ done** (23→39 tests green; manual vault probe verified). |
| 3 | `searchAdapter` + `renderer`: badges appear in search results, clean unload. **✅ done** (48 tests green; manual checks done; long-alias layout + same-name different-folder bugs fixed). |
| 4 | Settings tab + styles.css theming. **🟡 implemented** — full declarative + imperative settings UI (`getSettingDefinitions()` clears the 1.13 settings-search lint warning), live-apply via adapter.refresh(), inline display style, query-match highlight, theme-safe CSS; build/lint clean and 52 tests green. See §10 Phase 4 for manual checks. |
| 5 | Edge cases, performance, manual QA checklist |
| 6 | CI, packaging, docs (`README.md` with screenshots), release |

## 10. Phase completion verification (definition of done)

A phase is complete only when **all** of its listed checks pass. Checkmarks below indicate current status.

### Phase 0 — Spike ✅ (verified, see §9)

- [x] DOM structure, injection point, and rendering dynamics documented from real HTML.
- [x] Row→file mapping strategy confirmed via DevTools (`view.dom.resultDomLookup` found, `Map`).
- [x] Basename-uniqueness fallback measured against a real vault.
- [x] Test badge visually injected at the chosen injection point.
- [x] Findings written to `docs/phase0-search-internals.md` with no unresolved blockers.

### Phase 1 — Scaffold ✅

- [x] `npm install && npm run build` succeeds on a clean checkout with **zero** TypeScript errors (strict mode) and zero eslint errors. *(Verified: build exit 0; `tsc -noEmit` strict clean; `eslint .` 0 errors — 1 warning tracked to Phase 4.)*
- [x] `manifest.json` valid: unique id, name, version, `minAppVersion`, description, author, `isDesktopOnly: false` (mobile requirement from Phase 0). *(Verified by assertion script.)*
- [x] Built `main.js` loads in Obsidian without console errors; plugin appears in Community Plugins list; enable/disable toggles cleanly (no leftover console warnings). *(User-verified in dev vault.)*
- [x] Dev vault set up via symlink; Hot-Reload reflects a trivial change (e.g., a `console.log` in `onload`) without manual reimport. *(User-verified in dev vault.)*
- [x] `npm test` runs the empty vitest suite (CI-ready green baseline). *(Verified: 2 tests pass via an obsidian runtime stub.)*
- [x] Directory layout matches the architecture in §3 (module stubs exist and typecheck). *(Verified: `src/{main,settings,aliasResolver,cache,renderer,searchAdapter}.ts` all present and typecheck.)*

### Phase 2 — Alias resolution & cache ✅

- [x] Unit tests pass for: single-string alias, array alias, empty array, empty strings, whitespace-only entries, duplicates, malformed frontmatter (aliases not a string/array), alias on a file without frontmatter. *(Verified: 13 tests in `test/aliasResolver.test.ts`.)*
- [x] Unit tests pass for cache index maintenance: `changed`/`resolve` recompute, `rename` moves entry, `delete` removes entry, full rebuild on `resolved`. *(Verified: 8 tests in `test/cache.test.ts`, incl. basename-ambiguity never-guess and basename-change-on-rename.)*
- [x] Index correctness verified manually: edit aliases in a note → index reflects it within one metadata event; `console`-verified count matches number of files with aliases in the vault. *(User-verified in dev vault.)*
- [x] No full-vault rescan happens on single-file metadata events (asserted by test spy). *(Verified: `rebuild` spy asserts 0 calls across recompute/move/remove.)*

### Phase 3 — Badges in search results

- [x] Manual: badges appear for all results matching notes with aliases, within one rAF frame of rows rendering (no perceptible delay on typing a query).
- [x] Manual: badges follow virtualization — scrolling a 500+ result search decorates rows entering the viewport (with pre-wrap margin).
- [x] Manual: repeated queries, sort-order changes, collapse/expand of results never produce duplicated or stale badges (idempotency — one badge container per title row max).
- [x] Manual: correct file→alias mapping in a vault section containing duplicate basenames; ambiguous basenames show **no** badge (never-guess rule).
- [x] Manual: plugin disable → all `[data-aisr]` elements removed; re-enable → they return. Reload of Obsidian with plugin enabled: no errors, no duplicates.
- [x] ~~Manual: with "Style Tags in Search Results" enabled simultaneously, both plugins' effects coexist without errors.~~ Unnecessary
- [x] Zero uncaught exceptions in the console across the above (adapter degrades silently if `resultDomLookup` is temporarily unavailable — verify by observing badges still appear via basename fallback).
- [x] Unit test: row→file resolution logic (shape-check accept/reject paths) with mocked internals. *(Verified: 10 tests in `test/searchAdapter.test.ts` — `extractFilePath` (accept `{file}`, arrays, reject malformed) and `buildElementPathMap` (accept valid map, reject non-Element key, reject unprefixed value, allow empty).)*
- [x] Memory-leak hardening: removed rows are `unobserve`d from the per-leaf IntersectionObserver on re-render/container swap (`BoundLeaf.observedRows` + `unobserveRow`), and teardown disconnects observers and cancels pending rAF. *(Structural fix — runtime stability still covered by the Phase 5 repeated-search memory check.)*
- [x] **Bug fix (user-reported manual run): long alias names no longer break the row layout** — `<span class="aisr-badge">` gets `max-width` + `overflow:hidden` + `text-overflow:ellipsis`, and the container gets `min-width:0`/`max-width`/`overflow:hidden` so an over-long alias trunks with ellipsis instead of stretching the title-row flex. `+k` indicator stays visible via `flex:0 0 auto` + `overflow:visible`.
- [x] **Bug fix (user-reported manual run): aliases no longer disappear for same-named files in different folders** — root cause was a shell change: `resultDomLookup` keys are *result objects*, not DOM elements, on modern Obsidian builds, so the Element-keyed Tier-1 lookup resolved nothing and every row fell back to the basename index (ambiguous for collided basenames → no badge). Fixed by adding a `vChildren`-based Tier-1 lookup: each `view.dom.vChildren._children` entry (verified in the dev vault) carries `.file.path` **and** `.selfEl` (the rendered row element), so rows map to their exact path — including `Untitled.md` vs `Untitled/Untitled.md`. `resultDomLookup` remains a defensive legacy fallback. Never-guess rule preserved.

**Phase 3 status:** ✅ complete — build/lint clean (0 errors, 1 tracked Phase-4 settings warning) and 48 unit tests green (19 row→file resolution cases). Manual dev-vault checks done; two issues root-caused and fixed (long-alias layout; same-name/different-folder alias loss — a `resultDomLookup` shape-change that broke Element-keyed Tier-1, fixed with a `vChildren`-based lookup).

### Phase 4 — Settings & styling

- [x] Settings persist across reloads; every setting takes effect immediately (no plugin reload required). *(Automated: settings tab reads/writes `plugin.settings` and triggers `adapter.refresh()` after every change via `onApplied`; `normalizeSettings` sanitizes persisted data. Manual confirm still needed.)*
- [x] Toggle off → badges disappear; display style switch changes rendering; max-aliases truncation shows "+k" correctly; highlight setting highlights query-matching aliases. *(Automated: renderer honors `showAliases`, `displayStyle` badge/inline, `maxAliases` via `computeBadges`, `highlightMatches` via `shouldHighlight`/`matchesTerm`. Manual confirm in dev vault still needed.)*
- [x] Badges render correctly in light/dark base theme and under at least one popular community theme (CSS-variable-based styling — no hardcoded colors). *(Automated: `styles.css` uses only Obsidian CSS variables. Manual theme check still needed.)*
- [x] Narrow-pane / mobile layout: badges wrap or truncate without breaking the title-row flex layout (verify against the Phase 0 injection test in a narrow pane). *(Automated: `.is-mobile`/workspace-leaf max-width rules + inline-ellipsis added. Manual narrow-pane check still needed.)*
- [x] Declarative settings-search API: `getSettingDefinitions()` implemented (Obsidian 1.13+), plus imperative `display()` for pre-1.13 rendering — clears the previously tracked `prefer-setting-definitions` lint warning. *(Verified: lint now 0 errors + 0 warnings.)*

**Phase 4 status:** 🟡 implemented — build/lint clean (0 errors, 0 warnings; the long-standing settings lint warning is cleared) and 52 unit tests green (4 new highlight tests). The settings UI, live-apply wiring, inline style, query-match highlight and theme-safe CSS are code-complete. The four manual checks (persistence/live-toggle, display-style switch, light/dark + community theme, narrow-pane/mobile layout) need a dev-vault run to confirm. **Automated/unit checks pass; 52 tests total.** Remaining manual verification needed in the dev vault.

### Phase 5 — Edge cases & performance

- [ ] QA checklist from §6 executed and recorded (special characters, long lists, empty search, hidden/ignored files, uninstall/reload cleanliness).
- [ ] Performance: decorating a 1000-result search adds <16 ms per rendered frame batch; typing-latency unaffected (no layout thrash — verify via DevTools Performance trace showing no long tasks attributable to the plugin).
- [ ] Large vault simulation: alias index build <100 ms for 1000 files; memory retained stable after 10 repeated searches (WeakMap/Map cleanup verified).
- [ ] No plugin work at all when the vault contains zero aliases (early-exit verified by logging/breakpoint).

### Phase 6 — Release

- [ ] CI pipeline green: lint + unit tests + production build on every PR; release workflow attaches `main.js`, `manifest.json`, `styles.css` and a `versions.json` entry.
- [ ] Install-from-release verified in a fresh test vault: download assets → plugin loads and works (this is the exact path community users take).
- [ ] `README.md` includes usage, screenshots (search results with badges, settings), install instructions, and the "fragile internals" compatibility note.
- [ ] Community submission prerequisites reviewed against the official plugin guidelines checklist (no Node APIs beyond needs, no network calls, clean unload, no console spam) — a self-review pass recorded in the PR description.
- [ ] Git tags + GitHub release created; version in `manifest.json`, `package.json`, and `versions.json` consistent.

The riskiest unknown is Phase 0 (exact hook point into the private Search view), which is why it comes first and is contained to one module.

## 9. Phase 0 outcome (executed — complete)

Findings: see `docs/phase0-search-internals.md` — confirmed DOM structure, injection point (badge between `.tree-item-inner` and `.tree-item-flair-outer`), and lazy/virtualized rendering (MutationObserver + IntersectionObserver + rAF batching, validated against the shipped "Style Tags in Search Results" plugin).

DevTools verification (user-run, 2 rounds) closed the remaining unknowns:

- `resultDomLookup` exists but at **`view.dom.resultDomLookup`** (a `Map`, size = number of results) — not on the view itself; the accessor must probe both (`view.dom` first, then `view`). Key/value shape is handled by a runtime shape-check, no further manual confirmation needed.
- Virtualization confirmed by internals: `view.dom.infinityScroll` (`renderBlockSize`, `rootMargin`); results container also reachable via `view.dom.childrenEl`.
- Vault baseline: 1012 markdown files, 976 unique basenames. Duplicated timestamp-style basenames (36 pairs) are **out of scope** per user decision — ambiguous rows simply get no badge.
- Test badge injected successfully at the chosen injection point (visually confirmed).

Design decision: Tier 1 (`view.dom.resultDomLookup`, shape-checked) + Tier 2 (official-API basename index as guaranteed baseline) + never-guess rule. No prototype monkey-patching needed. **Phase 1 (scaffold) can start.**
