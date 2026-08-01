import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import {
	PostgresLedgerWriter,
	chainHash,
	genesisChainHash,
	type LedgerAppendRequest,
} from '@open-archiver/journaling';
import type { JournalLedgerRecord } from '@open-archiver/types';
import { acquireTestDatabase } from '../support/pg-harness';
import { postgresTransactor, rollingBackTransactor } from '../support/postgres-transactor';
import { seedIngestionSource } from '../support/iam-seed';

/**
 * `LedgerWriter.append()` against real Postgres (`JR-206`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this proves that the unit test cannot
 * ---------------------------------------------------------------------------------------------
 * `ledger-writer.test.ts` asserts the **order** of the statements against a fake. This file asserts
 * that the rows are real and that the chain **re-verifies after a round trip through the database** —
 * every value read back out, re-encoded, re-hashed, and compared to the stored `chain_hash`.
 *
 * That round trip is the part with teeth. A writer can be perfectly ordered and still produce an
 * unverifiable chain if any hashed value does not survive storage: a timestamp losing microseconds, an
 * array coming back reordered, `jsonb` reformatting a payload, `bytea` mangling a byte. None of that is
 * visible until someone runs `verify` months later, which is exactly when it must not be discovered.
 * This is the smallest possible version of E9's `verify`, and it runs on every commit.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('ledger-writer') : undefined;

const digest = (seed: string): Buffer => createHash('sha256').update(seed, 'utf8').digest();

/** `2026-07-31T10:15:30.123Z`. A whole millisecond, as ADR-006 section 3.1 requires. */
const BASE_MICROS = 1_785_492_930_123_000n;

async function deploymentId(): Promise<string> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

function writerFor(deployment: string): PostgresLedgerWriter {
	return new PostgresLedgerWriter({
		deploymentId: deployment,
		transactor: postgresTransactor(harness!.sql),
	});
}

const request = (
	chainScopeId: string,
	overrides: Partial<LedgerAppendRequest> = {}
): LedgerAppendRequest => ({
	chainScopeId,
	receivedAtMicros: BASE_MICROS,
	eventType: 'receipt',
	remoteIp: '192.0.2.25',
	ehloName: 'mail.example.com',
	tlsVersion: 'TLSv1.3',
	tlsCipher: 'TLS_AES_256_GCM_SHA384',
	envelopeFrom: 'sender@example.com',
	envelopeRcpt: ['first@example.com', 'second@example.com', 'third@example.com'],
	sizeBytes: 4096n,
	contentSha256: digest('content'),
	duplicateOf: null,
	journalingSourceId: null,
	spoolTxId: '01JZZ0000000000000000000AA',
	eventPayload: { parse_failed: false, phase: 'A' },
	...overrides,
});

/**
 * Read a chain back as the records the encoding hashes.
 *
 * `received_at` is read as **microseconds via numeric arithmetic**, not as a `Date`: `extract` returns
 * `numeric` on PostgreSQL 14 and later, so the value is exact, while a `Date` would truncate to
 * milliseconds and could not reproduce the hash of a chain that stored anything finer. It also means
 * this reader does not depend on how the driver maps timestamps.
 *
 * Note `ORDER BY journal_ledger.seq` — qualified, and that is not decoration. The projection aliases
 * `seq::text AS seq`, and an unqualified `ORDER BY seq` binds to that **text** alias, sorting
 * 1, 10, 2, 3… The first version of this file did exactly that and reported a chain break at seq 10
 * that did not exist. The dangerous direction is the mirror image: read in the wrong order, a real
 * break can be hidden. `verify` (E9) reads the chain the same way and has the same trap.
 */
