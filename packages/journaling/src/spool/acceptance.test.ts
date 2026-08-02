import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../../tests/support/fake-spool-fs';
import type { LedgerAppendRequest, LedgerAppendResult, LedgerBackend } from '../ledger/ledger-port';
import type { SpoolFileSystem } from './fs-port';
import { incomingFilePath } from './layout';
import type { SpoolConfig } from './config';
import type { QuarantineAlertSink } from './quarantine';
import { JournalAcceptance, isAccepted, type JournalTransactionInput } from './acceptance';

/**
 * `JournalAcceptance.accept()` — the two-phase acceptance wiring (`JR-3-04`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What "nothing can fail after a successful ledger append" means here, and how it is checked
 * ---------------------------------------------------------------------------------------------
 * The structural half of the acceptance criterion is argued in the doc comment on `acceptance.ts`:
 * the success value is built by a synchronous, total function whose parameter list holds no
 * reference to the filesystem or the ledger backend, fused to the `append()` await in a single
 * `return` statement. That is a property of the source text, not something a test can observe by
 * calling the function.
 *
 * What a test *can* show is the empirical consequence: once `backend.append()` has resolved, nothing
 * this module could reach touches the spool again, and the backend is not called a second time. The
 * "records order across both fakes" test below does exactly that — every fs call and the ledger call
 * are recorded onto one shared timeline, so "did anything happen after the append" is a direct
 * assertion on that timeline rather than an inference.
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
		chainScopeId: '11111111-1111-4111-8111-111111111111',
		receivedAtMicros: 1_785_492_930_123_000n,
		remoteIp: '192.0.2.25',
		ehloName: 'mail.example.com',
		tlsVersion: 'TLSv1.3',
		tlsCipher: 'TLS_AES_256_GCM_SHA384',
		envelopeFrom: 'sender@example.com',
		envelopeRcpt: ['rcpt@example.com'],
		journalingSourceId: null,
		chunks: chunksOf('Subject: test\r\n\r\nhello\r\n'),
		...overrides,
	};
}

/**
 * `alertSink` is a required constructor option (`JR-3-09`, PO decision 2026-08-02): a test that does
 * not care where a `'write-failed'` alert goes still has to say so, explicitly, here at its own call
 * site -- see `acceptance.ts`'s `JournalAcceptanceOptions.alertSink` doc comment for why an optional,
 * silently-discarding default was rejected (R-09, `08-risiken.md`).
 */
function noopAlertSink(): QuarantineAlertSink {
	return { alert: () => {} };
}

/**
 * A minimal, controllable `LedgerBackend` that records every call onto a shared timeline.
 *
 * Deliberately exposes only `backend` and `requests` -- no separate `calls` counter. `requests` is a
 * plain array, and a caller that destructures it (`const { requests } = fakeBackend(...)`) keeps the
 * *same* array reference, so `requests.length` reflects calls made after the destructuring point. A
 * getter-backed `calls: number` property looks equivalent but is not: `const { calls } = fakeBackend(...)`
 * evaluates the getter once, at destructuring time, and copies out that snapshot into a plain local
 * variable -- it does not keep a live binding to the getter. That is exactly how the "does not touch
 * the spool again" test below used to read `calls === 0` no matter how many times `append()` was
 * later called: the destructure ran before `backend.append()` had ever been invoked, so it captured 0
 * and nothing after that could change it. `requests.length` has no such trap.
 */
function fakeBackend(
	result: LedgerAppendResult | (() => LedgerAppendResult),
	timeline: string[] = []
): { backend: LedgerBackend; requests: LedgerAppendRequest[] } {
	const requests: LedgerAppendRequest[] = [];
	return {
		backend: {
			async append(request: LedgerAppendRequest): Promise<LedgerAppendResult> {
				requests.push(request);
				timeline.push('ledger-append');
				return typeof result === 'function' ? result() : result;
			},
		},
		requests,
	};
}

function failingBackend(error: unknown): LedgerBackend {
	return {
		async append(): Promise<LedgerAppendResult> {
			throw error;
		},
	};
}

const SUCCESS_RESULT: LedgerAppendResult = {
	seq: 42n,
	chainHash: Buffer.alloc(32, 0xaa),
	prevChainHash: Buffer.alloc(32, 0xbb),
};

