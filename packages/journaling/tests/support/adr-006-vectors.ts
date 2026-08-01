import { createHash } from 'node:crypto';
import type { JournalChainHead, JournalLedgerRecord } from '@open-archiver/types';

/**
 * The test vectors of **ADR-006 section 6**, as data.
 *
 * These are not values this code produced and then wrote down. They were computed by a reference
 * implementation while the ADR was being decided (2026-07-31) and published *in* the ADR; this module
 * transcribes them so that `adr-006-vectors.test.ts` can hold the implementation against them.
 *
 * That direction matters. A golden file generated from the implementation it guards only proves the
 * implementation is deterministic — it would happily bless a changed encoding. These numbers exist
 * independently of `packages/journaling`, so a byte-level change here fails the test even if the new
 * behaviour is self-consistent. If one of them ever has to change, that is a chain-invalidating
 * format change and needs a new `FORMAT_VERSION` plus a migration, not an updated constant.
 */

const sha256 = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

export const DEPLOYMENT_ID = '00000000-0000-4000-8000-000000000001';
export const SCOPE_A = '11111111-1111-4111-8111-111111111111';
export const SCOPE_B = '22222222-2222-4222-8222-222222222222';
export const SCOPE_C = '33333333-3333-4333-8333-333333333333';

/** `2026-07-31T10:15:30.123Z` in microseconds. A whole millisecond, per ADR-006 section 3.1. */
export const RECEIVED_AT_MICROS = 1_785_492_930_123_000n;

/** The `V1` receipt record of ADR-006 section 6, field for field. */
export const RECEIPT_V1: JournalLedgerRecord = {
	chainScopeId: SCOPE_A,
	seq: 1n,
	receivedAtMicros: RECEIVED_AT_MICROS,
	eventType: 'receipt',
	remoteIp: '192.0.2.25',
	ehloName: 'mail.example.com',
	tlsVersion: 'TLSv1.3',
	tlsCipher: 'TLS_AES_256_GCM_SHA384',
	envelopeFrom: 'sender@example.com',
	envelopeRcpt: ['a@example.com', 'b@example.com'],
	sizeBytes: 4096n,
	contentSha256: sha256('journal-report-bytes'),
	duplicateOf: null,
	journalingSourceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	spoolTxId: '01JZZ0000000000000000000AA',
	eventPayload: { parse_failed: false, phase: 'A' },
};

/** The `V2` anchor record: an event without an SMTP transaction, so fields 5-13 and 15 are null. */
export const ANCHOR_V2: JournalLedgerRecord = {
	chainScopeId: SCOPE_A,
	seq: 2n,
	receivedAtMicros: 1_785_549_600_000_000n, // 2026-08-01T02:00:00.000Z
	eventType: 'anchor',
	remoteIp: null,
	ehloName: null,
	tlsVersion: null,
	tlsCipher: null,
	envelopeFrom: null,
	envelopeRcpt: null,
	sizeBytes: null,
	contentSha256: null,
	duplicateOf: null,
	journalingSourceId: null,
	spoolTxId: null,
	eventPayload: { anchored_head_seq: 1, leaf_count: 3, merkle_root: 'PLACEHOLDER' },
};

export const HEAD_A: JournalChainHead = {
	chainScopeId: SCOPE_A,
	headSeq: 1n,
	headChainHash: sha256('head-A'),
};
export const HEAD_B: JournalChainHead = {
	chainScopeId: SCOPE_B,
	headSeq: 7n,
	headChainHash: sha256('head-B'),
};
export const HEAD_C: JournalChainHead = {
	chainScopeId: SCOPE_C,
	headSeq: 0n,
	headChainHash: sha256('head-C'),
};

/** Every expected value, exactly as ADR-006 section 6 prints it. */
export const EXPECTED = {
	genesisScopeA: '02f0c72949b5ac8058d7f6ab2ee6241c0f730eaf8cdd53799254fc0cda3f8a14',
	genesisScopeB: '52d2fdd7b5380cf2fcce9736f9be57ca99a263d67a9005f62a5ea221c22a1b49',
	receiptRecordLength: 351,
	receiptRecordSha256: 'cf5a92f4208a06c239d8b330a820ad5030570b1d784b1695b4cd7de105522522',
	receiptChainHash: '6ae132b63a3b3077ff80d988b76b190a7e954f2cdfcb1216d9b7dc6973889d92',
	leafA: '0a33f4d7fdc3c771eb4df31c88ab194bafd6093e5be00514a0408425483db323',
	rootOne: '0a33f4d7fdc3c771eb4df31c88ab194bafd6093e5be00514a0408425483db323',
	rootTwo: '72bcc7f6caf87be729b79c879677cd36463a19debe9b0eb6c8b344c4f5f5c422',
	rootThree: '97edaf856349af16d247b665078c53a99b7e0f0fd2906bcdff822c0125e2b9bc',
} as const;

/**
 * Preimage lengths from ADR-006 section 5.3, which is where the domain separation argument lives.
 *
 * A Merkle node preimage and a ledger record preimage both start with `0x01` — the node because
 * ADR-022 fixes the prefix, the record because that is its format version byte. They are disjoint by
 * length instead, and since that is an argument rather than a construction, it is asserted.
 */
export const PREIMAGE_LENGTHS = {
	merkleLeaf: 77,
	merkleNode: 65,
	/** All sixteen fields `NULL`: 1 + 4 + 16·5 = 85, plus the 32-byte previous hash. */
	ledgerRecordMinimum: 117,
} as const;
