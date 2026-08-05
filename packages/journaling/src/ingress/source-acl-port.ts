/**
 * The database port for the SMTP ingress source ACL (`JR-4-05a`, ADR-002), extended by `JR-4-05b`
 * to also carry `routing_address` for the recipient ACL, and by `JR-4-05c` to carry
 * `smtp_username`/`smtp_password_hash` for `AUTH`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is a separate port, following `../ledger/ledger-lookup-port.ts`'s pattern
 * ---------------------------------------------------------------------------------------------
 * This is the first thing in `apps/smtp-ingress` that reads a table other than the ledger's own,
 * and the first database connection this process has ever needed at all (`JR-4-01`-`JR-4-04`
 * never touched the database). `docs/dev/journaling/02-architektur.md` section 2 requires the
 * connection to be **injected**, never imported -- the same rule `LedgerBackend`/`LedgerLookup`
 * already follow -- so this port is narrow (one read, no write) and takes its connection through
 * the same generic {@link LedgerQuery} shape those two already use, rather than inventing a
 * differently-named but structurally identical interface. ADR-002's privilege-separation table
 * grants this process exactly `SELECT` on `journaling_sources` and the ledger head -- no `UPDATE`,
 * no `DELETE` -- and this port's single method matches that: a read, nothing else.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `status = 'active'` is the port's job, not the cache's
 * ---------------------------------------------------------------------------------------------
 * A `paused` journaling source has deliberately stopped receiving mail -- its `allowed_ips` should
 * not go on admitting connections while it is paused. Filtering in the query means a paused
 * source's IPs stop being honoured the moment the next refresh runs, with no special case in
 * `./source-acl-cache.ts` to remember. The same reasoning now covers `routingAddress` too
 * (`JR-4-05b`): a paused source's recipient address must stop being a valid `RCPT TO` target the
 * moment it is paused, not just its IPs.
 *
 * ---------------------------------------------------------------------------------------------
 * `routingAddress` -- one recipient ACL, the same load path as the source ACL (`JR-4-05b`)
 * ---------------------------------------------------------------------------------------------
 * The Product Owner's instruction for this slice was explicit: reuse `SourceAclCache`'s refresh
 * cycle and database connection rather than opening a second polling loop against
 * `journaling_sources`. `routingAddress` is therefore read here, in the same `SELECT`, rather than
 * through a second port -- `./source-acl-cache.ts`'s `CompiledSourceAcl` carries it alongside the
 * CIDR list, and one refresh keeps both the IP-based and the recipient-based ACLs current.
 *
 * ---------------------------------------------------------------------------------------------
 * `smtpUsername`/`smtpPasswordHash` -- `AUTH`, the same load path again (`JR-4-05c`)
 * ---------------------------------------------------------------------------------------------
 * The Product Owner's instruction for this slice was the same one already applied twice above:
 * reuse this cache and its refresh cycle rather than open a third polling loop against
 * `journaling_sources`. Both columns are nullable in the schema (`packages/backend/src/database/
 * schema/journaling-sources.ts`) -- a source with no `AUTH` credentials configured is a normal,
 * supported state, not a misconfiguration (`AUTH` is optional; the source ACL from `JR-4-05a` is
 * the primary access control). `smtpPasswordHash` is handed back exactly as stored -- a bcrypt hash,
 * never a plaintext password -- and is only ever compared through the injected `PasswordVerifier`
 * port in `./smtp-server.ts`; this port does not depend on bcrypt any more than it depends on the
 * CIDR or SASL-PLAIN parsing performed elsewhere.
 */

/** One active journaling source's ACL-relevant columns. */
export interface JournalingSourceAclEntry {
	/** `journaling_sources.id`. */
	readonly id: string;
	/** `journaling_sources.ingestion_source_id` -- ADR-007's `chain_scope_id`, the chain (and
	 * archive) this source's mail is journaled into. Handed back unparsed so a caller that later
	 * needs to build a ledger append request does not have to query for it a second time. */
	readonly chainScopeId: string;
	/** `journaling_sources.allowed_ips`, raw as stored -- CIDR blocks or bare addresses, entirely
	 * unparsed and unvalidated. Parsing, and the fail-closed handling of an invalid entry, is
	 * `./source-acl-cache.ts`'s job (`compileSourceAcl`), not this port's -- the port only reads
	 * what the database holds, exactly as `PostgresLedgerLookup` never interprets `remote_ip`. */
	readonly allowedIps: readonly string[];
	/** `journaling_sources.require_tls`. */
	readonly requireTls: boolean;
	/** `journaling_sources.routing_address` -- the `RCPT TO` address this source's mail arrives at
	 * (`JR-4-05b`). Persisted, generated at creation time, `NOT NULL` in the schema; handed back raw
	 * (unnormalised) the same way `allowedIps` is -- comparison-shape decisions (case folding etc.)
	 * are `./recipient-address.ts`'s job, not this port's. */
	readonly routingAddress: string;
	/** `journaling_sources.smtp_username` (`JR-4-05c`), nullable -- `null` means this source has no
	 * `AUTH` credentials configured at all (a supported, ordinary state, not a misconfiguration; see
	 * the module doc comment). */
	readonly smtpUsername: string | null;
	/** `journaling_sources.smtp_password_hash` (`JR-4-05c`), a bcrypt hash, nullable in lockstep with
	 * `smtpUsername` (both set or both unset, though this port does not itself enforce that -- see
	 * `./source-acl-cache.ts`'s `buildAuthIndex` for how a source with only one of the two set is
	 * handled). Never a plaintext password. */
	readonly smtpPasswordHash: string | null;
}

/**
 * The pluggable read side of the source ACL. `PostgresSourceAclLookup` (`./source-acl.ts`) is the
 * only implementation today, following the same "narrow port, one implementation, injected
 * connection" shape `LedgerLookup` already established.
 */
export interface SourceAclLookup {
	/**
	 * Every currently active journaling source's ACL-relevant columns.
	 *
	 * No paging: `journaling_sources` is an operator-configured table, expected to hold tens of
	 * rows per deployment, not a receipt log -- unlike `journal_ledger`, there is no volume
	 * argument for batching this any differently than a single `SELECT`.
	 */
	listActiveSources(): Promise<readonly JournalingSourceAclEntry[]>;
}
