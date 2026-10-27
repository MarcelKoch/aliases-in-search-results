/**
 * Ground-truth probe for the same-basename/different-folder alias-loss bug.
 *
 * Run this in DevTools while a search is showing results that include at least
 * TWO files that share the same basename but live in different folders (this is
 * the scenario where badges currently disappear). It dumps the fragile
 * `resultDomLookup` internals so we can see exactly how the row->file mapping
 * behaves for those rows, and what path-ish data the row DOM exposes.
 *
 * Usage:
 *   1. In Obsidian, run a search that returns a same-named-file pair.
 *   2. Open DevTools console and paste this block (or `node`-eval it via the
 *      console) — it self-invokes and prints the findings.
 *
 * Expected outcome: tells us whether Tier 1 really cannot discriminate the two
 * rows (value is an array across both files) or whether we're missing a
 * per-row discriminator.
 */
(() => {
	const leaf = app.workspace.getLeavesOfType('search')[0];
	if (!leaf) {
		console.warn('No open search leaf — open a search result first.');
		return;
	}
	const internals = leaf.view.dom ?? leaf.view;
	const map = internals.resultDomLookup;
	console.log('resultDomLookup is Map:', map instanceof Map, 'size:', map instanceof Map ? map.size : '(n/a)');

	if (map instanceof Map) {
		let collisions = 0;
		for (const [key, value] of map.entries()) {
			const paths = (Array.isArray(value) ? value : [value])
				.map((v) => (v && v.file && typeof v.file.path === 'string' ? v.file.path : null))
				.filter((p) => p !== null);
			const unique = [...new Set(paths)];
			if (unique.length > 1) {
				collisions++;
				console.log('--- ambiguous row ---');
				console.log('  key element:', key, 'className=', key.className);
				console.log('  value:', value);
				console.log('  distinct file paths:', unique);
				// Does the row DOM itself carry any path hint?
				const row = key.querySelector?.('.tree-item-self') ?? key;
				console.log('  row title text:', row.querySelector?.('.tree-item-inner')?.textContent?.trim());
				console.log('  row aria-label:', row.getAttribute?.('aria-label'));
				console.log('  row title attr data-*:',
					Array.from(row.querySelector?.('.tree-item-self')?.attributes ?? row.attributes ?? [])
						.map((a) => a.name)
						.filter((n) => n.startsWith('data-') || n === 'title' || n === 'aria-label'));
			}
		}
		console.log('ambiguous (multi-file) rows seen:', collisions);
	}
})();