async function readChain(
	chainScopeId: string
): Promise<{ record: JournalLedgerRecord; prev: Buffer; stored: Buffer }[]> {
	const rows = await harness!.sql<
		{
			chain_scope_id: string;
			seq: string;
			received_micros: string;
			event_type: JournalLedgerRecord['eventType'];
			remote_ip: string | null;
			ehlo_name: string | null;
			tls_version: string | null;
			tls_cipher: string | null;
			envelope_from: string | null;
			envelope_rcpt: string[] | null;
			size_bytes: string | null;
			content_sha256: Uint8Array | null;
			duplicate_of: string | null;
			journaling_source_id: string | null;
			spool_txid: string | null;
			event_payload: Record<string, unknown> | null;
			prev_chain_hash: Uint8Array;
			chain_hash: Uint8Array;
		}[]
	>`
		select
			chain_scope_id,
			seq::text as seq,
			(extract(epoch from received_at) * 1000000)::bigint::text as received_micros,
			event_type, remote_ip, ehlo_name, tls_version, tls_cipher,
			envelope_from, envelope_rcpt, size_bytes::text as size_bytes, content_sha256,
			duplicate_of::text as duplicate_of, journaling_source_id, spool_txid, event_payload,
			prev_chain_hash, chain_hash
		from journal_ledger
		where chain_scope_id = ${chainScopeId}
		order by journal_ledger.seq asc
	`;
	return rows.map((row) => ({
		record: {
			chainScopeId: row.chain_scope_id,
			seq: BigInt(row.seq),
			receivedAtMicros: BigInt(row.received_micros),
			eventType: row.event_type,
			remoteIp: row.remote_ip,
			ehloName: row.ehlo_name,
			tlsVersion: row.tls_version,
			tlsCipher: row.tls_cipher,
			envelopeFrom: row.envelope_from,
			envelopeRcpt: row.envelope_rcpt,
			sizeBytes: row.size_bytes === null ? null : BigInt(row.size_bytes),
			contentSha256: row.content_sha256,
			duplicateOf: row.duplicate_of === null ? null : BigInt(row.duplicate_of),
			journalingSourceId: row.journaling_source_id,
			spoolTxId: row.spool_txid,
			eventPayload: row.event_payload as JournalLedgerRecord['eventPayload'],
		},
		prev: Buffer.from(row.prev_chain_hash),
		stored: Buffer.from(row.chain_hash),
	}));
}

