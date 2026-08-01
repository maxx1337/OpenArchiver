import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_CLASSES, type TestClass } from './test-classes';

/**
 * Suite inventory (JR-1-05b).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------------------------
 * The CI job introduced by `JR-1-05` asserted that the `integration` suite had run by grepping the
 * test log for the *absence* of a skip notice. The `JR-1-06` acceptance broke that check twice:
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
 *   1. **Exact file count per suite.** Each suite declares how many files it must match. Zero files
 *      is therefore a failure, which is what closes (a) -- and it closes it for a *deleted* directory
 *      just as much as for a renamed one.
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
 *
 * ---------------------------------------------------------------------------------------------
 * What this file cannot see, and who does (JR-1-05c)
 * ---------------------------------------------------------------------------------------------
 * Everything here is decided before a single test runs, by looking at the filesystem. Three ways of
 * removing coverage leave the filesystem intact and were therefore green until JR-1-05c: relabelling a
 * suite's class, filling a file with `it.skip`, and deleting one file while adding another. Those are
 * findings F14 and F15, and they are watched by `./executed-tests.ts`, which counts tests that
 * actually **executed**, per suite and per class, and asserts the counts declared in
 * `SUITES[].expectedTests` below. The two guards sit in the same table on purpose: a maintainer who
 * adds or removes a test file has one place to update.
 */

/** Repository root -- this file lives at `<root>/tests/support/suite-inventory.ts`. */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

export type SuiteName = 'unit' | 'integration' | 'adversarial';

export interface SuiteSpec {
	readonly name: SuiteName;
	/** Include globs, handed to vitest verbatim. Repository-root relative, `/` separated. */
	readonly include: readonly string[];
	/**
	 * How many files must match -- **exactly**, not at minimum.
	 *
	 * It was a lower bound until JR-1-05c. A lower bound is slack, and a deletion the size of the
	 * slack goes through unnoticed: that is finding F15, reproduced by adding one integration file
	 * and deleting `pg-harness.int.test.ts`, which carries the entire JR-1-04 isolation contract.
	 * Equality costs one number per commit that adds or removes a test file, and the failure message
	 * says which number to write.
	 */
	readonly expectedFiles: number;
	/**
	 * How many tests must actually **execute**, per class, when that class is selected. Asserted
	 * after the run by `./executed-tests.ts`; see that module for why files alone are not enough
	 * (F14) and why this is equality rather than a lower bound (F15).
	 *
	 * A class that is not selected contributes 0 -- so the default `ci` run expects 0 `nightly`
	 * tests, and a suite relabelled from `ci` to `nightly` is caught by its `ci` number falling.
	 */
	readonly expectedTests: Readonly<Record<TestClass, number>>;
}

