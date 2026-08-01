import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import { acquireTestDatabase } from '../support/pg-harness';
import { seedIngestionSource } from '../support/iam-seed';
import { deploymentIdentity, journalLedger } from '../../src/database/schema';

/**
 * Append-only enforcement on the ledger (`JR-205`, **ADR-009**). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What is enforced, and by what
 * ---------------------------------------------------------------------------------------------
 * Migration `0042_journal_ledger_append_only.sql` installs one `plpgsql` function and **four**
 * triggers: per table, one for `UPDATE OR DELETE` at row level and one for `TRUNCATE` at statement
 * level. The `TRUNCATE` half is not decoration — `TRUNCATE` does not fire row-level triggers at all,
 * so a row trigger alone would leave a single statement able to remove the entire ledger.
 *
 * `deployment_identity` is in scope for the same reason as `journal_ledger`: `deployment_id` sits
 * inside the genesis hash of every chain (ADR-006 section 4.2), so changing it invalidates every
 * chain in the installation.
 *
 * ---------------------------------------------------------------------------------------------
 * The limit of this protection, and why it is not asserted here
 * ---------------------------------------------------------------------------------------------
 * The trigger holds against the path that matters in practice: **F1** injects raw SQL into a `WHERE`
 * clause and cannot issue a `SET` or an `ALTER TABLE`, because `postgres-js` uses the extended
 * protocol and does not allow statement stacking.
 *
 * It does **not** hold against arbitrary SQL on this connection: `SET session_replication_role =
 * replica` and `ALTER TABLE ... DISABLE TRIGGER` both succeed, because `POSTGRES_USER` in a
 * `postgres` image is superuser and owns every table. That is measured and written down as **F37**,
 * with the deployment work it implies queued for E11 — it is deliberately **not** a test here. A test
 * asserting "the protection can be bypassed" would turn red the moment E11 hardens the role, and
 * whoever hit that failure would have no way to tell a regression from the intended fix.
 *
 * What *is* asserted instead is that the triggers exist and are **enabled**. That is the assertion
 * with a future: it catches someone disabling them and leaving them disabled.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('ledger-append-only') : undefined;

const WHOLE_MS = new Date('2026-07-31T10:15:30.123Z');
const digest = (seed: string): Buffer => createHash('sha256').update(seed, 'utf8').digest();

/** Flatten an error and its `cause` chain — Drizzle wraps the driver error (see the schema test). */
function errorChain(error: unknown): string {
	const parts: string[] = [];
	let current: unknown = error;
	while (current instanceof Error) {
		parts.push(current.message);
		current = (current as { cause?: unknown }).cause;
	}
	return parts.join(' | ');
}

async function expectRefused(statement: Promise<unknown>, pattern: RegExp): Promise<void> {
	let caught: unknown;
	try {
		await statement;
	} catch (error) {
		caught = error;
	}
	expect(caught, 'the statement was expected to be refused, but it succeeded').toBeDefined();
	expect(errorChain(caught)).toMatch(pattern);
}

function receiptRow(chainScopeId: string, seq: bigint) {
	return {
		chainScopeId,
		seq,
		receivedAt: WHOLE_MS,
		eventType: 'receipt' as const,
		remoteIp: '192.0.2.25',
		envelopeFrom: 'sender@example.com',
		envelopeRcpt: ['a@example.com'],
		sizeBytes: 4096n,
		contentSha256: digest(`content-${seq}`),
		prevChainHash: digest(`prev-${seq}`),
		chainHash: digest(`chain-${seq}`),
	};
}

