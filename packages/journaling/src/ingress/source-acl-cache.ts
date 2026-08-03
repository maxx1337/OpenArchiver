import { normalizeRemoteIp } from '../ledger/canonical-encoding';
import { matchesCidr, parseCidr, type ParsedCidr } from './cidr';
import { normalizeJournalRecipient } from './recipient-address';
import type { JournalingSourceAclEntry, SourceAclLookup } from './source-acl-port';
import type {
	AuthCredentialEvaluator,
	AuthCredentialLookupResult,
	EsmtpServerOptions,
	IngressLogger,
	RecipientAclDecision,
	RecipientAclEvaluator,
	RequireTlsContext,
	RequireTlsResolver,
	SourceAclDecision,
	SourceAclEvaluator,
} from './smtp-server';

/**
 * `SourceAclCache` -- the periodically-refreshed, connect-time source ACL (`JR-4-05a`), extended by
 * `JR-4-05b` to also serve the recipient ACL from the same snapshot.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a cache, not a query per connection
 * ---------------------------------------------------------------------------------------------
 * A `SELECT` on every accepted TCP connection would make Postgres a hard dependency of the receive
 * path's availability -- exactly the coupling `docs/dev/journaling/02-architektur.md` section 3
 * already argues against for Phase B ("Object store unreachable ⇒ still `250`"). This cache polls
 * `journaling_sources` on a timer (`refreshIntervalMs`) and every `evaluate()`/`evaluateRecipient()`
 * call is a pure in-memory lookup against the last successfully loaded snapshot.
 *
 * ---------------------------------------------------------------------------------------------
 * One cache, one refresh cycle, three ACLs (`JR-4-05b`, `JR-4-05c`)
 * ---------------------------------------------------------------------------------------------
 * The Product Owner's instruction for this slice was explicit: reuse this cache and its refresh
 * cycle for the recipient ACL rather than open a second polling loop against `journaling_sources`.
 * `listActiveSources()` already reads the whole row (`./source-acl-port.ts`, `JR-4-05a`); this task
 * only adds `routingAddress` to {@link CompiledSourceAcl} and a second index
 * (`recipientIndex`, keyed by the normalised routing address -- see `./recipient-address.ts`) built
 * from the *same* `doRefresh()` pass that already builds the CIDR-matching `snapshot`. There is no
 * second `SourceAclLookup`, no second timer, and no second staleness clock: a recipient ACL change
 * and a source-IP ACL change become visible on exactly the same schedule, and an outage that makes
 * `evaluate()` report `'unavailable'` makes `evaluateRecipient()` report the same, at the same
 * moment, for the same reason.
 *
 * `JR-4-05c` repeats the exact same instruction a third time, for `AUTH`: `smtpUsername`/
 * `smtpPasswordHash` are carried onto {@link CompiledSourceAcl} and indexed into `authIndex` in the
 * same `doRefresh()` pass -- see `buildAuthIndex` below. A source with no `AUTH` credentials
 * configured (both columns `null`) is simply absent from `authIndex`; `lookupCredential()` reports
 * `'not_found'` for its username the same way it would for any other unrecognised one.
 *
 * ---------------------------------------------------------------------------------------------
 * The three questions the Product Owner's task asked this design to answer
 * ---------------------------------------------------------------------------------------------
 *  1. **How long is an entry valid for?** Until the next successful refresh, at most
 *     `refreshIntervalMs` later -- there is no per-entry TTL, the whole snapshot is replaced
 *     atomically each time `listActiveSources()` succeeds.
 *  2. **What happens to a database change?** It takes effect on the next successful refresh, so at
 *     most `refreshIntervalMs` of delay -- an operator revoking a compromised source's access does
 *     not take effect instantly, but does not require a process restart either.
 *  3. **What happens when refresh fails while an old snapshot is held?** The old snapshot keeps
 *     being served (availability) for up to `staleAfterMs` since its *last successful* refresh; once
 *     that bound is crossed, every `evaluate()` call reports `'unavailable'` instead (security) --
 *     see `./source-acl-config.ts`'s doc comment for the full reasoning behind choosing
 *     available-first-then-fail-closed over fail-closed-immediately.
 *
 * ---------------------------------------------------------------------------------------------
 * Fail-closed is still the default, not just the eventual state
 * ---------------------------------------------------------------------------------------------
 * Before the *first* successful refresh ever completes, `evaluate()` reports `'unavailable'` for
 * every IP -- "ACL unknown" never means "admit everyone" (ADR-002), it means "we cannot say yet,
 * try again shortly" (`421`, never a silent allow and never `554`). `evaluateRecipient()` follows the
 * identical rule for `RCPT TO` (`421`'s per-command sibling is `451`, see `./smtp-server.ts`'s
 * `handleRcpt`): before the first successful refresh, or once staleness is crossed, every recipient
 * reports `'unavailable'`, never `'allowed'`.
 *
 * ---------------------------------------------------------------------------------------------
 * No catch-all is reachable through this cache, for any of the three ways it could sneak in
 * ---------------------------------------------------------------------------------------------
 * `journal-ledger` skill section 10's prohibition is structural here, not disciplinary:
 *
 *  1. **A wildcard routing-address string.** There is no wildcard syntax this cache or
 *     `./recipient-address.ts` interprets -- `evaluateRecipient()` does one thing, an exact
 *     (normalised) string-equality lookup in `recipientIndex`. A literal `"*"` stored in
 *     `routing_address` would simply never equal any real `RCPT TO` address; it could not
 *     accidentally match everything the way an unescaped wildcard in a regex or glob might.
 *  2. **An empty recipient set.** No `journaling_sources` rows, or every row failing to compile
 *     (see `compileSourceAcl` below), yields an empty `recipientIndex` -- `evaluateRecipient()`
 *     then reports `'denied'` for every address once the cache has successfully loaded (or
 *     `'unavailable'` before it has), never `'allowed'`. There is no default-permit branch anywhere
 *     in {@link SourceAclCache.evaluateRecipient}.
 *  3. **A source with no `routing_address`.** The column is `NOT NULL` in the schema
 *     (`packages/backend/src/database/schema/journaling-sources.ts`) and generated by this product
 *     itself at source-creation time -- there is no application code path that creates a source
 *     with an empty or missing routing address, and even if the column somehow held an empty
 *     string, `normalizeJournalRecipient('')` is `''`, which cannot equal a real `RCPT TO` address
 *     (a real one is always non-empty per RFC 5321's `Mailbox` grammar) -- see
 *     `./recipient-address.ts`'s doc comment for that case.
 */

