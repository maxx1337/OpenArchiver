import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import {
	acquireTestDatabase,
	databaseExists,
	expectedMigrationCount,
	listHarnessDatabases,
	sweepStaleHarnessDatabases,
	withAdminConnection,
	type PgHarness,
} from '../support/pg-harness';

/**
 * JR-104 -- the harness proves its own contract.
 *
 * This file tests `tests/support/pg-harness.ts`, not production code. That is deliberate: every
 * later integration and adversarial test in this project inherits its isolation and teardown
 * guarantees from that module, and an isolation mechanism that silently does nothing would let a
 * whole epic report green while running against a shared database.
 *
 * The three acceptance criteria of JR-104, each with tests below:
 *   - isolation per run, two runs in parallel without interference
 *     -> "own database per acquisition", "a write in one harness is invisible in the other",
 *        "four concurrent acquisitions"
 *   - migrations applied automatically
 *     -> "applies the repository migrations, all of them"
 *   - teardown guaranteed, no residue
 *     -> "release() drops the database", "release() with a connection left open",
 *        "left no residue behind after the throwing test"
 *
 * Cross-*file* parallelism is exercised, not just asserted here: the `integration` project runs
 * test files in parallel with `isolate: true`, and `filter-builder.int.test.ts` /
 * `mongo-to-meli.int.test.ts` each acquire their own harness at the same time as this file. A
 * collision between them would fail the run.
 *
 * Classification: `ci`. Without Postgres the whole suite reports as skipped with the probe's
 * reason -- never as passed.
 */

const postgresProbe = await probePostgres();

/** Set by the nested "throwing test" describe so the sibling assertion can read it. */
let doomedDatabaseName = '';

