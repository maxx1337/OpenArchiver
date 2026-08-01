import type { Sql } from 'postgres';
import { chainHash, genesisChainHash } from '@open-archiver/journaling';
import type { JournalLedgerRecord } from '@open-archiver/types';

/**
 * Reading a ledger chain back and judging it (`JR-2-08`, `JR-2-09`).
 *
 * ---------------------------------------------------------------------------------------------
 * What this is, and what it deliberately is not
 * ---------------------------------------------------------------------------------------------
 * This is the smallest thing that can be called a verifier: read the rows, recompute every hash
 * from the values that were stored, and report the **first** divergence with its `seq` and — where
 * a second source of truth exists — the field. Testplan section 12.5 asks for exactly that, and
 * `JR-2-09` cannot make a statement about tamper evidence without something that judges.
 *
 * It is **not** E9's `verify`. E9 owns the CLI, the exit codes, the object store and the anchor
 * table; this walks a chain that a test just wrote. Two consequences worth stating rather than
 * discovering later:
 *
 *  - The chain hashing itself comes from `@open-archiver/journaling` — `chainHash()` and
 *    `genesisChainHash()`, the production functions. A verifier with its own copy of the encoding
 *    would agree with itself and prove nothing.
 *  - The **loop** around them is written here, independently of the writer. That is the part that
 *    has to be a second implementation, and it is why this file does not import anything from
 *    `ledger-writer.ts`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why naming the changed *field* needs a second source, and where it comes from
 * ---------------------------------------------------------------------------------------------
 * A chain hash commits to all sixteen fields at once. When it does not match, the ledger alone says
 * "row `seq` N does not hash to its stored value" — it cannot say **which** field moved, because
 * every field is equally consistent with the bytes that are there now. Anything else would be
 * guessing, and a verifier that guesses is worse than one that admits the limit.
 *
 * So field-level attribution takes a second, independent record of what was written, passed in as
 * `expectedRecords`. In these tests that is what the test itself appended; in E9 it is the export
 * manifest and the stored object (RFC section 8: `content_sha256` over the plaintext wire bytes is
 * verifiable against a re-export). The distinction matters for what `JR-2-09` may claim: the ledger
 * proves *that* and *where*, the second source proves *what*.
 */

/** One ledger row, in the shape the chain hashing consumes. */
export interface LedgerEntry {
	readonly record: JournalLedgerRecord;
	/** `prev_chain_hash` as stored. */
	readonly prev: Buffer;
	/** `chain_hash` as stored. */
	readonly stored: Buffer;
}

/**
 * The findings this verifier can produce.
 *
 * They are separate kinds rather than one "invalid" with a message, because Testplan section 12.5
 * requires cases (d) and (h) to be **their own** finding types and not "chain break": a tenant whose
 * chain vanished and a cloned server are different accusations with different remedies, and
 * collapsing them into the generic one is how a report stops being actionable.
 */
export type LedgerFinding =
	| {
			/** The chain's first row is not chained to the genesis hash of this deployment and scope. */
			readonly kind: 'genesis_mismatch';
			readonly seq: bigint;
			readonly detail: string;
	  }
	| {
			/** A `seq` that must exist does not. The chain is gapless by construction, so this is tamper. */
			readonly kind: 'missing_entry';
			readonly seq: bigint;
			readonly detail: string;
	  }
	| {
			/** Row `seq` does not point at row `seq - 1`'s hash. */
			readonly kind: 'chain_break';
			readonly seq: bigint;
			readonly detail: string;
	  }
	| {
			/** Row `seq` does not hash to its own stored `chain_hash`. Some hashed field moved. */
			readonly kind: 'row_hash_mismatch';
			readonly seq: bigint;
			/** Which fields moved — only when a second source of truth was supplied. See the header. */
			readonly fields: readonly string[] | null;
			readonly detail: string;
	  }
	| {
			/** The stored object's bytes do not hash to the `content_sha256` in the receipt. */
			readonly kind: 'object_hash_mismatch';
			readonly seq: bigint;
			readonly detail: string;
	  }
	| {
			/** Two chains share a genesis and diverge. A clone, not a break (ADR-006 section 4.3). */
			readonly kind: 'split_brain';
			readonly seq: bigint;
			readonly detail: string;
	  };