const noopAclLogger: IngressLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/** One source's `allowed_ips`, parsed into {@link ParsedCidr}s, ready for `evaluate()` to scan --
 * plus, since `JR-4-05b`, its normalised `routing_address`, ready for `evaluateRecipient()` to
 * index. */
export interface CompiledSourceAcl {
	readonly sourceId: string;
	readonly chainScopeId: string;
	readonly requireTls: boolean;
	readonly cidrs: readonly ParsedCidr[];
	/** `journaling_sources.routing_address`, folded through `./recipient-address.ts`'s comparison
	 * rules. Never re-derived at match time -- `evaluateRecipient()` folds the incoming `RCPT TO`
	 * address the same way and compares normalised-to-normalised. */
	readonly routingAddress: string;
	/** `journaling_sources.smtp_username` (`JR-4-05c`), unnormalised -- unlike `routingAddress`,
	 * `AUTH` usernames are compared byte-for-byte, the same posture as the password itself (see
	 * `./smtp-server.ts`'s "AUTH" module doc comment section). `null` when this source has no `AUTH`
	 * credentials configured. */
	readonly smtpUsername: string | null;
	/** `journaling_sources.smtp_password_hash` (`JR-4-05c`), a bcrypt hash, `null` in lockstep with
	 * `smtpUsername`. */
	readonly smtpPasswordHash: string | null;
}

/**
 * Parse one source's `allowedIps` into {@link CompiledSourceAcl}, or `null` if **any** entry fails
 * to parse.
 *
 * **A single invalid CIDR marks the whole source unusable -- it does not silently drop just that
 * entry and keep matching the rest.** The alternative (skip the bad entry, keep the good ones)
 * looks safer but is not: it lets a typo in one line of an `allowed_ips` array quietly narrow an
 * operator's intended allow-list with no signal anywhere that anything changed, which is worse
 * than the source simply not admitting any connection until the typo is fixed -- a `554`/`421` to a
 * legitimate sender is noisy and gets noticed; a silently-narrower allow-list is not. Every failure
 * is also logged loudly (`logger.error`), and every `prefixLength === 0` entry (an accidental
 * catch-all, matching every address of its family) logs a warning even when it is otherwise valid.
 */
