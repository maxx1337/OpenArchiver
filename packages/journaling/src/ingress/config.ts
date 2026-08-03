import { z } from 'zod';
import { spoolConfigSchema } from '../spool/config';
import { smtpServerConfigSchema } from './smtp-config';
import { ingressTlsConfigSchema } from './tls-config';
import { sourceAclConfigSchema } from './source-acl-config';
import { ledgerConfigSchema } from './ledger-config';
import { rateLimitConfigSchema } from './rate-limit-config';

/**
 * `apps/smtp-ingress` process configuration (`JR-4-01`, extended by `JR-4-02`), validated with
 * `zod` per CLAUDE.md section 5.6 and following the shape of `../spool/config.ts` (`JR-3-01`),
 * which this schema embeds rather than duplicates -- `./smtp-config.ts` (`JR-4-02`) is embedded
 * the same way.
 *
 * ---------------------------------------------------------------------------------------------
 * Scope: only what this slice uses
 * ---------------------------------------------------------------------------------------------
 * `JR-4-01`'s acceptance criteria were about the process boundary only (starts standalone, no
 * forbidden imports, a clear message on bad configuration) -- not the SMTP protocol itself, so
 * `JR-4-01` deliberately left out every field the protocol engine needs. `JR-4-02` is the task that
 * consumes `smtp` below. `AUTH` (`JR-4-05c`) reuses `sourceAcl` verbatim, the same way recipient
 * ACLs (`JR-4-05b`) do -- see `./source-acl-cache.ts`'s doc comment for why that is one cache
 * serving three roles, not three caches. Rate limits (`JR-4-08`) **do** need a field of their own
 * (`rateLimit` below) -- unlike `AUTH`/recipient ACLs, there is no existing key to piggyback on.
 *
 * Seven fields, one added by each of `JR-4-01`, `JR-4-02`, `JR-4-04`, `JR-4-05a`, `JR-4-06a` and
 * `JR-4-08`:
 *  - `smtpPort`: the port the ESMTP listener binds (`JR-4-02`'s `EsmtpServer`, replacing `JR-4-01`'s
 *    bare `net.createServer()` placeholder).
 *  - `spool`: the process owns the spool per the privilege-separation table in
 *    `docs/dev/journaling/02-architektur.md` section 1; `ensureSpoolLayout()` runs at startup so the
 *    directory structure exists before anything is ever written to it.
 *  - `smtp` (`JR-4-02`): `EsmtpServerOptions.smtp` -- hostname, `SIZE` limit, and the three
 *    timeouts. See `./smtp-config.ts` for every field and its default.
 *  - `tls` (`JR-4-04`): `EsmtpServerOptions.tls` -- certificate/key PEM content and the process-wide
 *    `requireTls` default. See `./tls-config.ts` for every field, its default and the
 *    tighten-never-loosen extension point `JR-4-05a` uses.
 *  - `sourceAcl` (`JR-4-05a`): the read-only-role database connection and cache refresh/staleness
 *    tuning for the source ACL (`./source-acl-config.ts`, `./source-acl-cache.ts`). Unlike `smtp`
 *    and `tls`, this key's `databaseUrl` field has **no default** -- see that schema's doc comment
 *    for why "no database configured" must be a startup error, not a silent allow-everyone.
 *  - `ledger` (`JR-4-06a`): the ledger database connection (`./ledger-config.ts`) for
 *    `PostgresLedgerWriter`/`JournalAcceptance`. Unlike `sourceAcl`, `databaseUrl` here **is**
 *    optional -- see that schema's own doc comment for why "not configured yet" is a safe default
 *    for the ledger specifically, where it would not be for the source ACL.
 *  - `rateLimit` (`JR-4-08`): per-source connection/transaction-rate limits
 *    (`./rate-limit-config.ts`). Required as a key, same shape as `smtp`/`tls`/`ledger` above -- `{}`
 *    is a valid value (every field defaults on its own; see that schema's doc comment for why these
 *    defaults are safe to ship rather than a startup error like `sourceAcl.databaseUrl`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this package validates the shaped object, not `process.env` (`JR-4-01`)
 * ---------------------------------------------------------------------------------------------
 * Per `../spool/config.ts`'s own doc comment, mapping environment variables into this shape is
 * `apps/smtp-ingress`'s job, not this package's -- `docs/dev/journaling/02-architektur.md` section 2
 * requires configuration to be **injected**, never read by this package from ambient environment
 * state. `apps/smtp-ingress/src/config-from-env.ts` does that mapping and is the only place that
 * reads `process.env` for this process -- `tls.cert`/`tls.key` are the one exception to "no I/O in
 * that mapping" (see that file's doc comment): loading the certificate/key **files** the operator
 * points at is app work, per the Product Owner's explicit instruction for `JR-4-04`.
 */
