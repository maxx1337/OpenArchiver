import { readFileSync } from 'node:fs';

/**
 * Map environment variables into the shape `parseIngressConfig()` (`@open-archiver/journaling`)
 * validates.
 *
 * This is the mapping job that `packages/journaling/src/spool/config.ts`'s doc comment assigns to
 * `apps/smtp-ingress`: the package validates a shaped object and never reads `process.env` itself
 * (`docs/dev/journaling/02-architektur.md` section 2 -- configuration is injected, never imported).
 * Everything with a decision behind it -- field names, defaults, error wording -- lives in the zod
 * schema in the package, where it is unit-tested; this function is a plain name-to-name mapping
 * with nothing to decide, which is why it has no dedicated test of its own. The env-var choices it
 * makes are still exercised end-to-end by
 * `packages/journaling/tests/unit/ingress-process-boot.test.ts`, which spawns this process both
 * with and without them set.
 *
 * Takes an env-like record rather than reaching for `process.env` itself so the same function can
 * be pointed at a synthetic environment in a test without mutating the real one.
 *
 * ---------------------------------------------------------------------------------------------
 * `tls.cert`/`tls.key` (`JR-4-04`): the one place this "no decision, no I/O" mapping does I/O
 * ---------------------------------------------------------------------------------------------
 * `packages/journaling/src/ingress/tls-config.ts` validates PEM **content**, never a path -- the
 * Product Owner's explicit instruction was that reading certificate/key paths and loading the files
 * they name is app work, not package work. `readOptionalFile()` below is that loading step. Unlike
 * every other field here, it can throw (a configured path that does not exist or is not readable
 * raises `ENOENT`/`EACCES`) -- deliberately not caught here: `formatIngressConfigError()` in the
 * package already has a fallback branch for exactly "not a `ZodError`", so an unreadable certificate
 * file surfaces as a clear one-line startup failure the same way any other misconfiguration does,
 * with no new plumbing needed in `index.ts`'s `main().catch(...)`.
 */
export function readIngressConfigInput(env: NodeJS.ProcessEnv): unknown {
	return {
		smtpPort: env.SMTP_INGRESS_PORT,
		spool: {
			rootPath: env.SMTP_INGRESS_SPOOL_ROOT_PATH,
			highWaterBytes: env.SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES,
		},
		// JR-4-02: every field here is optional in the zod schema (smtp-config.ts) and defaults on
		// its own, so an entirely unset env var must map to `undefined`, not to a string like "undefined"
		// -- `env.SMTP_INGRESS_HOSTNAME` is already `undefined` when unset, passed through as-is.
		smtp: {
			hostname: env.SMTP_INGRESS_HOSTNAME,
			sizeLimitBytes: env.SMTP_INGRESS_SIZE_LIMIT_BYTES,
			connectionTimeoutMs: env.SMTP_INGRESS_CONNECTION_TIMEOUT_MS,
			commandTimeoutMs: env.SMTP_INGRESS_COMMAND_TIMEOUT_MS,
			dataTimeoutMs: env.SMTP_INGRESS_DATA_TIMEOUT_MS,
		},
		// JR-4-04: cert/key are loaded here, from the paths the operator configured -- see this
		// function's doc comment. requireTls passes through as a string, the same coercion pattern
		// smtp-config.ts's numeric fields already rely on (zod's z.coerce.boolean()).
		tls: {
			cert: readOptionalFile(env.SMTP_INGRESS_TLS_CERT_PATH),
			key: readOptionalFile(env.SMTP_INGRESS_TLS_KEY_PATH),
			requireTls: env.SMTP_INGRESS_REQUIRE_TLS,
		},
		// JR-4-05a: a deliberately *different* variable than packages/backend's DATABASE_URL --
		// ADR-002 wants a separate, read-only-role connection string for this process's own source
		// ACL lookup, not the backend's connection reused with different code-level restrictions.
		sourceAcl: {
			databaseUrl: env.SMTP_INGRESS_DATABASE_URL,
			refreshIntervalMs: env.SMTP_INGRESS_SOURCE_ACL_REFRESH_MS,
			staleAfterMs: env.SMTP_INGRESS_SOURCE_ACL_STALE_AFTER_MS,
		},
		// JR-4-06a: a third, deliberately *different* variable again -- ADR-002 wants the ledger
		// connection on its own credential too, eventually a role with only INSERT on
		// journal_ledger (E11). Unset maps to `undefined`, the same "unset env var -> undefined"
		// rule every optional field here follows -- ledger-config.ts's schema accepts that (`{}` is
		// valid), unlike sourceAcl.databaseUrl.
		ledger: {
			databaseUrl: env.SMTP_INGRESS_LEDGER_DATABASE_URL,
		},
		// JR-4-08: per-source connection/transaction-rate limits. Every field is optional in the zod
		// schema (rate-limit-config.ts) and defaults on its own, the same "unset env var -> undefined"
		// rule every other optional field here follows.
		rateLimit: {
			maxConnectionsPerSource: env.SMTP_INGRESS_MAX_CONNECTIONS_PER_SOURCE,
			maxTransactionsPerSourcePerWindow: env.SMTP_INGRESS_MAX_TRANSACTIONS_PER_SOURCE_PER_WINDOW,
			rateLimitWindowMs: env.SMTP_INGRESS_RATE_LIMIT_WINDOW_MS,
		},
		logLevel: env.SMTP_INGRESS_LOG_LEVEL,
	};
}

/** Read a PEM file if a path was configured; `undefined` (never an empty string) when it was not,
 * matching every other optional field's "unset env var maps to `undefined`" rule above. */
function readOptionalFile(path: string | undefined): string | undefined {
	if (path === undefined || path.trim() === '') {
		return undefined;
	}
	return readFileSync(path, 'utf8');
}
