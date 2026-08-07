import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { acquireTestDatabase } from '../support/pg-harness';
import { seedIngestionSource } from '../support/iam-seed';
import { deploymentIdentity, ingestionSources, journalLedger } from '../../src/database/schema';

/**
 * The `journal_ledger` and `deployment_identity` schema against real Postgres (`JR-2-04`, epic E2).
 * Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is an integration test and not a unit test
 * ---------------------------------------------------------------------------------------------
 * Everything asserted here is enforced by the **database**, not by TypeScript: five `CHECK`
 * constraints, a composite primary key, a composite foreign key, and an `ON DELETE restrict`. None of
 * them can be observed without a server, and each of them exists because application discipline alone
 * was judged insufficient — the ledger is the evidence, and the code that writes it is exactly the
 * code that could be wrong.
 *
 * The `CHECK` on `received_at` is the explicit acceptance criterion of `JR-2-04`: ADR-006 section 3.1
 * fixes the encoding at microseconds but allows only whole milliseconds to be written, because
 * `timestamptz` resolves to microseconds while JavaScript's `Date` resolves to milliseconds. Without
 * the constraint the invariant would live only in `packages/journaling`, and anything writing to the
 * table by another route — a fix-up script, a future service, psql — could produce a row whose chain
 * hash can never be reproduced.
 *
 * ---------------------------------------------------------------------------------------------
 * What this file deliberately does not do
 * ---------------------------------------------------------------------------------------------
 * It does not import `@open-archiver/journaling`. Proving that the canonical encoding's output
 * survives a round trip through these columns belongs with the writer (`JR-2-06`), which is where the
 * two halves actually meet; pulling the dependency in here to assert `bytea` is lossless would be a
 * wider claim than the test makes. The 32-byte round trip below uses a plain digest instead.
 *
 * Append-only enforcement is `JR-2-05`/ADR-009 and lives in
 * `journal-ledger-append-only.int.test.ts`. Since that migration exists, `UPDATE`, `DELETE` and
 * `TRUNCATE` on `journal_ledger` are refused — which is why nothing here mutates a ledger row. The
 * one `DELETE` below targets `ingestion_sources` and asserts the `ON DELETE restrict` on the chain
 * scope; teardown drops the whole database rather than deleting rows.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('journal-ledger') : undefined;

/** `2026-07-31T10:15:30.123Z` — a whole millisecond, as ADR-006 section 3.1 requires. */
const WHOLE_MS = new Date('2026-07-31T10:15:30.123Z');

const digest = (seed: string): Buffer => createHash('sha256').update(seed, 'utf8').digest();

/**
 * Flatten an error and its `cause` chain into one string.
 *
 * Needed because Drizzle wraps driver errors: its own message is `Failed query: insert into ...` and
 * the Postgres error — the one carrying the constraint name — sits in `cause`. Matching only the top
 * message would make every assertion below pass on *any* rejection, including a typo in the SQL,
 * which is the failure mode that makes a constraint test worthless.
 */
function errorChain(error: unknown): string {
	const parts: string[] = [];
	let current: unknown = error;
	while (current instanceof Error) {
		parts.push(current.message);
		current = (current as { cause?: unknown }).cause;
	}
	return parts.join(' | ');
}

/** Assert that a statement is rejected **by a named constraint**, not merely that it failed. */
async function expectViolation(statement: Promise<unknown>, constraint: RegExp): Promise<void> {
	let caught: unknown;
	try {
		await statement;
	} catch (error) {
		caught = error;
	}
	expect(caught, 'the statement was expected to be rejected, but it succeeded').toBeDefined();
	expect(errorChain(caught)).toMatch(constraint);
}

/** A minimal valid receipt row. Every test starts from this and breaks exactly one thing. */
function receiptRow(chainScopeId: string, seq: bigint) {
	return {
		chainScopeId,
		seq,
		receivedAt: WHOLE_MS,
		eventType: 'receipt' as const,
		remoteIp: '192.0.2.25',
		ehloName: 'mail.example.com',
		tlsVersion: 'TLSv1.3',
		tlsCipher: 'TLS_AES_256_GCM_SHA384',
		envelopeFrom: 'sender@example.com',
		envelopeRcpt: ['a@example.com', 'b@example.com'],
		sizeBytes: 4096n,
		contentSha256: digest(`content-${seq}`),
		duplicateOf: null,
		journalingSourceId: randomUUID(),
		spoolTxId: `01JZZ${seq.toString().padStart(21, '0')}`,
		eventPayload: { parse_failed: false },
		prevChainHash: digest(`prev-${seq}`),
		chainHash: digest(`chain-${seq}`),
	};
}

