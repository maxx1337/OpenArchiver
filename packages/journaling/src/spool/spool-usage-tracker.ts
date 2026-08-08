import { computeDirectoryUsageBytes } from './layout';
import type { SpoolFileSystem } from './fs-port';

/**
 * The running spool-usage counter (`F66`, `docs/dev/journaling/09-befunde-bestandscode.md`).
 *
 * ---------------------------------------------------------------------------------------------
 * What this replaces, and what it does not
 * ---------------------------------------------------------------------------------------------
 * Before this, `JournalAcceptance.accept()`'s step 0 called `checkSpoolHighWaterMark()`
 * (`./layout.ts`), which walks the entire spool tree (`incoming/` **and** `quarantine/`, every shard,
 * every file) and `stat()`s every file, on **every SMTP transaction** -- `O(entries)` work on the hot
 * path the acceptance contract is supposed to keep fast, called out in `layout.ts`'s own module doc
 * comment since `JR-3-01`/`JR-3-04` as "the likely production shape ... this module deliberately does
 * not decide that". F66 measured the consequence directly: cumulative accept time grows
 * quadratically with backlog depth once Phase B falls behind (`09-befunde-bestandscode.md`, the
 * per-500-message rate table).
 *
 * `checkSpoolHighWaterMark()` and `computeDirectoryUsageBytes()` are **not removed** -- they are
 * still exactly what seeds this counter (once, not per transaction) and what a reconciliation pass
 * corrects it against. `evaluateHighWaterMark()` (`./layout.ts`, already pure) is still the only place
 * that turns a byte count into an "exceeded" verdict; this class only replaces *how the byte count is
 * obtained* on the hot path.
 *
 * ---------------------------------------------------------------------------------------------
 * A plain counter, not a singleton -- deliberately
 * ---------------------------------------------------------------------------------------------
 * This project is built on dependency injection throughout (`SpoolFileSystem`, `LedgerBackend`,
 * `QuarantineAlertSink`, `SourceAclCache`, `JournalAcceptanceBootstrap` -- none of them a module-level
 * mutable singleton). A running counter is exactly the kind of shared mutable state a codebase reaches
 * for a singleton to hold; here it is instead a plain, constructor-injected object with no ambient
 * state, matching every other stateful collaborator in this package.
 *
 * ---------------------------------------------------------------------------------------------
 * Optional on `JournalAcceptanceOptions`/`PhaseBPipelineDeps` -- and what that trade-off costs
 * ---------------------------------------------------------------------------------------------
 * Both `JournalAcceptance` and `runPhaseBPipeline()` treat their `usageTracker` dependency as
 * optional. A caller that omits it gets the exact pre-F66 behaviour: `JournalAcceptance.accept()`
 * falls back to a fresh `checkSpoolHighWaterMark()` walk on every call (correct, `O(n)`, unchanged).
 * That is a deliberate choice, not an oversight: roughly forty existing call sites across this
 * package's and `packages/backend`'s test suites construct a `JournalAcceptance` to test something
 * unrelated to spool capacity (ledger append failures, oversize rejection, TLS, ...), and none of them
 * needed to change for this fix -- see `06-status.md`'s E7 section for the measured proof that they
 * still pass unmodified. Only a caller that actually cares about the hot-path cost -- production
 * (`apps/smtp-ingress/src/index.ts`) and this file's own regression test -- supplies a tracker and
 * gets the `O(1)` path.
 *
 * ---------------------------------------------------------------------------------------------
 * Debris counts too -- the counter has to match the walk it replaces, not a simplified version of it
 * ---------------------------------------------------------------------------------------------
 * `spool-fsync-fault-injection.adv.test.ts`'s "quarantined debris still silently erodes the
 * high-water-mark budget" case (F40 half 2) is accepted behaviour: bytes a failed, quarantined write
 * left behind count toward the budget exactly like a successful one, because
 * `computeDirectoryUsageBytes()` walks `quarantine/` too and never distinguishes why a file is there.
 * `JournalAcceptance.accept()`'s `DurableWriteError` handler therefore `stat()`s whatever
 * `quarantineSpoolFile()` actually moved (not the number of chunks the caller *tried* to write --
 * `writeDurableSpoolFile()` can fail after only some of them landed) and increments the tracker by
 * that real size, but only when a tracker was supplied; a caller without one keeps taking the
 * unconditionally-correct walk, so this extra `stat()` never runs on a path that would otherwise be
 * `O(1)` and doesn't need it.
 *
 * ---------------------------------------------------------------------------------------------
 * The cross-process gap this does **not** close (flagged, not hidden)
 * ---------------------------------------------------------------------------------------------
 * `apps/smtp-ingress` (accepts, increments) and the `journal-inbound` worker (`runPhaseBPipeline()`,
 * decrements on `release()`) are two separate OS processes sharing one spool directory on disk, not
 * one process with two responsibilities -- `docs/dev/journaling/02-architektur.md` section 1. A plain
 * in-memory `SpoolUsageTracker` instance constructed in one process is invisible to the other: wiring
 * one into `runPhaseBPipeline()`'s `deps.usageTracker` in the worker process would decrement an
 * instance nobody's high-water-mark check ever reads, which would *look* like a fix while measuring
 * nothing -- exactly the shape `CLAUDE.md` names F41/F43/F44 against. This is why
 * `journal-inbound.processor.ts` deliberately does not construct one: there is nothing productive for
 * it to decrement yet. The seam exists on `PhaseBPipelineDeps` for a future shared implementation
 * (e.g. Redis-backed) that could give both processes a consistent view; until one exists, the ingress
 * process's own tracker only shrinks when *it* restarts and re-walks. {@link SpoolUsageReconciler}
 * below is the mitigation this fix ships for that gap: a low-frequency walk (still `O(n)`, just paid
 * every few minutes instead of every SMTP transaction) that resets the counter to ground truth, so a
 * long-lived ingress process does not drift toward "permanently exceeded" as Phase B frees space in a
 * process this counter cannot otherwise see into. See `apps/smtp-ingress/src/index.ts` for the wiring,
 * and `06-status.md` for why this is called out to the Product Owner rather than assumed sufficient.
 */
