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
			event_type: string;
			// `| undefined` on both, and it is not defensive padding: a driver that omits a NULL column
			// from a row object, or any caller handing in a row shaped by a narrower SELECT, produces
			// `undefined` rather than `null` -- and the first version of this code compared with `=== null`
			// and threw `Cannot convert undefined to a BigInt`. Found by the existing unit test's fake rows,
			// which is exactly what that test is for.
			content_sha256: Uint8Array | null | undefined;
			size_bytes: string | bigint | null | undefined;
		}>(
			`SELECT spool_txid, seq, chain_scope_id, journaling_source_id, remote_ip, received_at,
			        event_type, content_sha256, size_bytes
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
				eventType: row.event_type,
				// `bytea` arrives as a Buffer from postgres-js; kept as raw bytes, never hex-encoded
				// here -- see the port's doc comment on why the encoding decision stays with the caller.
				// `?? null` rather than a `=== null` test: absent and SQL-NULL must reach the caller as the
				// same value, because the gate branches on `contentSha256 === null` and an `undefined`
				// slipping through would take the "hash present" branch and then hex-encode nothing.
				contentSha256: row.content_sha256 ?? null,
				sizeBytes:
					row.size_bytes === null || row.size_bytes === undefined
						? null
						: BigInt(row.size_bytes),
			});
		}
		return result;
	}
}
