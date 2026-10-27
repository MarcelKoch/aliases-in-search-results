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

		// Keep the cache in sync with the metadata cache and vault.
		// Rebuild from scratch only when the whole metadata cache resolves.
		this.registerEvent(
			this.app.metadataCache.on('resolved', () => {
				this.cache.rebuild(this.app.vault.getMarkdownFiles());
			}),
		);
		// Single-file metadata updates: recompute — never a full rescan.
		const recompute = (file: TFile): void => this.cache.recompute(file);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => recompute(file)),
		);
		this.registerEvent(
			this.app.metadataCache.on('resolve', (file) => recompute(file)),
		);
		this.registerEvent(
			this.app.metadataCache.on('deleted', (file) => this.cache.remove(file)),
		);
		// Vault rename (provides the old path): relocate the entry.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					this.cache.move(oldPath, file.path, file.basename);
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
