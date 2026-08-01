import { createHash } from 'node:crypto';
import { expect, it, afterAll } from 'vitest';
import postgres from 'postgres';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import {
	JournalAcceptance,
	PostgresLedgerWriter,
	chainHash,
	genesisChainHash,
	isAccepted,
	normalizeRemoteIp,
	type JournalTransactionInput,
	type LedgerAppendRequest,
} from '@open-archiver/journaling';
import type { JournalLedgerRecord } from '@open-archiver/types';
import { acquireTestDatabase } from '../support/pg-harness';
import { postgresTransactor } from '../support/postgres-transactor';
import { seedIngestionSource } from '../support/iam-seed';
import { MemorySpoolFileSystem } from '../support/memory-spool-fs';

/**
 * `JournalAcceptance.accept()` end to end against real Postgres, through a client that has **never**
 * been given to `drizzle()` (`JR-3-04`, F38). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this file exists, and why the other 14 `JR-3-04` tests could not close this gap
 * ---------------------------------------------------------------------------------------------
 * `acceptance.test.ts` proves the acceptance wiring's *order* (spool, then ledger, then success)
 * against fakes -- correct, and orthogonal to what this file checks, which is what happens once a
 * *real* `LedgerBackend` is on the other end of `backend.append()`.
 *
 * Every one of this repository's other Postgres integration tests writes through `harness.sql` from
 * `pg-harness.ts` (`journal-ledger-writer.int.test.ts`, `ledger-backend-contract.int.test.ts`, the
 * concurrency/tamper adversarial suites' seeding). That client looks bare -- it is constructed with
 * plain `postgres(url, ...)` -- but `pg-harness.ts` also builds `harness.db = drizzle(client, { schema
 * })` from the *same* client object, and `drizzle()` patches the instance it is given rather than
 * wrapping it. `F38` (`docs/dev/journaling/09-befunde-bestandscode.md`) was found only because a load
 * test happened to open its own pool instead of reusing `harness.sql`: `PostgresLedgerWriter` bound a
 * non-null `event_payload` as `JSON.stringify(...)` to a `$16::text::jsonb`-cast placeholder: the
 * driver still infers `jsonb` from the placeholder's target type and re-encodes the already-stringified
 * JSON a second time. Every test that wrote through `harness.sql` (the drizzle-patched client) got a
 * proper object back and stayed green; a bare client got a string containing `"{\"k\":1}"` and would
 * have caught it immediately, but nothing wrote through one until the load test tripped over it by
 * accident.
 *
 * `apps/smtp-ingress` (E4) is exactly the case none of those tests represent: it will hold a Postgres
 * connection injected into `packages/journaling` (architecture section 2) and will never import
 * drizzle at all, because `packages/journaling` may not depend on `packages/backend`. This file is the
 * test F38 asks for: "for anything in `packages/journaling` that gets its connection injected, at
 * least one test must write through a bare client." `postgres(harness.url, ...)` below is that client
 * -- constructed directly from the harness's connection URL and never passed to `drizzle()` anywhere in
 * this file's reachable code.
 *
 * ---------------------------------------------------------------------------------------------
 * What is and is not exercised
 * ---------------------------------------------------------------------------------------------
 * The first case drives the full `JournalAcceptance.accept()` path -- high-water-mark check, durable
 * write (against `MemorySpoolFileSystem`, see that file for why not a real disk or the fault-injectable
 * fake), ledger append, typed result -- and then re-verifies the row Postgres actually stored: the
 * chain hash recomputed from what comes back must equal the stored `chain_hash`, exactly the property
 * `verify` (E9) will depend on. That is "correct and re-verifiable" measured, not assumed.
 *
 * It does **not** exercise the F38 regression itself: `JournalAcceptance` hardcodes `eventPayload:
 * null` for every Phase A receipt (object-level dedup is Phase B's job, per the module doc comment on
 * `acceptance.ts`), so no code path reachable from `accept()` can carry a non-null JSON payload for
 * F38 to corrupt. The second case closes that gap directly: it drives `PostgresLedgerWriter.append()`
 * -- through the same bare client -- with a non-null `eventPayload` with keys out of alphabetical
 * order, and asserts it comes back as an object rather than a JSON-encoded string. That is the exact
 * shape of the original defect.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('accept-bare-client') : undefined;

/**
 * Constructed directly from the harness's connection URL, never from `harness.sql`, and never handed
 * to `drizzle()` anywhere in this file. This is the "bare client" the module doc comment is about.
 */
const bareClient = harness
	? postgres(harness.url, { max: 2, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} })
	: undefined;

afterAll(async () => {
	await bareClient?.end({ timeout: 10 }).catch(() => undefined);
});

async function deploymentId(): Promise<string> {
	// Reading through harness.sql is fine here -- it is only fetching a fixed UUID written by a
	// migration, not exercising the write path this file is about.
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

/** Read one chain-scope's rows back through the bare client, as the encoding hashes them. */
async function readChainViaBareClient(
	chainScopeId: string
): Promise<{ record: JournalLedgerRecord; prevChainHash: Buffer; storedChainHash: Buffer }[]> {
	const rows = await bareClient!<
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
			event_payload: unknown;
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
	// Qualified ORDER BY, deliberately: journal-ledger-writer.int.test.ts's doc comment explains why an
	// unqualified `order by seq` binds to the `seq::text` alias and sorts lexicographically.
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
		prevChainHash: Buffer.from(row.prev_chain_hash),
		storedChainHash: Buffer.from(row.chain_hash),
	}));
}

