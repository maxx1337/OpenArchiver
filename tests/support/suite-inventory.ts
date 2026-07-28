import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Suite inventory (JR-105b).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------------------------
 * The CI job introduced by `JR-105` asserted that the `integration` suite had run by grepping the
 * test log for the *absence* of a skip notice. The `JR-106` acceptance broke that check twice:
 *
 *   (a) Renaming `packages/backend/tests/integration` made the suite **absent** rather than
 *       skipped. No skip notice is printed for a suite that does not exist, so the check reported
 *       "No integration-suite skip notice found." and the run was green with the entire integration
 *       suite gone (`149 passed | 2 skipped`, exit 0).
 *
 *   (b) A file in `tests/integration/` named `*.test.ts` instead of `*.int.test.ts` matches **no**
 *       project include glob. With `expect(1).toBe(2)` inside it, `pnpm test` stayed green and the
 *       file name appeared nowhere in the output.
 *
 * A check that watches for a missing log line is exactly the construction that let (a) through. So
 * this module states **positive** expectations instead, and states them where they cannot be
 * bypassed by an environment: in `globalSetup`, before a single test runs. `pnpm test` goes red on
 * the developer's machine, not only in CI.
 *
 * ---------------------------------------------------------------------------------------------
 * The two expectations
 * ---------------------------------------------------------------------------------------------
 *   1. **Minimum file count per suite.** Each suite declares how many files it must match. Zero
 *      files is therefore a failure, which is what closes (a) -- and it closes it for a *deleted*
 *      directory just as much as for a renamed one.
 *
 *   2. **No unclassified test file.** Every file in the repository whose name looks like a test
 *      (`*.test.ts`, `*.spec.ts`, and the `.js`/`.mjs`/`.tsx`/... variants) must be matched by at
 *      least one project's include globs. That closes (b) at the root: a misnamed or misplaced test
 *      file fails the whole run instead of being silently collected by nobody.
 *
 * The include globs live here rather than in `vitest.config.ts` so that the config and the guard
 * cannot drift apart -- the config imports them from this module.
 *
 * Both numbers are reported on **every** run, green or red (Testplan rule 6: no silent caps). A
 * green run says how many files each suite matched, so "covered" can be read off the output rather
 * than assumed.
 */

/** Repository root -- this file lives at `<root>/tests/support/suite-inventory.ts`. */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

export type SuiteName = 'unit' | 'integration' | 'adversarial';

export interface SuiteSpec {
	readonly name: SuiteName;
	/** Include globs, handed to vitest verbatim. Repository-root relative, `/` separated. */
	readonly include: readonly string[];
	/**
	 * How many files must match, at minimum. Set to the number of files that exist today: raising
	 * it when a suite grows is optional, but *lowering* it is a deliberate act that shows up in a
	 * diff. Consolidating files without touching this number fails the run, which is the point --
	 * the alternative is a suite that quietly shrinks to nothing.
	 */
	readonly minimumFiles: number;
}

export const SUITES: readonly SuiteSpec[] = [
	{
		name: 'unit',
		// Units live next to the code they test; `tests/unit/` is for units of the harness itself,
		// which has no `src`.
		include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/unit/**/*.test.ts'],
		minimumFiles: 5,
	},
	{
		name: 'integration',
		include: ['packages/*/tests/integration/**/*.int.test.ts'],
		minimumFiles: 4,
	},
	{
		name: 'adversarial',
		include: ['packages/*/tests/adversarial/**/*.adv.test.ts'],
		minimumFiles: 1,
	},
];

export function suiteInclude(name: SuiteName): string[] {
	const spec = SUITES.find((candidate) => candidate.name === name);
	if (!spec) {
		throw new Error(`Unknown suite "${name}". Known: ${SUITES.map((s) => s.name).join(', ')}.`);
	}
	return [...spec.include];
}

/**
 * Anything named like a test. Deliberately wider than the include globs -- the point is to catch
 * files the globs do *not* reach. `.json` is excluded on purpose so that
 * `packages/backend/tsconfig.test.json` is not mistaken for a test.
 */
const TEST_FILE_NAME = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Directories never worth walking. `dist` and `node_modules` are also excluded by vitest itself. */
const SKIPPED_DIRECTORIES = new Set([
	'node_modules',
	'dist',
	'build',
	'coverage',
	'.git',
	'.svelte-kit',
	'.vitepress',
	'.turbo',
	'.pnpm-store',
]);

/**
 * Translate one include glob into a regular expression.
 *
 * Supports exactly the syntax the globs above use, and nothing more: `*` for "anything within one
 * path segment", `**` + `/` for "zero or more path segments", a trailing `**` for "anything".
 * Written out rather than pulled from a dependency because neither `picomatch` nor `tinyglobby`
 * resolves at this workspace root, and a new dependency for twenty lines is a bad trade. Its own
 * unit tests are in `packages/backend/tests/unit/suite-inventory.test.ts`.
 */
export function globToRegExp(glob: string): RegExp {
	let pattern = '';
	let index = 0;
	while (index < glob.length) {
		const char = glob[index]!;
		if (char === '*') {
			if (glob[index + 1] === '*') {
				if (glob[index + 2] === '/') {
					// `**/` -- zero or more complete segments, so `a/**/b.ts` also matches `a/b.ts`.
					pattern += '(?:[^/]+/)*';
					index += 3;
					continue;
				}
				pattern += '.*';
				index += 2;
				continue;
			}
			pattern += '[^/]*';
			index += 1;
			continue;
		}
		pattern += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
		index += 1;
	}
	return new RegExp(`^${pattern}$`);
}