/**
 * The sixteen hashed fields, by the names ADR-006 section 2 fixes them in.
 *
 * Order matters here as well: it is the order of the encoding, so a diff reports fields in the same
 * sequence they are hashed in. Kept as a literal list rather than derived from a record instance,
 * because `Object.keys()` of a record with a `null` field would still list it, but a *missing* key
 * would silently disappear — and a field silently dropped from the comparison is the failure mode
 * this list exists to prevent.
 */
export const HASHED_FIELDS = [
	'chainScopeId',
	'seq',
	'receivedAtMicros',
	'eventType',
	'remoteIp',
	'ehloName',
	'tlsVersion',
	'tlsCipher',
	'envelopeFrom',
	'envelopeRcpt',
	'sizeBytes',
	'contentSha256',
	'duplicateOf',
	'journalingSourceId',
	'spoolTxId',
	'eventPayload',
] as const satisfies readonly (keyof JournalLedgerRecord)[];

function sameValue(left: unknown, right: unknown): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	if (left instanceof Uint8Array && right instanceof Uint8Array) {
		return Buffer.from(left).equals(Buffer.from(right));
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((value, index) => value === right[index]);
	}
	if (typeof left === 'object' && typeof right === 'object') {
		return JSON.stringify(left) === JSON.stringify(right);
	}
	return left === right;
}

/**
 * Which of the sixteen hashed fields differ between what was written and what is stored now.
 *
 * Compares **every** field rather than stopping at the first: a tamper report that names one of two
 * changed fields invites the reader to fix that one and re-run.
 */
export function locateChangedFields(
	expected: JournalLedgerRecord,
	actual: JournalLedgerRecord
): string[] {
	return HASHED_FIELDS.filter((field) => !sameValue(expected[field], actual[field]));
}

export interface VerifyChainOptions {
	readonly deploymentId: string;
	readonly chainScopeId: string;
	/** Ascending by `seq`. `readLedgerChain()` guarantees it; a hand-built array must too. */
	readonly entries: readonly LedgerEntry[];
	/**
	 * An independent record of what was appended, keyed by `seq`. Optional, and its absence is not a
	 * weaker check — only a less specific report. See the header for why the ledger alone cannot name
	 * a field.
	 */
	readonly expectedRecords?: ReadonlyMap<bigint, JournalLedgerRecord>;
	/**
	 * How far the chain must reach. Without it a chain truncated at the **end** verifies happily:
	 * every remaining row is consistent, and nothing in the rows themselves says one is missing.
	 * `JR-2-09` case (b) deletes a middle row, which is caught regardless — but the truncation case is
	 * the one that needs an external expectation, and an anchor is what supplies it in production.
	 */
	readonly expectedLength?: number;
}

/**
 * Walk a chain and return its findings, first divergence first.
 *
 * Stops at the first finding **per row** but keeps walking, so a chain with two independent
 * manipulations reports both. It does not keep walking past a gap: after a missing entry every
 * subsequent `prev` mismatch is a consequence of that gap rather than a separate accusation, and
 * reporting them all would bury the one that matters.
 */
