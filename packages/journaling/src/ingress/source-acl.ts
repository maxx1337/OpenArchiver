import type { LedgerQuery } from '../ledger/ledger-port';
import type { JournalingSourceAclEntry, SourceAclLookup } from './source-acl-port';

/**
 * `PostgresSourceAclLookup` -- the Postgres implementation of {@link SourceAclLookup} (`JR-4-05a`,
 * extended by `JR-4-05b` to also read `routing_address`).
 *
 * Takes a bare {@link LedgerQuery}, the same generic parameterised-query port
 * `PostgresLedgerLookup` takes: a read against `journaling_sources` needs no transaction boundary
 * and no advisory lock -- those exist on the ledger's write side to serialise the chain, and this
 * query does not touch the chain at all. Any connection that can run a parameterised `SELECT`
 * satisfies this, including a plain pooled connection -- the expected case for the periodic
 * refresh `./source-acl-cache.ts` drives.
 *
 * `ORDER BY id` (`JR-4-05b`): deterministic row order, so that two active sources with the same
 * `routing_address` (an operator misconfiguration `journaling_sources` has no unique constraint
 * against) are deduplicated the same way on every refresh -- see
 * `./source-acl-cache.ts`'s `doRefresh` for what "deduplicated" means and why the choice is
 * "first row wins, logged loudly" rather than an arbitrary one.
 */
export class PostgresSourceAclLookup implements SourceAclLookup {
	constructor(private readonly db: LedgerQuery) {}

	async listActiveSources(): Promise<readonly JournalingSourceAclEntry[]> {
		const rows = await this.db.query<{
			id: string;
			ingestion_source_id: string;
			allowed_ips: unknown;
			require_tls: boolean;
			routing_address: string;
		}>(
			`SELECT id, ingestion_source_id, allowed_ips, require_tls, routing_address
			   FROM journaling_sources
			  WHERE status = 'active'
			  ORDER BY id`
		);
		return rows.map((row) => ({
			id: row.id,
			chainScopeId: row.ingestion_source_id,
			allowedIps: decodeAllowedIps(row.allowed_ips, row.id),
			requireTls: row.require_tls,
			routingAddress: row.routing_address,
		}));
	}
}

/**
 * `allowed_ips` is `jsonb`. postgres-js decodes a `jsonb` column via the wire type OID regardless
 * of whether the client went through `drizzle()` -- unlike the F38 defect (`docs/dev/journaling/
 * 09-befunde-bestandscode.md`), which was specifically about *binding an outgoing parameter*
 * (the driver inferring `jsonb` from the server's parameter description and re-encoding an
 * already-encoded string). There is no parameter here, only a result column, so that failure mode
 * does not apply to a read. This function still refuses to *assume* the shape: a value that is
 * neither a decoded array nor its JSON text throws, rather than silently returning `[]` and
 * leaving a source that looks like it has no allow-list at all when it actually has a corrupt one.
 */
function decodeAllowedIps(value: unknown, sourceId: string): string[] {
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry));
	}
	if (typeof value === 'string') {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) {
			throw new TypeError(
				`journaling_sources.allowed_ips for source ${sourceId} decoded to a non-array JSON value.`
			);
		}
		return parsed.map((entry) => String(entry));
	}
	throw new TypeError(
		`journaling_sources.allowed_ips for source ${sourceId} is neither an array nor a JSON string ` +
			`(got ${typeof value}).`
	);
}