/** Wrap a `SpoolFileSystem` to push a label onto a shared timeline for every fs call it makes. */
function timelineFileSystem(inner: SpoolFileSystem, timeline: string[]): SpoolFileSystem {
	return {
		async mkdir(p, options) {
			timeline.push('fs:mkdir');
			await inner.mkdir(p, options);
		},
		async createFile(p) {
			timeline.push('fs:createFile');
			const handle = await inner.createFile(p);
			return {
				async write(chunk) {
					timeline.push('fs:write');
					await handle.write(chunk);
				},
				async fsync() {
					timeline.push('fs:file-fsync');
					await handle.fsync();
				},
				async close() {
					timeline.push('fs:close');
					await handle.close();
				},
			};
		},
		async fsyncDirectory(p) {
			timeline.push('fs:directory-fsync');
			await inner.fsyncDirectory(p);
		},
		// F41: these three used to pass straight through, untracked -- a regression inserting a
		// *succeeding* call to any of them after the ledger append would not have shown up on the
		// timeline at all. See the module doc comment and acceptance.ts's doc comment for what that
		// gap meant and why all nine SpoolFileSystem/SpoolFileHandle operations belong on one timeline.
		async readdir(p) {
			timeline.push('fs:readdir');
			return inner.readdir(p);
		},
		async stat(p) {
			timeline.push('fs:stat');
			return inner.stat(p);
		},
		async rename(from, to) {
			timeline.push('fs:rename');
			await inner.rename(from, to);
		},
	};
}