export function verifyChain(options: VerifyChainOptions): LedgerFinding[] {
	const { deploymentId, chainScopeId, entries, expectedRecords } = options;
	const findings: LedgerFinding[] = [];
	const genesis = genesisChainHash(deploymentId, chainScopeId);

	let expectedSeq = 1n;
	let expectedPrev: Buffer = genesis;

	for (const entry of entries) {
		if (entry.record.seq !== expectedSeq) {
			findings.push({
				kind: 'missing_entry',
				seq: expectedSeq,
				detail:
					`chain ${chainScopeId}: expected seq ${expectedSeq}, next stored row is ` +
					`${entry.record.seq}. The chain is gapless by construction, so a gap is not a ` +
					`benign omission.`,
			});
			// Everything downstream is chained to a row that is no longer there; walking on would
			// report that as a second, independent break.
			return findings;
		}

		if (!entry.prev.equals(expectedPrev)) {
			findings.push({
				kind: expectedSeq === 1n ? 'genesis_mismatch' : 'chain_break',
				seq: entry.record.seq,
				detail:
					`chain ${chainScopeId} seq ${entry.record.seq}: prev_chain_hash is ` +
					`${entry.prev.toString('hex')}, expected ${expectedPrev.toString('hex')}.`,
			});
		}

		// Recompute from the row's **own** prev, not from the expected one: otherwise a broken link
		// would be reported a second time as a hash mismatch, and the two are different defects.
		const recomputed = chainHash(entry.record, entry.prev);
		if (!recomputed.equals(entry.stored)) {
			const expectedRecord = expectedRecords?.get(entry.record.seq);
			const fields = expectedRecord
				? locateChangedFields(expectedRecord, entry.record)
				: null;
			findings.push({
				kind: 'row_hash_mismatch',
				seq: entry.record.seq,
				fields,
				detail:
					`chain ${chainScopeId} seq ${entry.record.seq}: the row hashes to ` +
					`${recomputed.toString('hex')} but stores ${entry.stored.toString('hex')}` +
					(fields === null
						? '. No second source of truth was supplied, so the changed field cannot be named.'
						: `. Changed field(s): ${fields.length > 0 ? fields.join(', ') : 'none — the stored hash was altered, not the values'}.`),
			});
		}

		expectedPrev = entry.stored;
		expectedSeq += 1n;
	}

	if (options.expectedLength !== undefined && entries.length !== options.expectedLength) {
		findings.push({
			kind: 'missing_entry',
			seq: BigInt(entries.length + 1),
			detail:
				`chain ${chainScopeId} ends at seq ${entries.length}, but ${options.expectedLength} ` +
				`entries were expected. A chain truncated at the end is internally consistent — only ` +
				`an external record of its length, an anchor in production, can see it.`,
		});
	}

	return findings;
}

/**
 * Case (a) of Testplan section 12.5: the receipt is intact, the object it attests is not.
 *
 * Deliberately a separate check with a separate finding. The chain is untouched in this case and
 * `verifyChain()` says so correctly; reporting "chain break" here would point an auditor at the
 * ledger when the ledger is the only thing still trustworthy.
 */
export function verifyStoredObject(
	entry: LedgerEntry,
	objectBytes: Uint8Array,
	sha256: (bytes: Uint8Array) => Buffer
): LedgerFinding | null {
	const receipted = entry.record.contentSha256;
	if (receipted === null) {
		return null;
	}
	const actual = sha256(objectBytes);
	if (actual.equals(Buffer.from(receipted))) {
		return null;
	}
	return {
		kind: 'object_hash_mismatch',
		seq: entry.record.seq,
		detail:
			`seq ${entry.record.seq}: the stored object hashes to ${actual.toString('hex')}, the ` +
			`receipt records ${Buffer.from(receipted).toString('hex')}. The ledger row is intact; ` +
			`the object is not.`,
	};
}

/**
 * Case (h): two chains that share a genesis and disagree — a restored or cloned deployment writing
 * on with the same identity (ADR-006 section 4.3).
 *
 * Reported as its own kind, and the guard rails matter as much as the detection:
 *
 *  - **Both chains must verify on their own.** A clone produces two internally *valid* chains; that
 *    is precisely what makes it undetectable from inside either one. If either side has a break,
 *    this is an ordinary tamper case and saying "split brain" would misdirect.
 *  - **The genesis must be identical.** Two chains with different genesis hashes are two chains, not
 *    a fork — that is the normal multi-tenant case and must never be reported.
 */
export function detectSplitBrain(
	left: readonly LedgerEntry[],
	right: readonly LedgerEntry[]
): LedgerFinding | null {
	if (left.length === 0 || right.length === 0) {
		return null;
	}
	if (!left[0]!.prev.equals(right[0]!.prev)) {
		return null;
	}
	const shared = Math.min(left.length, right.length);
	for (let index = 0; index < shared; index += 1) {
		const a = left[index]!;
		const b = right[index]!;
		if (a.stored.equals(b.stored)) {
			continue;
		}
		return {
			kind: 'split_brain',
			seq: a.record.seq,
			detail:
				`two chains share the genesis hash ${left[0]!.prev.toString('hex')} and diverge at ` +
				`seq ${a.record.seq}: ${a.stored.toString('hex')} versus ${b.stored.toString('hex')}. ` +
				`Both are internally valid, so neither can be called the tampered one from the inside — ` +
				`this is a clone or a restore that kept writing, and it is a finding, not a break.`,
		};
	}
	return null;
}

