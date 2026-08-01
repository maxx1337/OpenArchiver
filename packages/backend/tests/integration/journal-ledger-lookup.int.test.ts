import { expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import {
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	type LedgerAppendRequest,
} from '@open-archiver/journaling';
import { acquireTestDatabase } from '../support/pg-harness';
import { bareLedgerQuery, postgresTransactor } from '../support/postgres-transactor';
import { seedIngestionSource } from '../support/iam-seed';

/**
 * `PostgresLedgerLookup.findBySpoolTxIds()` against real Postgres (`JR-3-05`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this proves that the unit test (`ledger-lookup.test.ts`) cannot
 * ---------------------------------------------------------------------------------------------
 * The unit test asserts the statement shape (one `ANY($1)` query) against a recording fake. This file
 * proves the query is actually correct against the real schema: `spool_txid = ANY($1)` resolves through
 * `journal_ledger_spool_txid_idx`, a `bigint` `seq` and a `bytea`-adjacent row round-trip through
 * `postgres-js` without corruption, and a batch mixing known and unknown ids comes back with exactly
 * the known ones present -- which is what `../../src/spool/crash-recovery.ts` depends on to decide
 * requeue-vs-quarantine correctly.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('ledger-lookup') : undefined;

const BASE_MICROS = 1_785_492_930_123_000n; // 2026-07-31T10:15:30.123Z, a whole millisecond.

async function deploymentId(): Promise<string> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

const request = (
	chainScopeId: string,
	spoolTxId: string,
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
	envelopeRcpt: ['rcpt@example.com'],
	sizeBytes: 4096n,
	contentSha256: null,
	duplicateOf: null,
	journalingSourceId: null,
	spoolTxId,
	eventPayload: null,
	...overrides,
});

suiteRequiring(
	'ci',
	'PostgresLedgerLookup.findBySpoolTxIds() against Postgres (JR-3-05)',
	postgresProbe,
	() => {
		it('resolves known spool_txids from a mixed batch and omits unknown ones', async () => {
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db);
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(harness!.sql),
			});

			const journalingSourceId = '33333333-3333-4333-8333-333333333333';
			const first = await writer.append(
				request(source.id, '01JZZ0000000000000000000AA', { journalingSourceId })
			);
			const second = await writer.append(
				request(source.id, '01JZZ0000000000000000000BB', {
					receivedAtMicros: BASE_MICROS + 5_000n,
					remoteIp: null,
					journalingSourceId: null,
				})
			);

			const lookup = new PostgresLedgerLookup(bareLedgerQuery(harness!.sql));
			const result = await lookup.findBySpoolTxIds([
				'01JZZ0000000000000000000AA',
				'01JZZ0000000000000000000BB',
				// Never written -- must come back absent, not null-valued.
				'01JZZ0000000000000000000ZZ',
			]);

			expect(result.size).toBe(2);
			expect(result.has('01JZZ0000000000000000000ZZ')).toBe(false);

			const found = result.get('01JZZ0000000000000000000AA')!;
			expect(found.seq).toBe(first.seq);
			expect(found.chainScopeId).toBe(source.id);
			expect(found.journalingSourceId).toBe(journalingSourceId);
			expect(found.remoteIp).toBe('192.0.2.25');
			expect(found.receivedAt.getTime()).toBe(Number(BASE_MICROS / 1000n));

			const foundSecond = result.get('01JZZ0000000000000000000BB')!;
			expect(foundSecond.seq).toBe(second.seq);
			expect(foundSecond.journalingSourceId).toBeNull();
			expect(foundSecond.remoteIp).toBeNull();
		});

		it('returns an empty map for a batch with no matches, without error', async () => {
			const lookup = new PostgresLedgerLookup(bareLedgerQuery(harness!.sql));
			const result = await lookup.findBySpoolTxIds(['01JZZ0000000000000000000NO']);
			expect(result.size).toBe(0);
		});

		it('performs no query at all for an empty batch', async () => {
			// Same contract as the unit test, verified against the real client: nothing here should even
			// reach the database for an idle spool.
			let queried = false;
			const lookup = new PostgresLedgerLookup({
				async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
					queried = true;
					const rows = await harness!.sql.unsafe(text, values as never[]);
					return rows as unknown as Row[];
				},
			});
			const result = await lookup.findBySpoolTxIds([]);
			expect(result.size).toBe(0);
			expect(queried).toBe(false);
		});
	}
);