suite('ci', 'JournalAcceptance.accept(): order', () => {
	it('writes durably, then appends to the ledger, then returns success -- in that order, on one timeline', async () => {
		const timeline: string[] = [];
		const fs = timelineFileSystem(new FakeSpoolFileSystem(), timeline);
		const { backend } = fakeBackend(SUCCESS_RESULT, timeline);
		const acceptance = new JournalAcceptance({
			fs,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		const result = await acceptance.accept(baseInput());

		expect(isAccepted(result)).toBe(true);
		expect(timeline.indexOf('ledger-append')).toBeGreaterThan(timeline.lastIndexOf('fs:write'));
		expect(timeline.indexOf('ledger-append')).toBeGreaterThan(
			timeline.indexOf('fs:directory-fsync')
		);
		// And the append is the very last thing on the timeline -- nothing ran after it resolved.
		expect(timeline[timeline.length - 1]).toBe('ledger-append');
	});

	it('does not touch the spool again, and does not call the ledger a second time, once append() has resolved', async () => {
		// The empirical half of "nothing after a successful append can still fail": if any code path
		// reachable from the success branch touched the fs or the backend again, this timeline would
		// grow past the single 'ledger-append' entry it ends on, and `requests` would grow past one
		// entry. `requests` is asserted by length rather than through a separate counter -- see the
		// `fakeBackend()` doc comment for why a getter-backed counter read through destructuring cannot
		// do this job: it would capture a snapshot before `accept()` had called `append()` even once,
		// and stay at that snapshot forever, passing regardless of what `accept()` actually does.
		const timeline: string[] = [];
		const fs = timelineFileSystem(new FakeSpoolFileSystem(), timeline);
		const { backend, requests } = fakeBackend(SUCCESS_RESULT, timeline);
		const acceptance = new JournalAcceptance({
			fs,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		await acceptance.accept(baseInput());

		expect(requests.length).toBe(1);
		const countAfterLastAppend = timeline
			.slice(timeline.lastIndexOf('ledger-append') + 1)
			.filter((entry) => entry !== 'ledger-append').length;
		expect(countAfterLastAppend).toBe(0);
	});

	it('never calls the ledger backend when the durable write fails', async () => {
		const fake = new FakeSpoolFileSystem();
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend: {
				async append(): Promise<LedgerAppendResult> {
					throw new Error('must not be called');
				},
			},
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});
		// Force the write itself to fail -- the txid is generated internally, so pre-fail every path
		// under the shard by making the shard directory refuse to accept the file. Simpler: fail the
		// write via a fixed txid supplied by the caller.
		const txid = '01ARZ3NDEKTSV4RRFFQ69G5FAV0';
		fake.failNextWrite(incomingFilePath(SPOOL_ROOT, txid));

		const result = await acceptance.accept(baseInput({ txid }));
		expect(result.kind).toBe('spool-capacity-exceeded');
	});
});

suite('ci', 'JournalAcceptance.accept(): high-water mark', () => {
	it('rejects before writing a single byte when the spool is at or over the high-water mark', async () => {
		const fake = new FakeSpoolFileSystem();
		// Pre-populate the spool past a 10-byte budget.
		await fake.mkdir('/spool/incoming', { recursive: true });
		await fake.mkdir('/spool/incoming/aa', { recursive: true });
		const existing = await fake.createFile('/spool/incoming/aa/existing.eml');
		await existing.write(Buffer.alloc(20, 1));
		await existing.fsync();
		await existing.close();

		const acceptance = new JournalAcceptance({
			fs: fake,
			backend: {
				async append(): Promise<LedgerAppendResult> {
					throw new Error('must not be called');
				},
			},
			spoolConfig: spoolConfig(10n),
			alertSink: noopAlertSink(),
		});

		const before = fake.writeLog.length;
		const result = await acceptance.accept(baseInput());

		expect(result.kind).toBe('high-water-mark-exceeded');
		if (result.kind === 'high-water-mark-exceeded') {
			expect(result.status.exceeded).toBe(true);
			expect(result.status.usageBytes).toBe(20n);
		}
		// Nothing was written for *this* transaction -- the write log is unchanged.
		expect(fake.writeLog.length).toBe(before);
	});
});

suite('ci', 'JournalAcceptance.accept(): spool write failures', () => {
	it("classifies a non-capacity write failure as 'spool-write-failed' and never calls the ledger", async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = '01ARZ3NDEKTSV4RRFFQ69G5FAV1';
		fake.failNextWrite(
			incomingFilePath(SPOOL_ROOT, txid),
			Object.assign(new Error('i/o error'), { code: 'EIO' })
		);
		let called = false;
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend: {
				async append(): Promise<LedgerAppendResult> {
					called = true;
					return SUCCESS_RESULT;
				},
			},
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		const result = await acceptance.accept(baseInput({ txid }));

		expect(result.kind).toBe('spool-write-failed');
		if (result.kind === 'spool-write-failed') {
			expect(result.stage).toBe('write');
			expect((result.cause as { code?: string }).code).toBe('EIO');
			expect(result.spoolTxId).toBe(txid);
		}
		expect(called).toBe(false);
	});

	it("classifies an ENOSPC write failure as 'spool-capacity-exceeded', not 'spool-write-failed'", async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = '01ARZ3NDEKTSV4RRFFQ69G5FAV2';
		// FakeSpoolFileSystem.failNextWrite() defaults to an ENOSPC-coded error.
		fake.failNextWrite(incomingFilePath(SPOOL_ROOT, txid));
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend: failingBackend(new Error('must not be called')),
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		const result = await acceptance.accept(baseInput({ txid }));

		expect(result.kind).toBe('spool-capacity-exceeded');
		if (result.kind === 'spool-capacity-exceeded') {
			expect(result.stage).toBe('write');
			expect((result.cause as { code?: string }).code).toBe('ENOSPC');
		}
	});

	it('classifies an ENOSPC-coded file-fsync failure as capacity too -- stage alone never decides', async () => {
		// docs/dev/journaling/02-architektur.md section 3: 'write' vs 'file-fsync' vs 'directory-fsync'
		// says *where* durability broke; 452 vs 451 comes from stage *and* cause together.
		const fake = new FakeSpoolFileSystem();
		const txid = '01ARZ3NDEKTSV4RRFFQ69G5FAV3';
		fake.failNextFileFsync(
			incomingFilePath(SPOOL_ROOT, txid),
			Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
		);
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend: failingBackend(new Error('must not be called')),
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		const result = await acceptance.accept(baseInput({ txid }));

		expect(result.kind).toBe('spool-capacity-exceeded');
		if (result.kind === 'spool-capacity-exceeded') {
			expect(result.stage).toBe('file-fsync');
		}
	});
});

