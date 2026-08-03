import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { LedgerQuery } from '../ledger/ledger-port';
import { PostgresSourceAclLookup } from './source-acl';

/**
 * `JR-4-05a` -- `PostgresSourceAclLookup` against a recording fake `LedgerQuery`, the same
 * fake-first pattern `ledger-lookup.test.ts` uses for `PostgresLedgerLookup`. The proof that the
 * SQL text is actually correct against the real schema (`journaling_sources`, the `status`
 * column, `allowed_ips` round-tripping through a **bare**, non-drizzle-patched `postgres-js`
 * client per F38's rule) is `packages/backend/tests/integration/source-acl-lookup.int.test.ts`.
 */

function fakeQuery(rows: readonly Record<string, unknown>[]): {
	readonly query: LedgerQuery;
	calls: Array<{ text: string; values: readonly unknown[] }>;
} {
	const calls: Array<{ text: string; values: readonly unknown[] }> = [];
	return {
		calls,
		query: {
			async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
				calls.push({ text, values });
				return rows as unknown as Row[];
			},
		},
	};
}

suite('ci', 'PostgresSourceAclLookup (JR-4-05a)', () => {
	describe('listActiveSources', () => {
		it('maps rows into JournalingSourceAclEntry, decoding an already-decoded jsonb array', async () => {
			const { query } = fakeQuery([
				{
					id: 'source-1',
					ingestion_source_id: 'archive-1',
					allowed_ips: ['192.0.2.0/24', '2001:db8::/32'],
					require_tls: true,
					routing_address: 'journal-1@journaling.test.invalid',
					smtp_username: 'journal-1',
					smtp_password_hash: '$2b$10$abcdefghijklmnopqrstuv',
				},
			]);
			const lookup = new PostgresSourceAclLookup(query);
			const rows = await lookup.listActiveSources();

			expect(rows).toEqual([
				{
					id: 'source-1',
					chainScopeId: 'archive-1',
					allowedIps: ['192.0.2.0/24', '2001:db8::/32'],
					requireTls: true,
					routingAddress: 'journal-1@journaling.test.invalid',
					smtpUsername: 'journal-1',
					smtpPasswordHash: '$2b$10$abcdefghijklmnopqrstuv',
				},
			]);
		});

		it('maps smtp_username/smtp_password_hash through as null when AUTH is not configured for a source (JR-4-05c)', async () => {
			const { query } = fakeQuery([
				{
					id: 'source-1b',
					ingestion_source_id: 'archive-1b',
					allowed_ips: [],
					require_tls: false,
					routing_address: 'journal-1b@journaling.test.invalid',
					smtp_username: null,
					smtp_password_hash: null,
				},
			]);
			const lookup = new PostgresSourceAclLookup(query);
			const rows = await lookup.listActiveSources();

			expect(rows[0]!.smtpUsername).toBeNull();
			expect(rows[0]!.smtpPasswordHash).toBeNull();
		});

		it('decodes allowed_ips when it arrives as JSON text rather than a decoded array', async () => {
			const { query } = fakeQuery([
				{
					id: 'source-2',
					ingestion_source_id: 'archive-2',
					allowed_ips: '["10.0.0.0/8"]',
					require_tls: false,
					routing_address: 'journal-2@journaling.test.invalid',
				},
			]);
			const lookup = new PostgresSourceAclLookup(query);
			const rows = await lookup.listActiveSources();
			expect(rows[0]!.allowedIps).toEqual(['10.0.0.0/8']);
		});

		it('throws rather than silently returning [] for a value that decodes to a non-array', async () => {
			const { query } = fakeQuery([
				{
					id: 'source-3',
					ingestion_source_id: 'archive-3',
					allowed_ips: '{"not":"an array"}',
					require_tls: false,
					routing_address: 'journal-3@journaling.test.invalid',
				},
			]);
			const lookup = new PostgresSourceAclLookup(query);
			await expect(lookup.listActiveSources()).rejects.toThrow(/non-array/);
		});

		it('throws for a value that is neither an array nor a string', async () => {
			const { query } = fakeQuery([
				{
					id: 'source-4',
					ingestion_source_id: 'archive-4',
					allowed_ips: 42,
					require_tls: false,
					routing_address: 'journal-4@journaling.test.invalid',
				},
			]);
			const lookup = new PostgresSourceAclLookup(query);
			await expect(lookup.listActiveSources()).rejects.toThrow(
				/neither an array nor a JSON string/
			);
		});

		it('filters on status = active in the query itself, not in application code', async () => {
			const { query, calls } = fakeQuery([]);
			const lookup = new PostgresSourceAclLookup(query);
			await lookup.listActiveSources();
			expect(calls).toHaveLength(1);
			expect(calls[0]!.text).toMatch(/status\s*=\s*'active'/);
			expect(calls[0]!.text).toMatch(/journaling_sources/);
		});

		it('reads routing_address and orders by id (JR-4-05b)', async () => {
			const { query, calls } = fakeQuery([]);
			const lookup = new PostgresSourceAclLookup(query);
			await lookup.listActiveSources();
			expect(calls[0]!.text).toMatch(/routing_address/);
			expect(calls[0]!.text).toMatch(/order by id/i);
		});

		it('returns an empty array when no source is active', async () => {
			const { query } = fakeQuery([]);
			const lookup = new PostgresSourceAclLookup(query);
			expect(await lookup.listActiveSources()).toEqual([]);
		});
	});
});