export const SUITES: readonly SuiteSpec[] = [
	{
		name: 'unit',
		// Units live next to the code they test; `tests/unit/` is for units of the harness itself,
		// which has no `src`.
		include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/unit/**/*.test.ts'],
		// 5 after JR-1-05b; 7 after JR-13-01 added the F1 regression at the validator boundary
		// (src/iam-policy/policy-validator.f1-conditions.test.ts) and the ADR-017 call-site
		// inventory (tests/unit/filter-builder-call-sites.test.ts); 8 after JR-13-13 added the
		// cross-gate check (tests/unit/condition-key-gates.test.ts); 10 after JR-1-05c added
		// tests/unit/executed-tests.test.ts and tests/unit/harness-ledger.test.ts; 13 after JR-2-02
		// added the canonical encoding of packages/journaling (canonical-encoding, merkle and the
		// ADR-006 golden vectors, all under src/ledger/); 14 after JR-2-06 added ledger-writer.test.ts;
		// 15 after JR-2-07 added tests/unit/ledger-backend-contract.test.ts -- the shared LedgerBackend
		// contract against a backend with no database, plus the counter-check that its concurrency case
		// fails without a lock. 16 after JR-3-03 added packages/journaling/src/spool/fs-port.test.ts --
		// the fault-injectable filesystem seam (real implementation plus the independent-failure fake).
		// 19 after JR-3-01 added spool/{txid,layout,config}.test.ts -- transaction IDs, sharded
		// incoming/quarantine layout, the high-water-mark check, and its zod config validation.
		// 20 after JR-3-02 added spool/durable-write.test.ts -- the streaming, dual-fsync durable
		// write, plus its 150 MB heap-growth case (nightly). 21 after JR-3-04 added
		// spool/acceptance.test.ts -- the two-phase acceptance wiring (high-water-mark -> durable write
		// -> ledger append -> typed result) against fakes. 23 after JR-3-05 added
		// ledger/ledger-lookup.test.ts (the batched spool_txid -> ledger read port, against a recording
		// fake) and spool/crash-recovery.test.ts (the crash-recovery scan: requeue vs. quarantine,
		// batching, quarantine/ observability, no-delete, and tolerance of a racing second scan).
		expectedFiles: 23,
		// 216 before JR-2-02; 266 with the 50 tests of the canonical encoding and the Merkle encoding;
		// 280 with the 14 statement-order tests of the ledger writer (JR-2-06).
		// 288 after JR-2-07: the 5 shared contract cases, plus 3 that show the contract's concurrency
		// case has teeth (unlocked backend forks, locked one does not, a failed append does not wedge
		// the chain). 299 after JR-3-03: 11 tests proving write/file-fsync/directory-fsync fail
		// independently against the fake, plus the real NodeSpoolFileSystem exercised on disk. 335
		// after JR-3-01: 9 (txid: shape, uniqueness, time-ordering) + 19 (layout: sharding, paths,
		// ensureSpoolLayout, high-water-mark) + 8 (zod config validation) = 36 new tests.
		// 347 ci / 1 nightly after JR-3-02: 11 tests against FakeSpoolFileSystem (path, size, hash,
		// empty message, byte-verbatim, fsync/close ordering, the shard directory fsync'd, the three
		// stage-typed failures, the buffer-reuse streaming proof) + 1 against real disk
		// (NodeSpoolFileSystem, platform-aware directory-fsync outcome) = 12 new `ci` tests, plus the
		// 150 MB heap-growth acceptance case classified `nightly`. 361 ci after JR-3-04: 14 tests
		// wiring high-water-mark -> durable write -> ledger append -> typed result against fakes --
		// order (2 cases, one of them the fix for the getter-destructuring trap described in
		// acceptance.test.ts's fakeBackend() doc comment), high-water mark, the three spool-failure
		// classifications, ledger-append failure leaving the spool file in place, and the five success
		// cases (seq/hash passthrough, generated txid, size/hash from the durable write, IP
		// normalisation x2, receipt event shape). 371 after JR-3-05: 3 tests for
		// PostgresLedgerLookup.findBySpoolTxIds() against a fake (empty batch skips I/O, one batched
		// ANY($1) call with correct row mapping, a string-encoded received_at converted to Date) + 7 for
		// the crash-recovery scan (requeue leaves the file in place, quarantine moves it and alerts, a
		// mixed multi-shard batch resolved in exactly one ledger call, pre-existing quarantine/ files
		// counted but never queried or moved, a fresh/empty spool scans cleanly, content preserved
		// byte-for-byte across a run that both requeues and quarantines, and a racing second scan's
		// already-moved source is tolerated rather than thrown).
		expectedTests: { ci: 371, nightly: 1, manual: 0 },
	},
	{
		name: 'integration',
		include: ['packages/*/tests/integration/**/*.int.test.ts'],
		// 4 after JR-1-04; 8 after JR-13-01 split the F1/F3/F7/F8 regressions out of
		// filter-builder.int.test.ts and added predefined-roles.int.test.ts; 9 after JR-2-04 added
		// journal-ledger-schema.int.test.ts (the CHECK constraints and keys of the ledger table);
		// 10 after JR-2-05 added journal-ledger-append-only.int.test.ts (the trigger); 11 after JR-2-06
		// added journal-ledger-writer.int.test.ts (append() against a real database); 12 after JR-2-07
		// added ledger-backend-contract.int.test.ts -- the same contract against PostgresLedgerWriter.
		// One suite, two implementations: that pair is what makes "the backend is pluggable" a
		// measurement rather than a claim. 13 after JR-3-04 added
		// journal-acceptance-bare-client.int.test.ts -- JournalAcceptance.accept() through a client
		// that is never given to drizzle() (F38's rule: anything in packages/journaling that gets its
		// connection injected needs at least one test writing through a bare client). 14 after JR-3-05
		// added journal-ledger-lookup.int.test.ts -- PostgresLedgerLookup.findBySpoolTxIds() against a
		// real database.
		expectedFiles: 14,
		// 55 before JR-2-04; 71 with the 16 schema tests of journal_ledger/deployment_identity;
		// 79 with the 8 append-only tests of JR-2-05; 87 with the 8 writer tests of JR-2-06.
		// 92 after JR-2-07: the same 5 contract cases, against PostgresLedgerWriter this time. 94 after
		// JR-3-04: the bare-client round trip through JournalAcceptance.accept() (re-verifies the chain
		// hash after storage) and the direct F38 regression case (a non-null event_payload with keys out
		// of order, through PostgresLedgerWriter.append() on the same bare client). 97 after JR-3-05: a
		// mixed batch of known/unknown spool_txids resolved correctly against the real schema and index,
		// an all-unknown batch coming back empty without error, and an empty batch never reaching the
		// database at all.
		expectedTests: { ci: 97, nightly: 0, manual: 0 },
	},
	{
		name: 'adversarial',
		include: ['packages/*/tests/adversarial/**/*.adv.test.ts'],
		// 1 until JR-2-08/JR-2-09; 3 with journal-ledger-concurrency.adv.test.ts (the 20x500 load case)
		// and journal-ledger-tamper.adv.test.ts (Testplan 12.5 cases (a) to (h)).
		expectedFiles: 3,
		// The one `nightly` and one `manual` suite in the repository are both in
		// mongo-to-drizzle.adv.test.ts. They are the two skips a default `pnpm test` reports.
		// ci: 3 before E2; 7 with the 4 concurrency cases of JR-2-08 (load, rollback-under-load,
		// the no-lock counter-check, and the F38 regression); 18 with the 11 tamper cases of JR-2-09.
		expectedTests: { ci: 18, nightly: 1, manual: 1 },
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
		if (counts[spec.name] !== spec.expectedFiles) {
			const direction = counts[spec.name] < spec.expectedFiles ? 'fewer' : 'more';
			violations.push(
				`Suite "${spec.name}" matched ${counts[spec.name]} file(s), but exactly ` +
					`${spec.expectedFiles} are expected -- ${direction} than declared.\n` +
					`    include: ${spec.include.join(', ')}\n` +
					`    A suite that matches nothing is reported as green by vitest. The count is ` +
					`checked for equality rather than as a lower bound (F15): slack lets a deletion the ` +
					`size of the slack pass unnoticed. If this change is intended, set expectedFiles to ` +
					`${counts[spec.name]} for suite "${spec.name}" in tests/support/suite-inventory.ts ` +
					`in the same commit -- and expectedTests with it.`
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
			(spec) => `${spec.name}: ${counts[spec.name]} file(s) (expected ${spec.expectedFiles})`
		).join(' · ') +
		` · unclassified: ${unclassified.length}`;

	return { counts, unclassified, violations, summary };
}

/**
 * Write the inventory as JSON when `OA_TEST_INVENTORY_REPORT` names a path.
 *
 * This is how CI states its expectation **positively**: the job requires the file to exist and to
 * satisfy the counts it carries. A run in which `globalSetup` never executed -- because the entry
 * was removed from `vitest.config.ts`, say -- produces no file, and the job fails on its absence
 * rather than on the absence of a log line. The expectations travel inside the report, so the check
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
			expectedFiles: spec.expectedFiles,
			expectedTests: Object.fromEntries(
				TEST_CLASSES.map((cls) => [cls, spec.expectedTests[cls]])
			),
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
		`Test suite inventory check failed (JR-1-05b).\n\n` +
			report.violations.map((violation) => `  - ${violation}`).join('\n\n') +
			`\n\n${report.summary}`
	);
}
