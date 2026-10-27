/**
 * Minimal runtime stub for the `obsidian` package, used only by unit tests.
 * The real module is provided by the Obsidian app at runtime; here we expose
 * just enough API surface for the pure modules under test. Extend as Phase 2+
 * adds tests that import more Obsidian types/values.
 */
export class Component {}
export class Plugin extends Component {}
export class PluginSettingTab extends Component {
	constructor(app: unknown, plugin: unknown) {
		super();
	}
}
export class Setting {}
export class TFile {}

export const normalizePath = (p: string): string => p;
export const debounce = <F extends (...args: never[]) => unknown>(
	fn: F,
	timeout = 0,
	immediate = false,
) => fn;
export type Debouncer<T, R> = (...args: T[]) => Promise<R>;
