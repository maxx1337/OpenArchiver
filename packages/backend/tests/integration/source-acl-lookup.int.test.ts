import postgres from 'postgres';
import { afterAll, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { PostgresSourceAclLookup, type LedgerQuery } from '@open-archiver/journaling';
import { acquireTestDatabase } from '../support/pg-harness';
import { seedIngestionSource, seedJournalingSource } from '../support/iam-seed';

/**
 * `PostgresSourceAclLookup.listActiveSources()` against real Postgres (`JR-4-05a`). Classification:
 * `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * F38's rule, applied to this port
 * ---------------------------------------------------------------------------------------------
 * `docs/dev/journaling/09-befunde-bestandscode.md` F38: the only `postgres-js` client in this
 * repository that behaves differently from production is `harness.sql`, because `drizzle(client,
 * ...)` patches whatever client it is given. Everything in `packages/journaling` gets its
 * connection **injected** and is never routed through `drizzle` in production (`apps/smtp-ingress`
 * has no dependency on `drizzle` at all) -- so at least one test here reads through a client this
 * file constructs itself with `postgres(harness.url, ...)`, never handed to `drizzle()`, mirroring
 * `journal-ledger-concurrency.adv.test.ts`'s `pool` rather than `journal-ledger-lookup.int.test.ts`'s
 * `bareLedgerQuery(harness.sql)` (which, despite its name, still reads through the harness's
 * drizzle-patched client).
 *
 * ---------------------------------------------------------------------------------------------
 * What this proves that `../unit`/`../.../src/ingress/source-acl.test.ts` cannot
 * ---------------------------------------------------------------------------------------------
 * The unit test asserts the statement shape against a recording fake. This file proves the query is
 * correct against the real schema: `status = 'active'` actually excludes a paused source, `jsonb`
 * `allowed_ips` round-trips (including an empty array) through a client `drizzle` never touched, and
 * `ingestion_source_id` comes back as the `chainScopeId` a caller needs. Since `JR-4-05b`: the same
 * is true of `routing_address`, the column the recipient ACL reads through this same port.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('source-acl-lookup') : undefined;

/** Deliberately never handed to `drizzle()` -- see the module doc comment's "F38's rule" section. */
const bareClient = enabled
	? postgres(harness!.url, { max: 2, connect_timeout: 15, onnotice: () => {} })
	: undefined;

afterAll(async () => {
	await bareClient?.end({ timeout: 5 }).catch(() => undefined);
});

function bareQuery(): LedgerQuery {
	return {
		async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
			const rows = await bareClient!.unsafe(text, values as never[]);
			return rows as unknown as Row[];
		},
	};
}

suiteRequiring(
	'ci',
	'PostgresSourceAclLookup.listActiveSources() against Postgres (JR-4-05a)',
	postgresProbe,
	() => {
		it('reads an active source, its CIDR list and require_tls through a bare, non-drizzle-patched client', async () => {
			const archive = await seedIngestionSource(harness!.db);
			const source = await seedJournalingSource(harness!.db, {
				ingestionSourceId: archive.id,
				allowedIps: ['192.0.2.0/24', '2001:db8::/32'],
				requireTls: true,
			});

			const lookup = new PostgresSourceAclLookup(bareQuery());
			const rows = await lookup.listActiveSources();

			const found = rows.find((row) => row.id === source.id);
			expect(found).toBeDefined();
			expect(found!.chainScopeId).toBe(archive.id);
			expect(found!.allowedIps).toEqual(['192.0.2.0/24', '2001:db8::/32']);
			expect(found!.requireTls).toBe(true);
			expect(found!.routingAddress).toBe(source.routingAddress);
		});

		it('excludes a paused source', async () => {
			const archive = await seedIngestionSource(harness!.db);
			const source = await seedJournalingSource(harness!.db, {
				ingestionSourceId: archive.id,
				status: 'paused',
			});

			const lookup = new PostgresSourceAclLookup(bareQuery());
			const rows = await lookup.listActiveSources();

			expect(rows.find((row) => row.id === source.id)).toBeUndefined();
		});

		it('round-trips an empty allowed_ips array rather than rejecting or nulling it', async () => {
			const archive = await seedIngestionSource(harness!.db);
			const source = await seedJournalingSource(harness!.db, {
				ingestionSourceId: archive.id,
				allowedIps: [],
			});

			const lookup = new PostgresSourceAclLookup(bareQuery());
			const rows = await lookup.listActiveSources();

			const found = rows.find((row) => row.id === source.id);
			expect(found).toBeDefined();
			expect(found!.allowedIps).toEqual([]);
		});

		it('reads require_tls: false correctly (not merely the absence of true)', async () => {
			const archive = await seedIngestionSource(harness!.db);
			const source = await seedJournalingSource(harness!.db, {
				ingestionSourceId: archive.id,
				requireTls: false,
			});

			const lookup = new PostgresSourceAclLookup(bareQuery());
			const rows = await lookup.listActiveSources();

			const found = rows.find((row) => row.id === source.id);
			expect(found!.requireTls).toBe(false);
		});
	}
);
