import type { Sql } from 'postgres';
import type { LedgerQuery, LedgerTransactor } from '@open-archiver/journaling';

/**
 * A `LedgerTransactor` over a `postgres-js` connection (`JR-4-06a`).
 *
 * ---------------------------------------------------------------------------------------------
 * The move this completes
 * ---------------------------------------------------------------------------------------------
 * `packages/backend/tests/support/postgres-transactor.ts`'s own doc comment has said, since
 * `JR-2-06`, "when those processes arrive, this moves to `src/` largely unchanged" -- twice dated to
 * `JR-4-06` (`JR-2-06`'s note, `JR-4-01`'s decision). This is that move: `apps/smtp-ingress` is now a
 * process that owns a `LedgerBackend` (`index.ts` constructs `PostgresLedgerWriter` with this
 * transactor to build the `JournalAcceptance` it hands `EsmtpServer`), so the production adapter
 * belongs in this app's own `src/`, not only in a test-support directory.
 *
 * The test-support copy is **not** deleted: `packages/backend`'s own integration/adversarial suites
 * (`journal-ledger-writer.int.test.ts`, `ledger-backend-contract.int.test.ts`,
 * `journal-acceptance-bare-client.int.test.ts`, the concurrency/tamper adversarial suites) test
 * `packages/journaling`'s `PostgresLedgerWriter` from `packages/backend`'s own test tree, which has no
 * dependency on `apps/smtp-ingress` and, per ADR-025, must not gain one -- an app is not a package
 * another package's tests may reach into. The two copies are structurally identical (same ~15 lines,
 * same shape) because there is no shared location both can import from without inverting that
 * dependency: `packages/journaling` cannot depend on the `postgres` npm package at all (architecture
 * section 2's dependency list is `@open-archiver/types`/`zod` only), so the adapter cannot live there
 * either. Small, duplicated glue code is the accepted cost of keeping the dependency graph one-way.
 *
 * ---------------------------------------------------------------------------------------------
 * ADR-002 privilege separation: not yet enforced, deliberately not blocked either
 * ---------------------------------------------------------------------------------------------
 * The eventual design gives this process its own database role with only `INSERT` on
 * `journal_ledger` (E11). This file does nothing that would make that harder to add later: it takes
 * whatever `Sql` connection `index.ts` constructs from `SMTP_INGRESS_LEDGER_DATABASE_URL`
 * (`ledger-config.ts`) and does not assume anything about the role behind it.
 *
 * ---------------------------------------------------------------------------------------------
 * Deliberately a **bare** client, never routed through `drizzle()` (F38)
 * ---------------------------------------------------------------------------------------------
 * See `./postgres-query.ts`'s doc comment (`JR-4-05a`) for the full F38 history -- the same
 * reasoning applies here verbatim: this process has no reason to import `drizzle` at all (ADR-002/
 * ADR-025 keep `packages/backend` out of this process's dependency graph), so the client `index.ts`
 * builds and hands to this function is unpatched by construction, not by care taken to avoid
 * patching it.
 */
export function postgresTransactor(sql: Sql): LedgerTransactor {
	return {
		async transaction<T>(run: (tx: LedgerQuery) => Promise<T>): Promise<T> {
			// `sql.begin` issues BEGIN/COMMIT and rolls back when the callback throws. Everything
			// PostgresLedgerWriter does -- the durability setting, the advisory lock, the head read,
			// the insert -- happens on this one reserved connection, which is what makes `SET LOCAL`
			// and `pg_advisory_xact_lock` mean what they say (see `ledger-writer.ts`'s doc comment).
			return sql.begin(async (tx) => {
				const handle: LedgerQuery = {
					async query<Row>(
						text: string,
						values: readonly unknown[] = []
					): Promise<Row[]> {
						// `unsafe` refers to the *statement text*, which is always a literal in
						// PostgresLedgerWriter -- never interpolated input. The values stay parameterised.
						const rows = await tx.unsafe(text, values as never[]);
						return rows as unknown as Row[];
					},
				};
				return run(handle);
			}) as Promise<T>;
		},
	};
}
