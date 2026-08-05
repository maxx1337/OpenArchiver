import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Queue, type Job } from 'bullmq';
import { suiteRequiring } from '@oa-test/classification';
import { probeRedis } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import {
	JOURNAL_INBOUND_JOB_NAME,
	JOURNAL_INBOUND_QUEUE_NAME,
	generateTxId,
	journalInboundJobId,
} from '@open-archiver/journaling';
import { connection } from '../../src/config/redis';

/**
 * The `journal-inbound` worker process (`JR-6-01`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What "der Worker startet eigenständig" is worth as an assertion
 * ---------------------------------------------------------------------------------------------
 * The acceptance criterion is that the worker starts as its own process. A test that imported the
 * module and checked that no exception escaped would satisfy the words and prove almost nothing: the
 * thing that ships is `node dist/workers/journal-inbound.worker.js` behind
 * `pnpm --filter @open-archiver/backend start:journal-worker`, and the failure modes worth catching are
 * exactly the ones an in-process import cannot have -- a wrong `dist` path in the script, an entry
 * point that constructs its `Worker` but never binds the queue, a process that ignores `SIGTERM`.
 *
 * So this spawns the compiled file and measures five things:
 *
 *   1. **It comes up and stays up.** The start line is emitted and the process is still alive after it.
 *   2. **It is genuinely bound to the queue.** A job enqueued by name is picked up -- which is the only
 *      way to distinguish "a Worker object exists" from "a Worker is consuming `journal-inbound`".
 *   3. **It fails that job rather than completing it.** This is the load-bearing assertion of the
 *      slice. Phase B does not exist yet (`JR-6-02`, ADR-010 undecided), and a completed Phase-B job is
 *      a claim that a message is archived and searchable -- the claim `JR-6-04`'s reconciler reads to
 *      leave a spool entry alone. A placeholder that logged and returned would report that claim
 *      falsely, and it would do so *greenly*. That is the shape of `JR-4-10` (two useless test versions
 *      reporting green) and of F48 (twelve red CI runs behind a step that never ran): the absence of
 *      work and the success of work printing identically.
 *   4. **A malformed concurrency override aborts startup.** `journal-inbound.options.test.ts` proves
 *      the validator rejects `"12x"`. This proves the entry point *calls* it. Without this, that unit
 *      test would keep passing over a function nobody invokes -- which is F46 exactly: two things that
 *      had to line up, verified separately, never verified together.
 *   5. **`SIGTERM` shuts it down gracefully** -- on POSIX. See below.
 *
 * ---------------------------------------------------------------------------------------------
 * One claim is platform-dependent, and it says so rather than skipping
 * ---------------------------------------------------------------------------------------------
 * Windows has no POSIX signals: `child.kill('SIGTERM')` calls `TerminateProcess`, the handler in the
 * worker never runs, and the child is reported as killed by the signal. The graceful-shutdown claim is
 * therefore measurable on the Linux CI runner only -- the same situation `fsyncDirectory()` is in
 * (F48), and the same rule applies (CLAUDE.md section 5.1): where a suite's central claim depends on
 * the platform, emit something that distinguishes "branch not taken" from "taken and passed".
 *
 * It is a branch inside the test, not a `skipIf`, for two reasons. `expectedTests` is an exact,
 * platform-independent number, so a skip would make Windows and Linux disagree about it. And a skipped
 * assertion prints exactly like a passing one, which is the failure this project has already paid for
 * twice. On Windows the test asserts what Windows actually does and emits a `coverageNotice` naming
 * the claim that went unverified.
 *
 * ---------------------------------------------------------------------------------------------
 * Why it needs a build, and why an absent build is a skip rather than a pass
 * ---------------------------------------------------------------------------------------------
 * `dist/` is gitignored, so on a fresh checkout the compiled worker does not exist. That is treated as
 * an unmet infrastructure requirement, like an unreachable Postgres: the suite skips **visibly**, with
 * a reason that says to build. CI sets `OA_TEST_REQUIRE_INFRA=1` and runs `Build backend` before the
 * test step, so there the skip is a failure and this suite must run. Locally, the same variable in the
 * documented full-run recipe means the recipe now wants a build first -- which is what the CI does
 * anyway.
 *
 * ---------------------------------------------------------------------------------------------
 * Residue
 * ---------------------------------------------------------------------------------------------
 * The queue name is the production one, because the worker binds that constant and a test that
 * renamed it would no longer be testing the worker. Isolation comes from the **job ids** instead:
 * every job here is keyed to a freshly generated ULID, and `afterAll` removes the ones it created.
 * Nothing is obliterated -- a test must not be able to empty a queue that a later epic will feed.
 */

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const compiledWorker = path.resolve(thisDir, '../../dist/workers/journal-inbound.worker.js');

const redisProbe = await probeRedis();
const buildProbe = existsSync(compiledWorker)
	? { available: true, reason: `compiled worker present at ${compiledWorker}` }
	: {
			available: false,
			reason:
				`the compiled worker is missing (${compiledWorker}) -- run ` +
				`\`pnpm --filter @open-archiver/backend build\` first. dist/ is gitignored, so a fresh ` +
				`checkout has none`,
		};

