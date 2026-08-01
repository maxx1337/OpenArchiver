import { expect, it } from 'vitest';
import postgres from 'postgres';
import { suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';

/**
 * JR-1-01 / JR-1-02 -- the reference example for the `integration` category.
 *
 * Purpose: prove that the integration suite (a) exists, (b) actually talks to Postgres when one is
 * reachable, and (c) is **visibly skipped** with a stated reason when one is not. It is deliberately
 * minimal. The real harness -- one isolated schema per run, migrations applied automatically,
 * guaranteed teardown, two runs in parallel without interference -- is JR-1-04 and is not started
 * here.
 *
 * Note what this file does NOT import: `../../src/database`. That module throws at *import* time
 * when `DATABASE_URL` is unset, so a test importing it cannot even be collected in an environment
 * without configuration. The `postgres` driver is used directly instead.
 *
 * Classification: `ci` -- once a Postgres service container exists (JR-1-05) this runs on every PR.
 * In an environment without Postgres it reports as skipped, never as passed.
 */

// Top-level await: the probe result must be known before the suite is declared, so the skip reason
// can be part of the reported suite name.
const postgresProbe = await probePostgres();

suiteRequiring('ci', 'Postgres reachability (integration harness smoke)', postgresProbe, () => {
	it('connects and executes a trivial statement', async () => {
		const sql = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 2 });
		try {
			const rows = await sql<{ one: number }[]>`select 1 as one`;
			expect(rows).toHaveLength(1);
			expect(rows[0]!.one).toBe(1);
		} finally {
			await sql.end({ timeout: 5 });
		}
	});

	it('reports a server version, so a wrong service on the port is caught', async () => {
		const sql = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 2 });
		try {
			const rows = await sql<{ version: string }[]>`select version() as version`;
			expect(rows[0]!.version).toMatch(/PostgreSQL/i);
		} finally {
			await sql.end({ timeout: 5 });
		}
	});

	it('can create and drop an isolated schema (precondition for JR-1-04)', async () => {
		const schema = `oa_test_${process.pid}_${Date.now()}`;
		const sql = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 2 });
		try {
			await sql.unsafe(`create schema "${schema}"`);
			const present = await sql<{ count: string }[]>`
				select count(*)::text as count from information_schema.schemata
				where schema_name = ${schema}
			`;
			expect(present[0]!.count).toBe('1');
			await sql.unsafe(`drop schema "${schema}" cascade`);
			const gone = await sql<{ count: string }[]>`
				select count(*)::text as count from information_schema.schemata
				where schema_name = ${schema}
			`;
			// No residue in the database after the run -- Testplan rule 4.
			expect(gone[0]!.count).toBe('0');
		} finally {
			await sql.end({ timeout: 5 });
		}
	});
});
