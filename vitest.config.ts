import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Root vitest configuration for the Open Archiver monorepo (JR-101).
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
 */

const supportDir = fileURLToPath(new URL('./tests/support', import.meta.url));

const resolve = {
	alias: {
		'@oa-test': supportDir,
	},
};

export default defineConfig({
	test: {
		projects: [
			{
				resolve,
				test: {
					name: 'unit',
					// Units live next to the code they test.
					include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/unit/**/*.test.ts'],
					environment: 'node',
					// A unit test that needs a network socket or a database is not a unit test.
					testTimeout: 5_000,
				},
			},
			{
				resolve,
				test: {
					name: 'integration',
					include: ['packages/*/tests/integration/**/*.int.test.ts'],
					environment: 'node',
					// Creating a database and applying 41 migrations happens in a hook; on a cold
					// Postgres that is comfortably slower than the 10s default.
					testTimeout: 60_000,
					hookTimeout: 120_000,
					// JR-104: an integration test file points `process.env.DATABASE_URL` at the
					// isolated database it acquired, because `src/database` reads it at import time.
					// A separate process per file with a fresh module registry is what keeps that
					// mutation from leaking into a sibling file. Pinned rather than inherited from
					// the vitest defaults, because the isolation guarantee depends on it.
					pool: 'forks',
					isolate: true,
					// Files still run in parallel -- that is the case JR-104 has to survive, so it is
					// exercised on every run rather than only asserted inside one file.
					fileParallelism: true,
				},
			},
			{
				resolve,
				test: {
					name: 'adversarial',
					include: ['packages/*/tests/adversarial/**/*.adv.test.ts'],
					environment: 'node',
					testTimeout: 120_000,
					hookTimeout: 120_000,
				},
			},
		],
	},
});