const requirement = !redisProbe.available ? redisProbe : buildProbe;

/**
 * The child's exact stdio shape: `stdin` is `'ignore'` (nothing is ever written to the worker), both
 * output streams are pipes. Spelled out rather than cast to `ChildProcessWithoutNullStreams`, which
 * would claim a writable `stdin` that does not exist.
 */
type SpawnedProcess = ChildProcessByStdio<null, Readable, Readable>;

/** Kill a child unconditionally, used by teardown so a failed assertion cannot leave a process behind. */
function hardKill(child: SpawnedProcess | undefined): void {
	if (child && child.exitCode === null && child.signalCode === null) {
		child.kill('SIGKILL');
	}
}

/** pino-pretty is configured with `colorize: true`, so the log lines arrive wrapped in ANSI codes. */
function stripAnsi(text: string): string {
	const esc = String.fromCharCode(27);
	return text.replace(new RegExp(esc + '\\[[0-9;]*m', 'g'), '');
}

interface SpawnedWorker {
	readonly child: SpawnedProcess;
	/** Everything written to stdout and stderr so far, ANSI-stripped. */
	output(): string;
	/** Resolves once `output()` contains `needle`, rejects on exit or after `timeoutMs`. */
	waitForOutput(needle: string, timeoutMs?: number): Promise<void>;
	/** Resolves with the exit code / signal once the process is gone. */
	waitForExit(timeoutMs?: number): Promise<{ code: number | null; signal: string | null }>;
}

function spawnWorker(extraEnv: Record<string, string> = {}): SpawnedWorker {
	const child = spawn(process.execPath, [compiledWorker], {
		// A pipe, not `inherit`: the assertions read the log, and an inherited stdio would put the
		// worker's output into the test runner's own stream where nothing can match on it.
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, ...extraEnv },
	});

	let buffer = '';
	const waiters: Array<() => void> = [];
	const absorb = (chunk: Buffer) => {
		buffer += stripAnsi(chunk.toString('utf8'));
		for (const notify of waiters.splice(0)) {
			notify();
		}
	};
	child.stdout.on('data', absorb);
	child.stderr.on('data', absorb);

	let exited: { code: number | null; signal: string | null } | undefined;
	const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
		child.once('exit', (code, signal) => {
			exited = { code, signal };
			for (const notify of waiters.splice(0)) {
				notify();
			}
			resolve({ code, signal });
		});
	});

	return {
		child,
		output: () => buffer,
		waitForOutput: (needle, timeoutMs = 30_000) =>
			new Promise<void>((resolve, reject) => {
				const deadline = setTimeout(() => {
					reject(
						new Error(
							`timed out after ${timeoutMs}ms waiting for ${JSON.stringify(needle)}. ` +
								`Output so far:\n${buffer || '(nothing)'}`
						)
					);
				}, timeoutMs);
				const check = () => {
					if (buffer.includes(needle)) {
						clearTimeout(deadline);
						resolve();
						return;
					}
					if (exited) {
						clearTimeout(deadline);
						reject(
							new Error(
								`process exited (code ${exited.code}, signal ${exited.signal}) before ` +
									`${JSON.stringify(needle)} appeared. Output:\n${buffer || '(nothing)'}`
							)
						);
						return;
					}
					waiters.push(check);
				};
				check();
			}),
		waitForExit: (timeoutMs = 30_000) =>
			Promise.race([
				exitPromise,
				new Promise<never>((_resolve, reject) =>
					setTimeout(
						() =>
							reject(
								new Error(
									`process was still alive ${timeoutMs}ms after the signal. ` +
										`Output:\n${buffer || '(nothing)'}`
								)
							),
						timeoutMs
					)
				),
			]),
	};
}

const START_LINE = 'Journal inbound worker started';

