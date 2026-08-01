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
}

/** Build a minimal, valid {@link LedgerEntryByTxId} with sensible defaults, overridable per field. */
export function ledgerEntry(overrides: Partial<LedgerEntryByTxId> = {}): LedgerEntryByTxId {
	return {
		seq: 1n,
		chainScopeId: '11111111-1111-4111-8111-111111111111',
		journalingSourceId: null,
		remoteIp: '192.0.2.25',
		receivedAt: new Date('2026-08-01T10:00:00.000Z'),
		...overrides,
	};
}
