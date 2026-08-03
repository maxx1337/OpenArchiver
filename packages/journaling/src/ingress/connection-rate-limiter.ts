import type { ConnectionLimiter, TransactionRateLimiter } from './smtp-server';

/**
 * Concurrent-connection cap per source (`JR-4-08`). Keyed by `sourceId` -- the identity
 * `JR-4-05a`'s connect-time ACL match already resolves -- never by remote IP and never by
 * connection object. That choice is what answers the two questions the task asked:
 *
 *  1. **What bounds this counter's memory?** The number of *distinct sources currently holding at
 *     least one open connection*, never the number of connections or distinct IPs ever seen.
 *     `sourceId` comes from `journaling_sources`, a finite, operator-controlled table -- there is
 *     no way for {@link counts} to hold more entries than that table has active rows, no matter how
 *     many connection attempts are made or from how many addresses. {@link release} additionally
 *     deletes an entry once its count reaches zero, so a source that disconnects entirely leaves
 *     nothing behind either -- the map's size is bounded by *currently open* sources, not by
 *     historical ones.
 *  2. **Can an unauthorized caller reach, and so grow or exhaust, this counter?** No. `EsmtpServer`
 *     (`./smtp-server.ts`, `handleConnection`) calls {@link tryAcquire} only after the source ACL has
 *     already resolved the connection to `'allowed'` -- an IP matching no configured source is
 *     rejected `554 5.7.1` (or `421 4.3.2` if the ACL is not currently known) before this class is
 *     ever consulted. There is no `sourceId` for an unauthorized address to acquire a slot with, so
 *     this limiter cannot be turned into an exhaustion vector by connecting from outside the ACL,
 *     regardless of how many times.
 */
export class PerSourceConnectionLimiter implements ConnectionLimiter {
	private readonly counts = new Map<string, number>();

	constructor(private readonly maxPerSource: number) {}

	tryAcquire(sourceId: string): boolean {
		const current = this.counts.get(sourceId) ?? 0;
		if (current >= this.maxPerSource) {
			return false;
		}
		this.counts.set(sourceId, current + 1);
		return true;
	}

	release(sourceId: string): void {
		const current = this.counts.get(sourceId) ?? 0;
		if (current <= 1) {
			this.counts.delete(sourceId);
		} else {
			this.counts.set(sourceId, current - 1);
		}
	}

	/** Current concurrent-connection count held for `sourceId` -- exposed for tests only; production
	 * only ever needs {@link tryAcquire}/{@link release}. */
	currentCount(sourceId: string): number {
		return this.counts.get(sourceId) ?? 0;
	}
}

/**
 * Fixed-window transaction-rate cap per source (`JR-4-08`). Same memory and same
 * unreachable-by-an-unauthorized-caller argument as {@link PerSourceConnectionLimiter} above --
 * keyed by `sourceId`, never by IP or connection, and only ever consulted (`SmtpConnection.handleMail`,
 * `./smtp-server.ts`) for a connection the source ACL already resolved to `'allowed'`.
 *
 * A fixed window (not a sliding one, not a token bucket) is a deliberate simplification: at the
 * boundary between two windows a source could, in the worst case, start close to `2x` the
 * configured rate (a burst at the end of one window immediately followed by a burst at the start of
 * the next). That looseness is acceptable for a coarse abuse backstop -- catching a source that is
 * grossly misbehaving, not shaping traffic to the transaction -- and a fixed window is far simpler
 * to reason about and to test than a sliding one. Flagged here rather than silently accepted:
 * tightening this to a sliding window is a reasonable future refinement if the coarser bound ever
 * proves insufficient in practice.
 */
export class PerSourceTransactionRateLimiter implements TransactionRateLimiter {
	private readonly windows = new Map<string, { windowStart: number; count: number }>();

	constructor(
		private readonly maxPerWindow: number,
		private readonly windowMs: number,
		private readonly now: () => number = Date.now
	) {}

	tryConsume(sourceId: string): boolean {
		const nowMs = this.now();
		const existing = this.windows.get(sourceId);
		if (existing === undefined || nowMs - existing.windowStart >= this.windowMs) {
			this.windows.set(sourceId, { windowStart: nowMs, count: 1 });
			return true;
		}
		if (existing.count >= this.maxPerWindow) {
			return false;
		}
		existing.count += 1;
		return true;
	}

	/** Drop windows for sources that have not attempted a transaction in at least `windowMs` --
	 * optional housekeeping, not required for correctness (see the class doc comment: the key space
	 * is already bounded by the number of active sources, so a window nobody ever prunes still
	 * cannot grow unboundedly). Exposed so a deployment with many configured sources and bursty,
	 * infrequent traffic can keep the map limited to currently-active sources if it chooses to call
	 * this periodically; `apps/smtp-ingress` does not call it today.
	 */
	pruneExpired(): void {
		const nowMs = this.now();
		for (const [sourceId, window] of this.windows) {
			if (nowMs - window.windowStart >= this.windowMs) {
				this.windows.delete(sourceId);
			}
		}
	}

	/** Current window's consumed count for `sourceId`, `0` if it has no window yet or its window has
	 * already expired -- exposed for tests only. */
	currentWindowCount(sourceId: string): number {
		const existing = this.windows.get(sourceId);
		if (existing === undefined || this.now() - existing.windowStart >= this.windowMs) {
			return 0;
		}
		return existing.count;
	}
}
