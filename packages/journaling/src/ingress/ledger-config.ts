import { z } from 'zod';

/**
 * Configuration for the ledger database connection (`JR-4-06a`), a sibling schema to
 * `./source-acl-config.ts`: this task owns it, `./config.ts` embeds it rather than duplicating it.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is optional, unlike `./source-acl-config.ts`'s `databaseUrl`
 * ---------------------------------------------------------------------------------------------
 * `sourceAclConfigSchema.databaseUrl` has no default because "no database configured" would
 * otherwise silently mean "admit every connection" -- a security hole, not a safe default (see that
 * schema's own doc comment). The ledger's absence carries no such risk the other way: with no
 * `ledger.databaseUrl` configured, `apps/smtp-ingress/src/index.ts` never constructs a
 * `JournalAcceptance`, `EsmtpServer` receives `journalAcceptance: undefined`, and
 * `completeTransfer()` keeps the pre-`JR-4-06a` behaviour every earlier task's tests already rely
 * on -- end of `DATA`/`BDAT ... LAST` always answers `451 4.3.0` (skill `journal-ledger` section 1:
 * never a `250` this process cannot back). That is a strictly *safer* default than the source ACL's
 * "reject everything" would be for a receive path with no way to accept mail durably at all, so
 * "unset" is a legitimate starting point here the same way it already is for `smtp`/`tls`.
 *
 * A configured-but-unreachable ledger database is handled the same way, deliberately, for the same
 * reason: `index.ts` logs loudly and falls back to `journalAcceptance: undefined` rather than
 * refusing to start the whole process over what may be a transient Postgres outage -- the same
 * "available first, then fail closed for the specific operation affected" posture
 * `source-acl-config.ts`'s own doc comment argues for the source ACL. Flagged here, as elsewhere in
 * this codebase, for the Product Owner: a deployment that means to accept mail durably but has a
 * typo'd or briefly-down `SMTP_INGRESS_LEDGER_DATABASE_URL` will *not* see a crash-loop -- it will see
 * a loud log line and every transaction end in `451`, indistinguishable at the SMTP level from
 * `journalAcceptance` never having been configured at all. A future task may want a startup-time
 * distinction between "not configured" and "configured but failed" (e.g. a readiness probe), which
 * this schema does not attempt to provide.
 */
/** See `retryIntervalMs`'s doc comment for why 30 s. */
export const DEFAULT_LEDGER_RETRY_INTERVAL_MS = 30_000;

export const ledgerConfigSchema = z.object({
	/** Postgres connection string this process uses for `PostgresLedgerWriter` (`JR-2-06`). No
	 * default and no privilege-separation requirement enforced yet -- ADR-002's dedicated
	 * insert-only role is deferred to E11 (see `apps/smtp-ingress/src/postgres-transactor.ts`'s doc
	 * comment); this field is deliberately shaped so pointing it at that role later is a
	 * configuration change, not a code change. `undefined` (unset) is valid -- see the module doc
	 * comment. */
	databaseUrl: z
		.string()
		.min(1, 'ledger.databaseUrl must be a non-empty Postgres connection string when set')
		.optional(),
	/**
	 * How long `JournalAcceptanceBootstrap` waits between attempts to build the acceptance port
	 * while it is not yet wired (`JR-4-19`). Only ever used before the first success -- see that
	 * class's doc comment for why the retry loop stops afterwards.
	 *
	 * 30 s by default: long enough that a database outage does not produce a connection attempt per
	 * second across however many replicas an operator runs, short enough that a receiver which
	 * started during a brief outage becomes able to accept mail well inside Exchange Online's retry
	 * window rather than after it has given up and generated NDRs.
	 */
	retryIntervalMs: z.coerce
		.number()
		.int()
		.positive('ledger.retryIntervalMs must be a positive integer number of milliseconds')
		.optional()
		.default(DEFAULT_LEDGER_RETRY_INTERVAL_MS),
});

export type LedgerConfig = z.infer<typeof ledgerConfigSchema>;
