import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import { expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import {
	PostgresLedgerWriter,
	chainHash,
	genesisChainHash,
	merkleRoot,
	type LedgerAppendRequest,
} from '@open-archiver/journaling';
import type { JournalChainHead, JournalLedgerRecord } from '@open-archiver/types';
import { acquireTestDatabase } from '../support/pg-harness';
import { postgresTransactor } from '../support/postgres-transactor';
import { seedIngestionSource } from '../support/iam-seed';
import {
	detectSplitBrain,
	readChainHeads,
	readLedgerChain,
	verifyChain,
	verifyStoredObject,
	type LedgerEntry,
} from '../support/ledger-verifier';
import {
	chainsMissingFromLaterAnchor,
	inclusionProof,
	verifyInclusion,
} from '../support/merkle-audit-path';
import {
	FIELDS_UNHASHED_BY_RFC_FORMULA,
	rfcFormulaChainHash,
} from '../support/rfc-formula-encoding';

/**
 * Ledger tamper evidence — `JR-2-09`, Testplan section 12.5 cases (a) to (h). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * The one thing that makes this suite worth running
 * ---------------------------------------------------------------------------------------------
 * Every case here manipulates a **real row in a real database** and then asks an independent walker
 * (`../support/ledger-verifier.ts`) what it sees. The expectation is never "something is wrong": it is
 * the finding kind, the `seq`, and — where a second source of truth exists — the field. A tamper test
 * that asserts only pass/fail cannot distinguish "detected the right thing" from "detected anything",
 * and the difference between those two is the entire evidential value of the ledger.
 *
 * Three of the eight cases are deliberately expected to leave the chain **sound**, and those are the
 * interesting ones:
 *
 *  - (c) a chain rewritten forwards from `seq` N is internally perfect. Only an anchor taken before
 *        the rewrite sees it. That is what anchoring is *for*, and asserting the chain walk stays
 *        green here is the honest way to say so.
 *  - (d) a tenant chain deleted in full leaves nothing behind to break. Only the comparison of two
 *        consecutive Merkle anchors notices, because the tree covers every chain including dormant
 *        ones (ADR-022 finding 1).
 *  - (h) a clone writes a second, internally valid chain from the same genesis. Neither side can be
 *        called the tampered one from the inside, so it is its own finding and not a break
 *        (ADR-006 section 4.3).
 *
 * ---------------------------------------------------------------------------------------------
 * Why the append-only trigger has to be switched off, and what that costs
 * ---------------------------------------------------------------------------------------------
 * Since `JR-2-05` (`0042_journal_ledger_append_only.sql`) `UPDATE`, `DELETE` and `TRUNCATE` on
 * `journal_ledger` are rejected by a trigger. Without disabling it no manipulation in this file is
 * possible at all — and the suite would be **green having tested nothing**, which is the single most
 * expensive way for this file to fail.
 *
 * So `withAppendOnlyDisabled()` disables the trigger, and three things keep that from becoming a hole:
 * it re-enables in a `finally`, it *asserts* the re-enabled state afterwards, and the first case below
 * shows the trigger actually rejecting the same statement when it is on. The disable requires the
 * table owner, which is also the standing finding **F37** (the application connects as owner and can
 * therefore do this itself); ADR-009 assigns the privilege half to E11.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('ledger-tamper') : undefined;

const APPEND_ONLY_TRIGGER = 'journal_ledger_append_only';

const sha256 = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest();

/** `2026-07-31T10:15:30.000Z`. Whole milliseconds only (ADR-006 section 3.1). */
const BASE_MICROS = 1_785_492_930_000_000n;

async function deploymentId(): Promise<string> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

function writerFor(deployment: string): PostgresLedgerWriter {
	return new PostgresLedgerWriter({
		deploymentId: deployment,
		transactor: postgresTransactor(harness!.sql),
	});
}

const request = (
	chainScopeId: string,
	index: number,
	overrides: Partial<LedgerAppendRequest> = {}
): LedgerAppendRequest => ({
	chainScopeId,
	receivedAtMicros: BASE_MICROS + BigInt(index) * 1000n,
	eventType: 'receipt',
	remoteIp: '192.0.2.25',
	ehloName: 'mail.example.com',
	// Null on purpose: case (f) sets it to TLSv1.3, which is the dangerous direction -- a message
	// received in the clear presented as encrypted.
	tlsVersion: null,
	tlsCipher: null,
	envelopeFrom: `sender-${index}@example.com`,
	envelopeRcpt: [`first-${index}@example.com`, `second-${index}@example.com`],
	sizeBytes: BigInt(1024 + index),
	contentSha256: sha256(Buffer.from(`object-${index}`, 'utf8')),
	duplicateOf: null,
	journalingSourceId: null,
	spoolTxId: `01JZZ${String(index).padStart(21, '0')}`,
	eventPayload: { index, phase: 'A' },
	...overrides,
});

/** Append `count` events to a fresh chain and return the chain scope plus what was written. */
async function seedChain(
	deployment: string,
	count: number
): Promise<{ chainScopeId: string; expected: Map<bigint, JournalLedgerRecord> }> {
	const source = await seedIngestionSource(harness!.db);
	const writer = writerFor(deployment);
	const expected = new Map<bigint, JournalLedgerRecord>();
	for (let index = 1; index <= count; index += 1) {
		const sent = request(source.id, index);
		const result = await writer.append(sent);
		expected.set(result.seq, {
			chainScopeId: sent.chainScopeId,
			seq: result.seq,
			receivedAtMicros: sent.receivedAtMicros,
			eventType: sent.eventType,
			remoteIp: sent.remoteIp,
			ehloName: sent.ehloName,
			tlsVersion: sent.tlsVersion,
			tlsCipher: sent.tlsCipher,
			envelopeFrom: sent.envelopeFrom,
			envelopeRcpt: sent.envelopeRcpt,
			sizeBytes: sent.sizeBytes,
			contentSha256: sent.contentSha256,
			duplicateOf: sent.duplicateOf,
			journalingSourceId: sent.journalingSourceId,
			spoolTxId: sent.spoolTxId,
			eventPayload: sent.eventPayload as JournalLedgerRecord['eventPayload'],
		});
	}
	return { chainScopeId: source.id, expected };
}

async function triggerState(sql: Sql): Promise<string> {
	const rows = await sql<{ tgenabled: string }[]>`
		select tgenabled from pg_trigger where tgname = ${APPEND_ONLY_TRIGGER}
	`;
	if (rows.length !== 1) {
		throw new Error(
			`expected exactly one trigger named ${APPEND_ONLY_TRIGGER}, found ${rows.length}. ` +
				`Without it every manipulation below would succeed against an unprotected table and ` +
				`this suite would assert nothing.`
		);
	}
	return rows[0]!.tgenabled;
}

/**
 * Run `fn` with the append-only trigger switched off, and put it back.
 *
 * The `finally` is not enough on its own — a failed re-enable would leave the rest of the file
 * running against an unprotected table — so the state is read back and asserted. `tgenabled` is `'O'`
 * for an enabled trigger and `'D'` for a disabled one.
 */
async function withAppendOnlyDisabled<T>(fn: () => Promise<T>): Promise<T> {
	const sql = harness!.sql;
	expect(await triggerState(sql), 'the append-only trigger was not enabled to begin with').toBe(
		'O'
	);
	await sql.unsafe(`alter table journal_ledger disable trigger ${APPEND_ONLY_TRIGGER}`);
	expect(await triggerState(sql)).toBe('D');
	try {
		return await fn();
	} finally {
		await sql.unsafe(`alter table journal_ledger enable trigger ${APPEND_ONLY_TRIGGER}`);
		expect(
			await triggerState(sql),
			'the append-only trigger was not restored; every later case would run unprotected'
		).toBe('O');
	}
}

suiteRequiring('ci', 'ledger tamper evidence (JR-2-09, Testplan 12.5)', postgresProbe, () => {
	it('rejects the manipulation outright while the append-only trigger is on', async () => {
		// The premise of every other case in this file. If an UPDATE were possible with the trigger
		// enabled, `withAppendOnlyDisabled()` would be theatre; if it were impossible even with the
		// trigger disabled, every case below would be vacuously green.
		const deployment = await deploymentId();
		const { chainScopeId } = await seedChain(deployment, 3);

		await expect(
			harness!.sql`
				update journal_ledger set tls_version = 'TLSv1.3'
				where chain_scope_id = ${chainScopeId} and seq = 2
			`
		).rejects.toThrow(/append-only|journal_ledger/i);

		const stillOn = await withAppendOnlyDisabled(async () => {
			const updated = await harness!.sql`
				update journal_ledger set tls_version = 'TLSv1.3'
				where chain_scope_id = ${chainScopeId} and seq = 2
			`;
			expect(updated.count).toBe(1);
			return true;
		});
		expect(stillOn).toBe(true);
		expect(await triggerState(harness!.sql)).toBe('O');
	});

	it('(a) reports an altered object as an object mismatch, not as a chain break', async () => {
		const deployment = await deploymentId();
		const { chainScopeId } = await seedChain(deployment, 4);
		const chain = await readLedgerChain(harness!.sql, chainScopeId);

		// The ledger row is untouched -- only the bytes it attests changed. In E3 those bytes live in
		// the spool; here they are the buffer whose digest went into the receipt.
		const original = Buffer.from('object-3', 'utf8');
		const tampered = Buffer.from('object-3 with an extra clause', 'utf8');
		const entry = chain.find((candidate) => candidate.record.seq === 3n)!;

		expect(verifyStoredObject(entry, original, sha256)).toBeNull();
		const finding = verifyStoredObject(entry, tampered, sha256);
		expect(finding?.kind).toBe('object_hash_mismatch');
		expect(finding?.seq).toBe(3n);

		// And the chain itself stays sound, which is the half that says where to look: the ledger is
		// still the trustworthy side of the comparison.
		expect(verifyChain({ deploymentId: deployment, chainScopeId, entries: chain })).toEqual([]);
	});

	it('(b) reports a deleted row at the seq that is missing', async () => {
		const deployment = await deploymentId();
		const { chainScopeId } = await seedChain(deployment, 6);

		await withAppendOnlyDisabled(async () => {
			const deleted = await harness!.sql`
				delete from journal_ledger where chain_scope_id = ${chainScopeId} and seq = 4
			`;
			expect(deleted.count).toBe(1);
		});

		const findings = verifyChain({
			deploymentId: deployment,
			chainScopeId,
			entries: await readLedgerChain(harness!.sql, chainScopeId),
		});
		expect(findings[0]?.kind).toBe('missing_entry');
		// The correct seq is the one that is gone -- 4 -- not 5, where the walk first notices.
		expect(findings[0]?.seq).toBe(4n);
	});

	it('(c) a chain rewritten forwards stays internally sound and is caught only by the anchor', async () => {
		const deployment = await deploymentId();
		const { chainScopeId } = await seedChain(deployment, 8);
		const before = await readLedgerChain(harness!.sql, chainScopeId);

		// The anchor, taken before the rewrite. In E7/E8 this root goes into an RFC-3161 token; here
		// it is simply held in a variable, which is all the case needs: the point is that the value
		// left the system before the manipulation.
		const headsBefore = await readChainHeads(harness!.sql);
		const anchoredRoot = merkleRoot(headsBefore as JournalChainHead[]);
		const anchoredHead = headsBefore.find((head) => head.chainScopeId === chainScopeId)!;

		const REWRITE_FROM = 5n;
		await withAppendOnlyDisabled(async () => {
			// Rewrite seq 5 and re-chain 6..8 on top of it, exactly as a competent attacker would.
			let prev = before.find((entry) => entry.record.seq === REWRITE_FROM - 1n)!.stored;
			for (const entry of before.filter(
				(candidate) => candidate.record.seq >= REWRITE_FROM
			)) {
				const record: JournalLedgerRecord =
					entry.record.seq === REWRITE_FROM
						? { ...entry.record, envelopeFrom: 'rewritten@example.com' }
						: entry.record;
				const rehashed = chainHash(record, prev);
				await harness!.sql`
					update journal_ledger
					   set envelope_from = ${record.envelopeFrom},
					       prev_chain_hash = ${prev},
					       chain_hash = ${rehashed}
					 where chain_scope_id = ${chainScopeId}
					   and seq = ${record.seq.toString()}::bigint
				`;
				prev = rehashed;
			}
		});

		// The rewritten chain verifies. That is not a defect in the verifier -- it is the property
		// that makes anchoring necessary, and stating it as an assertion keeps anyone from concluding
		// that the chain hash alone is sufficient.
		const after = await readLedgerChain(harness!.sql, chainScopeId);
		expect(
			verifyChain({ deploymentId: deployment, chainScopeId, entries: after }),
			'a forward rewrite must leave an internally valid chain -- otherwise this case is not the case'
		).toEqual([]);
		expect(after.find((entry) => entry.record.seq === REWRITE_FROM)!.record.envelopeFrom).toBe(
			'rewritten@example.com'
		);

		// The anchor is where it shows. The head's seq is unchanged, its hash is not, so the leaf
		// differs and the inclusion proof against the anchored root fails.
		const headsAfter = await readChainHeads(harness!.sql);
		const headAfter = headsAfter.find((head) => head.chainScopeId === chainScopeId)!;
		expect(headAfter.headSeq).toBe(anchoredHead.headSeq);
		expect(headAfter.headChainHash.equals(anchoredHead.headChainHash)).toBe(false);
		expect(merkleRoot(headsAfter as JournalChainHead[]).equals(anchoredRoot)).toBe(false);
	});

	it('(d) reports a fully deleted tenant chain as absent from the later anchor', async () => {
		const deployment = await deploymentId();
		// Three chains so that the deleted one is not the whole tree, and one of the survivors stays
		// completely dormant between the two anchors -- the case a tree over only *changed* chains
		// could not tell apart from a deletion.
		const doomed = await seedChain(deployment, 3);
		const dormant = await seedChain(deployment, 2);
		const active = await seedChain(deployment, 2);

		const headsBefore = await readChainHeads(harness!.sql);

		await withAppendOnlyDisabled(async () => {
			const deleted = await harness!.sql`
				delete from journal_ledger where chain_scope_id = ${doomed.chainScopeId}
			`;
			expect(deleted.count).toBe(3);
		});
		await writerFor(deployment).append(request(active.chainScopeId, 99));

		const headsAfter = await readChainHeads(harness!.sql);
		const missing = chainsMissingFromLaterAnchor(
			headsBefore as JournalChainHead[],
			headsAfter as JournalChainHead[]
		);

		expect(missing).toEqual([doomed.chainScopeId]);
		// The dormant chain is present in both anchors with an identical head -- the discriminator
		// that makes "deleted" different from "quiet".
		expect(missing).not.toContain(dormant.chainScopeId);
		const dormantBefore = headsBefore.find((h) => h.chainScopeId === dormant.chainScopeId)!;
		const dormantAfter = headsAfter.find((h) => h.chainScopeId === dormant.chainScopeId)!;
		expect(dormantAfter.headChainHash.equals(dormantBefore.headChainHash)).toBe(true);

		// Nothing else broke: the deletion leaves no trace inside any surviving chain, which is why
		// it needs the anchor comparison at all.
		for (const survivor of [dormant, active]) {
			expect(
				verifyChain({
					deploymentId: deployment,
					chainScopeId: survivor.chainScopeId,
					entries: await readLedgerChain(harness!.sql, survivor.chainScopeId),
				})
			).toEqual([]);
		}
	});

	it('proves one tenant included without any data about the others -- the promise of ADR-007', async () => {
		// Testplan section 12.5 calls this "the actual promise". The proof object is built from all
		// heads, but what the verifier receives is the leaf, the siblings and the root; if this ever
		// needed a head list to check, tenant separation would be a claim rather than a property.
		const deployment = await deploymentId();
		const chains = [];
		for (let n = 0; n < 5; n += 1) {
			chains.push(await seedChain(deployment, 1 + n));
		}
		const heads = (await readChainHeads(harness!.sql)) as JournalChainHead[];
		expect(heads.length).toBeGreaterThanOrEqual(5);

		const root = merkleRoot(heads);
		for (const chain of chains) {
			const proof = inclusionProof(heads, chain.chainScopeId);
			expect(
				proof.root.equals(root),
				'the independent path implementation disagrees on the root'
			).toBe(true);
			expect(verifyInclusion(proof)).toBe(true);
			// The sibling hashes are opaque: no other chain's identifier or seq appears in the proof.
			const serialised = JSON.stringify({
				leaf: proof.leaf.toString('hex'),
				path: proof.path.map((step) => [step.side, step.sibling.toString('hex')]),
			});
			for (const other of chains) {
				if (other.chainScopeId !== chain.chainScopeId) {
					expect(serialised).not.toContain(other.chainScopeId);
				}
			}
		}
	});

	it('(e) rejects an inclusion proof whose path was altered', async () => {
		const deployment = await deploymentId();
		for (let n = 0; n < 5; n += 1) {
			await seedChain(deployment, 1);
		}
		const heads = (await readChainHeads(harness!.sql)) as JournalChainHead[];
		const target = heads[2]!.chainScopeId;
		const proof = inclusionProof(heads, target);
		expect(verifyInclusion(proof)).toBe(true);
		expect(proof.path.length).toBeGreaterThan(0);

		// One bit in one sibling. Nothing about the leaf or the root changes.
		const flipped = Buffer.from(proof.path[0]!.sibling);
		flipped[0] ^= 0x01;
		expect(
			verifyInclusion({
				...proof,
				path: [{ ...proof.path[0]!, sibling: flipped }, ...proof.path.slice(1)],
			})
		).toBe(false);

		// Swapping a sibling's side is the subtler variant: the same hashes, a different tree.
		if (proof.path.length > 0) {
			const swapped = proof.path.map((step, index) =>
				index === 0
					? {
							...step,
							side: step.side === 'left' ? ('right' as const) : ('left' as const),
						}
					: step
			);
			expect(verifyInclusion({ ...proof, path: swapped })).toBe(false);
		}
	});

	it('(f) detects tls_version moved from NULL to TLSv1.3, at the right seq and field', async () => {
		// The dangerous one: it presents a message received in the clear as TLS-protected, and under
		// the RFC's eight-field formula it would be invisible. The counter-check below proves that
		// claim rather than repeating it.
		const deployment = await deploymentId();
		const { chainScopeId, expected } = await seedChain(deployment, 5);

		await withAppendOnlyDisabled(async () => {
			await harness!.sql`
				update journal_ledger set tls_version = 'TLSv1.3'
				where chain_scope_id = ${chainScopeId} and seq = 3
			`;
		});

		const findings = verifyChain({
			deploymentId: deployment,
			chainScopeId,
			entries: await readLedgerChain(harness!.sql, chainScopeId),
			expectedRecords: expected,
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]!.kind).toBe('row_hash_mismatch');
		expect(findings[0]!.seq).toBe(3n);
		expect(findings[0]!.kind === 'row_hash_mismatch' && findings[0]!.fields).toEqual([
			'tlsVersion',
		]);
	});

	it('(g) detects a rewritten remote_ip, at the right seq and field', async () => {
		const deployment = await deploymentId();
		const { chainScopeId, expected } = await seedChain(deployment, 5);

		await withAppendOnlyDisabled(async () => {
			await harness!.sql`
				update journal_ledger set remote_ip = '203.0.113.9'
				where chain_scope_id = ${chainScopeId} and seq = 2
			`;
		});

		const findings = verifyChain({
			deploymentId: deployment,
			chainScopeId,
			entries: await readLedgerChain(harness!.sql, chainScopeId),
			expectedRecords: expected,
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]!.kind).toBe('row_hash_mismatch');
		expect(findings[0]!.seq).toBe(2n);
		expect(findings[0]!.kind === 'row_hash_mismatch' && findings[0]!.fields).toEqual([
			'remoteIp',
		]);
	});

	it('(f)+(g) would both be undetectable under the eight-field RFC formula', async () => {
		// The counter-check Testplan section 12.5 requires: "both cases must first have been seen red
		// against an implementation following the RFC formula". Rather than having done that once by
		// hand, the rejected formula is implemented in ../support/rfc-formula-encoding.ts and the
		// comparison runs on every CI run.
		const deployment = await deploymentId();
		const { chainScopeId } = await seedChain(deployment, 4);
		const chain = await readLedgerChain(harness!.sql, chainScopeId);
		const entry = chain.find((candidate) => candidate.record.seq === 2n)!;

		const tampered: LedgerEntry[] = [
			{
				...entry,
				record: { ...entry.record, tlsVersion: 'TLSv1.3', remoteIp: '203.0.113.9' },
			},
		];

		// Under ADR-006's sixteen fields, both edits change the hash.
		expect(chainHash(tampered[0]!.record, entry.prev).equals(entry.stored)).toBe(false);

		// Under the RFC's eight, neither does -- the row still hashes to exactly what is stored, so a
		// verifier built to the RFC would pass the tampered chain.
		const rfcOriginal = rfcFormulaChainHash(entry.record, entry.prev);
		const rfcTampered = rfcFormulaChainHash(tampered[0]!.record, entry.prev);
		expect(
			rfcTampered.equals(rfcOriginal),
			'the RFC formula must be insensitive to these fields -- otherwise the counter-check is not one'
		).toBe(true);

		// Stated as the list rather than as two field names, so that narrowing the encoding towards
		// the RFC in any of the eight directions fails here.
		expect(FIELDS_UNHASHED_BY_RFC_FORMULA).toContain('tlsVersion');
		expect(FIELDS_UNHASHED_BY_RFC_FORMULA).toContain('remoteIp');
		for (const field of FIELDS_UNHASHED_BY_RFC_FORMULA) {
			// Every one of them is hashed by the production encoding. `chainScopeId` needs a valid
			// UUID and the numeric ones a number, so the probe value is chosen per field.
			const probe: JournalLedgerRecord = {
				...entry.record,
				...(field === 'chainScopeId'
					? { chainScopeId: '00000000-0000-4000-8000-000000000000' }
					: field === 'duplicateOf'
						? { duplicateOf: 1n }
						: field === 'journalingSourceId'
							? { journalingSourceId: '00000000-0000-4000-8000-000000000001' }
							: field === 'remoteIp'
								? { remoteIp: '203.0.113.9' }
								: { [field]: 'changed' }),
			};
			expect(
				chainHash(probe, entry.prev).equals(entry.stored),
				`${field} is not covered by the production encoding -- the RFC's blind spot is back`
			).toBe(false);
		}
	});

	it('(h) reports two chains sharing a genesis as split-brain, not as a chain break', async () => {
		const deployment = await deploymentId();
		const { chainScopeId } = await seedChain(deployment, 5);
		const original = await readLedgerChain(harness!.sql, chainScopeId);

		// The clone: same deployment identity, same chain scope, same history up to seq 3, then it
		// keeps writing on its own. Computed rather than stored, because the primary key
		// (chain_scope_id, seq) makes two versions of one chain impossible in one database -- which is
		// the point: the two halves of a split brain live on two servers, and only an anchor or an
		// export brings them face to face.
		const DIVERGE_AT = 4n;
		const clone: LedgerEntry[] = [];
		let prev = genesisChainHash(deployment, chainScopeId);
		for (const entry of original) {
			const record: JournalLedgerRecord =
				entry.record.seq >= DIVERGE_AT
					? { ...entry.record, envelopeFrom: `clone-${entry.record.seq}@example.com` }
					: entry.record;
			const hash = chainHash(record, prev);
			clone.push({ record, prev, stored: hash });
			prev = hash;
		}

		// Both sides are internally valid. That is what makes this its own finding: there is no
		// break to point at, and calling one of them "tampered" would be a guess.
		expect(verifyChain({ deploymentId: deployment, chainScopeId, entries: original })).toEqual(
			[]
		);
		expect(verifyChain({ deploymentId: deployment, chainScopeId, entries: clone })).toEqual([]);

		const finding = detectSplitBrain(original, clone);
		expect(finding?.kind).toBe('split_brain');
		expect(finding?.seq).toBe(DIVERGE_AT);

		// And the guard rail: two ordinary tenant chains, with different genesis hashes, must never be
		// reported as a split brain no matter how much they differ.
		const other = await seedChain(deployment, 5);
		expect(
			detectSplitBrain(original, await readLedgerChain(harness!.sql, other.chainScopeId))
		).toBeNull();
	});
});
