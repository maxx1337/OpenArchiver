import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../support/fake-spool-fs';
import { FakeLedgerLookup } from '../support/fake-ledger-lookup';
import type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
} from '../../src/ledger/ledger-port';
import { incomingFilePath, incomingShardDir, quarantineFilePath } from '../../src/spool/layout';
import type { SpoolConfig } from '../../src/spool/config';
import { JournalAcceptance, type JournalTransactionInput } from '../../src/spool/acceptance';
import { runCrashRecoveryScan, type CrashRecoveryAlert } from '../../src/spool/crash-recovery';
import type { QuarantineAlert, QuarantineAlertSink } from '../../src/spool/quarantine';

/**
 * `JR-3-06` -- fsync/write fault injection, driven through `JournalAcceptance.accept()`, the
 * caller-facing contract (Testplan section 12.2). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Scope this file adds beyond what JR-3-02/JR-3-03/JR-3-04 already demonstrated
 * ---------------------------------------------------------------------------------------------
 * `durable-write.test.ts`, `fs-port.test.ts` and `acceptance.test.ts` already show that write,
 * file-fsync and directory-fsync fail independently, and that an ENOSPC-coded write or file-fsync
 * failure classifies as `'spool-capacity-exceeded'`. What none of them cover:
 *
 *   1. The `'write'` stage is three sub-operations (mkdir, createFile, write()), per the PO decision
 *      recorded in `docs/dev/journaling/02-architektur.md` section 3 -- and until this file, the fake
 *      filesystem had **no way to fail `mkdir()` at all** (`FakeSpoolFileSystem.failNextMkdir()` was
 *      added in `tests/support/fake-spool-fs.ts` alongside this file to close that gap). Without it,
 *      two of the three `'write'`-stage sub-operations (mkdir, createFile) were untested through
 *      `accept()`, and the third (mkdir) was untestable through *any* entry point.
 *   2. `directory-fsync` failure was never driven through `accept()` at all -- only through
 *      `writeDurableSpoolFile()` directly (`durable-write.test.ts`).
 *   3. Nobody had checked what the spool *looks like* after each failure -- whether a failed
 *      transaction leaves a file behind. It matters because `JR-3-05`'s crash-recovery scan decides
 *      quarantine-vs-requeue purely by asking the ledger about whatever it finds in `incoming/`
 *      (`crash-recovery.ts`'s own doc comment: "the ledger is the only authority"). A file an ordinary
 *      *runtime* failure left behind used to be indistinguishable from a genuine crash artifact --
 *      see "F40 / JR-3-09" below.
 *
 * ---------------------------------------------------------------------------------------------
 * F40 / JR-3-09 -- an ordinary (non-crash) write-stage or fsync-stage failure used to leave permanent,
 * misdiagnosable spool debris; the accept path now quarantines its own debris immediately
 * ---------------------------------------------------------------------------------------------
 * `SpoolFileSystem` has no delete/unlink method (`crash-recovery.ts` relies on exactly this fact to
 * argue it can never delete a file). Before `JR-3-09`, that was also true of `writeDurableSpoolFile()`'s
 * *caller*: once `createFile()` had succeeded, nothing called anything path-mutating on a later failure,
 * so the file it created stayed exactly where it was, in `incoming/`, indistinguishable from a genuine
 * crash victim to `JR-3-05`'s crash-recovery scan (architecture doc section 5's corrected sentence). The
 * suite below ("state after a failure") still shows the underlying fact that motivated the finding --
 * three of the five sub-cases (`write()`, file-fsync, directory-fsync) leave a file behind, the other
 * two (mkdir, createFile) do not -- but now shows where that file ends up: quarantined by
 * `JournalAcceptance.accept()` itself, under reason `'write-failed'`, not sitting in `incoming/` for a
 * later startup to misdiagnose. "an ordinary write failure is quarantined immediately, not left for
 * JR-3-05 to misdiagnose" chains a failed `accept()` straight into `runCrashRecoveryScan()` to show the
 * fix end to end: the scan now finds **nothing** and raises **no** crash alert, because the debris was
 * already moved and alerted on, honestly, before the scan ever ran.
 *
 * F40's second half -- quarantine is never auto-emptied and still counts toward the high-water-mark
 * budget, so repeated write failures still erode spool capacity over time -- is unresolved by this and
 * belongs to E10/E12 (retention/release procedure), not to `packages/journaling`. The last suite in this
 * file demonstrates that this slice does not, and is not meant to, change that.
 */

