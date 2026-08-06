import { createHash } from 'node:crypto';
import type { LedgerEntryByTxId, LedgerLookup } from '../../src/ledger/ledger-lookup-port';

/**
 * An in-memory {@link LedgerLookup} (`JR-3-05`), the read-side counterpart to
 * `fake-spool-fs.ts`'s {@link FakeSpoolFileSystem}.
 *
 * Deliberately records every batch it was asked to resolve (`queries`), in call order -- that log is
 * what `crash-recovery.test.ts` uses to prove the scan issues **one** batched lookup for the whole
 * `incoming/` listing rather than one call per file, and that it never asks about a `spool_txid` it
 * found sitting in `quarantine/`.
 */
export class FakeLedgerLookup implements LedgerLookup {
	private readonly entries = new Map<string, LedgerEntryByTxId>();

	/** Every batch passed to {@link findBySpoolTxIds}, in call order. */
	readonly queries: (readonly string[])[] = [];

	/** Test setup: register a ledger row as if it had been durably appended for this `spoolTxId`. */
	set(spoolTxId: string, entry: LedgerEntryByTxId): void {
		this.entries.set(spoolTxId, entry);
	}

	async findBySpoolTxIds(
		spoolTxIds: readonly string[]
	): Promise<ReadonlyMap<string, LedgerEntryByTxId>> {
		this.queries.push([...spoolTxIds]);
		const result = new Map<string, LedgerEntryByTxId>();
		for (const txid of spoolTxIds) {
			const entry = this.entries.get(txid);
			if (entry) {
				result.set(txid, entry);
			}
		}
		return result;
	}

	/**
	 * `JR-6-03`: mirrors `PostgresLedgerLookup`'s `MIN(seq)` query over whatever a test has `.set()`,
	 * scanning the same map `findBySpoolTxIds()` reads. A test that wants "this is a redelivery" sets
	 * **two** entries with the same `chainScopeId`/`contentSha256` (one per simulated `spool_txid`, as
	 * two real Phase-A receipts would be) and this returns the smaller of the two seqs -- exactly what
	 * the real backend would. This fake cannot represent a `null`-`spool_txid` marker row (its map is
	 * keyed by `spool_txid`), so it does not exercise "a second call sees a marker row, not the true
	 * original" -- that guarantee rests on the real `MIN(seq)` query alone.
	 */
	async findOriginalReceiptSeq(
		chainScopeId: string,
		contentSha256: Uint8Array
	): Promise<bigint | null> {
		let min: bigint | null = null;
		const needle = Buffer.from(contentSha256);
		for (const entry of this.entries.values()) {
			if (entry.eventType !== 'receipt') continue;
			if (entry.chainScopeId !== chainScopeId) continue;
			if (entry.contentSha256 === null) continue;
			if (!Buffer.from(entry.contentSha256).equals(needle)) continue;
			if (min === null || entry.seq < min) {
				min = entry.seq;
			}
		}
		return min;
	}
}

/**
 * The bytes {@link ledgerEntry}'s default `contentSha256` is the hash of, so the default row is
 * **internally consistent**: its hash and its `sizeBytes` describe one and the same message.
 *
 * That consistency is the point. `JR-6-02a`'s gate compares a receipt's `content_sha256` against a
 * measurement of the file on disk, and a default of `null` (or of 32 zero bytes) would make the default
 * row one that no real receipt can be -- so a Phase-B test built on it would be exercising an
 * impossible input while looking like it exercised the ordinary one.
 */
export const DEFAULT_LEDGER_ENTRY_CONTENT = Buffer.from(
	'Return-Path: <sender@example.com>\r\nSubject: fake\r\n\r\nbody\r\n',
	'utf8'
);

/**
 * Build a minimal, valid {@link LedgerEntryByTxId} with sensible defaults, overridable per field.
 *
 * The defaults describe a **`receipt`** for {@link DEFAULT_LEDGER_ENTRY_CONTENT}. A Phase-B test that
 * measures its own bytes must override `contentSha256` and `sizeBytes` together -- overriding only one
 * produces a self-contradicting receipt, which is a legitimate thing to test but never an accident worth
 * having.
 */
export function ledgerEntry(overrides: Partial<LedgerEntryByTxId> = {}): LedgerEntryByTxId {
	return {
		seq: 1n,
		chainScopeId: '11111111-1111-4111-8111-111111111111',
		journalingSourceId: null,
		remoteIp: '192.0.2.25',
		receivedAt: new Date('2026-08-01T10:00:00.000Z'),
		eventType: 'receipt',
		contentSha256: new Uint8Array(
			createHash('sha256').update(DEFAULT_LEDGER_ENTRY_CONTENT).digest()
		),
		sizeBytes: BigInt(DEFAULT_LEDGER_ENTRY_CONTENT.length),
		// JR-6-02b: null by default, same posture as `journalingSourceId` above -- a caller exercising
		// the envelope fields overrides them explicitly rather than relying on an arbitrary default.
		envelopeFrom: null,
		envelopeRcpt: null,
		...overrides,
	};
}