export const ingressConfigSchema = z.object({
	/** TCP port the SMTP listener binds. `JR-4-02` replaces the placeholder listener this binds. */
	smtpPort: z.coerce.number().int().min(1, 'smtpPort must be between 1 and 65535').max(65535),
	/** Spool configuration this process owns (`../spool/config.ts`, `JR-3-01`). */
	spool: spoolConfigSchema,
	/**
	 * ESMTP protocol engine configuration (`./smtp-config.ts`, `JR-4-02`): hostname, `SIZE` limit,
	 * connection/command/data timeouts. Required as a key -- the same shape `spool` above already
	 * has -- but every field inside is itself optional and defaults on its own, so `{}` (or, per
	 * `config-from-env.ts`, an object of all-`undefined` leaves) is a valid value.
	 */
	smtp: smtpServerConfigSchema,
	/**
	 * TLS configuration (`./tls-config.ts`, `JR-4-04`): certificate/key PEM content (both optional,
	 * both-or-neither) and `requireTls`. Required as a key, same shape as `smtp`/`spool` above --
	 * `{}` is a valid value and means "no certificate configured, TLS not required".
	 */
	tls: ingressTlsConfigSchema,
	/**
	 * Source ACL configuration (`./source-acl-config.ts`, `JR-4-05a`): the read-only-role database
	 * connection string plus cache refresh/staleness tuning. Required as a key, but unlike `smtp`
	 * and `tls` it is **not** satisfied by `{}` -- `databaseUrl` has no default (see that schema's
	 * doc comment).
	 */
	sourceAcl: sourceAclConfigSchema,
	/**
	 * Ledger database connection (`./ledger-config.ts`, `JR-4-06a`). Required as a key, same shape as
	 * `smtp`/`tls` above -- `{}` is a valid value (no ledger database configured, `journalAcceptance`
	 * left unwired, pre-`JR-4-06a` `451`-always behaviour) -- see that schema's own doc comment for
	 * why "unset" is safe here, unlike `sourceAcl.databaseUrl`.
	 */
	ledger: ledgerConfigSchema,
	/**
	 * Per-source connection/transaction-rate limits (`./rate-limit-config.ts`, `JR-4-08`). Required
	 * as a key, same shape as `smtp`/`tls`/`ledger` above -- `{}` is a valid value, every field
	 * defaults on its own.
	 */
	rateLimit: rateLimitConfigSchema,
	/**
	 * Log verbosity. Optional -- a missing value is not a configuration error. Read for real since
	 * `JR-4-02`: `apps/smtp-ingress/src/index.ts` builds a `pino` instance with `level: logLevel`
	 * and injects it into `EsmtpServer` as `logger` (`../ingress/smtp-server.ts`'s "Where `logLevel`
	 * actually gets used" section explains why the field itself still lives here rather than in
	 * `smtp-config.ts`: it configures the logger, not the protocol engine).
	 */
	logLevel: z
		.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
		.optional()
		.default('info'),
});

export type IngressConfig = z.infer<typeof ingressConfigSchema>;

/** Parse and validate the ingress process configuration. Throws a `ZodError` on anything invalid. */
export function parseIngressConfig(input: unknown): IngressConfig {
	return ingressConfigSchema.parse(input);
}

/**
 * Turn a configuration error into the message `apps/smtp-ingress` prints on startup failure.
 *
 * This is the logic behind the `JR-4-01` acceptance criterion "fehlende Konfiguration führt zu
 * einer klaren Startmeldung, nicht zu einem Import-Crash": a `ZodError` becomes one line per
 * invalid field, naming the field and what is wrong with it -- never a raw stack trace, and never
 * the stack of whatever validated it. Anything that is not a `ZodError` (e.g. `EADDRINUSE` from
 * the placeholder listener, or a filesystem error creating the spool directories) falls back to
 * its own message rather than being rethrown, so the caller has exactly one thing to print.
 */
export function formatIngressConfigError(error: unknown): string {
	if (error instanceof z.ZodError) {
		const lines = error.issues.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
			return `  - ${path}: ${issue.message}`;
		});
		return ['smtp-ingress: configuration invalid, refusing to start:', ...lines].join('\n');
	}
	const message = error instanceof Error ? error.message : String(error);
	return `smtp-ingress: failed to start: ${message}`;
}
