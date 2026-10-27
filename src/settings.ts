import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import type AliasesInSearchResultsPlugin from './main';

export interface AliasesInSearchResultsSettings {
	/** Master toggle for showing aliases in search results. */
	showAliases: boolean;
	/** Display style: badge pills or comma-separated inline text. */
	displayStyle: 'badge' | 'inline';
	/** Maximum number of aliases to show per result row (badge style). */
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
 * Settings UI.
 *
 * Two coexisting rendering paths (reviewer-preferred for the declarative API):
 *  - `getSettingDefinitions()` (Obsidian 1.13+): settings-searchable UI driven
 *    by the framework; reads/writes via `getControlValue`/`setControlValue`.
 *  - `display()` (pre-1.13): classic imperative rendering of the same four
 *    settings. Keeps the plugin working on minAppVersion 1.7.0+.
 *
 * Every change is persisted through `saveSettings()` and then applied live via
 * `onApplied` (wired in `main.ts` to the search adapter's refresh) so open
 * search results update without a plugin reload.
 */
export class AliasesInSearchResultsSettingTab extends PluginSettingTab {
	plugin: AliasesInSearchResultsPlugin;
	/**
	 * Called after a setting is persisted, to apply it live (re-render current
	 * search rows). Wired by `main.ts` to the search adapter's refresh.
	 */
	onApplied: (() => void) | null = null;

	constructor(app: App, plugin: AliasesInSearchResultsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Declarative, settings-searchable path (Obsidian 1.13+). */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Show aliases in search results',
				desc: 'Toggle the alias badges/text next to note titles in search results.',
				control: { type: 'toggle', key: 'showAliases' },
			},
			{
				name: 'Display style',
				desc: 'Render aliases as badge pills or as comma-separated inline text.',
				control: {
					type: 'dropdown',
					key: 'displayStyle',
					options: { badge: 'Badges', inline: 'Inline text' },
				},
			},
			{
				name: 'Max aliases (badges)',
				desc: 'Maximum number of aliases shown per row before a “+k more” badge.',
				control: { type: 'slider', key: 'maxAliases', min: 0, max: 10, step: 1 },
			},
			{
				name: 'Highlight matching aliases',
				desc: 'Emphasize aliases that contain a term from the current search query.',
				control: { type: 'toggle', key: 'highlightMatches' },
			},
		];
	}

	getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		switch (key) {
			case 'showAliases':
				return settings.showAliases;
			case 'displayStyle':
				return settings.displayStyle;
			case 'maxAliases':
				return settings.maxAliases;
			case 'highlightMatches':
				return settings.highlightMatches;
			default:
				return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		switch (key) {
			case 'showAliases':
				settings.showAliases = Boolean(value);
				break;
			case 'displayStyle':
				settings.displayStyle = value === 'inline' ? 'inline' : 'badge';
				break;
			case 'maxAliases': {
				const n = typeof value === 'number' ? Math.floor(value) : NaN;
				settings.maxAliases = Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS.maxAliases;
				break;
			}
			case 'highlightMatches':
				settings.highlightMatches = Boolean(value);
				break;
			default:
				return;
		}
		await this.plugin.saveSettings();
		this.onApplied?.();
	}

	/** Classic imperative path (Obsidian < 1.13). */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl)
			.setName('Show aliases in search results')
			.setDesc('Toggle the alias badges/text next to note titles in search results.')
			.addToggle((toggle) =>
				toggle.setValue(s.showAliases).onChange((value) => {
					s.showAliases = value;
					void this.commit();
				}),
			);

		new Setting(containerEl)
			.setName('Display style')
			.setDesc('Render aliases as badge pills or as comma-separated inline text.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('badge', 'Badges')
					.addOption('inline', 'Inline text')
					.setValue(s.displayStyle)
					.onChange((value) => {
						s.displayStyle = value === 'inline' ? 'inline' : 'badge';
						void this.commit();
					}),
			);

		new Setting(containerEl)
			.setName('Max aliases (badges)')
			.setDesc('Maximum number of aliases shown per row before a “+k more” badge.')
			.addSlider((slider) =>
				slider
					.setLimits(0, 10, 1)
					.setValue(s.maxAliases)
					.onChange((value) => {
						s.maxAliases = value;
						void this.commit();
					}),
			);

		new Setting(containerEl)
			.setName('Highlight matching aliases')
			.setDesc('Emphasize aliases that contain a term from the current search query.')
			.addToggle((toggle) =>
				toggle.setValue(s.highlightMatches).onChange((value) => {
					s.highlightMatches = value;
					void this.commit();
				}),
			);
	}

	/** Persist the current settings and re-render open search rows live. */
	private async commit(): Promise<void> {
		await this.plugin.saveSettings();
		this.onApplied?.();
	}
}