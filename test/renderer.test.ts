import { describe, expect, it } from 'vitest';
import { computeBadges, matchesTerm, shouldHighlight } from '../src/renderer';

describe('computeBadges (maxAliases truncation)', () => {
	it('returns no badges for an empty alias list', () => {
		expect(computeBadges([], 3)).toEqual([]);
	});

	it('shows all aliases when within the cap', () => {
		expect(computeBadges(['a', 'b'], 3)).toEqual([
			{ text: 'a', more: false },
			{ text: 'b', more: false },
		]);
	});

	it('truncates and appends a +k "more" badge', () => {
		expect(computeBadges(['a', 'b', 'c', 'd'], 2)).toEqual([
			{ text: 'a', more: false },
			{ text: 'b', more: false },
			{ text: '+2', more: true },
		]);
	});

	it('produces only a +k badge when maxAliases is 0', () => {
		expect(computeBadges(['a', 'b', 'c'], 0)).toEqual([{ text: '+3', more: true }]);
	});

	it('caps negative maxAliases at 0', () => {
		expect(computeBadges(['a', 'b'], -1)).toEqual([{ text: '+2', more: true }]);
	});

	it('does not add a +k badge when exactly at the cap', () => {
		expect(computeBadges(['a', 'b', 'c'], 3)).toEqual([
			{ text: 'a', more: false },
			{ text: 'b', more: false },
			{ text: 'c', more: false },
		]);
	});

	it('truncates a very long alias list to the cap with an accurate +k count', () => {
		const many = Array.from({ length: 500 }, (_, i) => `alias-${i}`);
		const badges = computeBadges(many, 3);
		expect(badges).toEqual([
			{ text: 'alias-0', more: false },
			{ text: 'alias-1', more: false },
			{ text: 'alias-2', more: false },
			{ text: '+497', more: true },
		]);
	});

	it('renders only a +k badge for a long list when maxAliases is 0', () => {
		const many = Array.from({ length: 500 }, (_, i) => `alias-${i}`);
		expect(computeBadges(many, 0)).toEqual([{ text: '+500', more: true }]);
	});

	it('handles aliases that are themselves very long strings', () => {
		// A single very long alias must not overflow/break `computeBadges`; the
		// CSS handles ellipsis/truncation. Logic-wise it is just a string.
		const longAlias = 'x'.repeat(2000);
		expect(computeBadges([longAlias], 3)).toEqual([
			{ text: longAlias, more: false },
		]);
	});
});

describe('matchesTerm / shouldHighlight (query-match emphasis)', () => {
	it('matches a query term that is a substring, case-insensitively', () => {
		expect(matchesTerm('Project Alpha', ['alpha'])).toBe(true);
		expect(matchesTerm('Project Alpha', ['PROJECT'])).toBe(true);
		expect(matchesTerm('Project Alpha', ['beta'])).toBe(false);
	});

	it('ignores empty query terms', () => {
		expect(matchesTerm('Project', ['', '   '])).toBe(false);
		expect(matchesTerm('Project', ['project'])).toBe(true);
	});

	it('shouldHighlight is false when there are no terms', () => {
		expect(shouldHighlight(['alpha', 'beta'], [])).toBe(false);
	});

	it('shouldHighlight is true when any alias contains a term', () => {
		expect(shouldHighlight(['alpha', 'beta'], ['eta'])).toBe(true);
		expect(shouldHighlight(['alpha', 'beta'], ['nope'])).toBe(false);
	});
});
