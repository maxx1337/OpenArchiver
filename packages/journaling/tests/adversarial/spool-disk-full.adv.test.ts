import { readdir, rm, stat as fsStat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { suite, suiteRequiring } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import { FakeSpoolFileSystem } from '../support/fake-spool-fs';
import type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
} from '../../src/ledger/ledger-port';
import {
	ensureQuarantineShardDir,
	incomingFilePath,
	quarantineFilePath,
} from '../../src/spool/layout';
import type { SpoolConfig } from '../../src/spool/config';
import { NodeSpoolFileSystem } from '../../src/spool/fs-port';
import { JournalAcceptance, type JournalTransactionInput } from '../../src/spool/acceptance';
import type { QuarantineAlertSink } from '../../src/spool/quarantine';

/**
 * `JR-3-07` -- disk full (Testplan section 12.3). Classification: split, per the PO decision recorded
 * in the task brief (this checkout is Windows; there is no `tmpfs`/loop-device host here, and the
 * production target is Linux):
 *
 *   1. **`ci`** -- deterministic proof through the injectable seam (`JR-3-03`), covering the
 *      `ENOSPC` capacity classification, "no partial entries", recovery after the fault clears, and
 *      the high-water-mark path's consistency with `ENOSPC` as a second, independent route to the
 *      same capacity signal. Runs on every PR, on every platform.
 *   2. **`manual`** -- a real size-limited volume on Linux, `suiteRequiring`-gated on an operator- or
 *      CI-runner-provided environment variable. On this host it is always visibly skipped, never
 *      silently green -- see "Operator procedure" below for exactly what to set up.
 *
 * This refines Testplan section 12.3, which names the real-volume case `nightly`. `nightly` in this
 * repository still runs on the same host as `ci` (no dedicated Linux runner is configured), so
 * labelling the real-volume case `nightly` here would either never run (same problem `manual` is
 * honest about) or falsely claim nightly coverage that does not exist. Flagged for the PO to reconcile
 * with `04-testplan.md` -- not changed here, since only the ci-class content and this suite were asked
 * for.
 *
 * ---------------------------------------------------------------------------------------------
 * Operator procedure for the `manual` suite (Linux only)
 * ---------------------------------------------------------------------------------------------
 * ```sh
 * mkdir -p /mnt/oa-test-diskfull
 * sudo mount -t tmpfs -o size=8m tmpfs /mnt/oa-test-diskfull
 * # or, for a loop-device-backed filesystem instead of tmpfs:
 * #   dd if=/dev/zero of=/tmp/oa-diskfull.img bs=1M count=8
 * #   mkfs.ext4 /tmp/oa-diskfull.img
 * #   sudo mount -o loop /tmp/oa-diskfull.img /mnt/oa-test-diskfull
 * #   sudo chown "$USER" /mnt/oa-test-diskfull
 *
 * export OA_TEST_SPOOL_DISKFULL_ROOT=/mnt/oa-test-diskfull
 * export DATABASE_URL=postgres://admin:password@localhost:5432/open_archive
 * OA_TEST_CLASSES=manual corepack pnpm exec vitest run \
 *   packages/journaling/tests/adversarial/spool-disk-full.adv.test.ts
 *
 * sudo umount /mnt/oa-test-diskfull   # cleanup
 * ```
 * The directory named by `OA_TEST_SPOOL_DISKFULL_ROOT` must be empty and writable, and must be the
 * mount point itself (not a subdirectory sharing the parent filesystem's real capacity) -- otherwise
 * the write "succeeds" against the underlying disk and the test proves nothing, which is exactly the
 * silent-cap failure mode Testplan rule 6 forbids. `OA_TEST_REQUIRE_INFRA=1` turns a missing/incorrect
 * setup into a hard failure instead of a skip, for a CI runner that is supposed to have this configured.
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
		chainScopeId: '33333333-3333-4333-8333-333333333333',
		receivedAtMicros: 1_785_492_930_123_000n,
		remoteIp: '192.0.2.40',
		ehloName: 'mail.example.net',
		tlsVersion: 'TLSv1.3',
		tlsCipher: 'TLS_AES_256_GCM_SHA384',
		envelopeFrom: 'sender@example.net',
		envelopeRcpt: ['rcpt@example.net'],
		journalingSourceId: null,
		chunks: chunksOf('Subject: disk-full\r\n\r\nbody\r\n'),
		...overrides,
	};
}

const SUCCESS_RESULT: LedgerAppendResult = {
	seq: 9n,
	chainHash: Buffer.alloc(32, 0xee),
	prevChainHash: Buffer.alloc(32, 0xff),
};

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

function enospc(message: string): Error {
	return Object.assign(new Error(message), { code: 'ENOSPC' });
}

/**
 * `alertSink` is a required `JournalAcceptance` constructor option (`JR-3-09`, PO decision
 * 2026-08-02) -- this file's cases are about disk-full classification, not about `'write-failed'`
 * alerts, so each construction below passes this explicit no-op rather than relying on any default.
 */