const SPOOL_ROOT = '/spool';

function spoolConfig(highWaterBytes = 10_000_000n): SpoolConfig {
	return { rootPath: SPOOL_ROOT, highWaterBytes };
}

async function* chunksOf(...parts: string[]): AsyncGenerator<Uint8Array> {
	for (const part of parts) {
		yield Buffer.from(part);
	}
}

function baseInput(overrides: Partial<JournalTransactionInput> = {}): JournalTransactionInput {
	return {
		chainScopeId: '22222222-2222-4222-8222-222222222222',
		receivedAtMicros: 1_785_492_930_123_000n,
		remoteIp: '192.0.2.30',
		ehloName: 'mail.example.org',
		tlsVersion: 'TLSv1.3',
		tlsCipher: 'TLS_AES_256_GCM_SHA384',
		envelopeFrom: 'sender@example.org',
		envelopeRcpt: ['rcpt@example.org'],
		journalingSourceId: null,
		chunks: chunksOf('Subject: fault-injection\r\n\r\nbody\r\n'),
		...overrides,
	};
}

const SUCCESS_RESULT: LedgerAppendResult = {
	seq: 7n,
	chainHash: Buffer.alloc(32, 0xcc),
	prevChainHash: Buffer.alloc(32, 0xdd),
};

/** A `LedgerBackend` that records every request. Fails the test outright if it is ever called. */
function recordingBackend(): { backend: LedgerBackend; requests: LedgerAppendRequest[] } {
	const requests: LedgerAppendRequest[] = [];
	return {
		backend: {
			async append(request: LedgerAppendRequest): Promise<LedgerAppendResult> {
				requests.push(request);
				return SUCCESS_RESULT;
			},
		},
		requests,
	};
}

function eio(message: string): Error {
	return Object.assign(new Error(message), { code: 'EIO' });
}

function enospc(message: string): Error {
	return Object.assign(new Error(message), { code: 'ENOSPC' });
}

/** One row of the fault matrix: how to break one of the five durability sub-operations. */
interface FaultCase {
	readonly label: string;
	readonly expectedStage: 'write' | 'file-fsync' | 'directory-fsync';
	inject(fake: FakeSpoolFileSystem, txid: string, error: Error): void;
}

function shardDirOf(txid: string): string {
	return incomingShardDir(SPOOL_ROOT, txid);
}

function fileOf(txid: string): string {
	return incomingFilePath(SPOOL_ROOT, txid);
}

function quarantinedFileOf(txid: string): string {
	return quarantineFilePath(SPOOL_ROOT, txid);
}

/** A `QuarantineAlertSink` that records every alert. Same shape as `crash-recovery.test.ts`'s fake. */
function fakeAlertSink(): { sink: QuarantineAlertSink; alerts: QuarantineAlert[] } {
	const alerts: QuarantineAlert[] = [];
	return {
		sink: {
			alert(event: QuarantineAlert): void {
				alerts.push(event);
			},
		},
		alerts,
	};
}

const FAULT_CASES: readonly FaultCase[] = [
	{
		label: 'mkdir (shard directory creation)',
		expectedStage: 'write',
		inject: (fake, txid, error) => fake.failNextMkdir(shardDirOf(txid), error),
	},
	{
		label: 'createFile (exclusive file creation)',
		expectedStage: 'write',
		inject: (fake, txid, error) => fake.failNextCreateFile(fileOf(txid), error),
	},
	{
		label: 'write() (a chunk write call)',
		expectedStage: 'write',
		inject: (fake, txid, error) => fake.failNextWrite(fileOf(txid), error),
	},
	{
		label: 'file fsync()',
		expectedStage: 'file-fsync',
		inject: (fake, txid, error) => fake.failNextFileFsync(fileOf(txid), error),
	},
	{
		label: 'directory fsync()',
		expectedStage: 'directory-fsync',
		inject: (fake, txid, error) => fake.failNextDirectoryFsync(shardDirOf(txid), error),
	},
];

