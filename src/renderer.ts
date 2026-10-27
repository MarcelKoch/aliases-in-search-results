import { type AliasesInSearchResultsSettings } from './settings';

/**
 * Renders alias badges into a search result title row. This module only deals
 * with DOM construction — it has no knowledge of Obsidian internals.
 *
 * Idempotency contract: before rendering, any pre-existing `[data-aisr]`
 * elements in the row are removed so re-scanning never produces duplicates.
 */

export const BADGE_CONTAINER_CLASS = 'aisr-badge-container';
/** Attribute marking every element this plugin inserts, for cleanup on unload. */
const DATA_AISR = 'data-aisr';

/**
 * Build the badge container for a title row, or return the existing one if
 * already present. Returns null when there is nothing to render.
 */
export function renderAliases(
	titleRow: HTMLElement,
	aliases: string[],
	settings: AliasesInSearchResultsSettings,
): HTMLElement | null {
	if (!settings.showAliases) {
		return null;
	}
	if (aliases.length === 0) {
		return null;
	}

	// Idempotent: drop any previous badge container to avoid duplicates.
	const existing = titleRow.querySelector<HTMLElement>(`[${DATA_AISR}]`);
	existing?.remove();

	const container = titleRow.createSpan({
		cls: BADGE_CONTAINER_CLASS,
		attr: { [DATA_AISR]: '' },
	});
	container.textContent = ''; // cleared for now; built out in Phase 3

	return container;
}
