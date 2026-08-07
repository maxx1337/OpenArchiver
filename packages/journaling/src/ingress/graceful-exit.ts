/**
 * Writing a last line before `process.exit()` (**F59**, fixed 2026-08-05).
 *
 * ---------------------------------------------------------------------------------------------
 * The defect this exists to close
 * ---------------------------------------------------------------------------------------------
 * `apps/smtp-ingress`'s shutdown handler logged its one confirmation line with `console.log` and then
 * called `process.exit(0)` at the end of the drain. **`process.exit()` does not flush pending
 * asynchronous `stdout` writes**, and on Linux a `stdout` that is a *pipe* -- which it is under any test
 * harness, any process supervisor, any `docker logs` -- writes asynchronously. Between the two there is
 * normally plenty of time; under CPU contention there is not.
 *
 * The consequence was not theoretical. `ingress-process-boot.test.ts` went red on two of three CI runs
 * during E6 with `expected '[dotenv…] injecting env…' to contain 'shutting down'`: the process **had**
 * exited cleanly, only its last line never made it out of the buffer. A red run that is always the same
 * known race is worse than a flaky test -- it destroys the signal value of CI, which is exactly the
 * lesson F48 cost this project.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a bounded wait, and not simply "wait for the flush"
 * ---------------------------------------------------------------------------------------------
 * An unbounded wait swaps a lost log line for a **hung shutdown**, and that is the worse failure: a
 * supervisor eventually `SIGKILL`s a process that will not stop, and a `SIGKILL` during Phase B is what
 * the spool and the reconciler have to clean up afterwards. A `stdout` whose reader has gone away or
 * stopped reading is a real condition, not a hypothetical one.
 *
 * So the wait is bounded and the promise **never rejects**. Diagnostics may not decide whether the
 * process can stop -- the same posture `PhaseBAlertSink` takes for alerts and ADR-008 takes for the TSA:
 * a telemetry channel that is allowed to block the real work has inverted the priorities.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this lives here and not in `apps/smtp-ingress`
 * ---------------------------------------------------------------------------------------------
 * Two reasons, and the second is the binding one. `apps/smtp-ingress` is deliberately thin -- the logic
 * lives in this package (architecture doc section 2) -- and no vitest project glob reaches `apps/`, so a
 * test file placed next to the ingress would be collected by nobody. The suite inventory catches that
 * (an unclassified test file fails the whole run, finding F15's counterpart), but the honest fix is to
 * put testable behaviour where tests can reach it rather than to widen a glob for one helper.
 *
 * ---------------------------------------------------------------------------------------------
 * What is deliberately **not** changed
 * ---------------------------------------------------------------------------------------------
 * The ingress logs through both `pino` and `console.log` onto the same file descriptor. **F49** left that
 * open on purpose, and F59's write-up says a fix for this must not quietly rebuild it. This helper takes
 * the stream it should write to as a parameter and has no opinion about the rest.
 */

/** The slice of `process.stdout` this needs. Injected so a test can drive the callback itself. */
export interface FlushableStream {
	write(chunk: string, callback: (error?: Error | null) => void): boolean;
}

/** How long to wait for the write to reach the OS before giving up and exiting anyway. */
export const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;

/** Why {@link writeLineThenFlush} stopped waiting. Returned rather than logged: the caller is exiting. */
export type FlushOutcome =
	/** The stream reported the chunk as written. The normal case. */
	| 'flushed'
	/** The stream reported an error (`EPIPE` when the reader is gone). The line is lost; exit anyway. */
	| 'failed'
	/** The timeout elapsed first. The line may or may not appear; a hung shutdown is worse. */
	| 'timeout';

/**
 * Write one line and resolve once it has been handed to the operating system.
 *
 * Appends a trailing newline, like `console.log`. **Never rejects** -- see the module comment.
 *
 * @param stream Usually `process.stdout`.
 * @param line The line, without a trailing newline.
 * @param timeoutMs Upper bound on the wait. `0` or less waits not at all and reports `'timeout'`.
 */
export function writeLineThenFlush(
	stream: FlushableStream,
	line: string,
	timeoutMs: number = DEFAULT_FLUSH_TIMEOUT_MS
): Promise<FlushOutcome> {
	return new Promise<FlushOutcome>((resolve) => {
		let settled = false;
		const settle = (outcome: FlushOutcome) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			resolve(outcome);
		};

		// `unref()` so a pending timer cannot by itself keep the event loop alive. Without it this helper
		// would hold the process open for `timeoutMs` in the very case it is meant to make faster: a
		// shutdown where everything else has already finished.
		const timer: NodeJS.Timeout | undefined =
			timeoutMs > 0 ? setTimeout(() => settle('timeout'), timeoutMs) : undefined;
		timer?.unref?.();

		try {
			stream.write(`${line}\n`, (error) => {
				settle(error ? 'failed' : 'flushed');
			});
		} catch {
			// A stream that throws synchronously (a destroyed stream does) must not take the shutdown
			// down with it: the caller's next statement is `process.exit(0)`.
			settle('failed');
		}

		if (timeoutMs <= 0) {
			settle('timeout');
		}
	});
}