let txidCounter = 0;
/**
 * A fresh, valid-looking 26-character transaction id per call. Fixed-width, zero-padded, never
 * truncated -- an earlier version of this helper concatenated a 2-digit counter onto a 25-character
 * prefix and then `.slice(0, 26)`'d the result, which silently dropped the counter's last digit and
 * collapsed every single-digit counter value (1-9) onto one identical id. That produced hard-to-read
 * failures in exactly the tests meant to prove recovery: a "fresh" retry transaction silently reused
 * the failing transaction's own spool path and collided with the file it had already created.
 */
function freshTxid(): string {
	txidCounter += 1;
	return `01ARZ3NDEKTSV4RRFFQ6${String(txidCounter).padStart(6, '0')}`;
}

suite(
	'ci',
	'JR-3-06: the "write" stage is three sub-operations, each fails independently (non-capacity cause)',
	() => {
		for (const testCase of FAULT_CASES.filter((c) => c.expectedStage === 'write')) {
			it(`${testCase.label} failing (EIO) classifies as 'spool-write-failed', stage 'write', and never calls the ledger`, async () => {
				const fake = new FakeSpoolFileSystem();
				const txid = freshTxid();
				testCase.inject(fake, txid, eio(`i/o error injected for ${testCase.label}`));
				const { backend, requests } = recordingBackend();
				const acceptance = new JournalAcceptance({
					fs: fake,
					backend,
					spoolConfig: spoolConfig(),
					alertSink: fakeAlertSink().sink,
				});

				const result = await acceptance.accept(baseInput({ txid }));

				expect(result.kind).toBe('spool-write-failed');
				if (result.kind === 'spool-write-failed') {
					expect(result.stage).toBe('write');
					expect((result.cause as { code?: string }).code).toBe('EIO');
				}
				expect(requests).toHaveLength(0);
			});
		}
	}
);

suite(
	'ci',
	'JR-3-06: file-fsync and directory-fsync failures, driven through accept() (not previously exercised at this level)',
	() => {
		it("a file-fsync failure classifies as 'spool-write-failed', stage 'file-fsync', through the full acceptance path", async () => {
			const fake = new FakeSpoolFileSystem();
			const txid = freshTxid();
			fake.failNextFileFsync(fileOf(txid), eio('file fsync injected failure'));
			const { backend, requests } = recordingBackend();
			const acceptance = new JournalAcceptance({
				fs: fake,
				backend,
				spoolConfig: spoolConfig(),
				alertSink: fakeAlertSink().sink,
			});

			const result = await acceptance.accept(baseInput({ txid }));

			expect(result.kind).toBe('spool-write-failed');
			if (result.kind === 'spool-write-failed') {
				expect(result.stage).toBe('file-fsync');
			}
			expect(requests).toHaveLength(0);
		});

		it("a directory-fsync failure classifies as 'spool-write-failed', stage 'directory-fsync' -- untested by any existing accept()-level test", async () => {
			const fake = new FakeSpoolFileSystem();
			const txid = freshTxid();
			fake.failNextDirectoryFsync(shardDirOf(txid), eio('directory fsync injected failure'));
			const { backend, requests } = recordingBackend();
			const acceptance = new JournalAcceptance({
				fs: fake,
				backend,
				spoolConfig: spoolConfig(),
				alertSink: fakeAlertSink().sink,
			});

			const result = await acceptance.accept(baseInput({ txid }));

			expect(result.kind).toBe('spool-write-failed');
			if (result.kind === 'spool-write-failed') {
				expect(result.stage).toBe('directory-fsync');
			}
			expect(requests).toHaveLength(0);
		});
	}
);

