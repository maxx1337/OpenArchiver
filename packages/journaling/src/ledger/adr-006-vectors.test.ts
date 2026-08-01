import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	ANCHOR_V2,
	DEPLOYMENT_ID,
	EXPECTED,
	HEAD_A,
	HEAD_B,
	HEAD_C,
	PREIMAGE_LENGTHS,
	RECEIPT_V1,
	SCOPE_A,
	SCOPE_B,
} from '../../tests/support/adr-006-vectors';
import {
	FORMAT_VERSION,
	GENESIS_PREFIX,
	LEDGER_FIELD_COUNT,
	chainHash,
	encodeLedgerRecord,
	genesisChainHash,
} from './canonical-encoding';
import {
	MERKLE_LEAF_PREFIX,
	MERKLE_NODE_PREFIX,
	merkleLeaf,
	merkleNode,
	merkleRoot,
} from './merkle';

/**
 * The golden-file half of `JR-2-02`: the implementation against the test vectors of **ADR-006**.
 *
 * Classification: `ci`. Pure computation over `node:crypto`, no socket, no database.
 *
 * ---------------------------------------------------------------------------------------------
 * What makes this a golden file rather than a tautology
 * ---------------------------------------------------------------------------------------------
 * The expected values were **not** produced by this code. They were computed by a reference
 * implementation while ADR-006 was being decided and published in the ADR itself; `tests/support/
 * adr-006-vectors.ts` transcribes them. A golden file generated from the implementation it guards
 * only shows that the implementation is deterministic — it would bless a changed encoding without
 * complaint. These numbers exist independently of this package, so any byte-level change fails here.
 *
 * That is the whole job of this file: an encoding change invalidates every existing chain, so it has
 * to be a deliberate act — new `FORMAT_VERSION`, migration, updated ADR — and not a side effect of
 * an edit that looked harmless.
 */

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');
const sha256 = (value: Uint8Array): string =>
	createHash('sha256').update(Buffer.from(value)).digest('hex');

suite('ci', 'ADR-006 test vectors', () => {
	it('reproduces the genesis hash of section 6 (G1)', () => {
		expect(hex(genesisChainHash(DEPLOYMENT_ID, SCOPE_A))).toBe(EXPECTED.genesisScopeA);
	});

	it('gives a different genesis to a different chain scope (G2)', () => {
		// ADR-007 consequence 3 as a test: without chainScopeId in the genesis, two chains whose
		// first event is identical would be hash-identical and an entry could be moved between
		// tenants without breaking either chain.
		expect(hex(genesisChainHash(DEPLOYMENT_ID, SCOPE_B))).toBe(EXPECTED.genesisScopeB);
		expect(EXPECTED.genesisScopeA).not.toBe(EXPECTED.genesisScopeB);
	});

	it('keeps the genesis string recomputable by hand', () => {
		// The reason the genesis uses UUID *text* while the field encoding uses 16 raw bytes: an
		// auditor must be able to recompute this one value without our code. If this test has to
		// change, that property is gone.
		const byHand = createHash('sha256')
			.update(`${GENESIS_PREFIX}${DEPLOYMENT_ID}:${SCOPE_A}`, 'ascii')
			.digest('hex');
		expect(byHand).toBe(EXPECTED.genesisScopeA);
	});

	it('encodes the V1 receipt record to the expected bytes and length', () => {
		const record = encodeLedgerRecord(RECEIPT_V1);
		expect(record.length).toBe(EXPECTED.receiptRecordLength);
		expect(sha256(record)).toBe(EXPECTED.receiptRecordSha256);
	});

	it('frames the record with the version byte and the field count', () => {
		const record = encodeLedgerRecord(RECEIPT_V1);
		expect(record[0]).toBe(FORMAT_VERSION);
		expect(record.readUInt32BE(1)).toBe(LEDGER_FIELD_COUNT);
		expect(LEDGER_FIELD_COUNT).toBe(16);
	});

	it('reproduces chain_hash(1) over the genesis (V1)', () => {
		const genesis = genesisChainHash(DEPLOYMENT_ID, SCOPE_A);
		expect(hex(chainHash(RECEIPT_V1, genesis))).toBe(EXPECTED.receiptChainHash);
	});

	it('encodes an anchor event, whose transaction fields are all null (V2)', () => {
		// Not a vector with a published hash, but the shape check that belongs with it: an event
		// without an SMTP transaction must be encodable at all. `sizeBytes: 0` would assert a
		// message that never existed, which is why JR-2-04 makes the column nullable.
		const record = encodeLedgerRecord(ANCHOR_V2);
		expect(record.readUInt32BE(1)).toBe(LEDGER_FIELD_COUNT);
		expect(record.length).toBeLessThan(EXPECTED.receiptRecordLength);
	});

	it('reproduces the Merkle leaf of section 6 (V3)', () => {
		expect(hex(merkleLeaf(HEAD_A))).toBe(EXPECTED.leafA);
	});

	it('reproduces the roots over one, two and three leaves (V3)', () => {
		expect(hex(merkleRoot([HEAD_A]))).toBe(EXPECTED.rootOne);
		expect(hex(merkleRoot([HEAD_A, HEAD_B]))).toBe(EXPECTED.rootTwo);
		expect(hex(merkleRoot([HEAD_A, HEAD_B, HEAD_C]))).toBe(EXPECTED.rootThree);
	});

	it('makes a single leaf its own root', () => {
		expect(EXPECTED.rootOne).toBe(EXPECTED.leafA);
	});

	it('holds the preimage lengths that carry the domain separation argument', () => {
		// ADR-006 section 5.3. A node preimage and a ledger preimage both begin with 0x01; they are
		// distinguishable by length, and since that is an argument rather than a construction, it is
		// checked here so a later change to either frame cannot quietly break it.
		const leafPreimageLength = 1 + 1 + 4 + (1 + 4 + 16) + (1 + 4 + 8) + (1 + 4 + 32);
		expect(leafPreimageLength).toBe(PREIMAGE_LENGTHS.merkleLeaf);
		expect(1 + 32 + 32).toBe(PREIMAGE_LENGTHS.merkleNode);

		const allNullMinimum = 1 + 4 + LEDGER_FIELD_COUNT * 5 + 32;
		expect(allNullMinimum).toBe(PREIMAGE_LENGTHS.ledgerRecordMinimum);
		expect(allNullMinimum).toBeGreaterThan(PREIMAGE_LENGTHS.merkleNode);

		// And the prefixes are what ADR-022 fixed them to.
		expect(MERKLE_LEAF_PREFIX).toBe(0x00);
		expect(MERKLE_NODE_PREFIX).toBe(0x01);
		expect(FORMAT_VERSION).toBe(0x01);
	});

	it('separates a leaf from a node even when fed the same bytes', () => {
		const left = merkleLeaf(HEAD_A);
		const right = merkleLeaf(HEAD_B);
		const node = merkleNode(left, right);
		// Without the 0x00/0x01 prefixes a leaf could be presented as an inner node and vice versa.
		const unprefixed = createHash('sha256')
			.update(Buffer.concat([left, right]))
			.digest('hex');
		expect(hex(node)).not.toBe(unprefixed);
	});
});
