import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The 'obsidian' npm package is types-only (no runtime entry); the Electron
// app provides the real module. For unit tests, alias it to a lightweight stub.
export default defineConfig({
	plugins: [],
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./test/stubs/obsidian.ts', import.meta.url)),
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
