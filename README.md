# Aliases in Search Results

An [Obsidian](https://obsidian.md) plugin that shows the frontmatter `aliases`
of each note next to its filename in the **core Search** results:

```
▸ Daily Meeting Notes      [standup] [team-sync]
```

Instead of switching on a result to discover which note it is, you can see each
note's aliases right in the result list.

## Features

- Displays the `aliases` from each note's frontmatter in the built-in Search
  results, right after the note title.
- Starts with the notes that already match your query — it is purely a display
  enhancement; it never changes *which* results are returned.
- Supports both single-string (`aliases: standup`) and array
  (`aliases: [standup, team-sync]`) forms, YAML lists, and malformed entries are
  ignored safely.
- **Display styles**: compact badge pills, or comma-separated inline text.
- **Truncation**: shows up to a configurable number of aliases, with a `+k` hint
  when there are more (first alias is never cut off).
- **Query-match highlight**: optionally emphasise aliases that contain the
  current search query.
- Degrades gracefully: when two files share a basename, the row is **not**
  given a badge rather than risk attaching the wrong note's alias (never-guess).
- No work at all when the vault has no aliases (O(1) early exit — zero overhead).
- Works on desktop and mobile (`isDesktopOnly: false`).

> **Note:** this plugin annotates results rather than matching aliases. Making
> Search actually match aliases is a deeper change and is out of scope for v1.

## Screenshots

_Screenshot to be added — capture and place `docs/screenshots/badges.png` and
`docs/screenshots/settings.png` before the first release._

- `docs/screenshots/badges.png` — search results showing badge pills.
- `docs/screenshots/settings.png` — the plugin settings tab.

## Install

### From a GitHub release (recommended)

1. Download the latest release assets: `main.js`, `manifest.json`,
   `styles.css`.
2. Put them all three into `<your-vault>/.obsidian/plugins/aliases-in-search-results/`
   (create the folders if needed).
3. Restart Obsidian (or enable via **Settings → Community plugins** → reload) and
   toggle **Aliases in Search Results** on.

### Via BRAT

1. Install and enable the ["BRAT"](https://github.com/TfTHacker/obsidian42-brat)
   community plugin.
2. Run **Add a beta plugin**, enter this repository, and enable it.

### Manual (from source)

1. `git clone` this repo and `cd` into it.
2. `npm install && npm run build`
3. Copy `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/aliases-in-search-results/`.
4. Enable the plugin in Obsidian (**Settings → Community plugins**).

For local development, run `scripts/dev-vault-link.sh <vault-path>` to symlink the
vault's plugin folder to this repo, then `npm run dev` for watch-mode builds.

## Settings

Settings live in **Settings → Community plugins → Aliases in Search Results**.
They take effect immediately — no plugin reload needed.

| Setting | Type | Default | Description |
|---|---|---|---|
| Show aliases in search results | Toggle | On | Master switch. When off, search rows are left untouched. |
| Display style | Badges / Inline text | Badges | Pills after the title, or muted comma-separated text. |
| Max aliases per result | Slider (0–10) | 3 | How many aliases to show before a `+k` indicator. |
| Highlight aliases matching the query | Toggle | Off | Emphasise aliases that contain the current search query. |

The settings search box (Obsidian 1.13+) can find these options.

## Compatibility note (fragile internals)

Obsidian's core Search view has **no official customization API**. This plugin:

- observes the rendered search-results DOM with a `MutationObserver` +
  `IntersectionObserver` (batching work via `requestAnimationFrame`), and
- to map a result row back to its note file, reads an internal member of the
  Search view (`view.dom.vChildren._children`, with a legacy
  `resultDomLookup` fallback) under a strict runtime shape-check, falling back
  to a basename-uniqueness index built from the official `metadataCache` API.

All fragile-internals access is isolated to a single module,
`src/searchAdapter.ts`. If Obsidian changes those internals, the plugin
**degrades silently** (rows simply get no badge) rather than throwing or
corrupting the search view. Clean unload removes every injected element and
disposes observers, so disabling leaves no residue.

## For contributors

- `npm run dev` — watch-mode esbuild (outputs `main.js`).
- `npm run build` — type-check (strict) + production bundle.
- `npm run lint` — ESLint with Obsidian-specific rules
  (`eslint-plugin-obsidianmd`).
- `npm test` — Vitest unit tests (alias resolution, cache, renderer, adapter,
  edge-cases/performance).

### Releasing

```bash
npm version patch --no-git-tag-version   # or minor/major; syncs package.json + manifest.json + versions.json
git commit -am "chore: release vX.Y.Z"
git tag -s -a "vX.Y.Z" -m "Release vX.Y.Z"
git push && git push --tags
```

The `Release` GitHub Action builds and uploads `main.js`, `manifest.json`, and
`styles.css` from the tag. A draft release is created, but not published. The 
final release is published manually.

## License

This plugin is licensed under the [BSD Zero Clause License (0BSD)](/LICENSE).
See `LICENSES/0BSD.txt` for the canonical text. The project follows
[REUSE](https://reuse.software/) conventions; `reuse lint` is enforced in CI.

See `docs/plan.md` for the full implementation plan and per-phase verification, and
`docs/` for the search-internals and QA documentation.
