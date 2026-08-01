import { expect, it } from 'vitest';
import {
	chainHash,
	genesisChainHash,
	type LedgerAppendRequest,
	type LedgerBackend,
} from '@open-archiver/journaling';
import type { JournalLedgerRecord } from '@open-archiver/types';

/**
 * The contract every `LedgerBackend` owes, whichever variant of RFC section 5.4 it is (`JR-207`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why the assertions only look at return values
 * ---------------------------------------------------------------------------------------------
 * Deliberately, and it is the whole design of this file: nothing below reads a table, opens a file or
 * knows what storage looks like. A contract that inspected rows would be a Postgres contract wearing a
 * general name, and it could not be run against variant (b) — which is precisely the claim `JR-207` has
 * to substantiate.
 *
 * What `append()` returns is enough, because `seq`, `prevChainHash` and `chainHash` are the chain. If
 * those three are right for every append, the chain is right; where the bytes were put is the
 * implementation's business.
 *
 * The storage-facing half is not skipped, it is elsewhere and stays there:
 * `journal-ledger-writer.int.test.ts` re-reads every column, re-encodes and re-hashes it, which is the
 * check that a timestamp keeping its microseconds or an array keeping its order actually survived
 * Postgres. Those are properties of variant (a), so they are tested against variant (a).
 *
 * ---------------------------------------------------------------------------------------------
 * What a variant (b) implementation additionally owes
 * ---------------------------------------------------------------------------------------------
 * Passing this contract means the **signature** fits, which is what "retrofittable without a signature
 * change" claims and all it claims. It does not mean the implementation is durable, and an in-memory
 * backend passes it. The durability obligations are listed in `ledger-port.ts`; a WAL implementation
 * that satisfies this suite and skips that list would be worse than useless, because it would look
 * correct.
 */

/** A fresh, empty backend plus two distinct chain identifiers to append into. */
export interface LedgerBackendFixture {
	readonly backend: LedgerBackend;
	readonly deploymentId: string;
	readonly chainA: string;
	readonly chainB: string;
}

/** `2026-07-31T10:15:30.123Z`. A whole millisecond, as ADR-006 section 3.1 requires. */
const BASE_MICROS = 1_785_492_930_123_000n;

export function contractRequest(
	chainScopeId: string,
	overrides: Partial<LedgerAppendRequest> = {}
): LedgerAppendRequest {
	return {
		chainScopeId,
		receivedAtMicros: BASE_MICROS,
		eventType: 'receipt',
		remoteIp: '192.0.2.25',
		ehloName: 'mail.example.com',
		tlsVersion: 'TLSv1.3',
		tlsCipher: 'TLS_AES_256_GCM_SHA384',
		envelopeFrom: 'sender@example.com',
		envelopeRcpt: ['first@example.com', 'second@example.com'],
		sizeBytes: 4096n,
		contentSha256: null,
		duplicateOf: null,
		journalingSourceId: null,
		spoolTxId: null,
		eventPayload: null,
		...overrides,
	};
}

/** Rebuild the record the backend must have hashed, from the request plus the `seq` it returned. */
function expectedRecord(request: LedgerAppendRequest, seq: bigint): JournalLedgerRecord {
	return {
		chainScopeId: request.chainScopeId,
		seq,
		receivedAtMicros: request.receivedAtMicros,
		eventType: request.eventType,
		remoteIp: request.remoteIp,
		ehloName: request.ehloName,
		tlsVersion: request.tlsVersion,
		tlsCipher: request.tlsCipher,
		envelopeFrom: request.envelopeFrom,
		envelopeRcpt: request.envelopeRcpt,
		sizeBytes: request.sizeBytes,
		contentSha256: request.contentSha256,
		duplicateOf: request.duplicateOf,
		journalingSourceId: request.journalingSourceId,
		spoolTxId: request.spoolTxId,
		eventPayload: (request.eventPayload as JournalLedgerRecord['eventPayload']) ?? null,
	};
}

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');

/**
 * Declare the contract cases. Call from inside a `suite(...)` so the class label is the caller's.
 *
 * `makeFixture` must hand back an **empty** chain pair each time; the cases assume they start at seq 1.
 */
