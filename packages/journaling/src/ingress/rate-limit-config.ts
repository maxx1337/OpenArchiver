import { z } from 'zod';

/**
 * Per-source connection and transaction rate limits for the ESMTP listener (`JR-4-08`), a sibling
 * schema to `./smtp-config.ts`/`./tls-config.ts`/`./source-acl-config.ts`: this task owns it,
 * `./config.ts` embeds it rather than duplicating it.
 *
 * ---------------------------------------------------------------------------------------------
 * Process configuration, not a `journaling_sources` column -- and why
 * ---------------------------------------------------------------------------------------------
 * `journaling_sources` (`packages/backend/src/database/schema/journaling-sources.ts`) has no
 * connection- or rate-limit column today -- checked directly, the same way this task's own report
 * documents. Two ways to close this task existed:
 *
 *  1. A migration adding limit columns, with no operator surface to set them until the settings UI
 *     lands (E11/E12) -- half a feature: a schema change nobody can act on yet.
 *  2. Process-wide configuration, applied per source, with the same tighten-only seam
 *     `./tls-config.ts`'s `requireTls` already established for the identical situation (a
 *     per-source answer not available yet at the moment `journaling_sources` gained the column it
 *     needed).
 *
 * The second is what this file does, for the reason `tls-config.ts`'s own doc comment gives: the
 * source is already known at connect time (`JR-4-05a`'s `SourceAclDecision.sourceId`), so a limit
 * keyed by that id composes cleanly with a future per-source override -- a later task adding limit
 * columns would compose as `(sourceId) => Math.min(processDefault, sourceLimit ?? processDefault)`,
 * the mirror image of `RequireTlsResolver`'s `(ctx) => processDefault || sourceRequireTls(ctx)`: a
 * limit tightens by getting *smaller*, where `requireTls` tightens by becoming `true`. Nothing in
 * `EsmtpServer`'s wiring (`./smtp-server.ts`) assumes the limiter is process-wide-only -- the
 * `ConnectionLimiter`/`TransactionRateLimiter` ports it depends on take a `sourceId` on every call,
 * exactly what a per-source-aware implementation would need and a process-wide one simply ignores.
 *
 * ---------------------------------------------------------------------------------------------
 * Two independent limits, not one
 * ---------------------------------------------------------------------------------------------
 * `maxConnectionsPerSource` bounds concurrent TCP connections a single source may hold open at
 * once; `maxTransactionsPerSourcePerWindow`/`rateLimitWindowMs` bounds how many transactions
 * (`MAIL FROM`s) that source may start in a rolling window. A source that keeps one connection open
 * and pipelines an unbounded number of transactions down it would evade a connection-count limit
 * entirely, and a source that opens a new connection per message would evade a naive
 * per-connection transaction counter -- the two limits answer different abuse shapes and neither
 * substitutes for the other. See `./connection-rate-limiter.ts` for the two implementations and
 * `./smtp-server.ts`'s module doc comment ("Per-source connection and rate limits") for where each
 * is checked.
 *
 * ---------------------------------------------------------------------------------------------
 * Defaults
 * ---------------------------------------------------------------------------------------------
 * Ten concurrent connections and sixty transactions per minute per source are deliberately generous
 * -- a real journaling source (Exchange Online's journal rule, a Postfix `always_bcc`
 * configuration) is a small, fixed set of sending MTAs, not a high-volume public-facing service;
 * these numbers exist to catch a misbehaving or compromised source, not to shape ordinary traffic.
 * An operator with a genuinely higher-volume source overrides them via the env vars
 * `config-from-env.ts` reads.
 */

export const DEFAULT_MAX_CONNECTIONS_PER_SOURCE = 10;
export const DEFAULT_MAX_TRANSACTIONS_PER_SOURCE_PER_WINDOW = 60;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export const rateLimitConfigSchema = z.object({
	/** Concurrent TCP connections a single source (matched by the connect-time source ACL,
	 * `JR-4-05a`) may hold open at once. Exceeding it answers `421 4.7.0` and closes the *new*
	 * connection immediately -- every connection already open is unaffected. */
	maxConnectionsPerSource: z.coerce
		.number()
		.int()
		.positive('maxConnectionsPerSource must be a positive integer')
		.optional()
		.default(DEFAULT_MAX_CONNECTIONS_PER_SOURCE),
	/** Transactions (`MAIL FROM`s) a single source may start within `rateLimitWindowMs`. Exceeding
	 * it answers `450 4.7.1` at `MAIL FROM` itself -- the connection stays open and a transaction
	 * already past `MAIL FROM` is never retroactively throttled. */
	maxTransactionsPerSourcePerWindow: z.coerce
		.number()
		.int()
		.positive('maxTransactionsPerSourcePerWindow must be a positive integer')
		.optional()
		.default(DEFAULT_MAX_TRANSACTIONS_PER_SOURCE_PER_WINDOW),
	/** Milliseconds per rate-limit window (a fixed window, not a sliding one -- see
	 * `./connection-rate-limiter.ts`'s `PerSourceTransactionRateLimiter` doc comment for what that
	 * simplification costs). */
	rateLimitWindowMs: z.coerce
		.number()
		.int()
		.positive('rateLimitWindowMs must be a positive number of milliseconds')
		.optional()
		.default(DEFAULT_RATE_LIMIT_WINDOW_MS),
});

export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;
