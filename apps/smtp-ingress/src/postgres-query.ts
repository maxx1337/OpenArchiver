import type { Sql } from 'postgres';
import type { LedgerQuery } from '@open-archiver/journaling';

/**
 * Adapt a bare `postgres-js` connection into the {@link LedgerQuery} port `PostgresSourceAclLookup`
 * (`@open-archiver/journaling`, `JR-4-05a`) takes.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this adapter lives here, in the app, and not in `packages/journaling`
 * ---------------------------------------------------------------------------------------------
 * `packages/journaling` takes its database access **injected** (architecture section 2) and must
 * not depend on which driver constructs the connection -- that is what makes `LedgerQuery` a
 * generic, parameterised-query shape rather than a `postgres-js`-flavoured one. Owning a real
 * `postgres()` client, and therefore a dependency on the `postgres` npm package, is this process's
 * concern (ADR-002: `apps/smtp-ingress` connects with its own read-only-role credentials), the same
 * way `packages/backend/tests/support/postgres-transactor.ts`'s `bareLedgerQuery()` is test-only
 * infrastructure rather than package code -- this is that same three-line adapter, once a real
 * caller (this process) exists to own it.
 *
 * ---------------------------------------------------------------------------------------------
 * Deliberately a **bare** client, never routed through `drizzle()`
 * ---------------------------------------------------------------------------------------------
 * F38 (`docs/dev/journaling/09-befunde-bestandscode.md`) found that `drizzle(client, ...)` patches
 * the `postgres-js` client it is given, and that patch is what made an early `event_payload`
 * double-JSON-encoding bug invisible in the one test client that happened to go through it. This
 * process has no reason to import `drizzle` at all -- ADR-002/ADR-025 keep `packages/backend` (and
 * anything drizzle-shaped) out of this process's dependency graph -- so the client this file builds
 * is unpatched by construction, not by care taken to avoid patching it.
 */
export function createLedgerQuery(sql: Sql): LedgerQuery {
	return {
		async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
			const rows = await sql.unsafe(text, values as never[]);
			return rows as unknown as Row[];
		},
	};
}