export function ledgerBackendContractCases(makeFixture: () => Promise<LedgerBackendFixture>): void {
	it('starts an empty chain at seq 1, chained to the genesis hash', async () => {
		const { backend, deploymentId, chainA } = await makeFixture();
		const result = await backend.append(contractRequest(chainA));

		expect(result.seq).toBe(1n);
		expect(hex(result.prevChainHash)).toBe(hex(genesisChainHash(deploymentId, chainA)));
	});

	it('returns a chain hash reproducible from the request and the seq it assigned', async () => {
		// This is what binds any implementation to the canonical encoding of ADR-006. A backend that
		// hashed something else -- a different field order, a JSON dump, its own idea of a timestamp --
		// would still return a plausible 32 bytes and fail only here.
		const { backend, deploymentId, chainA } = await makeFixture();
		const request = contractRequest(chainA, {
			contentSha256: Buffer.alloc(32, 7),
			eventPayload: { phase: 'A', parse_failed: false },
			spoolTxId: '01JZZ0000000000000000000AA',
		});

		const result = await backend.append(request);
		const recomputed = chainHash(
			expectedRecord(request, result.seq),
			genesisChainHash(deploymentId, chainA)
		);
		expect(hex(result.chainHash)).toBe(hex(recomputed));
	});

	it('advances seq by one and links each entry to its predecessor', async () => {
		const { backend, chainA } = await makeFixture();

		let previous = await backend.append(contractRequest(chainA));
		for (let index = 2; index <= 5; index += 1) {
			const current = await backend.append(contractRequest(chainA));
			expect(current.seq).toBe(BigInt(index));
			// The link, and the only thing that makes it a chain: this entry's predecessor is the
			// previous entry's hash.
			expect(hex(current.prevChainHash)).toBe(hex(previous.chainHash));
			previous = current;
		}
	});

	it('keeps chains independent: own seq, own genesis (ADR-007)', async () => {
		const { backend, deploymentId, chainA, chainB } = await makeFixture();

		const firstA = await backend.append(contractRequest(chainA));
		const firstB = await backend.append(contractRequest(chainB));

		// seq runs per chain, not globally -- a global seq would be a second, hidden serialisation
		// point (ADR-007 consequence 1).
		expect(firstA.seq).toBe(1n);
		expect(firstB.seq).toBe(1n);

		// Identical first events, different chains, therefore different hashes. Without chainScopeId
		// in the genesis these would collide and an entry could be moved between tenants without
		// breaking either chain (ADR-007 consequence 3).
		expect(hex(firstB.prevChainHash)).not.toBe(hex(firstA.prevChainHash));
		expect(hex(firstB.chainHash)).not.toBe(hex(firstA.chainHash));
		expect(hex(firstB.prevChainHash)).toBe(hex(genesisChainHash(deploymentId, chainB)));

		// And appending to B does not disturb A.
		const secondA = await backend.append(contractRequest(chainA));
		expect(secondA.seq).toBe(2n);
		expect(hex(secondA.prevChainHash)).toBe(hex(firstA.chainHash));
	});

	it('serialises concurrent appends to one chain into a gapless chain', async () => {
		// The invariant RFC section 5.2 states as "writes must be serialized", holding per chain since
		// ADR-007. Concurrency is where a ledger fails silently: two appends reading the same head
		// produce two entries claiming the same predecessor, and one of them is quietly wrong while
		// both look fine on their own.
		const { backend, chainA } = await makeFixture();
		const count = 12;

		const results = await Promise.all(
			Array.from({ length: count }, () => backend.append(contractRequest(chainA)))
		);

		const bySeq = [...results].sort((left, right) => Number(left.seq - right.seq));
		expect(bySeq.map((entry) => entry.seq)).toEqual(
			Array.from({ length: count }, (_, index) => BigInt(index + 1))
		);

		// Gapless is not enough -- the links have to form one chain, with no two entries sharing a
		// predecessor.
		for (let index = 1; index < bySeq.length; index += 1) {
			expect(hex(bySeq[index]!.prevChainHash)).toBe(hex(bySeq[index - 1]!.chainHash));
		}
		expect(new Set(results.map((entry) => hex(entry.chainHash))).size).toBe(count);
	});
}
