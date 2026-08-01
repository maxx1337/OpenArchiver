import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { JournalChainHead } from '@open-archiver/types';
import { HEAD_A, HEAD_B, HEAD_C } from '../../tests/support/adr-006-vectors';
import { merkleLeaf, merkleNode, merkleRoot } from './merkle';

/**
 * The Merkle aggregate over all chain heads (**ADR-022**, encoding in **ADR-006** section 5).
 *
 * Classification: `ci`. Pure computation.
 *
 * ---------------------------------------------------------------------------------------------
 * The test that explains the design
 * ---------------------------------------------------------------------------------------------
 * `duplicating rule makes two different leaf sets collide` reproduces the rule this code does **not**
 * use, and shows it colliding. That is deliberate: the reason `merkleRoot` follows RFC 6962 is a
 * measured property of the alternative, not a preference, and a reason that lives only in a comment
 * becomes folklore and then gets "simplified" away. With the duplicating rule, a fourth chain could
 * be claimed as included in an existing anchor, which would undo ADR-022 finding 1 — that the anchor
 * attests the **set** of chains, so a vanished chain shows up when two consecutive anchors are
 * compared.
 */

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');

/**
 * The Bitcoin-style rule: pad an odd level by repeating its last node.
 *
 * Present only so the test below can show it colliding. Never use this.
 */
function duplicatingRoot(leaves: readonly Buffer[]): Buffer {
	if (leaves.length === 1) {
		return leaves[0]!;
	}
	const level = [...leaves];
	if (level.length % 2 === 1) {
		level.push(level[level.length - 1]!);
	}
	const next: Buffer[] = [];
	for (let index = 0; index < level.length; index += 2) {
		next.push(merkleNode(level[index]!, level[index + 1]!));
	}
	return duplicatingRoot(next);
}

const head = (scopeId: string, seq: bigint, seed: string): JournalChainHead => ({
	chainScopeId: scopeId,
	headSeq: seq,
	headChainHash: createHash('sha256').update(seed, 'utf8').digest(),
});

suite('ci', 'Merkle: tree shape', () => {
	it('makes a single leaf its own root', () => {
		expect(hex(merkleRoot([HEAD_A]))).toBe(hex(merkleLeaf(HEAD_A)));
	});

	it('builds a two-leaf root as one node over the two leaves', () => {
		const expected = merkleNode(merkleLeaf(HEAD_A), merkleLeaf(HEAD_B));
		expect(hex(merkleRoot([HEAD_A, HEAD_B]))).toBe(hex(expected));
	});

	it('splits three leaves at the largest power of two below the count (RFC 6962)', () => {
		// n = 3 splits 2 | 1, not 1 | 2. The split point is what makes the shape a function of the
		// leaf count alone.
		const expected = merkleNode(
			merkleNode(merkleLeaf(HEAD_A), merkleLeaf(HEAD_B)),
			merkleLeaf(HEAD_C)
		);
		expect(hex(merkleRoot([HEAD_A, HEAD_B, HEAD_C]))).toBe(hex(expected));
	});

	it('sorts leaves by the raw bytes of chain_scope_id, not by input order', () => {
		const forward = merkleRoot([HEAD_A, HEAD_B, HEAD_C]);
		const shuffled = merkleRoot([HEAD_C, HEAD_A, HEAD_B]);
		const reversed = merkleRoot([HEAD_C, HEAD_B, HEAD_A]);
		expect(hex(shuffled)).toBe(hex(forward));
		expect(hex(reversed)).toBe(hex(forward));
	});

	it('changes the root when a head advances', () => {
		const advanced = { ...HEAD_A, headSeq: HEAD_A.headSeq + 1n };
		expect(hex(merkleRoot([advanced, HEAD_B]))).not.toBe(hex(merkleRoot([HEAD_A, HEAD_B])));
	});

	it('changes the root when a chain disappears', () => {
		// ADR-022 finding 1, and ADR-007 consequence 5: "tenant X has no chain any more" must be a
		// finding, which requires the anchor to attest the set of chains.
		const withAll = merkleRoot([HEAD_A, HEAD_B, HEAD_C]);
		const withoutC = merkleRoot([HEAD_A, HEAD_B]);
		expect(hex(withoutC)).not.toBe(hex(withAll));
	});

	it('covers dormant chains too, so a deleted chain differs from an unchanged one', () => {
		// A leaf is included for every existing chain, whether or not it moved since the last anchor.
		// Two consecutive anchors over the same three dormant chains are therefore equal, and the
		// difference to the two-chain root above is the deletion.
		const first = merkleRoot([HEAD_A, HEAD_B, HEAD_C]);
		const second = merkleRoot([HEAD_A, HEAD_B, HEAD_C]);
		expect(hex(second)).toBe(hex(first));
	});
});