suiteRequiring('ci', 'pg-harness: isolation, migrations, teardown (JR-104)', postgresProbe, () => {
	let primary: PgHarness;
	let secondary: PgHarness;

	beforeAll(async () => {
		// autoRelease: false -- acquiring inside beforeAll would mean registering an afterAll from
		// inside a running hook, which vitest does not support. Released explicitly below.
		[primary, secondary] = await Promise.all([
			acquireTestDatabase('harness-primary', { autoRelease: false }),
			acquireTestDatabase('harness-secondary', { autoRelease: false }),
		]);
	});

	afterAll(async () => {
		await Promise.all([primary?.release(), secondary?.release()]);
	});

	it('gives each acquisition its own database, and the session agrees', async () => {
		expect(primary.databaseName).not.toBe(secondary.databaseName);
		expect(primary.databaseName).toMatch(/^oa_test_\d{13}_/);

		const [primaryCurrent] = await primary.sql<{ db: string }[]>`
			select current_database() as db
		`;
		const [secondaryCurrent] = await secondary.sql<{ db: string }[]>`
			select current_database() as db
		`;
		// The failure this guards against is the silent one: an isolation mechanism that did not
		// take effect and left both handles pointing at the same shared database.
		expect(primaryCurrent!.db).toBe(primary.databaseName);
		expect(secondaryCurrent!.db).toBe(secondary.databaseName);
		expect(primaryCurrent!.db).not.toBe(secondaryCurrent!.db);
	});

	it('a write in one harness is invisible in the other, while both are open', async () => {
		// The same table, the same primary key and the same unique `name`, in both databases at the
		// same time. If the isolation were an illusion, the second insert would raise a unique
		// violation instead of succeeding.
		const sharedId = '11111111-1111-4111-8111-111111111111';
		for (const harness of [primary, secondary]) {
			await harness.sql`
				insert into roles (id, name, slug, policies)
				values (${sharedId}, 'harness-probe', 'harness-probe', '[]'::jsonb)
			`;
		}

		await primary.sql`update roles set name = 'changed-in-primary' where id = ${sharedId}`;

		const [fromPrimary] = await primary.sql<{ name: string }[]>`
			select name from roles where id = ${sharedId}
		`;
		const [fromSecondary] = await secondary.sql<{ name: string }[]>`
			select name from roles where id = ${sharedId}
		`;
		expect(fromPrimary!.name).toBe('changed-in-primary');
		expect(fromSecondary!.name).toBe('harness-probe');
	});

	it('applies the repository migrations, all of them, into each database', async () => {
		const expected = expectedMigrationCount();
		for (const harness of [primary, secondary]) {
			const [row] = await harness.sql<{ count: string }[]>`
				select count(*)::text as count from drizzle."__drizzle_migrations"
			`;
			expect(Number(row!.count), `${harness.databaseName} migration journal`).toBe(expected);
		}

		// A journal row proves drizzle believes it ran the migration; a real column proves it did.
		const columns = await primary.sql<{ column_name: string }[]>`
			select column_name from information_schema.columns
			where table_schema = 'public' and table_name = 'archived_emails'
		`;
		const names = new Set(columns.map((row) => row.column_name));
		expect(names.has('ingestion_source_id')).toBe(true);
		expect(names.has('storage_hash_sha256')).toBe(true);
		expect(names.has('is_journaled')).toBe(true);
	});

	it('keeps four concurrent acquisitions apart (no collision inside one millisecond)', async () => {
		const harnesses = await Promise.all(
			[0, 1, 2, 3].map((index) =>
				acquireTestDatabase(`concurrent-${index}`, { autoRelease: false })
			)
		);
		const names = harnesses.map((harness) => harness.databaseName);
		try {
			expect(new Set(names).size).toBe(4);
			const present = await listHarnessDatabases();
			for (const name of names) {
				expect(present, `${name} should exist on the server`).toContain(name);
			}
		} finally {
			await Promise.all(harnesses.map((harness) => harness.release()));
		}

		for (const name of names) {
			expect(await databaseExists(name), `${name} should be gone`).toBe(false);
		}
	});

	it('release() drops the database and is idempotent', async () => {
		const throwaway = await acquireTestDatabase('throwaway', { autoRelease: false });
		expect(await databaseExists(throwaway.databaseName)).toBe(true);

		await throwaway.release();
		expect(await databaseExists(throwaway.databaseName)).toBe(false);

		// The afterAll path and an explicit release must be able to both run; the second must not
		// fail the suite.
		await expect(throwaway.release()).resolves.toBeUndefined();
	});

	it('release() succeeds with a connection left open against the database', async () => {
		const leaky = await acquireTestDatabase('leaky', { autoRelease: false });
		// Hold a real backend open, the way a test that forgot to close a client would.
		const rows = await leaky.sql<{ n: number }[]>`select 1 as n`;
		expect(rows[0]!.n).toBe(1);

		await leaky.release();
		expect(await databaseExists(leaky.databaseName)).toBe(false);
	});

	/**
	 * Teardown after a throwing test.
	 *
	 * `it.fails` runs a test that throws and records it as passing, so the suite completes and the
	 * nested `afterAll` still executes -- exactly the situation the acceptance criterion cares
	 * about ("Teardown garantiert, auch wenn ein Test wirft"). The sibling test after this
	 * describe asserts, over an independent admin connection, that the database is gone.
	 *
	 * What this does NOT cover: a hard kill (SIGKILL) of the worker, where no hook of any kind
	 * runs. That residue is reclaimed by `sweepStaleHarnessDatabases()` on the next acquisition and
	 * announced by the exit handler; verifying it needs a child-process driver and is out of scope
	 * for JR-104.
	 */
	describe('teardown after a throwing test', () => {
		let doomed: PgHarness;

		beforeAll(async () => {
			doomed = await acquireTestDatabase('doomed', { autoRelease: false });
			doomedDatabaseName = doomed.databaseName;
		});

		afterAll(async () => {
			await doomed.release();
		});

		it.fails('throws on purpose, after using the database', async () => {
			const rows = await doomed.sql<{ n: number }[]>`select 1 as n`;
			expect(rows[0]!.n).toBe(1);
			throw new Error('deliberate failure: teardown must still run');
		});
	});

	it('left no residue behind after the throwing test', async () => {
		expect(
			doomedDatabaseName,
			'nested describe should have recorded its database name'
		).toMatch(/^oa_test_/);
		expect(await databaseExists(doomedDatabaseName)).toBe(false);
	});

	it('sweeps a stale database from a dead run but leaves a fresh one alone', async () => {
		// Names crafted the way a hard-killed run would have left them: another pid, no open
		// backends. One dated 2021 (stale), one dated now (a hypothetical concurrent run).
		const stale = 'oa_test_1609459200000_999999_deadaa_sweeptest';
		const fresh = `oa_test_${Date.now()}_999999_deadbb_sweeptest`;
		await withAdminConnection(async (sql) => {
			await sql.unsafe(`create database "${stale}"`);
			await sql.unsafe(`create database "${fresh}"`);
		});

		try {
			const dropped = await sweepStaleHarnessDatabases();
			expect(dropped).toContain(stale);
			expect(dropped).not.toContain(fresh);
			expect(await databaseExists(stale)).toBe(false);
			expect(await databaseExists(fresh)).toBe(true);
		} finally {
			await withAdminConnection(async (sql) => {
				await sql.unsafe(`drop database if exists "${stale}" with (force)`);
				await sql.unsafe(`drop database if exists "${fresh}" with (force)`);
			});
		}
	});

	it('never sweeps a database this process created, whatever the threshold', async () => {
		// The regression this pins: with OA_TEST_PG_STALE_MS set low, an earlier version of the
		// sweeper dropped its own run's live databases mid-suite.
		const own = await acquireTestDatabase('own-not-swept', { autoRelease: false });
		const previous = process.env.OA_TEST_PG_STALE_MS;
		process.env.OA_TEST_PG_STALE_MS = '1';
		try {
			const dropped = await sweepStaleHarnessDatabases();
			expect(dropped).not.toContain(own.databaseName);
			expect(dropped).not.toContain(primary.databaseName);
			expect(await databaseExists(own.databaseName)).toBe(true);
		} finally {
			if (previous === undefined) {
				delete process.env.OA_TEST_PG_STALE_MS;
			} else {
				process.env.OA_TEST_PG_STALE_MS = previous;
			}
			await own.release();
		}
	});

	it('states what it did not cover', () => {
		coverageNotice(
			'JR-104 pg-harness: teardown is verified for the throwing-test path and for a leaked ' +
				'connection. It is NOT verified for a hard kill (SIGKILL) of the vitest worker; that ' +
				'residue is only reclaimed by sweepStaleHarnessDatabases() on a later run.'
		);
		expect(doomedDatabaseName).not.toBe('');
	});
});