const compiled = new Map<string, RegExp>();

function matches(glob: string, relativePath: string): boolean {
	let regex = compiled.get(glob);
	if (!regex) {
		regex = globToRegExp(glob);
		compiled.set(glob, regex);
	}
	return regex.test(relativePath);
}

/** Which suites would collect this file? Empty means: nobody runs it. */
export function suitesMatching(relativePath: string): SuiteName[] {
	return SUITES.filter((spec) => spec.include.some((glob) => matches(glob, relativePath))).map(
		(spec) => spec.name
	);
}

/** Every test-looking file in the repository, as `/`-separated repository-relative paths. */
export function listTestLikeFiles(root: string = REPO_ROOT): string[] {
	const found: string[] = [];
	const walk = (absolute: string, relative: string): void => {
		for (const entry of readdirSync(absolute, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (SKIPPED_DIRECTORIES.has(entry.name)) {
					continue;
				}
				walk(
					path.join(absolute, entry.name),
					relative ? `${relative}/${entry.name}` : entry.name
				);
				continue;
			}
			if (!entry.isFile() || !TEST_FILE_NAME.test(entry.name)) {
				continue;
			}
			found.push(relative ? `${relative}/${entry.name}` : entry.name);
		}
	};
	walk(root, '');
	return found.sort();
}

export interface InventoryReport {
	/** Files matched, per suite. */
	readonly counts: Record<SuiteName, number>;
	/** Test-looking files no suite collects. */
	readonly unclassified: string[];
	/** Human-readable problems. Empty means the inventory holds. */
	readonly violations: string[];
	/** One line, printed on every run. */
	readonly summary: string;
}

export function collectSuiteInventory(root: string = REPO_ROOT): InventoryReport {
	const files = listTestLikeFiles(root);
	const counts = { unit: 0, integration: 0, adversarial: 0 } as Record<SuiteName, number>;
	const unclassified: string[] = [];

	for (const file of files) {
		const owners = suitesMatching(file);
		if (owners.length === 0) {
			unclassified.push(file);
			continue;
		}
		for (const owner of owners) {
			counts[owner] += 1;
		}
	}

	const violations: string[] = [];
	for (const spec of SUITES) {
		if (counts[spec.name] < spec.minimumFiles) {
			violations.push(
				`Suite "${spec.name}" matched ${counts[spec.name]} file(s), but at least ` +
					`${spec.minimumFiles} are expected.\n` +
					`    include: ${spec.include.join(', ')}\n` +
					`    A suite that matches nothing is reported as green by vitest. If the suite was ` +
					`renamed, moved or deleted on purpose, change minimumFiles in ` +
					`tests/support/suite-inventory.ts in the same commit.`
			);
		}
	}
	if (unclassified.length > 0) {
		violations.push(
			`${unclassified.length} file(s) are named like tests but are collected by no project, so ` +
				`they never run and a failing assertion inside them cannot be seen:\n` +
				unclassified.map((file) => `      ${file}`).join('\n') +
				`\n    Naming rules: units are \`*.test.ts\` under \`src/\` or \`tests/unit/\`, ` +
				`integration tests are \`*.int.test.ts\` under \`tests/integration/\`, adversarial ` +
				`tests are \`*.adv.test.ts\` under \`tests/adversarial/\`.`
		);
	}

	const summary =
		`[TEST-INVENTORY] ` +
		SUITES.map(
			(spec) => `${spec.name}: ${counts[spec.name]} file(s) (min ${spec.minimumFiles})`
		).join(' · ') +
		` · unclassified: ${unclassified.length}`;

	return { counts, unclassified, violations, summary };
}

/**
 * Write the inventory as JSON when `OA_TEST_INVENTORY_REPORT` names a path.
 *
 * This is how CI states its expectation **positively**: the job requires the file to exist and to
 * satisfy the minimums it carries. A run in which `globalSetup` never executed -- because the entry
 * was removed from `vitest.config.ts`, say -- produces no file, and the job fails on its absence
 * rather than on the absence of a log line. The minimums travel inside the report, so the check
 * needs no copy of them.
 */
function writeInventoryReport(report: InventoryReport): void {
	const target = process.env.OA_TEST_INVENTORY_REPORT?.trim();
	if (!target) {
		return;
	}
	const payload = {
		generatedAt: new Date().toISOString(),
		summary: report.summary,
		suites: SUITES.map((spec) => ({
			name: spec.name,
			include: [...spec.include],
			minimumFiles: spec.minimumFiles,
			files: report.counts[spec.name],
		})),
		unclassified: report.unclassified,
		violations: report.violations,
	};
	mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
	writeFileSync(path.resolve(target), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Report the inventory and fail the whole run if it does not hold.
 *
 * Called from `globalSetup`, so a violation aborts before any test executes and shows up in every
 * environment -- `pnpm test`, `pnpm test:integration`, CI alike.
 */
export function assertSuiteInventory(root: string = REPO_ROOT): void {
	const report = collectSuiteInventory(root);
	// Printed unconditionally, including on a green run: the counts are the evidence that the suites
	// were present, and evidence that is only printed on failure is evidence nobody reads.
	console.log(report.summary);
	writeInventoryReport(report);
	if (report.violations.length === 0) {
		return;
	}
	throw new Error(
		`Test suite inventory check failed (JR-105b).\n\n` +
			report.violations.map((violation) => `  - ${violation}`).join('\n\n') +
			`\n\n${report.summary}`
	);
}
