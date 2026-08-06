import postgres, { type Sql } from 'postgres';
import type { LedgerQuery, LedgerTransactor } from '@open-archiver/journaling';
import { encodeDatabaseUrl } from '../../helpers/db';

/**
 * A **bare** `postgres-js` client for `PostgresLedgerLookup` (`JR-6-02b`) -- deliberately not
 * `packages/backend/src/database`'s module-singleton `db`, which `drizzle()` wraps.
 *
 * F38 (`docs/dev/journaling/09-befunde-bestandscode.md`) found that `drizzle(client, ...)` patches
 * the `postgres-js` client it is given, and that patch hid a real bug (`event_payload`
 * double-JSON-encoding) in the one test client that happened to be drizzle-wrapped. The finding's
 * remedy is structural, not a one-off fix: at least one caller of ledger SQL must go through an
 * unpatched client, and `apps/smtp-ingress/src/postgres-query.ts` already established the pattern
 * this file mirrors for the exact same port (`PostgresLedgerLookup`). The `journal-inbound` worker
 * gets its own connection rather than reaching for the shared `client` inside `database/index.ts`,
 * because that module never exports the pre-`drizzle()` client -- only the wrapped `db`.
 *
 * Uses `DATABASE_URL`, the same credential the rest of `packages/backend` already has full read/write
 * access with -- unlike `apps/smtp-ingress` (ADR-002: separate, read-only-role credentials for a
 * process with a much larger untrusted attack surface), this worker is not internet-facing and
 * already needs full `archived_emails`/`journaling_sources` access for the rest of Phase B.
 */
export function createLedgerQuery(sql: Sql): LedgerQuery {
	return {
		async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
			const rows = await sql.unsafe(text, values as never[]);
			return rows as unknown as Row[];
		},
	};
}

/** Opens the bare connection this module's `createLedgerQuery()` needs, from `DATABASE_URL`. */
export function openBareLedgerConnection(): Sql {
	if (!process.env.DATABASE_URL) {
		throw new Error('DATABASE_URL is not set -- required for the journal-inbound worker.');
	}
	return postgres(encodeDatabaseUrl(process.env.DATABASE_URL));
}

/**
 * A `LedgerTransactor` over the same bare `postgres-js` connection `createLedgerQuery()` reads
 * with (`JR-6-03`) -- the write-side counterpart this worker needs to append a `duplicate_of`
 * marker via `PostgresLedgerWriter`.
 *
 * A **third** copy of `apps/smtp-ingress/src/postgres-transactor.ts`'s ~15 lines (the second being
 * `packages/backend/tests/support/postgres-transactor.ts`), for the same reason that doc comment
 * gives: `packages/journaling` cannot depend on the `postgres` npm package, so this adapter cannot
 * live there, and there is no shared location both this worker and the ingress app can import from
 * without inverting the one-way dependency graph (ADR-025). Small, duplicated glue code is the
 * accepted cost.
 */
export function postgresTransactor(sql: Sql): LedgerTransactor {
	return {
		async transaction<T>(run: (tx: LedgerQuery) => Promise<T>): Promise<T> {
			return sql.begin(async (tx) => {
				const handle: LedgerQuery = {
					async query<Row>(
						text: string,
						values: readonly unknown[] = []
					): Promise<Row[]> {
						const rows = await tx.unsafe(text, values as never[]);
						return rows as unknown as Row[];
					},
				};
				return run(handle);
			}) as Promise<T>;
		},
	};
}