suiteRequiring('ci', 'LedgerWriter.append() against Postgres (JR-206)', postgresProbe, () => {
	it('starts a chain at seq 1, chained to the genesis hash', async () => {
		const deployment = await deploymentId();
		const source = await seedIngestionSource(harness!.db);
		const result = await writerFor(deployment).append(request(source.id));

		expect(result.seq).toBe(1n);
		const genesis = genesisChainHash(deployment, source.id);
		expect(Buffer.from(result.prevChainHash).equals(genesis)).toBe(true);

		const chain = await readChain(source.id);
		expect(chain).toHaveLength(1);
		expect(chain[0]!.prev.equals(genesis)).toBe(true);
	});

	it('re-verifies a whole chain after the round trip — the point of the exercise', async () => {
		const deployment = await deploymentId();
		const source = await seedIngestionSource(harness!.db);
		const writer = writerFor(deployment);

		// Deliberately varied: differing recipient counts and orders, a null-heavy event, a payload
		// with keys out of alphabetical order, an unusual timestamp.
		await writer.append(request(source.id));
		await writer.append(
			request(source.id, {
				receivedAtMicros: BASE_MICROS + 877_000n,
				envelopeRcpt: ['zeta@example.com', 'alpha@example.com'],
				eventPayload: { z: 1, a: { nested: true }, m: [1, 2, 3] },
			})
		);
		await writer.append(
			request(source.id, {
				receivedAtMicros: BASE_MICROS + 2_000_000n,
				eventType: 'anchor',
				remoteIp: null,
				ehloName: null,
				tlsVersion: null,
				tlsCipher: null,
				envelopeFrom: null,
				envelopeRcpt: null,
				sizeBytes: null,
				contentSha256: null,
				spoolTxId: null,
				eventPayload: null,
			})
		);

		const chain = await readChain(source.id);
		expect(chain.map((entry) => entry.record.seq)).toEqual([1n, 2n, 3n]);

		// Recompute the chain from what the database returned, exactly as `verify` will have to.
		let expectedPrev = genesisChainHash(deployment, source.id);
		for (const entry of chain) {
			expect(entry.prev.equals(expectedPrev)).toBe(true);
			const recomputed = chainHash(entry.record, expectedPrev);
			expect(
				recomputed.equals(entry.stored),
				`chain_hash mismatch at seq ${entry.record.seq}`
			).toBe(true);
			expectedPrev = entry.stored;
		}
	});

	it('keeps microseconds and recipient order intact through storage', async () => {
		// The two values most likely to be quietly transformed, asserted directly rather than only via
		// the hash, so a failure says *what* changed instead of only that the chain broke.
		const deployment = await deploymentId();
		const source = await seedIngestionSource(harness!.db);
		const sent = request(source.id, {
			receivedAtMicros: BASE_MICROS + 999_000n,
			envelopeRcpt: ['zzz@example.com', 'aaa@example.com', 'mmm@example.com'],
		});
		await writerFor(deployment).append(sent);

		const [entry] = await readChain(source.id);
		expect(entry!.record.receivedAtMicros).toBe(sent.receivedAtMicros);
		expect(entry!.record.envelopeRcpt).toEqual(sent.envelopeRcpt);
	});

	it('runs seq per chain, so two archives are independent', async () => {
		// ADR-007 consequence 1. Both chains start at 1, and each is chained to its own genesis.
		const deployment = await deploymentId();
		const first = await seedIngestionSource(harness!.db);
		const second = await seedIngestionSource(harness!.db);
		const writer = writerFor(deployment);

		await writer.append(request(first.id));
		await writer.append(request(first.id));
		const secondResult = await writer.append(request(second.id));

		expect(secondResult.seq).toBe(1n);
		expect((await readChain(first.id)).map((entry) => entry.record.seq)).toEqual([1n, 2n]);
		expect(
			Buffer.from(secondResult.prevChainHash).equals(genesisChainHash(deployment, second.id))
		).toBe(true);
	});

	it('gives two chains different genesis hashes for an identical first event', async () => {
		// ADR-007 consequence 3, end to end: the same event in two chains must not produce the same
		// row hash, or an entry could be moved between tenants without breaking either chain.
		const deployment = await deploymentId();
		const first = await seedIngestionSource(harness!.db);
		const second = await seedIngestionSource(harness!.db);
		const writer = writerFor(deployment);

		const a = await writer.append(request(first.id));
		const b = await writer.append(request(second.id));
		expect(Buffer.from(a.chainHash).equals(Buffer.from(b.chainHash))).toBe(false);
	});

	it('consumes no seq when the transaction rolls back', async () => {
		// Why `max(seq) + 1` and not a sequence: `nextval()` survives a rollback and would leave a
		// permanent hole, and a hole is a tamper signal.
		const deployment = await deploymentId();
		const source = await seedIngestionSource(harness!.db);
		await writerFor(deployment).append(request(source.id));

		const abandoned = new PostgresLedgerWriter({
			deploymentId: deployment,
			transactor: rollingBackTransactor(harness!.sql),
		});
		const rolledBack = await abandoned.append(request(source.id));
		expect(rolledBack.seq).toBe(2n);

		// Nothing was written, so the next real append takes seq 2 as well.
		expect((await readChain(source.id)).map((entry) => entry.record.seq)).toEqual([1n]);
		const next = await writerFor(deployment).append(request(source.id));
		expect(next.seq).toBe(2n);

		const chain = await readChain(source.id);
		expect(chain.map((entry) => entry.record.seq)).toEqual([1n, 2n]);
		// And the chain is still sound across the gap that never happened.
		let prev = genesisChainHash(deployment, source.id);
		for (const entry of chain) {
			expect(chainHash(entry.record, prev).equals(entry.stored)).toBe(true);
			prev = entry.stored;
		}
	});

	it('serialises concurrent appends to the same chain, gaplessly', async () => {
		// The contract of ADR-007 consequence 2. Ten appends started at once on separate connections:
		// the advisory lock has to turn them into 1..10 with no gap, no duplicate and a chain that
		// verifies. The load version of this is JR-208; this is the functional case.
		const deployment = await deploymentId();
		const source = await seedIngestionSource(harness!.db);
		const writer = writerFor(deployment);

		const results = await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				writer.append(
					request(source.id, {
						receivedAtMicros: BASE_MICROS + BigInt(index) * 1000n,
						spoolTxId: `01JZZ${String(index).padStart(21, '0')}`,
					})
				)
			)
		);

		const seqs = results.map((result) => result.seq).sort((a, b) => Number(a - b));
		expect(seqs).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]);

		const chain = await readChain(source.id);
		expect(chain).toHaveLength(10);
		// Assert the read order before verifying the chain. Without this the walk below is only as
		// trustworthy as the ORDER BY, and a lexicographic sort (1, 10, 2, …) turns a sound chain into
		// a reported break -- and could hide a real one. This is the guard for the bug that was in the
		// first version of readChain().
		expect(chain.map((entry) => entry.record.seq)).toEqual([
			1n,
			2n,
			3n,
			4n,
			5n,
			6n,
			7n,
			8n,
			9n,
			10n,
		]);

		let prev = genesisChainHash(deployment, source.id);
		for (const entry of chain) {
			expect(entry.prev.equals(prev), `prev mismatch at seq ${entry.record.seq}`).toBe(true);
			expect(
				chainHash(entry.record, prev).equals(entry.stored),
				`chain_hash mismatch at seq ${entry.record.seq}`
			).toBe(true);
			prev = entry.stored;
		}

		// Every append read a different head. A duplicate here would mean the advisory lock did not
		// serialise, which is the failure the lock exists to prevent.
		const distinctPredecessors = new Set(chain.map((entry) => entry.prev.toString('hex')));
		expect(distinctPredecessors.size).toBe(10);
	});

	it('refuses a sub-millisecond timestamp without writing anything', async () => {
		const deployment = await deploymentId();
		const source = await seedIngestionSource(harness!.db);
		await expect(
			writerFor(deployment).append(request(source.id, { receivedAtMicros: BASE_MICROS + 1n }))
		).rejects.toThrow(/whole millisecond/);
		expect(await readChain(source.id)).toHaveLength(0);
	});
});
