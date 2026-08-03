import { z } from 'zod';

/**
 * Configuration for the source ACL's database connection and cache refresh (`JR-4-05a`), a sibling
 * schema to `./smtp-config.ts`/`./tls-config.ts`: this task owns it, `./config.ts` embeds it rather
 * than duplicating it.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `databaseUrl` has no default and is not optional
 * ---------------------------------------------------------------------------------------------
 * Every other field this process validates defaults on its own if the operator sets nothing --
 * that is correct for `smtp`/`tls`, where "unset" is a legitimate, safe starting point. It is not
 * correct here: per ADR-002, the source ACL is the mechanism that keeps this receiver from being an
 * open relay to arbitrary senders, and "no database configured" must not silently mean "accept
 * everyone" (skill `journal-ledger` section 10 makes the parallel prohibition for recipients
 * explicit; the same posture applies here). So a missing `databaseUrl` is a startup-time
 * configuration error with a clear message (`formatIngressConfigError`), not a process that starts
 * up and quietly admits every connection.
 *
 * ---------------------------------------------------------------------------------------------
 * `refreshIntervalMs` / `staleAfterMs`: the availability/security trade-off, made explicit
 * ---------------------------------------------------------------------------------------------
 * The cache (`./source-acl-cache.ts`) polls `journaling_sources` every `refreshIntervalMs` rather
 * than querying on every connection -- a `SELECT` per connect would make Postgres a hard dependency
 * of the receive path's availability, exactly what `docs/dev/journaling/02-architektur.md` section
 * 3's "Object store unreachable ⇒ still 250" reasoning already argues against for Phase B.
 *
 * A refresh that *fails* (Postgres briefly unreachable) does not immediately stop admitting mail:
 * the cache keeps serving its last successfully loaded snapshot, so a short outage does not turn
 * into a receive-path outage. But that tolerance cannot be unbounded -- a configuration change
 * (revoking a compromised source, tightening an entry) must eventually take effect even through a
 * database problem, and an operator must be able to tell "briefly stale" from "the ACL has not
 * been read in a dangerously long time". `staleAfterMs` is that bound: once a refresh has been
 * failing for longer than this, the cache reports every connection `'unavailable'` (⇒ `421 4.3.2`,
 * never `554` -- skill section 1, local failure is never a permanent rejection) rather than keep
 * trusting data that may be arbitrarily old. Chosen **available-first, then fail closed** rather
 * than "fail closed the instant a refresh fails": the latter would turn every transient Postgres
 * blip into a receive-path outage, which is a worse failure mode than briefly admitting mail
 * against a few-minutes-stale allow-list.
 */

export const DEFAULT_SOURCE_ACL_REFRESH_INTERVAL_MS = 30_000;
/** Ten refresh cycles' worth of tolerance by default -- comfortably longer than one or two failed
 * polls, short enough that an operator notices "ACL unavailable" well before the number goes stale
 * for hours. */
export const DEFAULT_SOURCE_ACL_STALE_AFTER_MS = 5 * 60_000;

export const sourceAclConfigSchema = z
	.object({
		/** Read-only-role Postgres connection string for this process's own `SELECT` on
		 * `journaling_sources` (ADR-002 privilege separation) -- deliberately a *different*
		 * environment variable, and expected to be a *different* database role, than
		 * `packages/backend`'s `DATABASE_URL`. */
		databaseUrl: z
			.string()
			.min(1, 'databaseUrl must be a non-empty Postgres connection string'),
		/** Milliseconds between polls of `journaling_sources`. */
		refreshIntervalMs: z.coerce
			.number()
			.int()
			.positive('refreshIntervalMs must be a positive number of milliseconds')
			.optional()
			.default(DEFAULT_SOURCE_ACL_REFRESH_INTERVAL_MS),
		/** Milliseconds a snapshot may be served after its last successful refresh before the
		 * cache reports every connection `'unavailable'`. See the module doc comment. */
		staleAfterMs: z.coerce
			.number()
			.int()
			.positive('staleAfterMs must be a positive number of milliseconds')
			.optional()
			.default(DEFAULT_SOURCE_ACL_STALE_AFTER_MS),
	})
	.refine((v) => v.staleAfterMs >= v.refreshIntervalMs, {
		message:
			'staleAfterMs must be >= refreshIntervalMs -- otherwise the cache would report ' +
			"'unavailable' between successful refreshes even while Postgres is healthy",
		path: ['staleAfterMs'],
	});

export type SourceAclConfig = z.infer<typeof sourceAclConfigSchema>;
