/**
 * Verify where the resultDomLookup key hangs for a same-basename search.
 *
 * The bug: aliases disappear for same-named files in different folders even
 * though every resultDomLookup value is a single file (no ambiguous rows). The
 * hypothesis is that the *key* for those rows is neither the .title element nor
 * its direct parent, so the adapter fell back to the basename index (ambiguous
 * for collided basenames -> no badge).
 *
 * Usage (Obsidian DevTools console):
 *   1. Run a search that returns at least TWO files sharing a basename but in
 *      different folders (plus it helps if they have aliases).
 *   2. Paste this block. It reports, per search-title row, where the matching
 *      resultDomLookup key is in the DOM relative to the row.
 */
(() => {
  const leaf = app.workspace.getLeavesOfType('search')[0];
  if (!leaf) { console.warn('No open search leaf — open a search first.'); return; }
  const internals = leaf.view.dom ?? leaf.view;
  const map = internals.resultDomLookup;
  if (!(map instanceof Map)) { console.warn('resultDomLookup is not a Map (shape changed).'); return; }

  // Build reverse: element -> path.
  const byEl = new Map();
  for (const [k, v] of map.entries()) {
    const p = (Array.isArray(v) ? v : [v])
      .map((i) => i?.file?.path)
      .find(Boolean);
    if (p) byEl.set(k, p);
  }

  // Examine every search title row in the active leaf.
  const rows = leaf.view.containerEl.querySelectorAll('.search-result-file-title');
  const byBase = {};
  for (const row of rows) {
    const base = row.querySelector('.tree-item-inner')?.textContent?.trim();
    (byBase[base] = byBase[base] || []).push(row);
  }

  console.log('total rows:', rows.length);
  for (const [base, group] of Object.entries(byBase)) {
    if (group.length < 2) continue; // only shows collided basenames
    console.log('COLLIDED basename:', JSON.stringify(base), 'rows:', group.length);
    group.forEach((row, i) => {
      const direct = byEl.get(row);
      const parent = byEl.get(row?.parentElement);
      // Locate the key among descendants of the row root (.tree-item).
      const rowRoot = row?.parentElement?.closest('.tree-item') ?? row?.parentElement;
      const keyInSubtree = rowRoot ? [...rowRoot.querySelectorAll('*')].find((e) => byEl.has(e)) : undefined;
      const rel = direct ? 'DIRECT (title==' + byEl.get(row) + ')'
        : parent ? 'PARENT: ' + row?.parentElement?.className + ' -> ' + byEl.get(parent)
        : keyInSubtree ? 'DESCENDANT: ' + keyInSubtree.className + ' -> ' + byEl.get(keyInSubtree)
        : (() => {
            // Walk up to 3 ancestors for a key.
            let a = row?.parentElement, d = 0;
            while (a && d < 3) { if (byEl.has(a)) return 'ANCESTOR(depth ' + d + '): ' + a.className + ' -> ' + byEl.get(a); a = a.parentElement; d++; }
            return 'NOT FOUND anywhere mapping for row #' + i;
          })();
      console.log('  row#' + i, 'basename:', JSON.stringify(base), '|', rel);
    });
  }
})();