export function compileSourceAcl(
	entry: JournalingSourceAclEntry,
	logger: IngressLogger = noopAclLogger
): CompiledSourceAcl | null {
	const cidrs: ParsedCidr[] = [];
	for (const raw of entry.allowedIps) {
		let parsed: ParsedCidr;
		try {
			parsed = parseCidr(raw);
		} catch (err) {
			logger.error(
				{ sourceId: entry.id, entry: raw, err },
				'smtp-ingress: invalid CIDR entry in journaling_sources.allowed_ips -- treating the ' +
					'whole source as unusable (fail closed) until it is fixed'
			);
			return null;
		}
		if (parsed.isCatchAll) {
			logger.warn(
				{ sourceId: entry.id, entry: raw },
				'smtp-ingress: journaling_sources.allowed_ips entry has prefix length 0 -- matches ' +
					'every address of its family; verify this catch-all is intentional'
			);
		}
		cidrs.push(parsed);
	}
	return {
		sourceId: entry.id,
		chainScopeId: entry.chainScopeId,
		requireTls: entry.requireTls,
		cidrs,
		routingAddress: normalizeJournalRecipient(entry.routingAddress),
		smtpUsername: entry.smtpUsername,
		smtpPasswordHash: entry.smtpPasswordHash,
	};
}

/**
 * Build the recipient-ACL index (`JR-4-05b`) from one refresh's already-`compileSourceAcl`'d rows.
 * Pulled out of `doRefresh()` into its own pure function -- no logger side effects beyond the
 * `IngressLogger` parameter, no cache state -- for the same reason `compileSourceAcl` is a free
 * function rather than a private method: a test can call it directly against a handful of
 * `CompiledSourceAcl` fixtures without spinning up a whole cache and refresh cycle.
 *
 * **A duplicate `routing_address` across two active sources is an operator misconfiguration, not a
 * crash.** `journaling_sources` has no unique constraint on the column, so nothing in the schema
 * prevents it. Keeping *both* is not an option -- `evaluateRecipient()` must return exactly one
 * `chainScopeId` per match. Between "reject every recipient for that address" (denies a working
 * source too) and "keep one, log loudly", the second is chosen: the **first** row encountered wins
 * -- deterministic because `PostgresSourceAclLookup.listActiveSources()` orders by `id`
 * (`JR-4-05b`) -- and every subsequent row for the same normalised address is dropped with a
 * `logger.error` naming both source ids, so the operator sees the conflict on every refresh until
 * it is fixed rather than silently losing one source's mail.
 */
export function buildRecipientIndex(
	compiled: readonly CompiledSourceAcl[],
	logger: IngressLogger
): ReadonlyMap<string, CompiledSourceAcl> {
	const index = new Map<string, CompiledSourceAcl>();
	for (const one of compiled) {
		if (one.routingAddress === '') {
			// Not reachable in practice -- routing_address is NOT NULL and generated by this system --
			// but this cache never assumes a "cannot happen" case is actually unreachable (the same
			// posture decodeAllowedIps takes for a corrupt allowed_ips value). Excluded from the
			// recipient index only; the source's IP-based ACL (./cidr.ts) is unaffected.
			logger.error(
				{ sourceId: one.sourceId },
				'smtp-ingress: journaling_sources.routing_address for this source is empty after ' +
					'normalisation -- excluding it from the recipient ACL (its source-IP ACL is unaffected)'
			);
			continue;
		}
		const existing = index.get(one.routingAddress);
		if (existing) {
			logger.error(
				{
					routingAddress: one.routingAddress,
					keptSourceId: existing.sourceId,
					ignoredSourceId: one.sourceId,
				},
				'smtp-ingress: two active journaling sources share the same routing_address -- keeping ' +
					'the first (lowest id) and ignoring the second until the operator fixes the duplicate'
			);
			continue;
		}
		index.set(one.routingAddress, one);
	}
	return index;
}

