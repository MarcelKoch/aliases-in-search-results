/*
 * Phase 0 — DevTools verification script ("Aliases in Search Results" plugin)
 *
 * HOW TO RUN:
 *   1. Open Obsidian, open the Search pane, run a search that returns >= 1 result
 *      (ideally include a note whose basename is duplicated in another folder).
 *   2. Ctrl/Cmd+Shift+I → Console tab.
 *   3. Paste this whole file and press Enter.
 *   4. Read the output groups; then call `phase0Cleanup()` to remove the test badge.
 *
 * The script is read-mostly. It only (a) logs internals and (b) injects ONE
 * temporary badge so you can visually confirm the injection point. Everything
 * is wrapped so it cannot throw into Obsidian.
 */
(function phase0Verify() {
	"use strict";

	const RESULTS_CHILDREN = ".search-results-children";
	const TITLE_ROW = ".tree-item.search-result";
	const TITLE_SELF = ".search-result-file-title";
	const TITLE_INNER = ".tree-item-inner";
	const FLAIR_OUTER = ".tree-item-flair-outer";

	function group(name, fn) {
		console.group(name);
		try {
			fn();
		} catch (e) {
			console.error("FAILED:", e);
		}
		console.groupEnd();
	}

	group("0) Environment", function () {
		console.log("app available:", typeof window.app !== "undefined");
		console.log("Obsidian app version:", window.app?.version ?? "unknown");
	});

	// ---- 1) Search leaves & view ----
	let leaf, view;
	group("1) Search leaves", function () {
		const leaves = window.app.workspace.getLeavesOfType("search");
		console.log("open search leaves:", leaves.length);
		if (!leaves.length) {
			console.warn("No search leaf open. Open the Search pane and re-run.");
			throw new Error("abort");
		}
		leaf = leaves[0];
		view = leaf.view;
		console.log("view:", view);
		console.log("view constructor name:", view?.constructor?.name);
		console.log(
			"prototype method names:",
			Object.getOwnPropertyNames(Object.getPrototypeOf(view)).sort(),
		);
		console.log(
			"own field names (filtered by /result|dom|search/i):",
			Object.keys(view).filter((k) => /result|dom|search/i.test(k)),
		);
	});

	// ---- 2) resultDomLookup (primary mapping strategy) ----
	group("2) view.resultDomLookup", function () {
		const rdl = view?.resultDomLookup;
		console.log("exists:", rdl != null, "| type:", typeof rdl, "| is Map:", rdl instanceof Map);
		if (rdl instanceof Map) {
			console.log("size:", rdl.size);
			let shown = 0;
			for (const [key, val] of rdl.entries()) {
				if (shown++ >= 5) break;
				const el = key instanceof Element ? key : null;
				console.log("KEY classes:", el ? el.className : typeof key);
				console.log(
					"  key matches title-self?",
					el && el.matches?.(TITLE_SELF),
					"| key matches tree-item?",
					el && el.matches?.(TITLE_ROW),
				);
				console.log("  VALUE:", val);
				if (val && typeof val === "object") {
					console.log("  VALUE keys:", Object.keys(val));
					const file = val.file ?? val.data?.file;
					console.log("  VALUE.file.path:", file?.path);
				}
			}
			console.log(
				"RESULT: If 'VALUE.file.path' printed a real vault path, the primary mapping strategy WORKS. Note which element the KEY is.",
			);
		} else if (rdl != null) {
			console.warn("resultDomLookup exists but is not a Map. Dumping:", rdl);
		} else {
			console.warn(
				"resultDomLookup NOT found → primary strategy unavailable for this Obsidian version. Fallback (basename index) will be used.",
			);
		}
	});

	// ---- 3) Basename uniqueness (fallback strategy viability) ----
	group("3) Basename uniqueness in vault", function () {
		const files = window.app.vault.getMarkdownFiles();
		const byBase = new Map();
		for (const f of files) {
			const base = f.basename;
			byBase.set(base, (byBase.get(base) || 0) + 1);
		}
		let dupes = 0;
		for (const [base, n] of byBase) if (n > 1) { dupes++; console.log("duplicate basename:", base, "×" + n); }
		console.log(
			"markdown files:",
			files.length,
			"| unique basenames:",
			byBase.size,
			"| duplicated basenames:",
			dupes,
		);
		console.log("RESULT: small dupe count → fallback alone would nearly suffice; large → need primary strategy.");
	});

	// ---- 4) Injection point visual test ----
	group("4) Injection point test", function () {
		const leafEl = leaf.view.containerEl?.closest('.workspace-leaf-content[data-type="search"]') || leaf.view.containerEl;
		const rows = leafEl?.querySelectorAll(TITLE_ROW);
		console.log("visible result rows:", rows?.length ?? 0);
		const row = rows && rows[0];
		if (!row) {
			console.warn("No result rows in DOM (run a search first).");
			return;
		}
		const titleSelf = row.querySelector(TITLE_SELF);
		const inner = titleSelf?.querySelector(TITLE_INNER);
		const flairOuter = titleSelf?.querySelector(FLAIR_OUTER);
		console.log("title text (basename):", inner?.textContent);
		console.log("flair text (match count):", flairOuter?.textContent?.trim());

		// Inject a temporary badge between .tree-item-inner and .tree-item-flair-outer
		const badge = document.createElement("span");
		badge.className = "tree-item-flair aisr-badge";
		badge.dataset.aisr = "1";
		badge.textContent = "TEST-ALIAS";
		badge.style.cssText = "background: var(--background-modifier-hover); color: var(--text-muted); margin: 0 4px;";
		flairOuter
			? flairOuter.before(badge)
			: titleSelf.appendChild(badge);
		console.log("Injected test badge into:", titleSelf);
		console.log("RESULT: confirm visually that the badge sits between title and match count, and flexes correctly. Narrow the pane to check overflow.");
	});

	console.log("%cPhase 0 verification done. Run phase0Cleanup() to remove the test badge.", "color:#7c3aed");
	window.phase0Cleanup = function () {
		document.querySelectorAll("[data-aisr]").forEach((el) => el.remove());
		console.log("Test badges removed.");
	};
})();