suite('ci', 'Merkle: why the odd node is promoted and not duplicated', () => {
	it('keeps [A,B,C] and [A,B,C,C] distinct under RFC 6962', () => {
		const abc = merkleRoot([HEAD_A, HEAD_B, HEAD_C]);
		// A fourth chain whose head is a copy of C's. Under RFC 6962 this is a four-leaf tree and a
		// different root; under the duplicating rule it is not (see the next test).
		const cTwin = head('44444444-4444-4444-8444-444444444444', HEAD_C.headSeq, 'head-C');
		const abcc = merkleRoot([HEAD_A, HEAD_B, HEAD_C, cTwin]);
		expect(hex(abcc)).not.toBe(hex(abc));
	});

	it('shows the duplicating rule making two different leaf sets collide', () => {
		// The measured reason this code does not use that rule. If this test ever goes green in the
		// other direction, the premise of ADR-006 section 5.2 has changed and the ADR is wrong.
		const leaves = [HEAD_A, HEAD_B, HEAD_C].map((chainHead) => merkleLeaf(chainHead));
		const three = duplicatingRoot(leaves);
		const four = duplicatingRoot([...leaves, leaves[2]!]);
		expect(hex(four)).toBe(hex(three));
	});

	it('and the same two sets are distinguishable under the rule that is used', () => {
		const leaves = [HEAD_A, HEAD_B, HEAD_C].map((chainHead) => merkleLeaf(chainHead));
		// Same comparison as above, through the promoting rule: mth([l0,l1,l2]) against
		// mth([l0,l1,l2,l2]). Expressed over raw leaves rather than heads because merkleRoot()
		// rejects a duplicate chain_scope_id, which is the other half of the same protection.
		const three = merkleNode(merkleNode(leaves[0]!, leaves[1]!), leaves[2]!);
		const four = merkleNode(
			merkleNode(leaves[0]!, leaves[1]!),
			merkleNode(leaves[2]!, leaves[2]!)
		);
		expect(hex(four)).not.toBe(hex(three));
	});
});

suite('ci', 'Merkle: refusals', () => {
	it('refuses to anchor zero chains', () => {
		// SHA256("") would be a root that looks legitimate and commits to nothing.
		expect(() => merkleRoot([])).toThrow(/at least one chain head/);
	});

	it('refuses two leaves for the same chain', () => {
		const twin = { ...HEAD_A, headSeq: 99n };
		expect(() => merkleRoot([HEAD_A, twin])).toThrow(/Duplicate chainScopeId/);
	});

	it('refuses a head hash that is not 32 bytes', () => {
		expect(() => merkleLeaf({ ...HEAD_A, headChainHash: Buffer.alloc(16) })).toThrow(
			/32 bytes/
		);
	});

	it('refuses a non-canonical chain scope id', () => {
		// Not SCOPE_A.toUpperCase(): that scope is all digits, so uppercasing it changes nothing and
		// the assertion would hold vacuously. It did, on the first run.
		expect(() =>
			merkleLeaf({ ...HEAD_A, chainScopeId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })
		).toThrow(/canonical UUID/);
		expect(() => merkleLeaf({ ...HEAD_A, chainScopeId: 'nope' })).toThrow(/canonical UUID/);
	});

	it('refuses node children that are not hashes', () => {
		expect(() => merkleNode(Buffer.alloc(32), Buffer.alloc(31))).toThrow(/32 bytes each/);
	});
});
