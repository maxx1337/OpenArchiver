import { merkleLeaf, merkleNode } from '@open-archiver/journaling';
import type { JournalChainHead } from '@open-archiver/types';

/**
 * Inclusion proofs over the anchor tree, and the comparison of two consecutive anchors
 * (`JR-2-09` cases (d) and (e), Testplan section 12.5).
 *
 * ---------------------------------------------------------------------------------------------
 * Why the path is computed here and not in `packages/journaling`
 * ---------------------------------------------------------------------------------------------
 * `merkleRoot()` exists in production (`JR-2-02`); the **audit path** does not, because it belongs to
 * E8's anchoring job (`JR-8-02`/`JR-8-03`). Rather than reach forward into E8, this file computes the
 * path independently — from RFC 6962 section 2.1.1 directly — and checks it against the production
 * root.
 *
 * That is not a workaround, it is the stronger arrangement: a path built by the same code that built
 * the root would agree with it by construction. Here, two implementations that share only
 * `merkleLeaf()` and `merkleNode()` have to arrive at the same 32 bytes, and the split rule — the
 * largest power of two **strictly less than** the leaf count, which is the whole reason ADR-006
 * section 5 rejected the duplicating rule — has to be got right twice. When E8 lands, its path
 * implementation gets a second opinion for free.
 *
 * ---------------------------------------------------------------------------------------------
 * What the positive case here is worth
 * ---------------------------------------------------------------------------------------------
 * Testplan section 12.5 calls it "the actual promise": a tenant's inclusion proof must verify from
 * the leaf, the sibling hashes, the root and the token — **and nothing about other chains**. That is
 * the entire justification for ADR-007's per-tenant chains and ADR-022's tree, so it is asserted as
 * a shape (`verifyInclusion()` takes no head list at all) and not only as a value.
 */

/** One step of an audit path: a sibling hash and which side of the concatenation it goes on. */
export interface AuditStep {
	readonly sibling: Buffer;
	readonly side: 'left' | 'right';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function scopeBytes(chainScopeId: string): Buffer {
	if (!UUID_PATTERN.test(chainScopeId)) {
		throw new RangeError(`chainScopeId = "${chainScopeId}" is not a lowercase canonical UUID.`);
	}
	return Buffer.from(chainScopeId.replace(/-/g, ''), 'hex');
}

/** The leaf order `merkleRoot()` uses: by the raw bytes of `chain_scope_id`. */
export function sortedHeads(heads: readonly JournalChainHead[]): JournalChainHead[] {
	return [...heads].sort((left, right) =>
		Buffer.compare(scopeBytes(left.chainScopeId), scopeBytes(right.chainScopeId))
	);
}

/** RFC 6962: the largest power of two strictly less than `count`. */
function splitPoint(count: number): number {
	let split = 1;
	while (split * 2 < count) {
		split *= 2;
	}
	return split;
}

function rootOf(leaves: readonly Buffer[]): Buffer {
	if (leaves.length === 1) {
		return leaves[0]!;
	}
	const split = splitPoint(leaves.length);
	return merkleNode(rootOf(leaves.slice(0, split)), rootOf(leaves.slice(split)));
}

/**
 * The audit path for the leaf at `index`, from the leaf upwards.
 *
 * Written recursively against the same split rule as the tree hash: descend into the half that
 * contains the index, and the sibling is the root of the other half.
 */
export function auditPath(leaves: readonly Buffer[], index: number): AuditStep[] {
	if (index < 0 || index >= leaves.length) {
		throw new RangeError(`index ${index} is outside 0..${leaves.length - 1}.`);
	}
	if (leaves.length === 1) {
		return [];
	}
	const split = splitPoint(leaves.length);
	if (index < split) {
		return [
			...auditPath(leaves.slice(0, split), index),
			{ sibling: rootOf(leaves.slice(split)), side: 'right' },
		];
	}
	return [
		...auditPath(leaves.slice(split), index - split),
		{ sibling: rootOf(leaves.slice(0, split)), side: 'left' },
	];
}

/**
 * Everything a tenant needs to prove its head was anchored — and nothing more.
 *
 * The returned object is the entire export: the leaf, the path, the root. No other tenant's
 * `chain_scope_id`, `seq` or head hash appears in it, which is the property ADR-022 was chosen for.
 */
export interface InclusionProof {
	readonly leaf: Buffer;
	readonly path: readonly AuditStep[];
	readonly root: Buffer;
}

export function inclusionProof(
	heads: readonly JournalChainHead[],
	chainScopeId: string
): InclusionProof {
	const sorted = sortedHeads(heads);
	const index = sorted.findIndex((head) => head.chainScopeId === chainScopeId);
	if (index < 0) {
		throw new RangeError(`chain ${chainScopeId} is not among the ${heads.length} heads.`);
	}
	const leaves = sorted.map((head) => merkleLeaf(head));
	return { leaf: leaves[index]!, path: auditPath(leaves, index), root: rootOf(leaves) };
}

/**
 * Recompute the root from a leaf and its path.
 *
 * Takes no head list on purpose — see the header. If this function ever needs one, the tenant-clean
 * proof has been lost.
 */
export function verifyInclusion(proof: InclusionProof): boolean {
	let current = proof.leaf;
	for (const step of proof.path) {
		current =
			step.side === 'right'
				? merkleNode(current, step.sibling)
				: merkleNode(step.sibling, current);
	}
	return current.equals(proof.root);
}

/**
 * Case (d): which chains were in the earlier anchor and are absent from the later one.
 *
 * This is the comparison ADR-022 finding 1 exists for. Because the tree covers **every** chain —
 * including ones that have not moved since the last anchor — a chain that disappears leaves a hole
 * that two consecutive anchors make visible. Under a tree over only the *changed* chains, a deleted
 * tenant and a dormant one would look identical, and the finding would not exist.
 */
export function chainsMissingFromLaterAnchor(
	earlier: readonly JournalChainHead[],
	later: readonly JournalChainHead[]
): string[] {
	const present = new Set(later.map((head) => head.chainScopeId));
	return earlier
		.map((head) => head.chainScopeId)
		.filter((id) => !present.has(id))
		.sort();
}