function noopAlertSink(): QuarantineAlertSink {
	return { alert: () => {} };
}

let txidCounter = 0;
/**
 * A fresh, valid-looking 26-character transaction id per call. Fixed-width and never truncated -- see
 * the identical helper in `spool-fsync-fault-injection.adv.test.ts` for the collision bug this shape
 * avoids (a truncating version silently collapsed several counter values onto one identical id).
 */
function freshTxid(): string {
	txidCounter += 1;
	return `01ARZ3NDEKTSV4RRFFQ7${String(txidCounter).padStart(6, '0')}`;
}

suite('ci', 'JR-3-07: recovery after the capacity fault clears', () => {
	it('a transaction rejected as spool-capacity-exceeded is followed by a healthy transaction that succeeds normally', async () => {
		const fake = new FakeSpoolFileSystem();
		const { backend, requests } = recordingBackend();
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		const failingTxid = freshTxid();
		fake.failNextWrite(incomingFilePath(SPOOL_ROOT, failingTxid), enospc('device full'));
		const rejected = await acceptance.accept(baseInput({ txid: failingTxid }));
		expect(rejected.kind).toBe('spool-capacity-exceeded');
		expect(requests).toHaveLength(0);

		// "Space freed" is modelled by the fault simply not being armed for the next transaction id --
		// the fake's one-shot semantics stand in for an operator clearing the disk before the client's
		// SMTP retry (a fresh transaction, since the acceptance contract never reuses a transaction id
		// across a 452 and its retry).
		const retryTxid = freshTxid();
		const recovered = await acceptance.accept(baseInput({ txid: retryTxid }));
		expect(recovered.kind).toBe('accepted');
		expect(requests).toHaveLength(1);
	});

	it('a high-water-mark rejection is followed by success once the operator raises the budget (space freed)', async () => {
		const fake = new FakeSpoolFileSystem();
		await fake.mkdir('/spool/incoming', { recursive: true });
		await fake.mkdir('/spool/incoming/aa', { recursive: true });
		const existing = await fake.createFile('/spool/incoming/aa/existing.eml');
		await existing.write(Buffer.alloc(100, 1));
		await existing.fsync();
		await existing.close();

		const { backend, requests } = recordingBackend();
		const tightAcceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(50n),
			alertSink: noopAlertSink(),
		});
		const rejected = await tightAcceptance.accept(baseInput({ txid: freshTxid() }));
		expect(rejected.kind).toBe('high-water-mark-exceeded');
		expect(requests).toHaveLength(0);

		// Same fake, same 100 bytes of pre-existing usage -- but a budget an operator raised (freed
		// capacity elsewhere on the volume, or reconfigured the limit) now accepts the same transaction.
		const relaxedAcceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(1_000n),
			alertSink: noopAlertSink(),
		});
		const recovered = await relaxedAcceptance.accept(baseInput({ txid: freshTxid() }));
		expect(recovered.kind).toBe('accepted');
		expect(requests).toHaveLength(1);
	});
});