/**
 * Read a chain back as the records the encoding hashes.
 *
 * `received_at` is read as **microseconds via numeric arithmetic**, not as a `Date`: `extract`
 * returns `numeric` on PostgreSQL 14 and later, so the value is exact, while a `Date` would truncate
 * to milliseconds and could not reproduce the hash of a chain that stored anything finer.
 *
 * Note `ORDER BY journal_ledger.seq` — qualified, and that is not decoration. The projection aliases
 * `seq::text AS seq`, and an unqualified `ORDER BY seq` binds to that **text** alias, sorting
 * 1, 10, 2, 3… That happened during `JR-2-06` and reported a chain break at seq 10 that did not
 * exist. The dangerous direction is the mirror image: read in the wrong order, a real break can be
 * hidden. `JR-2-08` writes ten thousand rows into one chain, so it is the first place where a
 * lexicographic sort would be catastrophic rather than merely wrong.
 */
export async function readLedgerChain(sql: Sql, chainScopeId: string): Promise<LedgerEntry[]> {
	const rows = await sql<
		{
			chain_scope_id: string;
			seq: string;
			received_micros: string;
			event_type: JournalLedgerRecord['eventType'];
			remote_ip: string | null;
			ehlo_name: string | null;
			tls_version: string | null;
			tls_cipher: string | null;
			envelope_from: string | null;
			envelope_rcpt: string[] | null;
			size_bytes: string | null;
			content_sha256: Uint8Array | null;
			duplicate_of: string | null;
			journaling_source_id: string | null;
			spool_txid: string | null;
			event_payload: Record<string, unknown> | null;
			prev_chain_hash: Uint8Array;
			chain_hash: Uint8Array;
		}[]
	>`
		select
			chain_scope_id,
			seq::text as seq,
			(extract(epoch from received_at) * 1000000)::bigint::text as received_micros,
			event_type, remote_ip, ehlo_name, tls_version, tls_cipher,
			envelope_from, envelope_rcpt, size_bytes::text as size_bytes, content_sha256,
			duplicate_of::text as duplicate_of, journaling_source_id, spool_txid, event_payload,
			prev_chain_hash, chain_hash
		from journal_ledger
		where chain_scope_id = ${chainScopeId}
		order by journal_ledger.seq asc
	`;
	return rows.map((row) => ({
		record: {
			chainScopeId: row.chain_scope_id,
			seq: BigInt(row.seq),
			receivedAtMicros: BigInt(row.received_micros),
			eventType: row.event_type,
			remoteIp: row.remote_ip,
			ehloName: row.ehlo_name,
			tlsVersion: row.tls_version,
			tlsCipher: row.tls_cipher,
			envelopeFrom: row.envelope_from,
			envelopeRcpt: row.envelope_rcpt,
			sizeBytes: row.size_bytes === null ? null : BigInt(row.size_bytes),
			contentSha256: row.content_sha256,
			duplicateOf: row.duplicate_of === null ? null : BigInt(row.duplicate_of),
			journalingSourceId: row.journaling_source_id,
			spoolTxId: row.spool_txid,
			eventPayload: row.event_payload as JournalLedgerRecord['eventPayload'],
		},
		prev: Buffer.from(row.prev_chain_hash),
		stored: Buffer.from(row.chain_hash),
	}));
}

/**
 * Every chain's head, as the Merkle aggregate needs them (ADR-022).
 *
 * `DISTINCT ON` over `(chain_scope_id)` ordered by `seq DESC` takes the head of each chain in one
 * pass. The head's `seq` and `chain_hash` come from the **same row** by construction — assembling a
 * head from `max(seq)` and a separately selected hash is how a head from two different rows gets
 * built.
 */
export async function readChainHeads(
	sql: Sql
): Promise<{ chainScopeId: string; headSeq: bigint; headChainHash: Buffer }[]> {
	const rows = await sql<{ chain_scope_id: string; seq: string; chain_hash: Uint8Array }[]>`
		select distinct on (chain_scope_id)
			chain_scope_id, seq::text as seq, chain_hash
		from journal_ledger
		order by chain_scope_id, journal_ledger.seq desc
	`;
	return rows.map((row) => ({
		chainScopeId: row.chain_scope_id,
		headSeq: BigInt(row.seq),
		headChainHash: Buffer.from(row.chain_hash),
	}));
}
