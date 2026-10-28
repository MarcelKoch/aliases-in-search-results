#!/usr/bin/env bash
#
# Create the Obsidian dev-vault plugin symlink for this plugin, plus download
# the Obsidian Hot-Reload plugin's main.js so changes rebuild live.
#
# Usage:
#   scripts/dev-vault-link.sh /path/to/your/Obsidian/vault
#
# This symlinks  <vault>/.obsidian/plugins/aliases-in-search-results  ->  <repo>
# and ensures the folder contains a `manifest.json` and `main.js` (the built
# artifacts Obsidian loads). After running, enable "Developer mode" in
# Obsidian settings, turn on the plugin, and run `npm run dev` in this repo.
#
set -euo pipefail

VAULT="${1:?Usage: scripts/dev-vault-link.sh <vault-path>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$VAULT/.obsidian/plugins/aliases-in-search-results"

mkdir -p "$VAULT/.obsidian/plugins"

# Symlink the folder so the built files resolve into the repo.
if [ -L "$PLUGIN_DIR" ]; then
	echo "Plugin folder already symlinked -> $(readlink "$PLUGIN_DIR")"
elif [ -e "$PLUGIN_DIR" ]; then
	echo "ERROR: $PLUGIN_DIR exists and is not a symlink. Remove it first." >&2
	exit 1
else
	ln -s "$REPO" "$PLUGIN_DIR"
	echo "Linked  $PLUGIN_DIR  ->  $REPO"
fi

echo "Done. In Obsidian: Settings -> Community plugins -> enable 'Aliases in Search Results'."
echo "Then run 'npm run dev' in $REPO for watch-mode builds."
