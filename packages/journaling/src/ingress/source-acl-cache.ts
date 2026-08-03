import { normalizeRemoteIp } from '../ledger/canonical-encoding';
import { matchesCidr, parseCidr, type ParsedCidr } from './cidr';
import type { JournalingSourceAclEntry, SourceAclLookup } from './source-acl-port';
import type {
	IngressLogger,
	RequireTlsContext,
	RequireTlsResolver,
	SourceAclDecision,
	SourceAclEvaluator,
} from './smtp-server';

/**
 * `SourceAclCache` -- the periodically-refreshed, connect-time source ACL (`JR-4-05a`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why a cache, not a query per connection
 * ---------------------------------------------------------------------------------------------
 * A `SELECT` on every accepted TCP connection would make Postgres a hard dependency of the receive
 * path's availability -- exactly the coupling `docs/dev/journaling/02-architektur.md` section 3
 * already argues against for Phase B ("Object store unreachable ⇒ still `250`"). This cache polls
 * `journaling_sources` on a timer (`refreshIntervalMs`) and every `evaluate()` call is a pure
 * in-memory lookup against the last successfully loaded snapshot.
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
 * try again shortly" (`421`, never a silent allow and never `554`).
 */

const noopAclLogger: IngressLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/** One source's `allowed_ips`, parsed into {@link ParsedCidr}s, ready for `evaluate()` to scan. */
export interface CompiledSourceAcl {
	readonly sourceId: string;
	readonly chainScopeId: string;
	readonly requireTls: boolean;
	readonly cidrs: readonly ParsedCidr[];
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
	};
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

export class SourceAclCache implements SourceAclEvaluator {
	private snapshot: readonly CompiledSourceAcl[] = [];
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
		if (this.lastSuccessAt === null) {
			return { kind: 'unavailable' };
		}
		if (this.now() - this.lastSuccessAt > this.options.staleAfterMs) {
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
