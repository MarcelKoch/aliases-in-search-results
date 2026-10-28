#!/usr/bin/env node
/**
 * Generate N markdown files with random names, a random number of aliases
 * (0-10), and the tag `#tag`.
 *
 * Usage:
 *   node scripts/generate-fixture-notes.mjs [count] [outputDir]
 *
 *   count     - Required. Number of markdown files to create.
 *   outputDir - Optional. Directory to write files into.
 *               Defaults to the current working directory.
 *
 * Examples:
 *   node scripts/generate-fixture-notes.mjs 1000
 *   node scripts/generate-fixture-notes.mjs 500 /tmp/notes
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

// --------------------------------------------------------------------------
// Small helpers (dependency-free, keeps the script portable)
// --------------------------------------------------------------------------

/** Pick a random element from an array. */
function pick(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

/** Random integer in [min, max] inclusive. */
function randInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random lowercase identifier fragment (6 hex chars). */
function randomSuffix() {
	return randomBytes(3).toString('hex');
}

/** A believable random word used as a name/alias token. */
function randomWord() {
	return pick([
		'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
		'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
		'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo',
		'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray',
		'yankee', 'zulu', 'meeting', 'standup', 'plan', 'draft',
		'notes', 'summary', 'review', 'todo', 'archive', 'project',
	]);
}

/** Random markdown-safe filename (no spaces, alphanumeric + dashes). */
function randomFileName() {
	return `note-${randomSuffix()}.md`;
}

/** Build a random lists of 0-10 unique aliases. */
function randomAliases() {
	const count = randInt(0, 10);
	const seen = new Set();
	const aliases = [];
	while (aliases.length < count) {
		const alias = `${randomWord()}-${randomSuffix()}`;
		if (!seen.has(alias)) {
			seen.add(alias);
			aliases.push(alias);
		}
	}
	return aliases;
}

/** A single markdown file body with frontmatter (aliases) and the `#tag`. */
function buildMarkdown(aliases) {
	const lines = [];
	lines.push('---');
	if (aliases.length > 0) {
		lines.push('aliases:');
		for (const alias of aliases) {
			lines.push(`  - ${JSON.stringify(alias)}`);
		}
	}
	lines.push('---');
	lines.push('');
	lines.push(`<!--- generated fixture note (${aliases.length} aliases) --->`);
	lines.push('');
	lines.push(`Some linked content for this note.`);
	lines.push('');
	lines.push('#tag');
	lines.push('');
	return lines.join('\n');
}

// --------------------------------------------------------------------------
// Argument parsing
// --------------------------------------------------------------------------

function parseArgs(argv) {
	const count = Number(argv[0]);
	const outputDir = resolve(argv[1] ?? process.cwd());
	return { count, outputDir };
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function main() {
	const { count, outputDir } = parseArgs(process.argv.slice(2));

	if (!Number.isInteger(count) || count < 0) {
		console.error(
			'Usage: node scripts/generate-fixture-notes.mjs <count> [outputDir]',
		);
		console.error('  <count> must be a non-negative integer.');
		process.exit(1);
	}

	mkdirSync(outputDir, { recursive: true });

	let created = 0;
	for (let i = 0; i < count; i++) {
		const basename = randomFileName();
		const path = join(outputDir, basename);
		writeFileSync(path, buildMarkdown(randomAliases()), 'utf8');
		created += 1;
	}

	console.log(`Created ${created} markdown file(s) in ${outputDir}`);
}

main();
