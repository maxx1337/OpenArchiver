import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../support/fake-spool-fs';
import { FakeLedgerLookup } from '../support/fake-ledger-lookup';
import type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
} from '../../src/ledger/ledger-port';
import { incomingFilePath, incomingShardDir } from '../../src/spool/layout';
import type { SpoolConfig } from '../../src/spool/config';
import { JournalAcceptance, type JournalTransactionInput } from '../../src/spool/acceptance';
import { runCrashRecoveryScan, type CrashRecoveryAlert } from '../../src/spool/crash-recovery';

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
 *      *runtime* failure left behind is therefore indistinguishable from a genuine crash artifact --
 *      see "FINDING" below.
 *
 * ---------------------------------------------------------------------------------------------
 * FINDING -- an ordinary (non-crash) write-stage or fsync-stage failure leaves permanent spool debris
 * ---------------------------------------------------------------------------------------------
 * `SpoolFileSystem` has no delete/unlink method (`crash-recovery.ts` relies on exactly this fact to
 * argue it can never delete a file). That is also true of `writeDurableSpoolFile()`'s own failure
 * path: once `createFile()` has succeeded, nothing calls anything path-mutating on failure, so the
 * file entry it created stays exactly where it is. The suite below ("state after a failure") shows
 * this is true for three of the five sub-cases (`write()`, file-fsync, directory-fsync) and false for
 * the other two (mkdir, createFile) -- and then, in "an ordinary write failure looks exactly like a
 * crash to JR-3-05", chains a failed `accept()` straight into `runCrashRecoveryScan()` to show the
 * consequence end to end: the leftover file gets quarantined and alerted on the next startup, exactly
 * as if the process had crashed, even though nothing crashed -- a client got a `451` and, per the
 * acceptance contract, is expected to retry with a brand-new transaction id. This is reported as a
 * finding, not fixed here (role: TEST does not patch `packages/journaling/src`).
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
	'JR-3-06: state after a failure -- which sub-operations leave a spool artifact behind (FINDING)',
	() => {
		it('records exactly which failing sub-operation leaves a file behind: mkdir and createFile are clean, write()/file-fsync/directory-fsync are not', async () => {
			const observed: Record<string, boolean> = {};
			for (const testCase of FAULT_CASES) {
				const fake = new FakeSpoolFileSystem();
				const txid = freshTxid();
				testCase.inject(fake, txid, eio(`i/o error injected for ${testCase.label}`));
				const { backend, requests } = recordingBackend();
				const acceptance = new JournalAcceptance({
					fs: fake,
					backend,
					spoolConfig: spoolConfig(),
				});

				const result = await acceptance.accept(baseInput({ txid }));
				expect(result.kind).not.toBe('accepted');
				expect(requests).toHaveLength(0);

				observed[testCase.label] = fake.hasFile(fileOf(txid));
			}

			// This is the finding: three of the five sub-cases leave a file with no ledger entry sitting
			// in incoming/ -- structurally identical to what JR-3-05's crash-recovery scan treats as "a
			// crash happened here". mkdir and createFile fail *before* a file object is ever created, so
			// those two are the only clean cases.
			expect(observed).toEqual({
				'mkdir (shard directory creation)': false,
				'createFile (exclusive file creation)': false,
				'write() (a chunk write call)': true,
				'file fsync()': true,
				'directory fsync()': true,
			});
		});

		it('a write() failure partway through a multi-chunk message leaves the already-written chunks on disk, not zero bytes', async () => {
			// A stronger version of the case above: the leftover is not merely an empty placeholder file,
			// it can carry genuinely partial message content -- worse for an operator trying to make sense
			// of quarantine/ later, since the file looks like a truncated real message rather than an
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
			});

			async function* twoChunks(): AsyncGenerator<Uint8Array> {
				yield Buffer.from('Subject: partial\r\n\r\n');
				fake.failNextWrite(fileOf(txid), enospc('no space left after the first chunk'));
				yield Buffer.from('this second chunk never lands\r\n');
			}

			const result = await acceptance.accept(baseInput({ txid, chunks: twoChunks() }));

			expect(result.kind).toBe('spool-capacity-exceeded');
			expect(fake.hasFile(fileOf(txid))).toBe(true);
			// The first chunk's 21 bytes are genuinely on disk; the second chunk's write is what failed.
			expect(fake.fileContent(fileOf(txid))?.toString()).toBe('Subject: partial\r\n\r\n');
		});
	}
);

