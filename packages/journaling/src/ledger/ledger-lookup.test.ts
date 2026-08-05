import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { LedgerQuery } from './ledger-port';
import { PostgresLedgerLookup } from './ledger-lookup';

/**
 * `PostgresLedgerLookup.findBySpoolTxIds()` against a recording fake (`JR-3-05`). Classification: `ci`.
 *
 * What this proves against a fake, and what it cannot: the same split as `ledger-writer.test.ts`. The
 * statement shape (one batched `ANY($1)` query, never one call per id) and the row-to-value mapping are
 * checked here; that the query actually resolves against real Postgres, with a real `bytea`/`bigint`
 * driver round trip, is `journal-ledger-lookup.int.test.ts` in `packages/backend/tests/integration/`.
 */

interface Recorded {
	readonly text: string;
	readonly values: readonly unknown[];
}

function fakeQuery(rows: Record<string, unknown>[]): { db: LedgerQuery; statements: Recorded[] } {
	const statements: Recorded[] = [];
	return {
		db: {
			async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
				statements.push({ text, values });
				return rows as Row[];
			},
		},
		statements,
	};
}

suite('ci', 'PostgresLedgerLookup.findBySpoolTxIds()', () => {
	it('does not touch the database for an empty batch', async () => {
		const fake = fakeQuery([]);
		const lookup = new PostgresLedgerLookup(fake.db);

		const result = await lookup.findBySpoolTxIds([]);

		expect(result.size).toBe(0);
		expect(fake.statements).toHaveLength(0);
	});

	it('resolves a whole batch in exactly one query, using WHERE spool_txid = ANY($1)', async () => {
		const fake = fakeQuery([
			{
				spool_txid: '01JZZ0000000000000000000AA',
				seq: '3',
				chain_scope_id: '11111111-1111-4111-8111-111111111111',
				journaling_source_id: null,
				remote_ip: '192.0.2.25',
				received_at: new Date('2026-08-01T10:00:00.000Z'),
				event_type: 'receipt',
				content_sha256: new Uint8Array(32).fill(0xab),
				size_bytes: '4096',
			},
		]);
		const lookup = new PostgresLedgerLookup(fake.db);

		const result = await lookup.findBySpoolTxIds([
			'01JZZ0000000000000000000AA',
			'01JZZ0000000000000000000BB',
		]);

		expect(fake.statements).toHaveLength(1);
		expect(fake.statements[0]!.text).toMatch(/spool_txid = ANY\(\$1\)/);
		expect(fake.statements[0]!.values).toEqual([
			['01JZZ0000000000000000000AA', '01JZZ0000000000000000000BB'],
		]);

		// JR-6-02a: the three columns Phase B verifies a spool file against have to be *selected*, not
		// only mapped. Asserted against the statement text because a mapping that reads a column the
		// query never asked for yields `undefined` on every row -- and `undefined` is precisely what the
		// first version of this code turned into `Cannot convert undefined to a BigInt`.
		expect(fake.statements[0]!.text).toMatch(/event_type/);
		expect(fake.statements[0]!.text).toMatch(/content_sha256/);
		expect(fake.statements[0]!.text).toMatch(/size_bytes/);

		// Found: mapped, with seq/received_at converted to the types the port promises.
		const found = result.get('01JZZ0000000000000000000AA');
		expect(found).toBeDefined();
		expect(found!.seq).toBe(3n);
		expect(found!.chainScopeId).toBe('11111111-1111-4111-8111-111111111111');
		expect(found!.remoteIp).toBe('192.0.2.25');
		expect(found!.receivedAt.toISOString()).toBe('2026-08-01T10:00:00.000Z');
		expect(found!.eventType).toBe('receipt');
		expect(found!.contentSha256).toEqual(new Uint8Array(32).fill(0xab));
		expect(found!.sizeBytes).toBe(4096n);

		// Not found: absent from the map, not present with a null/undefined value.
		expect(result.has('01JZZ0000000000000000000BB')).toBe(false);
		expect(result.get('01JZZ0000000000000000000BB')).toBeUndefined();
	});

	it('converts a string-encoded received_at (some drivers do not parse timestamptz automatically)', async () => {
		const fake = fakeQuery([
			{
				spool_txid: '01JZZ0000000000000000000CC',
				seq: 7n,
				chain_scope_id: '22222222-2222-4222-8222-222222222222',
				journaling_source_id: 'source-1',
				remote_ip: null,
				received_at: '2026-08-01T11:30:00.000Z',
				event_type: 'receipt',
				content_sha256: new Uint8Array(32).fill(0x01),
				size_bytes: 512n,
			},
		]);
		const lookup = new PostgresLedgerLookup(fake.db);

		const result = await lookup.findBySpoolTxIds(['01JZZ0000000000000000000CC']);

		const found = result.get('01JZZ0000000000000000000CC')!;
		expect(found.seq).toBe(7n);
		expect(found.journalingSourceId).toBe('source-1');
		expect(found.remoteIp).toBeNull();
		expect(found.receivedAt).toBeInstanceOf(Date);
		expect(found.receivedAt.toISOString()).toBe('2026-08-01T11:30:00.000Z');
		// A driver that hands back `bigint` directly, not only the string form above.
		expect(found.sizeBytes).toBe(512n);
	});

	it.each([
		['SQL NULL', null],
		['a column the driver omitted entirely', undefined],
	])(
		'normalises %s in content_sha256 and size_bytes to null, so the gate branches correctly',
		async (_label, absent) => {
			// The gate (`../phase-b/spool-entry-gate.ts`) branches on `contentSha256 === null`. An
			// `undefined` reaching it takes the "hash present" branch and then hex-encodes nothing --
			// a receipt with no hash would be reported as a content mismatch, i.e. as tampering.
			const fake = fakeQuery([
				{
					spool_txid: '01JZZ0000000000000000000DD',
					seq: 9n,
					chain_scope_id: '33333333-3333-4333-8333-333333333333',
					journaling_source_id: null,
					remote_ip: null,
					received_at: new Date('2026-08-01T12:00:00.000Z'),
					event_type: 'anchor',
					content_sha256: absent as Uint8Array | null | undefined,
					size_bytes: absent as string | bigint | null | undefined,
				},
			]);
			const lookup = new PostgresLedgerLookup(fake.db);

			const found = (await lookup.findBySpoolTxIds(['01JZZ0000000000000000000DD'])).get(
				'01JZZ0000000000000000000DD'
			)!;
			expect(found.contentSha256).toBeNull();
			expect(found.sizeBytes).toBeNull();
			expect(found.eventType).toBe('anchor');
		}
	);
});
