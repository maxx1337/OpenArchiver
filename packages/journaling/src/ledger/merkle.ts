import { createHash } from 'node:crypto';
import type { JournalChainHead } from '@open-archiver/types';
import { FORMAT_VERSION, TAG } from './canonical-encoding';

/**
 * Merkle aggregate over all chain heads (**ADR-022**, encoding fixed by **ADR-006** section 5).
 *
 * ---------------------------------------------------------------------------------------------
 * Why there is a tree at all
 * ---------------------------------------------------------------------------------------------
 * Since ADR-007 there is one chain per tenant, so an anchoring run has N heads. One RFC-3161 token
 * per tenant would scale cost with tenants × frequency (daily × 50 tenants is 18,250 tokens a year
 * against 365 for an aggregate), but the load-bearing reason is a different one: **an inclusion proof
 * must not require other tenants' data.** With a sorted list of heads as the stamped input, proving
 * that tenant A's head was included requires reconstructing the whole list — every other tenant's
 * `chain_scope_id`, `seq` and head hash, and `seq` reveals message volume. With a tree, the proof is
 * A's leaf, ~log2(N) sibling hashes, the root and the token; sibling hashes are opaque.
 *
 * This is **not** the Merkle question from RFC section 15. That one asks about a tree *instead of*
 * the chain, as a partial-verification optimisation, and the answer there stays "not for v1". This is
 * a tree *over* the chains, and it is the condition for tenant-clean proofs, not an optimisation.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the odd node is promoted and not duplicated
 * ---------------------------------------------------------------------------------------------
 * Under the Bitcoin rule ("duplicate the last node"), the leaf sets `[A,B,C]` and `[A,B,C,C]` produce
 * the **same** root. That would let a fourth chain be claimed as included in an existing anchor, and
 * it would undo ADR-022 finding 1, whose whole point is that the anchor attests the **set** of
 * chains so that a vanished chain is detectable by comparing two consecutive anchors. RFC 6962 has no
 * such ambiguity, so `merkleRoot` follows it: split at the largest power of two **strictly less
 * than** the number of leaves.
 *
 * `merkle.test.ts` asserts both halves of that — the ambiguity of the duplicating rule is reproduced
 * there against a local implementation of it, so the reason this code looks the way it does stays
 * visible instead of becoming folklore.
 */

/**
 * Domain separation prefixes (ADR-022 finding 2).
 *
 * Without them the tree structure is ambiguous: a leaf could be presented as an inner node and vice
 * versa. Leaves are **hashed** rather than placed into the tree in the clear, so a leaked leaf hash
 * reveals nothing about the head it commits to.
 */
export const MERKLE_LEAF_PREFIX = 0x00;
export const MERKLE_NODE_PREFIX = 0x01;

/** How many fields a Merkle leaf record carries. Same frame as a ledger record, three fields. */
export const MERKLE_LEAF_FIELD_COUNT = 3;

function uint32be(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32BE(value);
	return buffer;
}

function field(tag: number, value: Buffer): Buffer {
	return Buffer.concat([Buffer.from([tag]), uint32be(value.length), value]);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function chainScopeBytes(chainScopeId: string): Buffer {
	if (!UUID_PATTERN.test(chainScopeId)) {
		throw new RangeError(
			`chainScopeId = "${chainScopeId}" is not a lowercase canonical UUID (RFC 4122 section 3).`
		);
	}
	return Buffer.from(chainScopeId.replace(/-/g, ''), 'hex');
}

/**
 * `leaf = SHA256( 0x00 || record3(chain_scope_id, head_seq, head_chain_hash) )`.
 *
 * `record3` is the frame from `canonical-encoding.ts` with `field_count = 3`, so the leaf encoding
 * inherits every property of the field encoding — one encoder, two schemas.
 */
export function merkleLeaf(head: JournalChainHead): Buffer {
	if (head.headChainHash.length !== 32) {
		throw new RangeError(
			`headChainHash must be 32 bytes (SHA-256), got ${head.headChainHash.length}.`
		);
	}
	if (head.headSeq < 0n || head.headSeq > 0xffffffffffffffffn) {
		throw new RangeError(`headSeq = ${head.headSeq} does not fit an unsigned 64-bit integer.`);
	}
	const seq = Buffer.alloc(8);
	seq.writeBigUInt64BE(head.headSeq);
	const record = Buffer.concat([
		Buffer.from([FORMAT_VERSION]),
		uint32be(MERKLE_LEAF_FIELD_COUNT),
		field(TAG.UUID, chainScopeBytes(head.chainScopeId)),
		field(TAG.UINT64, seq),
		field(TAG.BYTES, Buffer.from(head.headChainHash)),
	]);
	return createHash('sha256')
		.update(Buffer.from([MERKLE_LEAF_PREFIX]))
		.update(record)
		.digest();
}

/** `node = SHA256( 0x01 || left || right )`. */
export function merkleNode(left: Uint8Array, right: Uint8Array): Buffer {
	if (left.length !== 32 || right.length !== 32) {
		throw new RangeError(
			`Merkle node children must be 32 bytes each, got ${left.length} and ${right.length}.`
		);
	}
	return createHash('sha256')
		.update(Buffer.from([MERKLE_NODE_PREFIX]))
		.update(left)
		.update(right)
		.digest();
}

/**
 * Merkle Tree Hash over already-hashed leaves, per RFC 6962 section 2.1.
 *
 * The split point is the largest power of two **strictly less than** `leaves.length`, which is what
 * makes the tree shape a function of the leaf count alone — and therefore what makes
 * `root([A,B,C]) !== root([A,B,C,C])`.
 */
function mth(leaves: readonly Buffer[]): Buffer {
	if (leaves.length === 1) {
		return leaves[0]!;
	}
	let split = 1;
	while (split * 2 < leaves.length) {
		split *= 2;
	}
	return merkleNode(mth(leaves.slice(0, split)), mth(leaves.slice(split)));
}

/**
 * Root over **every** existing chain head, sorted by the raw bytes of `chain_scope_id`.
 *
 * "Every" is not an optimisation left on the table: leaves must cover chains that have not changed
 * since the last anchor as well, because otherwise a deleted chain is indistinguishable from a
 * dormant one and the finding disappears (ADR-022 finding 1).
 *
 * Sorting is over the 16 raw UUID bytes rather than the text form. The two orders coincide for
 * lowercase canonical UUIDs, so this is a statement about which one is normative, not a behavioural
 * choice — an implementation in another language must not have to reason about hex collation.
 */
export function merkleRoot(heads: readonly JournalChainHead[]): Buffer {
	if (heads.length === 0) {
		// An anchoring run over zero chains has nothing to attest. Returning SHA256("") here would be
		// a root that looks legitimate and commits to nothing, so the caller has to decide instead.
		throw new RangeError(
			'merkleRoot() needs at least one chain head. An anchoring run with no chains must not ' +
				'produce an anchor -- there is nothing for the timestamp to attest.'
		);
	}
	const seen = new Set<string>();
	for (const head of heads) {
		if (seen.has(head.chainScopeId)) {
			// Two leaves for one chain would make the tree ambiguous about that chain's head and is
			// only reachable through a caller bug, so it fails loudly rather than picking one.
			throw new RangeError(
				`Duplicate chainScopeId "${head.chainScopeId}" among the chain heads.`
			);
		}
		seen.add(head.chainScopeId);
	}
	const sorted = [...heads].sort((left, right) =>
		Buffer.compare(chainScopeBytes(left.chainScopeId), chainScopeBytes(right.chainScopeId))
	);
	return mth(sorted.map((head) => merkleLeaf(head)));
}