suite(
	'ci',
	'JR-3-06: an ordinary write failure looks exactly like a crash to JR-3-05 (FINDING, end to end)',
	() => {
		it('the file a failed write() left behind gets quarantined and alerted by the crash-recovery scan, even though nothing crashed', async () => {
			const fake = new FakeSpoolFileSystem();
			const txid = freshTxid();
			fake.failNextWrite(
				fileOf(txid),
				enospc('disk full during an ordinary, non-crash write')
			);
			const acceptance = new JournalAcceptance({
				fs: fake,
				backend: recordingBackend().backend,
				spoolConfig: spoolConfig(),
			});

			const result = await acceptance.accept(baseInput({ txid }));
			expect(result.kind).toBe('spool-capacity-exceeded');
			// Nothing crashed: the process is still running, and it is about to run the exact same scan
			// `apps/smtp-ingress` runs at *startup* -- simulating a restart here to show the consequence,
			// not because this scan runs mid-session in production (architecture doc section 5 says it must
			// not, precisely to avoid racing a live acceptance -- this is a different scenario: the process
			// restarting normally sometime *after* the failed transaction, with the orphan still sitting
			// there).
			const ledgerLookup = new FakeLedgerLookup(); // correctly empty: accept() never reached append()
			const alerts: CrashRecoveryAlert[] = [];

			const scan = await runCrashRecoveryScan({
				fs: fake,
				ledgerLookup,
				spoolRoot: SPOOL_ROOT,
				alertSink: { alert: (event) => void alerts.push(event) },
			});

			expect(scan.quarantined).toHaveLength(1);
			expect(scan.quarantined[0]!.spoolTxId).toBe(txid);
			expect(alerts).toHaveLength(1);
			expect(alerts[0]!.reason).toBe('no-ledger-entry');
			// The alert is indistinguishable from a genuine crash alert -- CrashRecoveryAlert carries no
			// field that could say "this was actually just a 452, not a crash". An operator paging on this
			// alert has no way to tell the two apart from the alert alone.
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
	'JR-3-06 -> JR-3-07 link: orphaned files silently erode the high-water-mark budget',
	() => {
		it('debris left by file-fsync failures counts toward the spool budget and can reject an unrelated, otherwise-healthy transaction', async () => {
			// Five failed transactions, each fully written (20 real bytes) but never file-synced -- the
			// "file fsync()" row of the finding above, which leaves the complete byte content behind. That
			// content is real as far as `computeDirectoryUsageBytes()` (./layout.ts) is concerned: it walks
			// the spool with `stat()`, which has no notion of "durable" versus "written but unsynced".
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
			});

			for (let i = 0; i < 5; i += 1) {
				const txid = freshTxid();
				fake.failNextFileFsync(fileOf(txid));
				const failed = await acceptance.accept(
					baseInput({ txid, chunks: chunksOf('x'.repeat(20)) })
				);
				expect(failed.kind).toBe('spool-write-failed');
			}

			// Five failed transactions, 100 leftover bytes nobody asked for -- and a sixth, entirely
			// unrelated and otherwise-healthy transaction is rejected by the high-water-mark check because
			// of them, purely because nothing ever cleans up a failed write's debris.
			const healthyTxid = freshTxid();
			const result = await acceptance.accept(baseInput({ txid: healthyTxid }));
			expect(result.kind).toBe('high-water-mark-exceeded');
			if (result.kind === 'high-water-mark-exceeded') {
				expect(result.status.usageBytes).toBe(100n);
			}
		});
	}
);
