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
					testTimeout: 60_000,
					hookTimeout: 60_000,
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
