/**
 * Raw dump of resultDomLookup + same-name title rows — defensive version that
 * never assumes a key is a DOM Node (some keys may be non-Element).
 *
 * Run in Obsidian DevTools with a search showing at least two same-basename
 * files. Prints resultDomLookup.size, every (key, value) entry with a safe
 * description, then every visible title row's cross-check against the map.
 */
(() => {
  const leaf = app.workspace.getLeavesOfType('search')[0];
  if (!leaf) { console.warn('No search leaf — open a search first.'); return; }
  const internals = leaf.view.dom ?? leaf.view;
  const map = internals.resultDomLookup;
  console.log('==== resultDomLookup ====');
  console.log('is Map:', map instanceof Map);
  if (!(map instanceof Map)) return;
  console.log('size:', map.size);
  const describe = (k) => {
    if (k instanceof Element) return { kind: 'Element', label: k.className + ' <' + k.tagName + '>', el: k };
    if (typeof k === 'object' && k !== null && typeof k.nodeType === 'number') return { kind: 'Node', label: String(k.nodeName), el: k };
    return { kind: typeof k, label: (Array.isArray(k) ? 'Array[' + k.length + ']' : String(k)), el: null };
  };
  const pathsOf = (v) => (Array.isArray(v) ? v : [v])
    .map((i) => (i && i.file && typeof i.file.path === 'string') ? i.file.path : null)
    .filter(Boolean);
  for (const [k, v] of map.entries()) {
    const d = describe(k);
    console.log('KEY kind=' + d.kind, '| label=', d.label, '| value=', (Array.isArray(v) ? v.slice(0, 3) : v), '| paths=', pathsOf(v));
  }

  console.log('\n==== visible title rows ====');
  const rows = leaf.view.containerEl.querySelectorAll('.search-result-file-title');
  console.log('count:', rows.length);
  const mapKeys = [...map.keys()].filter((k) => k instanceof Element);
  for (const row of rows) {
    const base = row.querySelector('.tree-item-inner')?.textContent?.trim();
    let rel = 'NO_ELEMENT_KEY_MATCH';
    for (const k of mapKeys) {
      if (k === row) { rel = 'TITLE(' + pathsOf(map.get(k)).join(',') + ')'; break; }
      if (k === row.parentElement) { rel = 'PARENT(' + pathsOf(map.get(k)).join(',') + ')'; break; }
      if (k.contains?.(row)) { rel = 'ANCESTOR ' + k.className + '(' + pathsOf(map.get(k)).join(',') + ')'; break; }
      if (row.contains?.(k)) { rel = 'DESCENDANT ' + k.className + '(' + pathsOf(map.get(k)).join(',') + ')'; break; }
    }
    console.log('title:', JSON.stringify(base), '| key-rel:', rel);
  }
})();