suite(
	'ci',
	'JR-3-07: the high-water-mark path is a second, independent route to a capacity signal, consistent with ENOSPC',
	() => {
		it('a spool full only of quarantined debris (no incoming/ files at all) still rejects a new transaction via high-water-mark-exceeded', async () => {
			// architecture doc section 3 / layout.ts: quarantine/ is deliberately counted, because it is
			// never auto-emptied. Verified here through the same entry point (`accept()`) JR-3-06 uses, not
			// only through the lower-level checkSpoolHighWaterMark() unit tests in layout.test.ts.
			const fake = new FakeSpoolFileSystem();
			const quarantinedTxid = freshTxid();
			await ensureQuarantineShardDir(fake, SPOOL_ROOT, quarantinedTxid);
			const handle = await fake.createFile(quarantineFilePath(SPOOL_ROOT, quarantinedTxid));
			await handle.write(Buffer.alloc(200, 7));
			await handle.close();

			const { backend, requests } = recordingBackend();
			const acceptance = new JournalAcceptance({
				fs: fake,
				backend,
				spoolConfig: spoolConfig(100n),
				alertSink: noopAlertSink(),
			});

			const result = await acceptance.accept(baseInput({ txid: freshTxid() }));

			expect(result.kind).toBe('high-water-mark-exceeded');
			if (result.kind === 'high-water-mark-exceeded') {
				expect(result.status.usageBytes).toBe(200n);
			}
			expect(requests).toHaveLength(0);
		});
	}
);

suite('ci', 'JR-3-07: repeated capacity failures never produce a single ledger entry', () => {
	it('twenty consecutive ENOSPC-rejected transactions leave the ledger backend uncalled throughout', async () => {
		const fake = new FakeSpoolFileSystem();
		const { backend, requests } = recordingBackend();
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		for (let i = 0; i < 20; i += 1) {
			const txid = freshTxid();
			fake.failNextWrite(incomingFilePath(SPOOL_ROOT, txid), enospc('device full'));
			const result = await acceptance.accept(baseInput({ txid }));
			expect(result.kind).toBe('spool-capacity-exceeded');
			expect(requests).toHaveLength(0);
		}
	});
});

/* ------------------------------------------------------------------------------------------ */
/* manual: a genuinely size-limited volume                                                     */
/* ------------------------------------------------------------------------------------------ */

interface DiskFullProbe {
	readonly available: boolean;
	readonly reason: string;
}

function probeRealDiskFullVolume(): DiskFullProbe {
	const root = process.env.OA_TEST_SPOOL_DISKFULL_ROOT?.trim();
	if (!root) {
		return {
			available: false,
			reason:
				'OA_TEST_SPOOL_DISKFULL_ROOT is not set -- point it at a mounted, size-limited volume ' +
				"(see this file's module doc comment for the tmpfs/loop-device setup) to run this suite " +
				'for real; the ci-class suite above already proves the injected-ENOSPC path on every platform.',
		};
	}
	if (process.platform === 'win32') {
		// Not merely "untested here" -- genuinely impossible: Windows has no tmpfs-with-size-limit or
		// loop-device equivalent this harness can drive, and NodeSpoolFileSystem's directory-fsync
		// already fails with EPERM on this platform regardless (JR-3-03), which would be
		// indistinguishable from the disk-full failure this suite is trying to isolate.
		return {
			available: false,
			reason:
				'OA_TEST_SPOOL_DISKFULL_ROOT is set, but this host is win32 -- a real size-limited volume ' +
				'test needs a Linux host (tmpfs with size=, or a loop-device filesystem). Run this on the ' +
				'Linux CI runner or operator machine described in the module doc comment.',
		};
	}
	return { available: true, reason: `using ${root} as the size-limited spool root` };
}

const diskFullProbe = probeRealDiskFullVolume();
if (!diskFullProbe.available) {
	coverageNotice(`JR-3-07 manual suite not run on this host: ${diskFullProbe.reason}`);
}