async function* chunksOf(...parts: string[]): AsyncGenerator<Uint8Array> {
	for (const part of parts) {
		yield Buffer.from(part);
	}
}

function baseInput(
	chainScopeId: string,
	overrides: Partial<JournalTransactionInput> = {}
): JournalTransactionInput {
	return {
		chainScopeId,
		receivedAtMicros: 1_785_492_930_123_000n,
		remoteIp: '::ffff:192.0.2.25',
		ehloName: 'mail.example.com',
		tlsVersion: 'TLSv1.3',
		tlsCipher: 'TLS_AES_256_GCM_SHA384',
		envelopeFrom: 'sender@example.com',
		envelopeRcpt: ['zeta@example.com', 'alpha@example.com'],
		journalingSourceId: null,
		chunks: chunksOf('Subject: bare client test\r\n\r\nhello, journal.\r\n'),
		...overrides,
	};
}

suiteRequiring(
	'ci',
	'JournalAcceptance.accept() through a bare (non-drizzle) Postgres client (JR-3-04, F38)',
	postgresProbe,
	() => {
		it('durably accepts a transaction and produces a ledger row that re-verifies after the round trip', async () => {
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db);
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(bareClient!),
			});
			const fs = new MemorySpoolFileSystem();
			const acceptance = new JournalAcceptance({
				fs,
				backend: writer,
				spoolConfig: { rootPath: '/spool', highWaterBytes: 10_000_000n },
			});

			const sentBytes = Buffer.from('Subject: bare client test\r\n\r\nhello, journal.\r\n');
			const result = await acceptance.accept(baseInput(source.id));

			expect(isAccepted(result)).toBe(true);
			if (!isAccepted(result)) {
				return;
			}
			expect(result.seq).toBe(1n);

			const chain = await readChainViaBareClient(source.id);
			expect(chain).toHaveLength(1);
			const entry = chain[0]!;

			// The exact defect F38 could have hidden here: eventType/eventPayload for every Phase A
			// receipt is fixed, but everything else below is the same round trip that defect broke --
			// bytea (content hash, chain hashes), text[] (recipient order), bigint (size, seq),
			// microsecond timestamps, and a normalised (not raw) remote IP.
			expect(entry.record.eventType).toBe('receipt');
			expect(entry.record.eventPayload).toBeNull();
			expect(entry.record.sizeBytes).toBe(BigInt(sentBytes.byteLength));
			expect(
				Buffer.from(entry.record.contentSha256!).equals(
					createHash('sha256').update(sentBytes).digest()
				)
			).toBe(true);
			expect(entry.record.envelopeRcpt).toEqual(['zeta@example.com', 'alpha@example.com']);
			expect(entry.record.remoteIp).toBe(normalizeRemoteIp('::ffff:192.0.2.25'));
			expect(entry.record.remoteIp).toBe('192.0.2.25');

			// Re-verify: recompute the chain hash from exactly what the bare client read back, and
			// compare against what the bare client's own write put in the `chain_hash` column. This is
			// the smallest form of what `verify` (E9) does, and it is the actual point of the exercise --
			// a writer can look perfectly ordered and still be unverifiable if any hashed value did not
			// survive the round trip through this specific (non-drizzle) client.
			const genesis = genesisChainHash(deployment, source.id);
			expect(entry.prevChainHash.equals(genesis)).toBe(true);
			const recomputed = chainHash(entry.record, genesis);
			expect(recomputed.equals(entry.storedChainHash)).toBe(true);
			expect(Buffer.from(result.chainHash).equals(entry.storedChainHash)).toBe(true);
		});

		it('does not double-encode a non-null event_payload through the bare client (F38 regression)', async () => {
			// JournalAcceptance cannot carry a non-null eventPayload (see the module doc comment above),
			// so this drives PostgresLedgerWriter.append() directly -- still through the same bare
			// client -- to exercise the exact shape of the original defect: a JSON object with keys
			// deliberately out of alphabetical order, going in as $16::text::jsonb.
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db);
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(bareClient!),
			});

			const request: LedgerAppendRequest = {
				chainScopeId: source.id,
				receivedAtMicros: 1_785_492_930_123_000n,
				eventType: 'parse_failed',
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
				eventPayload: { z: 1, a: { nested: true }, m: [1, 2, 3] },
			};
			await writer.append(request);

			const chain = await readChainViaBareClient(source.id);
			expect(chain).toHaveLength(1);
			// The F38 failure mode: `event_payload` comes back as the *string*
			// '{"z":1,"a":{"nested":true},"m":[1,2,3]}' instead of the object. `typeof` on a string vs.
			// an object is the sharpest assertion available for that distinction.
			expect(typeof chain[0]!.record.eventPayload).toBe('object');
			expect(chain[0]!.record.eventPayload).toEqual({
				z: 1,
				a: { nested: true },
				m: [1, 2, 3],
			});

			// And the chain still verifies with a payload in it, through the same bare client.
			const genesis = genesisChainHash(deployment, source.id);
			const recomputed = chainHash(chain[0]!.record, genesis);
			expect(recomputed.equals(chain[0]!.storedChainHash)).toBe(true);
		});
	}
);