suiteRequiring('ci', 'journal_ledger append-only (JR-205)', postgresProbe, () => {
	// Testplan rule 6: no silent caps. Emitted from the suite body rather than from an `it` with a
	// `expect(true)` in it -- a test without an assertion is a violation of rule 2, and a notice does
	// not need to pretend to be one.
	coverageNotice(
		'JR-205: the append-only triggers are verified against UPDATE, DELETE and TRUNCATE for every ' +
			'role. They are NOT verified against `SET session_replication_role = replica` or ' +
			'`ALTER TABLE ... DISABLE TRIGGER`, both of which succeed for the owning role and are ' +
			'measured in F37. Closing that is a deployment change queued for E11 (ADR-009).'
	);

	it('refuses UPDATE on a ledger row', async () => {
		const source = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n));
		// The exact tamper from testplan section 12.5 (f): presenting a cleartext session as TLS.
		await expectRefused(
			harness!.db
				.update(journalLedger)
				.set({ tlsVersion: 'TLSv1.3' })
				.where(eq(journalLedger.chainScopeId, source.id)),
			/append-only/
		);
	});

	it('refuses DELETE on a ledger row', async () => {
		const source = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n));
		await expectRefused(
			harness!.db.delete(journalLedger).where(eq(journalLedger.chainScopeId, source.id)),
			/append-only/
		);
	});

	it('refuses TRUNCATE on the ledger', async () => {
		// The hole a row-level trigger alone would leave: TRUNCATE fires no row triggers, so one
		// statement would remove every receipt in the installation.
		await expectRefused(harness!.sql`truncate journal_ledger`, /append-only/);
	});

	it('refuses UPDATE, DELETE and TRUNCATE on deployment_identity', async () => {
		// Changing deployment_id would invalidate every chain, since it is part of every genesis hash.
		await expectRefused(
			harness!.sql`update deployment_identity set deployment_id = gen_random_uuid()`,
			/append-only/
		);
		await expectRefused(harness!.sql`delete from deployment_identity`, /append-only/);
		await expectRefused(harness!.sql`truncate deployment_identity`, /append-only/);
	});

	it('still allows INSERT — the ledger has to keep growing', async () => {
		// The failure mode worth guarding: a protection that also blocks appends would stop ingestion,
		// and ingestion must never stop (ADR-008).
		const source = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n));
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 2n));
		const rows = await harness!.db
			.select()
			.from(journalLedger)
			.where(eq(journalLedger.chainScopeId, source.id));
		expect(rows).toHaveLength(2);
	});

	it('leaves the identity row readable', async () => {
		const rows = await harness!.db.select().from(deploymentIdentity);
		expect(rows).toHaveLength(1);
	});

	it('reports the reason and the remedy, not just a failure', async () => {
		// An operator who hits this needs to know that erasure is an appended event, not a DELETE
		// (RFC section 10). An error that says only "refused" invites someone to disable the trigger.
		const source = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n));
		let caught: unknown;
		try {
			await harness!.db
				.delete(journalLedger)
				.where(eq(journalLedger.chainScopeId, source.id));
		} catch (error) {
			caught = error;
		}
		const text = errorChain(caught);
		expect(text).toMatch(/DELETE on journal_ledger is refused/);
		expect(text).toMatch(/JR-205, ADR-009/);
		const code = (caught as { cause?: { code?: string } })?.cause?.code;
		// restrict_violation, so a caller can distinguish this from a connection failure.
		expect(code).toBe('23001');
	});

	it('has all four triggers installed and enabled', async () => {
		// The assertion with a future: it catches someone disabling a trigger and leaving it disabled.
		// `tgenabled = 'O'` is the normal, origin-firing state; 'D' is disabled.
		const rows = await harness!.sql<{ tgname: string; tgenabled: string; rel: string }[]>`
			select tgname, tgenabled::text as tgenabled, tgrelid::regclass::text as rel
			from pg_trigger
			where not tgisinternal
			  and tgrelid in ('journal_ledger'::regclass, 'deployment_identity'::regclass)
			order by tgname
		`;
		expect(rows.map((row) => row.tgname)).toEqual([
			'deployment_identity_append_only',
			'deployment_identity_no_truncate',
			'journal_ledger_append_only',
			'journal_ledger_no_truncate',
		]);
		expect(rows.every((row) => row.tgenabled === 'O')).toBe(true);
	});
});