suite('ci', 'JournalAcceptance.accept(): ledger append failures', () => {
	it("returns 'ledger-append-failed' and leaves the spool file exactly where the durable write put it", async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = '01ARZ3NDEKTSV4RRFFQ69G5FAV4';
		const cause = new Error('deadlock detected');
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend: failingBackend(cause),
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		const expectedPath = incomingFilePath(SPOOL_ROOT, txid);
		const result = await acceptance.accept(baseInput({ txid }));

		expect(result.kind).toBe('ledger-append-failed');
		if (result.kind === 'ledger-append-failed') {
			expect(result.cause).toBe(cause);
			expect(result.filePath.replace(/\\/g, '/')).toBe(expectedPath.replace(/\\/g, '/'));
		}
		// The skill's rule (section 3): never delete a spool file that has no ledger entry. The file
		// from the successful durable write must still be there, byte for byte.
		expect(fake.hasFile(expectedPath)).toBe(true);
		expect(fake.fileContent(expectedPath)?.toString()).toBe('Subject: test\r\n\r\nhello\r\n');
	});
});

suite('ci', 'JournalAcceptance.accept(): success', () => {
	it('returns the seq and chain hash the backend produced, keyed to the transaction id', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = '01ARZ3NDEKTSV4RRFFQ69G5FAV5';
		const { backend } = fakeBackend(SUCCESS_RESULT);
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		const result = await acceptance.accept(baseInput({ txid }));

		expect(result).toEqual({
			kind: 'accepted',
			spoolTxId: txid,
			seq: SUCCESS_RESULT.seq,
			chainHash: SUCCESS_RESULT.chainHash,
		});
	});

	it('generates a transaction id when the caller does not supply one', async () => {
		const fake = new FakeSpoolFileSystem();
		const { backend, requests } = fakeBackend(SUCCESS_RESULT);
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(),
			now: () => 1_700_000_000_000,
			alertSink: noopAlertSink(),
		});

		const result = await acceptance.accept(baseInput());

		expect(isAccepted(result)).toBe(true);
		if (isAccepted(result)) {
			expect(result.spoolTxId).toMatch(/^[0-9A-Z]{26}$/);
			expect(requests[0]!.spoolTxId).toBe(result.spoolTxId);
		}
	});

	it('uses the durable write result for size and content hash, never the caller-supplied input', async () => {
		const fake = new FakeSpoolFileSystem();
		const { backend, requests } = fakeBackend(SUCCESS_RESULT);
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		await acceptance.accept(baseInput({ chunks: chunksOf('abcde') }));

		expect(requests[0]!.sizeBytes).toBe(5n);
		expect(requests[0]!.contentSha256).not.toBeNull();
	});

	it('normalises the remote IP before it reaches the ledger request', async () => {
		const fake = new FakeSpoolFileSystem();
		const { backend, requests } = fakeBackend(SUCCESS_RESULT);
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		await acceptance.accept(baseInput({ remoteIp: '::ffff:192.0.2.1' }));

		expect(requests[0]!.remoteIp).toBe('192.0.2.1');
	});

	it('passes a null remote IP through unchanged, never normalising a null', async () => {
		const fake = new FakeSpoolFileSystem();
		const { backend, requests } = fakeBackend(SUCCESS_RESULT);
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		await acceptance.accept(baseInput({ remoteIp: null }));

		expect(requests[0]!.remoteIp).toBeNull();
	});

	it("sets eventType 'receipt' and duplicateOf/eventPayload to null for every Phase A transaction", async () => {
		// Object-level dedup against content_sha256 is Phase B's job (architecture section 6); the
		// ingress process has no object-store access to check against (architecture section 1).
		const fake = new FakeSpoolFileSystem();
		const { backend, requests } = fakeBackend(SUCCESS_RESULT);
		const acceptance = new JournalAcceptance({
			fs: fake,
			backend,
			spoolConfig: spoolConfig(),
			alertSink: noopAlertSink(),
		});

		await acceptance.accept(baseInput());

		expect(requests[0]!.eventType).toBe('receipt');
		expect(requests[0]!.duplicateOf).toBeNull();
		expect(requests[0]!.eventPayload).toBeNull();
	});
});
