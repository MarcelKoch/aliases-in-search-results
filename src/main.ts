import { Plugin, TFile } from 'obsidian';
import {
	type AliasesInSearchResultsSettings,
	AliasesInSearchResultsSettingTab,
	normalizeSettings,
} from './settings';
import { AliasCache } from './cache';
import { SearchAdapter } from './searchAdapter';

export default class AliasesInSearchResultsPlugin extends Plugin {
	settings!: AliasesInSearchResultsSettings;
	private cache!: AliasCache;
	private adapter!: SearchAdapter;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Alias + basename index over all markdown files.
		this.cache = new AliasCache(this.app.vault, this.app.metadataCache);
		this.cache.rebuild(this.app.vault.getMarkdownFiles());

		// Search adapter: binds to core Search leaves (empty until Phase 3).
		this.adapter = new SearchAdapter(this.app.workspace, this.cache);
		this.adapter.attach();

		// Settings tab.
		this.addSettingTab(new AliasesInSearchResultsSettingTab(this.app, this));

		// React to new/renamed/deleted files (full event wiring in Phase 2).
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile) {
					this.cache.recompute(file);
				}
			}),
		);

		// Clean teardown of the search adapter on disable/unload.
		this.register(() => this.adapter.detach());
	}

	onunload(): void {
		// register() already disposes the adapter; explicit DOM cleanup happens
		// inside adapter.detach() (implemented in Phase 3).
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
