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
 *
 * Honors `settings.displayStyle` ('badge' pills vs comma-separated inline text)
 * and `settings.highlightMatches` (wraps any alias that contains a current
 * query term in a highlight span). `highlightTerms` may be empty when highlight
 * is off or the query produced no usable terms.
 */
export function renderAliases(
	titleRow: HTMLElement,
	aliases: string[],
	settings: AliasesInSearchResultsSettings,
	highlightTerms: ReadonlyArray<string> = [],
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

	if (settings.displayStyle === 'inline') {
		container.addClass('aisr-inline');
		const inner = titleRow.createSpan({
			cls: 'aisr-inline-text',
			attr: { [DATA_AISR]: '' },
		});
		container.appendChild(inner);
		renderInline(inner, aliases, settings.highlightMatches ? highlightTerms : []);
	} else {
		const badges = computeBadges(aliases, settings.maxAliases);
		for (const badge of badges) {
			const cls = badge.more
				? `tree-item-flair ${BADGE_CLASS} ${MORE_CLASS}`
				: `tree-item-flair ${BADGE_CLASS}`;
			const span = container.createSpan({
				cls,
				text: badge.text,
				attr: { [DATA_AISR]: '' },
			});
			if (!badge.more && shouldHighlight([badge.text], highlightTerms)) {
				span.addClass('aisr-highlight');
			}
		}
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

/**
 * Fill an inline container with the joined alias text, wrapping any alias that
 * contains a query term in `.aisr-highlighted`. Pure span construction.
 */
function renderInline(
	container: HTMLElement,
	aliases: string[],
	highlightTerms: ReadonlyArray<string>,
): void {
	aliases.forEach((alias, i) => {
		if (i > 0) {
			container.createSpan({ text: ', ', cls: 'aisr-sep' });
		}
		if (matchesTerm(alias, highlightTerms)) {
			container.createSpan({ text: alias, cls: 'aisr-highlighted' });
		} else {
			container.createSpan({ text: alias });
		}
	});
}

/** True when any lower-cased alias contains any highlight term (pure). */
export function shouldHighlight(
	aliases: ReadonlyArray<string>,
	highlightTerms: ReadonlyArray<string>,
): boolean {
	if (highlightTerms.length === 0) {
		return false;
	}
	return aliases.some((a) => matchesTerm(a, highlightTerms));
}

/** True when lower-cased `text` contains at least one non-empty term (pure). */
export function matchesTerm(
	text: string,
	terms: ReadonlyArray<string>,
): boolean {
	const lower = text.toLowerCase();
	return terms.some((t) => t.length > 0 && lower.includes(t.toLowerCase()));
}

/** True if the element was inserted by this plugin (used for cleanup). */
export function isAisrElement(el: Element): boolean {
	return el.matches(`[${DATA_AISR}]`);
}
