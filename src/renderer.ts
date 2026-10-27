import { type AliasesInSearchResultsSettings } from './settings';

/**
 * Renders alias badges into a search result title row. This module only deals
 * with DOM construction — it has no knowledge of Obsidian internals.
 *
 * Injection point (from Phase 0 §2): the badge container is inserted between
 * the `.tree-item-inner` (title text) and `.tree-item-flair-outer` (match count
 * flair), so aliases appear right after the title. See
 * `docs/phase0-search-internals.md` §2.
 *
 * Idempotency contract: before rendering, any pre-existing `[data-aisr]`
 * elements in the row are removed, so re-scanning never produces duplicates.
 */

export const BADGE_CONTAINER_CLASS = 'aisr-badge-container';
const BADGE_CLASS = 'aisr-badge';
const MORE_CLASS = 'aisr-badge-more';
/** Attribute marking every element this plugin inserts, for cleanup on unload. */
const DATA_AISR = 'data-aisr';

const TITLE_INNER_SELECTOR = '.tree-item-inner';
const FLAIR_OUTER_SELECTOR = '.tree-item-flair-outer';

/** A badge carries the alias text and an optional marker (for the "+k" case). */
export interface Badge {
	text: string;
	more: boolean;
}

/**
 * Compute the badges to render, applying the maxAliases truncation setting.
 * Pure, so it is unit-testable.
 */
export function computeBadges(
	aliases: string[],
	maxAliases: number,
): Badge[] {
	if (aliases.length === 0) {
		return [];
	}
	const cap = Math.max(0, maxAliases);
	if (cap === 0) {
		return [{ text: `+${aliases.length}`, more: true }];
	}
	const shown = aliases.slice(0, cap);
	const badges: Badge[] = shown.map((text) => ({ text, more: false }));
	if (aliases.length > cap) {
		badges.push({ text: `+${aliases.length - cap}`, more: true });
	}
	return badges;
}

/**
 * Render aliases into the given title row. Returns the container element, or
 * null when there is nothing to render (plugin disabled in settings, or no
 * aliases to show).
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

	const badges = computeBadges(aliases, settings.maxAliases);
	if (badges.length === 0) {
		return null;
	}

	const container = titleRow.createSpan({
		cls: BADGE_CONTAINER_CLASS,
		attr: { [DATA_AISR]: '' },
	});

	for (const badge of badges) {
		const cls = badge.more
			? `tree-item-flair ${BADGE_CLASS} ${MORE_CLASS}`
			: `tree-item-flair ${BADGE_CLASS}`;
		container.createSpan({ cls, text: badge.text, attr: { [DATA_AISR]: '' } });
	}

	// Insert between inner title and the trailing flair-outer, if present.
	const inner = titleRow.querySelector<HTMLElement>(TITLE_INNER_SELECTOR);
	const flairOuter = titleRow.querySelector<HTMLElement>(FLAIR_OUTER_SELECTOR);
	if (flairOuter && inner) {
		flairOuter.before(container);
	} else {
		titleRow.appendChild(container);
	}

	return container;
}

/** True if the element was inserted by this plugin (used for cleanup). */
export function isAisrElement(el: Element): boolean {
	return el.matches(`[${DATA_AISR}]`);
}
