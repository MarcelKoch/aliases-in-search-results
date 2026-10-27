# Aliases in Search Results

An [Obsidian](https://obsidian.md) plugin that shows the frontmatter `aliases`
of each note next to its filename in the **core Search** results:

```
▸ Daily Meeting Notes      [standup] [team-sync]
```

## Features

- Displays the alias(es) from each note's frontmatter in the built-in Search results.
- Understands both a single-string and an array `aliases` value.
- Degrades gracefully: ambiguous filenames (duplicate basenames) show no badge
  rather than risk a wrong alias.
- Skips results for notes with no aliases entirely (zero overhead for vaults
  without aliases).
- Works on desktop and mobile.

## Install

This plugin is under development and not yet published to the community plugin
catalog. To try it:

1. Build: `npm install && npm run build`
2. Copy `main.js` and `manifest.json` (and `styles.css` when present) to
   `<your-vault>/.obsidian/plugins/aliases-in-search-results/`
3. Enable **Settings → Community plugins → Aliases in Search Results**.

For development, run `scripts/dev-vault-link.sh <vault-path>` to symlink the
vault's plugin folder to this repo, then `npm run dev` for watch-mode builds.

## Settings

Settings are populated in a later milestone (see `plan.md` §4). The current
scaffold exposes a single toggle and persists it via the standard
`loadData`/`saveData` API.

## Compatibility note

Obsidian's core Search view has no official customization API. This plugin
observes the rendered search-results DOM and, to map a result row back to its
note file, reads an internal member of the Search view
(`view.dom.resultDomLookup`) with a strict runtime shape-check, falling back to
a basename-uniqueness index built from the official `metadataCache` API. All
fragile internals access is isolated to `src/searchAdapter.ts`. If Obsidian
changes those internals, the plugin degrades silently rather than throwing.

## Development

- `npm run dev` — watch-mode esbuild (outputs `main.js`).
- `npm run build` — type-check (strict) + production bundle.
- `npm run lint` — ESLint (Obsidian-specific rules via `eslint-plugin-obsidianmd`).
- `npm test` — Vitest unit tests (aliases and settings come first).

See `plan.md` for the full implementation plan and per-phase verification.