suite(
	'ci',
	'JR-3-06: the same five sub-operations, ENOSPC-flavoured -- classification is by stage *and* cause, never stage alone',
	() => {
		for (const testCase of FAULT_CASES) {
			it(`${testCase.label} failing with ENOSPC classifies as 'spool-capacity-exceeded', stage '${testCase.expectedStage}'`, async () => {
				const fake = new FakeSpoolFileSystem();
				const txid = freshTxid();
				testCase.inject(fake, txid, enospc(`no space left injected for ${testCase.label}`));
				const { backend, requests } = recordingBackend();
				const acceptance = new JournalAcceptance({
					fs: fake,
					backend,
					spoolConfig: spoolConfig(),
					alertSink: fakeAlertSink().sink,
				});

				const result = await acceptance.accept(baseInput({ txid }));

				expect(result.kind).toBe('spool-capacity-exceeded');
				if (result.kind === 'spool-capacity-exceeded') {
					expect(result.stage).toBe(testCase.expectedStage);
					expect((result.cause as { code?: string }).code).toBe('ENOSPC');
				}
				// Nothing acknowledged: never 'accepted', ledger never consulted, no seq handed out.
				expect(requests).toHaveLength(0);
			});
		}
	}
);

suite(
	'ci',
	'JR-3-06/JR-3-09: state after a failure -- which sub-operations leave debris, and where it ends up',
	() => {
		it("mkdir and createFile leave nothing to quarantine; write()/file-fsync/directory-fsync are quarantined under 'write-failed'", async () => {
			const observedIncoming: Record<string, boolean> = {};
			const observedQuarantine: Record<string, boolean> = {};
			const observedAlertReason: Record<string, string | undefined> = {};

			for (const testCase of FAULT_CASES) {
				const fake = new FakeSpoolFileSystem();
				const txid = freshTxid();
				testCase.inject(fake, txid, eio(`i/o error injected for ${testCase.label}`));
				const { backend, requests } = recordingBackend();
				const { sink, alerts } = fakeAlertSink();
				const acceptance = new JournalAcceptance({
					fs: fake,
					backend,
					spoolConfig: spoolConfig(),
					alertSink: sink,
				});

				const result = await acceptance.accept(baseInput({ txid }));
				expect(result.kind).not.toBe('accepted');
				expect(requests).toHaveLength(0);

				observedIncoming[testCase.label] = fake.hasFile(fileOf(txid));
				observedQuarantine[testCase.label] = fake.hasFile(quarantinedFileOf(txid));
				observedAlertReason[testCase.label] = alerts[0]?.reason;
			}

			// JR-3-09: nothing is ever left in incoming/ after a failed write, for any of the five
			// sub-operations -- the two that never created a file (mkdir, createFile) have nothing to
			// quarantine either, but they are not distinguishable from "already quarantined" by this check
			// alone, which is exactly why the next assertion checks quarantine/ directly.
			expect(Object.values(observedIncoming).every((present) => present === false)).toBe(
				true
			);

			// Where the debris actually ended up: quarantined for the three sub-operations that leave a
			// file behind (durable-write.ts's module doc comment), nothing to quarantine for the two that
			// fail before any file exists.
			expect(observedQuarantine).toEqual({
				'mkdir (shard directory creation)': false,
				'createFile (exclusive file creation)': false,
				'write() (a chunk write call)': true,
				'file fsync()': true,
				'directory fsync()': true,
			});

			// The alarm reason distinguishes this cleanup from crash-recovery's 'no-ledger-entry': only
			// the three cases that were actually quarantined raised an alert, and all three say why.
			expect(observedAlertReason).toEqual({
				'mkdir (shard directory creation)': undefined,
				'createFile (exclusive file creation)': undefined,
				'write() (a chunk write call)': 'write-failed',
				'file fsync()': 'write-failed',
				'directory fsync()': 'write-failed',
			});
		});

		it('a write() failure partway through a multi-chunk message quarantines the already-written chunks, not zero bytes', async () => {
			// A stronger version of the case above: the debris is not merely an empty placeholder file, it
			// can carry genuinely partial message content -- worse for an operator trying to make sense of
			// quarantine/ later, since the file looks like a truncated real message rather than an
			// obviously-empty artifact. `failNextWrite()` is a one-shot armed for whichever write() call
			// happens *next*, so it is armed from inside the chunk generator itself, between the first
			// chunk's `yield` and the second's -- i.e. after the first chunk's `write()` has already been
			// awaited by the consumer, and before the second one is attempted.
			const fake = new FakeSpoolFileSystem();
			const txid = freshTxid();
			const acceptance = new JournalAcceptance({
				fs: fake,
				backend: recordingBackend().backend,
				spoolConfig: spoolConfig(),
				alertSink: fakeAlertSink().sink,
			});

			async function* twoChunks(): AsyncGenerator<Uint8Array> {
				yield Buffer.from('Subject: partial\r\n\r\n');
				fake.failNextWrite(fileOf(txid), enospc('no space left after the first chunk'));
				yield Buffer.from('this second chunk never lands\r\n');
			}

			const result = await acceptance.accept(baseInput({ txid, chunks: twoChunks() }));

			expect(result.kind).toBe('spool-capacity-exceeded');
			// Not in incoming/ anymore (JR-3-09) -- moved to quarantine/, first chunk's 21 bytes intact.
			expect(fake.hasFile(fileOf(txid))).toBe(false);
			expect(fake.hasFile(quarantinedFileOf(txid))).toBe(true);
			expect(fake.fileContent(quarantinedFileOf(txid))?.toString()).toBe(
				'Subject: partial\r\n\r\n'
			);
		});
	}
);