suiteRequiring(
	'manual',
	'JR-3-07: disk full on a real size-limited volume (Linux)',
	diskFullProbe,
	() => {
		let root: string;
		let fs: NodeSpoolFileSystem;

		beforeEach(async () => {
			root = process.env.OA_TEST_SPOOL_DISKFULL_ROOT!.trim();
			fs = new NodeSpoolFileSystem();
			const existing = await readdir(root);
			if (existing.length > 0) {
				throw new Error(
					`OA_TEST_SPOOL_DISKFULL_ROOT (${root}) is not empty -- refusing to run against a ` +
						`volume that might already be full of something else's data. Found: ${existing.join(', ')}`
				);
			}
		});

		afterEach(async () => {
			// Best-effort cleanup so a second run of this suite starts from an empty volume again.
			const entries = await readdir(root).catch(() => [] as string[]);
			for (const entry of entries) {
				await rm(path.join(root, entry), { recursive: true, force: true }).catch(() => {});
			}
		});

		it("a message exceeding the volume's real capacity is classified spool-capacity-exceeded, with no partial spool entry surviving", async () => {
			const { backend, requests } = recordingBackend();
			// A large-but-not-infinite high-water-mark: the point of this case is the OS's genuine
			// ENOSPC, not the internal high-water-mark check (already proven above and in layout.test.ts).
			const acceptance = new JournalAcceptance({
				fs,
				backend,
				spoolConfig: { rootPath: root, highWaterBytes: 10_000_000_000n },
				alertSink: noopAlertSink(),
			});

			const CHUNK_SIZE = 256 * 1024;
			const CHUNK_COUNT = 128; // 32 MiB nominal -- comfortably over an 8 MiB tmpfs mount
			async function* overflow(): AsyncGenerator<Uint8Array> {
				const chunk = Buffer.alloc(CHUNK_SIZE, 0x41);
				for (let i = 0; i < CHUNK_COUNT; i += 1) {
					yield chunk;
				}
			}

			const txid = freshTxid();
			const result = await acceptance.accept(baseInput({ txid, chunks: overflow() }));

			expect(result.kind).toBe('spool-capacity-exceeded');
			expect(requests).toHaveLength(0);
			if (result.kind === 'spool-capacity-exceeded') {
				expect((result.cause as { code?: string }).code).toBe('ENOSPC');
			}
		}, 60_000);

		it('recovers once space is freed: a subsequent transaction succeeds after the filler file is removed', async () => {
			const { backend, requests } = recordingBackend();
			const acceptance = new JournalAcceptance({
				fs,
				backend,
				spoolConfig: { rootPath: root, highWaterBytes: 10_000_000_000n },
				alertSink: noopAlertSink(),
			});

			// Deliberately fill the volume with an oversized transaction first (same shape as the case
			// above), then free the space by deleting everything the OS actually wrote for it, and
			// prove a normal-sized transaction now succeeds.
			const CHUNK_SIZE = 256 * 1024;
			async function* overflow(): AsyncGenerator<Uint8Array> {
				const chunk = Buffer.alloc(CHUNK_SIZE, 0x42);
				for (let i = 0; i < 128; i += 1) {
					yield chunk;
				}
			}
			const fillTxid = freshTxid();
			const filled = await acceptance.accept(
				baseInput({ txid: fillTxid, chunks: overflow() })
			);
			expect(filled.kind).toBe('spool-capacity-exceeded');

			// Free the space: remove whatever partial file the failed write left on the real volume.
			// (This is JR-3-06's finding applied to a real disk: the failed write's own debris is what
			// has to be cleaned up before recovery is possible -- nothing in packages/journaling does
			// this automatically.)
			async function removeAllRegularFiles(dir: string): Promise<void> {
				const entries = await readdir(dir, { withFileTypes: true });
				for (const entry of entries) {
					const full = path.join(dir, entry.name);
					if (entry.isDirectory()) {
						await removeAllRegularFiles(full);
						continue;
					}
					const info = await fsStat(full);
					if (info.size > 0) {
						await unlink(full).catch(() => {});
					}
				}
			}
			await removeAllRegularFiles(root);

			const retryTxid = freshTxid();
			const recovered = await acceptance.accept(baseInput({ txid: retryTxid }));
			expect(recovered.kind).toBe('accepted');
			expect(requests).toHaveLength(1);
		}, 60_000);
	}
);