suiteRequiring('ci', 'journal-inbound worker process (JR-6-01)', requirement, () => {
	let queue: Queue;
	let worker: SpawnedWorker | undefined;
	const createdJobIds: string[] = [];

	beforeAll(async () => {
		queue = new Queue(JOURNAL_INBOUND_QUEUE_NAME, { connection });
		worker = spawnWorker();
		await worker.waitForOutput(START_LINE);
	});

	afterAll(async () => {
		hardKill(worker?.child);
		for (const id of createdJobIds) {
			const job = await queue.getJob(id);
			await job?.remove().catch(() => undefined);
		}
		await queue.close();
		coverageNotice(
			`[JR-6-01] journal-inbound worker: spawned ${compiledWorker}, ` +
				`${createdJobIds.length} job(s) enqueued and removed`
		);
	});

	it('starts as its own process and reports the queue parameters it came up with', () => {
		const log = worker!.output();
		expect(log).toContain(START_LINE);
		// The parameters are logged, not only chosen -- an operator who has to answer "is this
		// worker running with maxStalledCount 0?" should not have to read the source.
		expect(log).toContain(JOURNAL_INBOUND_QUEUE_NAME);
		expect(log).toMatch(/lockDurationMs["\s:]+600000/);
		expect(log).toMatch(/maxStalledCount["\s:]+0/);
		expect(log).toMatch(/concurrency["\s:]+3/);
		expect(worker!.child.exitCode).toBeNull();
	});

	it('picks up a job from the queue and fails it -- never reports it as archived', async () => {
		const spoolTxId = generateTxId();
		const jobId = journalInboundJobId(spoolTxId);
		createdJobIds.push(jobId);

		// `attempts: 1` overrides the queue default of 10. That default exists so a short storage
		// outage is ridden out inside the queue (see `journalInboundQueue`), and with it this job
		// would spend roughly 85 minutes retrying before reaching the failed set.
		const job = await queue.add(
			JOURNAL_INBOUND_JOB_NAME,
			{ spoolTxId },
			{ jobId, attempts: 1 }
		);

		const state = await waitForTerminalState(job);
		expect(state).toBe('failed');

		const reloaded = await queue.getJob(jobId);
		expect(reloaded?.failedReason ?? '').toContain('Phase B is not implemented yet');
		// The txid travels through the queue unchanged -- the payload is the one field the
		// reconciler can reproduce, and a worker that lost it could not act on the job at all.
		expect(reloaded?.failedReason ?? '').toContain(spoolTxId);
	});

	it('fails a job whose name it does not know, instead of silently completing it', async () => {
		const spoolTxId = generateTxId();
		const jobId = `${journalInboundJobId(spoolTxId)}-unknown-name`;
		createdJobIds.push(jobId);

		const job = await queue.add(
			'a-name-nothing-dispatches',
			{ spoolTxId },
			{ jobId, attempts: 1 }
		);

		expect(await waitForTerminalState(job)).toBe('failed');
		const reloaded = await queue.getJob(jobId);
		expect(reloaded?.failedReason ?? '').toContain('Unknown job name');
	});

	it('refuses to start on a malformed concurrency override, rather than using the default', async () => {
		const rejected = spawnWorker({ JOURNAL_INBOUND_WORKER_CONCURRENCY: '12x' });
		try {
			const exit = await rejected.waitForExit(20_000);
			expect(exit.code).not.toBe(0);
			expect(rejected.output()).toContain('must be a positive integer');
			// The calibration that makes the assertion above mean something: the process must not
			// have announced itself as started before dying.
			expect(rejected.output()).not.toContain(START_LINE);
		} finally {
			hardKill(rejected.child);
		}
	});

	it('shuts down cleanly on SIGTERM (graceful branch is POSIX-only)', async () => {
		const shuttingDown = spawnWorker();
		try {
			await shuttingDown.waitForOutput(START_LINE);
			shuttingDown.child.kill('SIGTERM');
			const exit = await shuttingDown.waitForExit(20_000);

			if (process.platform === 'win32') {
				// Windows has no POSIX signals. `child.kill('SIGTERM')` calls `TerminateProcess`,
				// so the handler in the worker never runs and the child is reported as killed by
				// the signal. The graceful path is therefore **not measurable here** -- and saying
				// so out loud is the point. A `skipIf` would be wrong twice: `expectedTests` is an
				// exact, platform-independent number (a skip would make Windows and Linux disagree
				// on it), and a skipped assertion prints the same as a passing one, which is the
				// F48 shape. So this branch asserts what Windows actually does and emits a notice
				// that names the untested claim.
				expect(exit.signal).toBe('SIGTERM');
				coverageNotice(
					`[JR-6-01] SIGTERM graceful-shutdown branch NOT exercised: platform is ` +
						`win32, where child.kill() terminates rather than signals. The claim ` +
						`"worker.close() drains and the process exits 0" is verified on the ` +
						`Linux CI runner only.`
				);
				return;
			}

			// `worker.close()` drains in-flight jobs and then lets the event loop empty, so the
			// process ends of its own accord with 0 -- it is not killed by the signal. A `signal`
			// of SIGTERM here would mean the handler never ran.
			expect(exit.signal).toBeNull();
			expect(exit.code).toBe(0);
			coverageNotice(
				`[JR-6-01] SIGTERM graceful-shutdown branch exercised on ${process.platform}: ` +
					`exit code 0, no terminating signal`
			);
		} finally {
			hardKill(shuttingDown.child);
		}
	});
});

/**
 * Poll a job until it is `completed` or `failed`.
 *
 * Polling rather than a `QueueEvents` subscription: the assertion is about the job's recorded state,
 * which is what the reconciler will read, and an event listener would additionally have to prove it
 * did not miss an event that fired before it attached.
 */
async function waitForTerminalState(job: Job, timeoutMs = 30_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let last = 'unknown';
	while (Date.now() < deadline) {
		last = await job.getState();
		if (last === 'completed' || last === 'failed') {
			return last;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`job ${job.id} never reached a terminal state within ${timeoutMs}ms (last state: ${last})`
	);
}