/**
 * Build the `AUTH` credential index (`JR-4-05c`) from one refresh's already-`compileSourceAcl`'d
 * rows, the same pattern {@link buildRecipientIndex} already establishes: a pure function, no cache
 * state, so a test can call it directly against a handful of fixtures.
 *
 * A source with `smtpUsername === null` (no `AUTH` credentials configured -- the ordinary case, see
 * this module's doc comment) contributes nothing to the index; it is not an error. **Two active
 * sources sharing the same `smtp_username`** is handled exactly like a duplicate `routing_address`
 * in {@link buildRecipientIndex}: keeping both is not an option (`lookupCredential()` must return
 * exactly one source per username), rejecting every login for that username would deny a working
 * source too, so the first row wins -- deterministic because `PostgresSourceAclLookup` orders by
 * `id` -- and every later row for the same username is dropped with a `logger.error` naming both
 * source ids, so the conflict is visible on every refresh rather than silently costing one source
 * its `AUTH` access.
 */
export function buildAuthIndex(
	compiled: readonly CompiledSourceAcl[],
	logger: IngressLogger
): ReadonlyMap<string, CompiledSourceAcl> {
	const index = new Map<string, CompiledSourceAcl>();
	for (const one of compiled) {
		if (one.smtpUsername === null || one.smtpPasswordHash === null || one.smtpUsername === '') {
			continue;
		}
		const existing = index.get(one.smtpUsername);
		if (existing) {
			logger.error(
				{
					smtpUsername: one.smtpUsername,
					keptSourceId: existing.sourceId,
					ignoredSourceId: one.sourceId,
				},
				'smtp-ingress: two active journaling sources share the same smtp_username -- keeping ' +
					'the first (lowest id) and ignoring the second until the operator fixes the duplicate'
			);
			continue;
		}
		index.set(one.smtpUsername, one);
	}
	return index;
}

export interface SourceAclCacheOptions {
	readonly lookup: SourceAclLookup;
	/** Milliseconds between polls of `journaling_sources`. */
	readonly refreshIntervalMs: number;
	/** Milliseconds a snapshot may be served after its last successful refresh before `evaluate()`
	 * starts reporting `'unavailable'`. See the class doc comment. */
	readonly staleAfterMs: number;
	readonly logger?: IngressLogger;
	/** Injectable clock, `Date.now` by default -- lets tests control staleness deterministically
	 * without a real `setTimeout`/`setInterval` wait. */
	readonly now?: () => number;
}

