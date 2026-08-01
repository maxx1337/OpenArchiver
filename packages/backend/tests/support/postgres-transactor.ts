import type { Sql } from 'postgres';
import type { LedgerQuery, LedgerTransactor } from '@open-archiver/journaling';

/**
 * A `LedgerTransactor` over a `postgres-js` connection (`JR-2-06`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this lives under `tests/support/` and not in `src/`
 * ---------------------------------------------------------------------------------------------
 * `packages/journaling` takes its database access **injected** (architecture section 2), and this is
 * the adapter that satisfies the port. It is not production code **yet**, deliberately: which process
 * connects with which credentials is the subject of ADR-002's privilege separation, and the processes
 * that will own such a connection do not exist before E3/E4 (`apps/smtp-ingress`) and E6 (the
 * `journal-inbound` worker). Putting a production adapter in `src/` now would mean picking a
 * connection owner with no caller to justify the choice.
 *
 * When those processes arrive, this moves to `src/` largely unchanged — that is the point of keeping it
 * this small.
 */
export function postgresTransactor(sql: Sql): LedgerTransactor {
	return {
		async transaction<T>(run: (tx: LedgerQuery) => Promise<T>): Promise<T> {
			// `sql.begin` issues BEGIN/COMMIT and rolls back when the callback throws. Everything the
			// writer does -- the durability setting, the advisory lock, the head read, the insert --
			// happens on this one reserved connection, which is what makes `SET LOCAL` and
			// `pg_advisory_xact_lock` mean what they say.
			return sql.begin(async (tx) => {
				const handle: LedgerQuery = {
					async query<Row>(
						text: string,
						values: readonly unknown[] = []
					): Promise<Row[]> {
						// `unsafe` refers to the *statement text*, which is a literal in the writer --
						// never interpolated input. The values stay parameterised.
						const rows = await tx.unsafe(text, values as never[]);
						return rows as unknown as Row[];
					},
				};
				return run(handle);
			}) as Promise<T>;
		},
	};
}

/**
 * A `LedgerQuery` directly over a `postgres-js` connection, with **no** transaction boundary
 * (`JR-3-05`).
 *
 * The write side above always needs `postgresTransactor()`'s `BEGIN`/`COMMIT` and its
 * `pg_advisory_xact_lock` -- that is what serialises appends to one chain. A read keyed by the
 * indexed `spool_txid` column (`PostgresLedgerLookup`) has nothing to serialise against and no chain
 * state to protect, so a bare, unwrapped query is the whole implementation.
 */
export function bareLedgerQuery(sql: Sql): LedgerQuery {
	return {
		async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
			const rows = await sql.unsafe(text, values as never[]);
			return rows as unknown as Row[];
		},
	};
}

/**
 * A transactor that rolls back after the callback succeeded.
 *
 * Used to show that a rolled-back append consumes no `seq` — the property that rules out a Postgres
 * sequence, whose `nextval()` is not rolled back and would leave a permanent hole (skill
 * `journal-ledger` section 4).
 */
export function rollingBackTransactor(sql: Sql): LedgerTransactor {
	return {
		async transaction<T>(run: (tx: LedgerQuery) => Promise<T>): Promise<T> {
			let result: T;
			try {
				await sql.begin(async (tx) => {
					const handle: LedgerQuery = {
						async query<Row>(
							text: string,
							values: readonly unknown[] = []
						): Promise<Row[]> {
							const rows = await tx.unsafe(text, values as never[]);
							return rows as unknown as Row[];
						},
					};
					result = await run(handle);
					// Everything the writer wanted has happened; now abandon it.
					throw new Error('deliberate rollback');
				});
			} catch (error) {
				if ((error as Error).message !== 'deliberate rollback') {
					throw error;
				}
			}
			return result!;
		},
	};
}
