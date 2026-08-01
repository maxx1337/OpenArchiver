import type { LedgerQuery } from './ledger-port';
import type { LedgerEntryByTxId, LedgerLookup } from './ledger-lookup-port';

/**
 * `PostgresLedgerLookup` -- the Postgres implementation of {@link LedgerLookup} (`JR-3-05`).
 *
 * Takes a bare {@link LedgerQuery}, not a {@link LedgerTransactor}: a read against an indexed column
 * needs no transaction boundary and no advisory lock -- those exist on the write side to serialise the
 * chain, and a lookup by `spool_txid` does not touch the chain at all. Any connection that can run a
 * parameterised `SELECT` satisfies this, including one reserved by a transaction elsewhere (harmless)
 * or a plain pooled connection (the common case for a startup-time scan).
 */
export class PostgresLedgerLookup implements LedgerLookup {
	constructor(private readonly db: LedgerQuery) {}

	async findBySpoolTxIds(
		spoolTxIds: readonly string[]
	): Promise<ReadonlyMap<string, LedgerEntryByTxId>> {
		// An idle spool must not touch the database at all -- see the port's doc comment.
		if (spoolTxIds.length === 0) {
			return new Map();
		}

		const rows = await this.db.query<{
			spool_txid: string | null;
			seq: string | bigint;
			chain_scope_id: string;
			journaling_source_id: string | null;
			remote_ip: string | null;
			received_at: string | Date;
		}>(
			`SELECT spool_txid, seq, chain_scope_id, journaling_source_id, remote_ip, received_at
			   FROM journal_ledger
			  WHERE spool_txid = ANY($1)`,
			[[...spoolTxIds]]
		);

		const result = new Map<string, LedgerEntryByTxId>();
		for (const row of rows) {
			// The WHERE clause guarantees this column is non-null on every row this query returns.
			const spoolTxId = row.spool_txid as string;
			result.set(spoolTxId, {
				seq: BigInt(row.seq),
				chainScopeId: row.chain_scope_id,
				journalingSourceId: row.journaling_source_id,
				remoteIp: row.remote_ip,
				receivedAt:
					row.received_at instanceof Date ? row.received_at : new Date(row.received_at),
			});
		}
		return result;
	}
}