export class SourceAclCache
	implements SourceAclEvaluator, RecipientAclEvaluator, AuthCredentialEvaluator
{
	private snapshot: readonly CompiledSourceAcl[] = [];
	/** Recipient ACL index (`JR-4-05b`), keyed by normalised `routing_address` -- rebuilt in the same
	 * `doRefresh()` pass as `snapshot`, from the same rows. See {@link doRefresh} for how a duplicate
	 * `routing_address` across two active sources is handled. */
	private recipientIndex: ReadonlyMap<string, CompiledSourceAcl> = new Map();
	/** `AUTH` credential index (`JR-4-05c`), keyed by `smtp_username` -- rebuilt in the same
	 * `doRefresh()` pass as `snapshot`/`recipientIndex`. See {@link buildAuthIndex} for how a
	 * duplicate `smtp_username` across two active sources is handled. */
	private authIndex: ReadonlyMap<string, CompiledSourceAcl> = new Map();
	private lastSuccessAt: number | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private refreshInFlight: Promise<void> | null = null;
	private readonly logger: IngressLogger;
	private readonly now: () => number;

	constructor(private readonly options: SourceAclCacheOptions) {
		this.logger = options.logger ?? noopAclLogger;
		this.now = options.now ?? Date.now;
	}

	/**
	 * Perform the first load and start the refresh timer. Resolves even if the first load failed --
	 * a Postgres outage at process boot must not crash `apps/smtp-ingress`'s startup (skill section
	 * 1: a local failure rejects individual transactions, it never stops the process). The cache
	 * simply starts in the `'unavailable'` state and the timer keeps retrying.
	 */
	async start(): Promise<void> {
		await this.refreshNow();
		this.timer = setInterval(() => {
			void this.refreshNow();
		}, this.options.refreshIntervalMs);
		this.timer.unref?.();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Force an immediate refresh, coalescing concurrent callers onto one in-flight request rather
	 * than issuing overlapping queries. Exposed (not only driven by the internal timer) so a test
	 * can await a deterministic refresh instead of racing `setInterval`.
	 */
	async refreshNow(): Promise<void> {
		if (this.refreshInFlight) {
			return this.refreshInFlight;
		}
		this.refreshInFlight = this.doRefresh().finally(() => {
			this.refreshInFlight = null;
		});
		return this.refreshInFlight;
	}

	private async doRefresh(): Promise<void> {
		try {
			const rows = await this.options.lookup.listActiveSources();
			const compiled: CompiledSourceAcl[] = [];
			for (const row of rows) {
				const one = compileSourceAcl(row, this.logger);
				if (one) {
					compiled.push(one);
				}
			}
			this.snapshot = compiled;
			this.recipientIndex = buildRecipientIndex(compiled, this.logger);
			this.authIndex = buildAuthIndex(compiled, this.logger);
			this.lastSuccessAt = this.now();
		} catch (err) {
			// Deliberately keep the previous snapshot and lastSuccessAt -- see the class doc
			// comment's answer to question 3. The staleness check in evaluate() is what eventually
			// fails this closed if the outage outlasts staleAfterMs.
			this.logger.error(
				{ err },
				'smtp-ingress: source ACL refresh failed; serving the previous snapshot until ' +
					'staleAfterMs elapses, then failing closed'
			);
		}
	}

	/**
	 * Decide connect-time admission for `remoteIp`. Never throws: an unparseable `remoteIp` --
	 * should not happen, it comes from `socket.remoteAddress` -- is treated as `'unavailable'`
	 * rather than crashing the connection handler.
	 */
	evaluate(remoteIp: string): SourceAclDecision {
		if (this.isSnapshotUnavailable()) {
			return { kind: 'unavailable' };
		}

		let normalized: string;
		try {
			normalized = normalizeRemoteIp(remoteIp);
		} catch {
			return { kind: 'unavailable' };
		}

		for (const source of this.snapshot) {
			for (const cidr of source.cidrs) {
				if (matchesCidr(normalized, cidr)) {
					return {
						kind: 'allowed',
						sourceId: source.sourceId,
						chainScopeId: source.chainScopeId,
						requireTls: source.requireTls,
					};
				}
			}
		}
		return { kind: 'denied' };
	}

	/**
	 * Decide `RCPT TO` admission for `rcptToAddress` (`JR-4-05b`). Follows the exact same
	 * fail-closed shape as {@link evaluate}: `'unavailable'` before the first successful refresh or
	 * once staleness is crossed, `'denied'` for a known-but-non-matching address, `'allowed'` with
	 * the matched source's identity and `chainScopeId` otherwise. See the class doc comment's "No
	 * catch-all is reachable through this cache" section for why none of the three ways to reach an
	 * accidental catch-all apply here.
	 */
	evaluateRecipient(rcptToAddress: string): RecipientAclDecision {
		if (this.isSnapshotUnavailable()) {
			return { kind: 'unavailable' };
		}

		const normalized = normalizeJournalRecipient(rcptToAddress);
		const match = this.recipientIndex.get(normalized);
		if (!match) {
			return { kind: 'denied' };
		}
		return { kind: 'allowed', sourceId: match.sourceId, chainScopeId: match.chainScopeId };
	}

	/**
	 * Look up `AUTH` credentials for `username` (`JR-4-05c`). Follows the same fail-closed shape as
	 * {@link evaluate}/{@link evaluateRecipient}: `'unavailable'` before the first successful refresh
	 * or once staleness is crossed (never `'not_found'` for that case -- an unknown ACL state must
	 * not be indistinguishable from a proven-wrong username to the caller, since `./smtp-server.ts`
	 * maps the two to different response codes, `454` vs. `535`). `'not_found'` covers both "no such
	 * username" and "this username's source has no `AUTH` credentials configured" -- there is nothing
	 * for a caller to usefully tell apart between those two, and conflating them is exactly what
	 * keeps an unconfigured source from leaking "this username at least exists" through a different
	 * response than a genuinely absent one.
	 *
	 * Never throws, and never runs a password comparison itself -- this method only decides *which*
	 * hash (if any) a caller should compare against; the comparison itself (real or, for `'not_found'`,
	 * the timing-parity dummy hash) is `./smtp-server.ts`'s `SmtpConnection.verifyCredentials`'s job,
	 * through the injected `PasswordVerifier` port.
	 */
	lookupCredential(username: string): AuthCredentialLookupResult {
		if (this.isSnapshotUnavailable()) {
			return { kind: 'unavailable' };
		}
		const match = this.authIndex.get(username);
		if (!match) {
			return { kind: 'not_found' };
		}
		return {
			kind: 'found',
			sourceId: match.sourceId,
			chainScopeId: match.chainScopeId,
			passwordHash: match.smtpPasswordHash!,
		};
	}

	/** Shared by {@link evaluate}/{@link evaluateRecipient}/{@link lookupCredential}: no snapshot has ever loaded
	 * successfully, or the last successful load is older than `staleAfterMs`. See the class doc
	 * comment's "Fail-closed is still the default" section. */
	private isSnapshotUnavailable(): boolean {
		if (this.lastSuccessAt === null) {
			return true;
		}
		return this.now() - this.lastSuccessAt > this.options.staleAfterMs;
	}
}

/**
 * Compose a {@link SourceAclCache} into a {@link RequireTlsResolver} that **tightens, never
 * loosens** the process-wide default -- the contract `../ingress/smtp-server.ts`'s
 * `RequireTlsResolver` doc comment states: `(ctx) => processDefault || sourceRequireTls(ctx)`,
 * never `(ctx) => sourceRequireTls(ctx)` alone.
 *
 * A `remoteIp` that matches no source, or a cache that is currently `'unavailable'`, contributes
 * `false` -- the process default is the only thing keeping such a connection gated at all, which
 * is exactly the pre-`JR-4-05a` behaviour for a connection this cache cannot yet place.
 */
export function createSourceAclRequireTlsResolver(
	cache: SourceAclCache,
	processDefault: boolean
): RequireTlsResolver {
	return (context: RequireTlsContext): boolean => {
		if (processDefault) {
			return true;
		}
		if (context.remoteIp === null) {
			return false;
		}
		const decision = cache.evaluate(context.remoteIp);
		return decision.kind === 'allowed' && decision.requireTls;
	};
}

/** The three {@link EsmtpServerOptions} slots {@link SourceAclCache} fills at once -- `Pick`, not a
 * hand-rolled copy, so this stays in lockstep with `EsmtpServerOptions` itself if a fourth slot is
 * ever added there. */
export type SourceAclCacheEsmtpBindings = Required<
	Pick<EsmtpServerOptions, 'sourceAclEvaluator' | 'recipientAclEvaluator' | 'authCredentialEvaluator'>
>;

/**
 * Bind one {@link SourceAclCache} instance into the three {@link EsmtpServerOptions} slots it fills
 * (`JR-4-20`, closing F46) -- `apps/smtp-ingress/src/index.ts`'s production wiring calls this
 * instead of writing out `sourceAclEvaluator: cache, recipientAclEvaluator: cache,
 * authCredentialEvaluator: cache` inline, and so does
 * `tests/unit/source-acl-cache-wiring.test.ts` -- **the same function**, not a re-typed copy of the
 * assignment, wired into a real `EsmtpServer` over a real loopback socket.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this function exists at all -- it does nothing a three-line object literal could not
 * ---------------------------------------------------------------------------------------------
 * F46 was not a wrong *object* passed to the wrong slot -- passing the same `SourceAclCache` to all
 * three was, and remains, exactly the intended design (this file's module doc comment, "One cache,
 * one refresh cycle, three ACLs"). F46 was a method-name collision between two of the *ports*
 * (`SourceAclEvaluator.evaluate`/`RecipientAclEvaluator.evaluate`, now `evaluateRecipient` --
 * `./smtp-server.ts`'s `RecipientAclEvaluator` doc comment) that no test caught, because every
 * existing test constructed its own hand-written fakes for these three roles rather than this
 * production assembly. Extracting the assembly here, so a test can call the identical function
 * production calls, is what closes *that* gap: a test built on this function exercises the real
 * three-role binding, not a reproduction of it, so a future regression in *how the cache is bound*
 * -- not just in the ports' method names, already covered by
 * `tests/unit/acl-evaluator-port-shapes.test.ts` -- has a test standing in its way too.
 */
export function bindSourceAclCache(cache: SourceAclCache): SourceAclCacheEsmtpBindings {
	return {
		sourceAclEvaluator: cache,
		recipientAclEvaluator: cache,
		authCredentialEvaluator: cache,
	};
}
