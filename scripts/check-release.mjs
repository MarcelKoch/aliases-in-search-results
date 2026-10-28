#!/usr/bin/env node
/**
 * Release-readiness check: asserts that the version numbers agree across
 * manifest.json, package.json and versions.json, and that the required plugin
 * assets exist after a production build.
 *
 * Usage:
 *   node scripts/check-release.mjs            # check version consistency + required files
 *   node scripts/check-release.mjs --build    # also run the production build first
 *
 * Exits 0 when all checks pass, non-zero otherwise (CI-friendly).
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const REQUIRED_ASSETS = ['main.js', 'manifest.json', 'styles.css'];

function read(name) {
	return JSON.parse(readFileSync(name, 'utf8'));
}

function fail(msg) {
	console.error(`✖ ${msg}`);
	process.exitCode = 1;
}

function main() {
	const checkBuild = process.argv.includes('--build');
	if (checkBuild) {
		console.log('Running production build…');
		const res = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
		if (res.status !== 0) {
			console.error('✖ build failed');
			process.exit(1);
		}
	}

	// 1. Version consistency across the three version-bearing files.
	const pkg = read('package.json');
	const manifest = read('manifest.json');
	const versions = read('versions.json');

	console.log(`package.json version:    ${pkg.version}`);
	console.log(`manifest.json version:   ${manifest.version}`);
	console.log(`versions.json has it:    ${pkg.version in versions ? 'yes' : 'NO'}`);

	if (pkg.version !== manifest.version) {
		fail(`package.json (${pkg.version}) != manifest.json (${manifest.version})`);
	}
	if (!(pkg.version in versions)) {
		fail(`versions.json has no entry for "${pkg.version}"`);
	}
	if (versions[pkg.version] !== manifest.minAppVersion) {
		fail(
			`versions.json["${pkg.version}"] = "${versions[pkg.version]}" ` +
				`!= manifest.json minAppVersion "${manifest.minAppVersion}"`,
		);
	}

	if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
		fail('manifest.json "id" is missing/empty');
	}
	if (manifest.isDesktopOnly !== false) {
		fail('manifest.json must set isDesktopOnly: false (mobile support)');
	}

	// 2. Required release assets exist.
	for (const asset of REQUIRED_ASSETS) {
		if (!existsSync(asset)) {
			fail(`missing required release asset: ${asset}`);
		} else {
			console.log(`asset present: ${asset}`);
		}
	}

	if (process.exitCode === undefined) {
		console.log('✓ All release checks passed.');
	}
}

main();
