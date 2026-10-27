import { describe, expect, it } from 'vitest';
import { computeBadges } from '../src/renderer';

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
});
