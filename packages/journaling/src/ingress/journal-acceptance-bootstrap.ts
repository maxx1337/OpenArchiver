import {
	noopIngressLogger,
	type IngressLogger,
	type JournalAcceptancePort,
	type JournalAcceptanceProvider,
} from './smtp-server';

/**
 * `JournalAcceptanceBootstrap` -- keeps trying to build the durable-acceptance port until it
 * succeeds, so a ledger database that was unreachable at process start does not leave the receiver
 * answering `451` forever (`JR-4-19`).
 *
 * ---------------------------------------------------------------------------------------------
 * The defect this closes
 * ---------------------------------------------------------------------------------------------
 * `apps/smtp-ingress` built its acceptance port exactly once, during startup. With the ledger
 * database briefly down (or `deployment_identity` not yet migrated) at that moment,
 * `journalAcceptance` stayed `undefined` **for the lifetime of the process**: the port bound, the
 * process looked healthy, and every single transaction ended in `451 4.3.0` until an operator
 * happened to restart it. Exchange Online retries for a while and then generates NDRs, so "looks
 * healthy, accepts nothing" is the worst shape this failure could have had. `JR-4-06a` flagged it
 * when it introduced the fallback; this is the promotion path it deliberately left out of scope.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the timer stops after the first success -- decided by the Product Owner on 2026-08-03
 * ---------------------------------------------------------------------------------------------
 * This is a **boot** problem, not a liveness problem. Once {@link build} has succeeded once, a later
 * outage needs nothing from this class: `PostgresLedgerWriter`'s transactor reconnects per `append()`
 * (postgres-js does that itself), and `JournalAcceptance` already maps a failing append to
 * `'ledger-append-failed'` -- `451`, never `250`. Polling on would burn a connection per interval to
 * learn something the accept path already handles correctly, and it would raise a question with no
 * good answer ("un-wire the acceptance again?" -- which would only duplicate the `451` the append
 * already produces). So: retry until wired, then `clearInterval` and stay out of the way.
 *
 * ---------------------------------------------------------------------------------------------
 * The crash-recovery scan runs inside every attempt, and that is safe -- same decision
 * ---------------------------------------------------------------------------------------------
 * `apps/smtp-ingress`'s {@link build} includes `runExclusiveCrashRecoveryScan()` (`JR-4-18`), so a
 * retry re-runs it. Architecture doc section 5 requires that scan to run over "a spool nobody writes
 * to", and in the pre-promotion state that holds by construction: with no acceptance wired,
 * `EsmtpServer` opens no `SpoolWriteBridge` at all (see `smtp-server.ts`, the
 * `transactionAcceptance` field), so not one byte reaches `incoming/`. Because the timer stops at the
 * first success, the scan never runs again once transactions can be accepted -- the scan-versus-accept
 * race `crash-recovery-lock.ts` explicitly does *not* solve stays unreachable. The alternative --
 * scanning only on the boot attempt -- would leave a crashed deployment's orphaned spool files
 * unreconciled forever precisely when the database was down at restart (F40's capacity problem).
 *
 * ---------------------------------------------------------------------------------------------
 * Shape borrowed from `SourceAclCache`
 * ---------------------------------------------------------------------------------------------
 * Same three-method surface (`start`/`stop` plus an awaitable manual attempt), same `unref()`'d
 * timer, same "resolves even if the first attempt failed, because a Postgres outage at boot must not
 * crash startup" contract. {@link tryNow} is public for the same reason `refreshNow()` is: a test
 * must be able to await a deterministic attempt instead of racing `setInterval`.
 *
 * Configuration and the database live outside this package (architecture doc section 2): the caller
 * injects {@link JournalAcceptanceBootstrapOptions.build}, which is where the
 * `deployment_identity` read, the crash-recovery scan and the `PostgresLedgerWriter` construction
 * actually happen.
 */