suite(
	'ci',
	'JR-3-06/JR-3-09: an ordinary write failure is quarantined immediately, so JR-3-05 never sees it (FIX for F40 half 1)',
	() => {
		it("the file a failed write() left behind is quarantined by accept() itself, under 'write-failed' -- and a later crash-recovery scan finds nothing and raises no alert", async () => {
			const fake = new FakeSpoolFileSystem();
			const txid = freshTxid();
			fake.failNextWrite(
				fileOf(txid),
				enospc('disk full during an ordinary, non-crash write')
			);
			const acceptanceAlerts = fakeAlertSink();
			const acceptance = new JournalAcceptance({
				fs: fake,
				backend: recordingBackend().backend,
				spoolConfig: spoolConfig(),
				alertSink: acceptanceAlerts.sink,
			});

			const result = await acceptance.accept(baseInput({ txid }));
			expect(result.kind).toBe('spool-capacity-exceeded');

			// The debris never sat in incoming/ waiting to be found -- accept() moved and alerted on it
			// before returning, with the honest reason: an ordinary write failure, not a crash.
			expect(fake.hasFile(fileOf(txid))).toBe(false);
			expect(fake.hasFile(quarantinedFileOf(txid))).toBe(true);
			expect(acceptanceAlerts.alerts).toEqual([
				{
					spoolTxId: txid,
					originalFilePath: fileOf(txid),
					quarantineFilePath: quarantinedFileOf(txid),
					reason: 'write-failed',
				},
			]);

			// Nothing crashed: the process is still running, and it is about to run the exact same scan
			// `apps/smtp-ingress` runs at *startup* -- simulating a restart here to show there is nothing
			// left for it to find, not because this scan runs mid-session in production (architecture doc
			// section 5 says it must not, precisely to avoid racing a live acceptance -- this is a
			// different scenario: the process restarting normally sometime *after* the failed
			// transaction, with the debris already resolved).
			const ledgerLookup = new FakeLedgerLookup(); // correctly empty: accept() never reached append()
			const scanAlerts: CrashRecoveryAlert[] = [];

			const scan = await runCrashRecoveryScan({
				fs: fake,
				ledgerLookup,
				spoolRoot: SPOOL_ROOT,
				alertSink: { alert: (event) => void scanAlerts.push(event) },
			});

			// This is the fix, measured: before JR-3-09, this scan found the file in incoming/, quarantined
			// it a *second* time and raised a *second*, indistinguishable-from-a-crash alert. Now there is
			// nothing in incoming/ to find -- incomingFilesScanned is 0, not 1 -- and the one file the scan
			// does see (in quarantine/, from accept()'s own cleanup) is only ever counted, never re-queried,
			// re-quarantined or re-alerted (crash-recovery.ts's own contract for quarantine/).
			expect(scan.incomingFilesScanned).toBe(0);
			expect(scan.requeue).toHaveLength(0);
			expect(scan.quarantined).toHaveLength(0);
			expect(scan.preexistingQuarantineFiles).toBe(1);
			expect(scanAlerts).toHaveLength(0);
		});
	}
);