export class SpoolUsageTracker {
	private bytes: bigint;

	constructor(initialBytes: bigint) {
		this.bytes = initialBytes;
	}

	/** Record `bytes` more usage -- called once a durable write (or its quarantined debris) is real. */
	increment(bytes: bigint): void {
		if (bytes === 0n) {
			return;
		}
		this.bytes += bytes;
	}

	/**
	 * Record `bytes` less usage -- called once Phase B's `release()` has actually deleted a file.
	 *
	 * Floored at zero rather than allowed to go negative: a decrement that would cross zero means this
	 * process's view has already drifted from the real filesystem (a decrement for bytes this instance
	 * never itself incremented, e.g. after a restart lost the pre-restart count) -- the floor keeps a
	 * single missed increment from turning into a permanently negative counter that would then report
	 * "never exceeded" regardless of real usage. The next full-walk reconciliation is what actually
	 * corrects the drift; this floor only bounds how wrong the number can be in the meantime.
	 */
	decrement(bytes: bigint): void {
		if (bytes === 0n) {
			return;
		}
		const next = this.bytes - bytes;
		this.bytes = next < 0n ? 0n : next;
	}

	/** The current tracked usage, in bytes. `O(1)` -- no I/O. */
	current(): bigint {
		return this.bytes;
	}

	/** Replace the tracked value outright. Used only by a full-walk reconciliation, never by the hot path. */
	reset(bytes: bigint): void {
		this.bytes = bytes;
	}
}

/** Default interval for {@link SpoolUsageReconciler} -- see its doc comment and this module's. */
export const DEFAULT_SPOOL_USAGE_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export interface SpoolUsageReconcilerOptions {
	readonly fs: SpoolFileSystem;
	readonly spoolRoot: string;
	readonly tracker: SpoolUsageTracker;
	/** Defaults to {@link DEFAULT_SPOOL_USAGE_RECONCILE_INTERVAL_MS} (five minutes). */
	readonly intervalMs?: number;
}

/**
 * Periodically resets a {@link SpoolUsageTracker} to a fresh {@link computeDirectoryUsageBytes} walk.
 *
 * This is the mitigation for the cross-process gap this module's doc comment describes: the walk is
 * still `O(n)`, but paying it once every few minutes rather than once per SMTP transaction is exactly
 * the trade the acceptance contract's hot path needs, and it is what keeps a long-lived
 * `apps/smtp-ingress` process's tracker from drifting away from what the `journal-inbound` worker has
 * actually freed in the meantime. Shape borrowed from `SourceAclCache`/`JournalAcceptanceBootstrap`:
 * an `unref()`'d timer, `start()`/`stop()`, and a public `reconcileNow()` a test can await directly
 * instead of racing `setInterval`.
 */
export class SpoolUsageReconciler {
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly intervalMs: number;

	constructor(private readonly options: SpoolUsageReconcilerOptions) {
		this.intervalMs = options.intervalMs ?? DEFAULT_SPOOL_USAGE_RECONCILE_INTERVAL_MS;
	}

	/** Start the periodic reconciliation. Idempotent -- a second call while running is a no-op. */
	start(): void {
		if (this.timer !== null) {
			return;
		}
		this.timer = setInterval(() => {
			void this.reconcileNow();
		}, this.intervalMs);
		this.timer.unref?.();
	}

	/** Stop the timer. Idempotent; called from the process's shutdown path. */
	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Walk the spool now and reset the tracker to the result. Public so a test can await one attempt. */
	async reconcileNow(): Promise<bigint> {
		const usage = await computeDirectoryUsageBytes(this.options.fs, this.options.spoolRoot);
		this.options.tracker.reset(usage);
		return usage;
	}
}
