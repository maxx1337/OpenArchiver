import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { ExecutedTestsReporter } from './tests/support/executed-tests';
import { suiteInclude } from './tests/support/suite-inventory';

/**
 * Root vitest configuration for the Open Archiver monorepo (JR-1-01).
 *
 * There is exactly one config file and it defines **suites as vitest projects**, so that
 * `pnpm test` from the repository root discovers tests in every workspace package.
 * The include globs are `packages/*\/...`, so a package that gains tests later
 * (`packages/types`, a future `packages/journaling`) is picked up without touching this file.
 *
 * The `unit` / `integration` split is a hard requirement, not a preference:
 * `packages/backend/src/database/index.ts` throws **at import time** when `DATABASE_URL` is
 * unset, so anything that transitively imports `../database` cannot even be loaded without a
 * configured database. The `unit` suite must therefore stay free of that import chain.
 * See docs/dev/journaling/04-testplan.md section 2.
 *
 * The include globs are **not** literals here: they come from `tests/support/suite-inventory.ts`,
 * which also enforces them in `globalSetup` (JR-1-05b). A suite that matches too few files, and a
 * test-looking file that no glob reaches, both fail the run before the first test executes. Two
 * silent failure modes found during the JR-1-06 acceptance -- an absent `integration` directory and a
 * `*.test.ts` file under `tests/integration/` -- are closed by that check rather than by inspecting
 * the log afterwards.
 *
 * `ExecutedTestsReporter` is the second half of that guard (JR-1-05c). Counting files cannot see the
 * three ways of removing coverage without touching the filesystem -- relabelling a suite's class,
 * filling a file with `it.skip`, deleting one file while adding another (F14, F15) -- so it measures
 * how many tests of each class actually ran and writes that down; the `globalSetup` teardown asserts
 * it. Removing this reporter does not disable the check: the measurement is then missing and the
 * teardown fails on its absence.
 */

const supportDir = fileURLToPath(new URL('./tests/support', import.meta.url));

const resolve = {
	alias: {
		'@oa-test': supportDir,
	},
};

export default defineConfig({
	test: {
		// Positive, unconditional expectations about which test files exist and which project
		// collects them. See tests/support/suite-inventory.ts.
		globalSetup: ['./tests/support/global-setup.ts'],
		// `default` stays first so the human-readable output is unchanged; the second reporter only
		// measures and writes a file. Named explicitly because listing any reporter replaces the
		// default one.
		reporters: ['default', new ExecutedTestsReporter()],
		projects: [
			{
				resolve,
				test: {
					name: 'unit',
					// Units live next to the code they test.
					include: suiteInclude('unit'),
					environment: 'node',
					// A unit test that needs a network socket or a database is not a unit test.
					testTimeout: 5_000,
				},
			},
			{
				resolve,
				test: {
					name: 'integration',
					include: suiteInclude('integration'),
					environment: 'node',
					// Creating a database and applying 41 migrations happens in a hook; on a cold
					// Postgres that is comfortably slower than the 10s default.
					testTimeout: 60_000,
					hookTimeout: 120_000,
					// JR-1-04: an integration test file points `process.env.DATABASE_URL` at the
					// isolated database it acquired, because `src/database` reads it at import time.
					// A separate process per file with a fresh module registry is what keeps that
					// mutation from leaking into a sibling file. Pinned rather than inherited from
					// the vitest defaults, because the isolation guarantee depends on it.
					pool: 'forks',
					isolate: true,
					// Files still run in parallel -- that is the case JR-1-04 has to survive, so it is
					// exercised on every run rather than only asserted inside one file.
					fileParallelism: true,
				},
			},
			{
				resolve,
				test: {
					name: 'adversarial',
					include: suiteInclude('adversarial'),
					environment: 'node',
					testTimeout: 120_000,
					hookTimeout: 120_000,
				},
			},
		],
	},
});