suite(
	'ci',
	'JR-3-06: a failure does not wedge the acceptance path for the next transaction',
	() => {
		it('after each of the five failures, a brand-new transaction through the same JournalAcceptance succeeds normally', async () => {
			for (const testCase of FAULT_CASES) {
				const fake = new FakeSpoolFileSystem();
				const failingTxid = freshTxid();
				testCase.inject(fake, failingTxid, eio(`injected for ${testCase.label}`));
				const { backend, requests } = recordingBackend();
				const acceptance = new JournalAcceptance({
					fs: fake,
					backend,
					spoolConfig: spoolConfig(),
					alertSink: fakeAlertSink().sink,
				});

				const failed = await acceptance.accept(baseInput({ txid: failingTxid }));
				expect(failed.kind).not.toBe('accepted');

				// The one-shot fault has already fired; a fresh transaction id takes a fresh path through
				// the fake and is unaffected by the previous failure.
				const nextTxid = freshTxid();
				const succeeded = await acceptance.accept(baseInput({ txid: nextTxid }));
				expect(succeeded.kind).toBe('accepted');
				expect(requests).toHaveLength(1);
			}
		});
	}
);

suite(
	'ci',
	'JR-3-06 -> JR-3-07 link: quarantined debris still silently erodes the high-water-mark budget (F40 half 2, still open)',
	() => {
		it('debris left by file-fsync failures -- now quarantined, not left in incoming/ -- still counts toward the spool budget and can reject an unrelated, otherwise-healthy transaction', async () => {
			// Five failed transactions, each fully written (20 real bytes) but never file-synced -- the
			// "file fsync()" row of the state-after-a-failure suite above, which leaves the complete byte
			// content behind. Since JR-3-09, that content is quarantined immediately rather than left in
			// incoming/ -- but `computeDirectoryUsageBytes()` (./layout.ts) walks *both* incoming/ and
			// quarantine/ (JR-3-01, deliberately: quarantine is never auto-emptied, so excluding it would
			// hide exactly this failure mode), so moving the debris changes *where* it sits, not whether it
			// counts. This is F40's still-open second half, demonstrated rather than fixed here: JR-3-09
			// only made the *alarm* honest, not the budget self-healing.
			//
			// The budget is exactly 100 (5 x 20 bytes): each iteration's own high-water-mark check only
			// ever sees the *prior* iterations' debris (0, 20, 40, 60, 80 -- all under 100), so all five
			// genuinely reach and fail at the file-fsync stage; only the sixth, healthy-transaction's check
			// sees the full 100 and trips. A looser budget would let some of the five fail at
			// 'high-water-mark-exceeded' instead of 'spool-write-failed' before all five debris files exist
			// -- which is real behaviour, not a test bug, but would make this test assert the wrong stage
			// for a run-dependent number of iterations instead of demonstrating the point cleanly.
			const fake = new FakeSpoolFileSystem();
			const backend = recordingBackend().backend;
			const acceptance = new JournalAcceptance({
				fs: fake,
				backend,
				spoolConfig: spoolConfig(100n),
				alertSink: fakeAlertSink().sink,
			});

			const failingTxids: string[] = [];
			for (let i = 0; i < 5; i += 1) {
				const txid = freshTxid();
				failingTxids.push(txid);
				fake.failNextFileFsync(fileOf(txid));
				const failed = await acceptance.accept(
					baseInput({ txid, chunks: chunksOf('x'.repeat(20)) })
				);
				expect(failed.kind).toBe('spool-write-failed');
			}

			// The debris is in quarantine/, not incoming/ -- JR-3-09's fix -- but it is debris all the same.
			for (const txid of failingTxids) {
				expect(fake.hasFile(fileOf(txid))).toBe(false);
				expect(fake.hasFile(quarantinedFileOf(txid))).toBe(true);
			}

			// Five failed transactions, 100 quarantined bytes nobody asked for -- and a sixth, entirely
			// unrelated and otherwise-healthy transaction is rejected by the high-water-mark check because
			// of them, purely because nothing frees quarantined capacity (F40 half 2, E10/E12).
			const healthyTxid = freshTxid();
			const result = await acceptance.accept(baseInput({ txid: healthyTxid }));
			expect(result.kind).toBe('high-water-mark-exceeded');
			if (result.kind === 'high-water-mark-exceeded') {
				expect(result.status.usageBytes).toBe(100n);
			}
		});
	}
);
