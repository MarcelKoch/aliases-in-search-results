import { App, PluginSettingTab, Setting } from 'obsidian';
import type AliasesInSearchResultsPlugin from './main';

export interface AliasesInSearchResultsSettings {
	/** Master toggle for showing aliases in search results. */
	showAliases: boolean;
	/** Display style: badge or inline text. */
	displayStyle: 'badge' | 'inline';
	/** Maximum number of aliases to show per result row. */
	maxAliases: number;
	/** Highlight aliases that match the current search query. */
	highlightMatches: boolean;
}

export const DEFAULT_SETTINGS: AliasesInSearchResultsSettings = {
	showAliases: true,
	displayStyle: 'badge',
	maxAliases: 3,
	highlightMatches: false,
};

/** Merge raw persisted data into a valid settings object (unknown keys are dropped, types sanitized). */
export function normalizeSettings(
	raw: unknown,
): AliasesInSearchResultsSettings {
	const partial = (raw ?? {}) as Partial<AliasesInSearchResultsSettings>;
	return {
		showAliases: typeof partial.showAliases === 'boolean'
			? partial.showAliases
			: DEFAULT_SETTINGS.showAliases,
		displayStyle: partial.displayStyle === 'inline' ? 'inline' : 'badge',
		maxAliases:
			typeof partial.maxAliases === 'number' &&
			Number.isFinite(partial.maxAliases) &&
			partial.maxAliases >= 0
				? Math.floor(partial.maxAliases)
				: DEFAULT_SETTINGS.maxAliases,
		highlightMatches:
			typeof partial.highlightMatches === 'boolean'
				? partial.highlightMatches
				: DEFAULT_SETTINGS.highlightMatches,
	};
}

/**
 * Settings UI. The body is populated in Phase 4 (Settings & styling); only the
 * empty container and the onChange wiring scaffold live here for now so the
 * plugin loads and typechecks end to end.
 */
export class AliasesInSearchResultsSettingTab extends PluginSettingTab {
	plugin: AliasesInSearchResultsPlugin;

	constructor(app: App, plugin: AliasesInSearchResultsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Aliases in search results')
			.setDesc('Show the aliases of each note next to its name in the search results.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showAliases).onChange(async (value) => {
					this.plugin.settings.showAliases = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