export interface JournalAcceptanceBootstrapOptions {
	/**
	 * Build the acceptance port, or **throw**. Called once by {@link JournalAcceptanceBootstrap.start}
	 * and then once per retry interval until it returns. Must be safe to call repeatedly: in
	 * `apps/smtp-ingress` it reads `deployment_identity`, runs the crash-recovery scan and constructs
	 * the writer, all of which tolerate being redone.
	 */
	readonly build: () => Promise<JournalAcceptancePort>;
	/** How long to wait between attempts. Only ever used while unwired. */
	readonly retryIntervalMs: number;
	readonly logger?: IngressLogger;
}

export class JournalAcceptanceBootstrap {
	private acceptance: JournalAcceptancePort | undefined = undefined;
	private timer: ReturnType<typeof setInterval> | null = null;
	private attemptInFlight: Promise<void> | null = null;
	private attempts = 0;
	private readonly logger: IngressLogger;

	constructor(private readonly options: JournalAcceptanceBootstrapOptions) {
		this.logger = options.logger ?? noopIngressLogger;
	}

	/**
	 * Make the first attempt and, if it fails, start retrying in the background.
	 *
	 * **Resolves either way** -- a database that is down at boot must not stop the process from
	 * binding its port (the receiver still answers `451`, which is what the response-code table asks
	 * for, rather than refusing connections outright). Callers must therefore keep awaiting this
	 * *before* `listen()`: on the success path the crash-recovery scan inside `build` has to complete
	 * before the port accepts anything (`JR-4-18`, and the ordering test F49 rebuilt).
	 */
	async start(): Promise<void> {
		await this.tryNow();
		if (this.acceptance !== undefined) {
			return;
		}
		this.timer = setInterval(() => {
			void this.tryNow();
		}, this.options.retryIntervalMs);
		this.timer.unref?.();
	}

	/**
	 * Attempt once, now. Concurrent callers share the in-flight attempt rather than starting a second
	 * one -- `build` runs a database transaction and takes the crash-recovery advisory lock, so
	 * overlapping attempts would serialise against each other for no gain. A no-op once wired.
	 */
	async tryNow(): Promise<void> {
		if (this.acceptance !== undefined) {
			return;
		}
		if (this.attemptInFlight !== null) {
			return this.attemptInFlight;
		}
		this.attemptInFlight = this.attempt().finally(() => {
			this.attemptInFlight = null;
		});
		return this.attemptInFlight;
	}

	/** Stop retrying. Idempotent; called from the process's shutdown path. */
	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * The provider to hand `EsmtpServer` as `journalAcceptanceProvider`. Returns `undefined` until the
	 * first successful attempt, which is exactly what makes every transaction until then answer
	 * `451 4.3.0` and never `250`.
	 */
	provider(): JournalAcceptanceProvider {
		return () => this.acceptance;
	}

	/** Whether acceptance is wired. For tests and for a future readiness probe (`ledger-config.ts`'s
	 * doc comment asks for one); the receive path itself only ever uses {@link provider}. */
	isWired(): boolean {
		return this.acceptance !== undefined;
	}

	private async attempt(): Promise<void> {
		this.attempts++;
		const attempt = this.attempts;
		try {
			const acceptance = await this.options.build();
			this.acceptance = acceptance;
			// Stop before logging: the log line below claims the retry loop is over, and it should be
			// true by the time anyone reads it.
			this.stop();
			// The state change the acceptance criterion asks to be visible in the log. Exactly one
			// line per promotion -- the failures above are per attempt, this is not.
			this.logger.info(
				{ attempt },
				attempt === 1
					? 'smtp-ingress: journal acceptance wired at startup; transactions can be accepted durably'
					: 'smtp-ingress: journal acceptance wired after a failed start; transactions can be ' +
							'accepted durably again without a restart'
			);
		} catch (err) {
			this.logger.error(
				{ err, attempt, retryIntervalMs: this.options.retryIntervalMs },
				'smtp-ingress: could not build journal acceptance (ledger database unreachable, not ' +
					'migrated, or the crash-recovery scan failed) -- every transaction answers 451 4.3.0 ' +
					'until this succeeds; retrying in the background'
			);
		}
	}
}
