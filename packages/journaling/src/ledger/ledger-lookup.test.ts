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

		// Found: mapped, with seq/received_at converted to the types the port promises.
		const found = result.get('01JZZ0000000000000000000AA');
		expect(found).toBeDefined();
		expect(found!.seq).toBe(3n);
		expect(found!.chainScopeId).toBe('11111111-1111-4111-8111-111111111111');
		expect(found!.remoteIp).toBe('192.0.2.25');
		expect(found!.receivedAt.toISOString()).toBe('2026-08-01T10:00:00.000Z');

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
	});
});