suiteRequiring('ci', 'journal_ledger schema (JR-2-04)', postgresProbe, () => {
	it('created both tables through the migration', async () => {
		const rows = await harness!.sql<{ table_name: string }[]>`
			select table_name from information_schema.tables
			where table_schema = 'public' and table_name in ('journal_ledger', 'deployment_identity')
			order by table_name
		`;
		expect(rows.map((row) => row.table_name)).toEqual([
			'deployment_identity',
			'journal_ledger',
		]);
	});

	it('seeded exactly one deployment identity, and it is a real UUID', async () => {
		// ADR-006 section 4.2: created by the migration itself via gen_random_uuid(), so there is no
		// race between two starting processes and no application code that could mint a second one.
		const rows = await harness!.db.select().from(deploymentIdentity);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.id).toBe(1);
		expect(rows[0]!.deploymentId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);
	});

	it('refuses a second deployment identity', async () => {
		// A second row would mean two genesis strings for the same installation.
		await expectViolation(
			harness!
				.sql`insert into deployment_identity (id, deployment_id) values (2, gen_random_uuid())`,
			/deployment_identity_single_row/
		);
	});

	it('accepts a whole-millisecond received_at', async () => {
		const source = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n));
		const rows = await harness!.db
			.select()
			.from(journalLedger)
			.where(eq(journalLedger.chainScopeId, source.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]!.seq).toBe(1n);
	});

	it('refuses a sub-millisecond received_at — the JR-2-04 acceptance criterion', async () => {
		// The invariant of ADR-006 section 3.1, in the database rather than only in the encoder. A
		// row like this would carry a chain hash that no later verification could reproduce.
		const source = await seedIngestionSource(harness!.db);
		// Written through the raw driver rather than Drizzle: a `Date` cannot express microseconds in
		// the first place, so the value has to arrive as a timestamp literal to test the constraint
		// at all. That is also the realistic threat -- a fix-up script or psql, not this codebase.
		await expectViolation(
			harness!.sql`
				insert into journal_ledger
					(chain_scope_id, seq, received_at, event_type, prev_chain_hash, chain_hash)
				values (
					${source.id}::uuid, 1, '2026-07-31T10:15:30.123456Z'::timestamptz, 'receipt',
					${digest('prev')}, ${digest('chain')}
				)
			`,
			/journal_ledger_received_at_whole_ms/
		);
	});

	it('accepts a whole second, which is also a whole millisecond', async () => {
		const source = await seedIngestionSource(harness!.db);
		const row = { ...receiptRow(source.id, 1n), receivedAt: new Date('2026-07-31T10:15:30Z') };
		await expect(harness!.db.insert(journalLedger).values(row)).resolves.toBeDefined();
	});

	it('keeps seq unique per chain', async () => {
		const source = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n));
		await expectViolation(
			harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n)),
			/journal_ledger_chain_scope_id_seq_pk/
		);
	});

	it('allows the same seq in a different chain', async () => {
		// ADR-007 consequence 1: seq runs per chain. A global seq would be a second, hidden
		// serialisation point, and two tenants would contend on every append.
		const first = await seedIngestionSource(harness!.db);
		const second = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(first.id, 1n));
		await expect(
			harness!.db.insert(journalLedger).values(receiptRow(second.id, 1n))
		).resolves.toBeDefined();
	});

	it('pins duplicate_of to the same chain', async () => {
		const first = await seedIngestionSource(harness!.db);
		const second = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(first.id, 1n));

		// Same chain, earlier seq: fine.
		await harness!.db
			.insert(journalLedger)
			.values({ ...receiptRow(first.id, 2n), duplicateOf: 1n });

		// Other chain, where seq 1 does not exist: refused by the composite key. With a
		// single-column reference to seq this could not be expressed at all, and a duplicate could
		// point across tenants.
		await expectViolation(
			harness!.db
				.insert(journalLedger)
				.values({ ...receiptRow(second.id, 2n), duplicateOf: 1n }),
			/journal_ledger_duplicate_of_fk/
		);
	});

	it('refuses a row that names itself as its own original', async () => {
		// Found by writing the test above. The composite foreign key alone does **not** catch this:
		// Postgres checks referential integrity at the end of the statement, by which time the
		// referenced pair (chain_scope_id, seq) is the very row being inserted, so the key is
		// satisfied and a receipt becomes its own original. The `duplicate_of < seq` check closes it,
		// and it states the real rule anyway -- the original precedes the duplicate.
		const source = await seedIngestionSource(harness!.db);
		await expectViolation(
			harness!.db
				.insert(journalLedger)
				.values({ ...receiptRow(source.id, 1n), duplicateOf: 1n }),
			/journal_ledger_duplicate_of_precedes/
		);
		// And a forward reference is refused for the same reason.
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n));
		await expectViolation(
			harness!.db
				.insert(journalLedger)
				.values({ ...receiptRow(source.id, 2n), duplicateOf: 5n }),
			/journal_ledger_duplicate_of_precedes/
		);
	});

	it('stores an event without a message, with size and content hash null', async () => {
		// An `anchor` event has no message. ADR-006 section 2 makes both columns nullable, against the
		// RFC's `CREATE TABLE`, because `0` would assert something about a message that never existed.
		const source = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values({
			chainScopeId: source.id,
			seq: 1n,
			receivedAt: WHOLE_MS,
			eventType: 'anchor',
			remoteIp: null,
			ehloName: null,
			tlsVersion: null,
			tlsCipher: null,
			envelopeFrom: null,
			envelopeRcpt: null,
			sizeBytes: null,
			contentSha256: null,
			duplicateOf: null,
			journalingSourceId: null,
			spoolTxId: null,
			eventPayload: { anchored_head_seq: 0, leaf_count: 1 },
			prevChainHash: digest('prev'),
			chainHash: digest('chain'),
		});
		const rows = await harness!.db
			.select()
			.from(journalLedger)
			.where(eq(journalLedger.chainScopeId, source.id));
		expect(rows[0]!.sizeBytes).toBeNull();
		expect(rows[0]!.contentSha256).toBeNull();
	});

	it('returns hash bytes unchanged — bytea is lossless for all 256 values', async () => {
		// The property the whole chain rests on. A text column would raise a case question here; a
		// lossy round trip would make every row unverifiable, and it would look like tampering.
		const source = await seedIngestionSource(harness!.db);
		const allBytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index * 8));
		await harness!.db
			.insert(journalLedger)
			.values({ ...receiptRow(source.id, 1n), chainHash: allBytes });
		const rows = await harness!.db
			.select()
			.from(journalLedger)
			.where(eq(journalLedger.chainScopeId, source.id));
		expect(Buffer.from(rows[0]!.chainHash).equals(allBytes)).toBe(true);
		expect(rows[0]!.chainHash).toHaveLength(32);
	});

	it('refuses a hash that is not 32 bytes', async () => {
		const source = await seedIngestionSource(harness!.db);
		await expectViolation(
			harness!.db
				.insert(journalLedger)
				.values({ ...receiptRow(source.id, 1n), chainHash: Buffer.alloc(16) }),
			/journal_ledger_chain_hash_len/
		);
		await expectViolation(
			harness!.db
				.insert(journalLedger)
				.values({ ...receiptRow(source.id, 2n), prevChainHash: Buffer.alloc(33) }),
			/journal_ledger_prev_chain_hash_len/
		);
		await expectViolation(
			harness!.db
				.insert(journalLedger)
				.values({ ...receiptRow(source.id, 3n), contentSha256: Buffer.alloc(31) }),
			/journal_ledger_content_sha256_len/
		);
	});

	it('refuses a negative seq', async () => {
		const source = await seedIngestionSource(harness!.db);
		await expectViolation(
			harness!.db.insert(journalLedger).values(receiptRow(source.id, -1n)),
			/journal_ledger_seq_nonnegative/
		);
	});

	it('blocks deleting an archive that has ledger rows', async () => {
		// `ON DELETE restrict`, and this is the behaviour it is there for: a receipt ledger that
		// disappears with the configuration that produced it proves nothing. `SET NULL` was not an
		// option either — chain_scope_id is hashed, so changing it would break the chain instead of
		// merely dropping a reference. Removing an archive whose retention has fully expired is a
		// deliberate procedure (E12), not a DELETE.
		const source = await seedIngestionSource(harness!.db);
		await harness!.db.insert(journalLedger).values(receiptRow(source.id, 1n));
		await expectViolation(
			harness!.db.delete(ingestionSources).where(eq(ingestionSources.id, source.id)),
			/journal_ledger_chain_scope_id_ingestion_sources_id_fk/
		);
	});

	it('carries every declared event type', async () => {
		// Postgres cannot drop enum values, so the list is effectively permanent; it is checked here
		// against the enum the encoder hashes (`JournalEventType` in packages/types).
		const rows = await harness!.sql<{ enumlabel: string }[]>`
			select enumlabel from pg_enum
			join pg_type on pg_type.oid = pg_enum.enumtypid
			where pg_type.typname = 'journal_event_type'
			order by pg_enum.enumsortorder
		`;
		expect(rows.map((row) => row.enumlabel)).toEqual([
			'receipt',
			'anchor',
			'parse_failed',
			'retention_expiry',
			'object_erased',
			'legal_hold_set',
			// ADR-037 (JR-6-03 follow-up): the duplicate_of marker's own event type, added last by
			// migration 0043 -- ALTER TYPE ... ADD VALUE always appends, never reorders.
			'duplicate_marker',
		]);
	});
});
