import { describe, expect, it } from 'vitest';
import { normalizeAliases } from '../src/aliasResolver';
import { normalizeSettings } from '../src/settings';

describe('scaffold smoke test (Phase 1)', () => {
	it('normalizeAliases handles a single string', () => {
		expect(normalizeAliases('foo')).toEqual(['foo']);
	});

	it('normalizeSettings produces valid defaults for empty input', () => {
		expect(normalizeSettings({})).toEqual({
			showAliases: true,
			displayStyle: 'badge',
			maxAliases: 3,
			highlightMatches: false,
		});
	});
});
