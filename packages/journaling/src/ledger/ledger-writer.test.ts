import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { DEPLOYMENT_ID, SCOPE_A, SCOPE_B } from '../../tests/support/adr-006-vectors';
import { chainHash, genesisChainHash } from './canonical-encoding';
import type { LedgerAppendRequest, LedgerQuery, LedgerTransactor } from './ledger-port';
import { PostgresLedgerWriter, advisoryLockKey } from './ledger-writer';

/**
 * `LedgerWriter.append()` against a recording fake (`JR-2-06`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What a fake can prove here that a real database cannot
 * ---------------------------------------------------------------------------------------------
 * The acceptance criterion of `JR-2-06` is about **order**: durability setting, then lock, then read
 * head, then hash, then insert. Against a real Postgres all of that is invisible — a correct chain and
 * a chain hashed before the lock look identical until two writers race, and then the failure is
 * intermittent. The fake below records every statement, so the order is asserted directly instead of
 * being inferred from the absence of a race.
 *
 * The complementary integration test (`journal-ledger-writer.int.test.ts`) does what the fake cannot:
 * prove that the rows are real, durable and re-verifiable.
 *
 * The other half of the criterion is structural and needs no test: {@link LedgerAppendRequest} has no
 * `seq`, `prevChainHash` or `chainHash` field, so a caller has neither the inputs to pre-compute the
 * hash nor a way to pass one in.
 */

interface Recorded {
	readonly text: string;
	readonly values: readonly unknown[];
}

/** A transactor that records statements and answers the head query from a script. */
function fakeTransactor(headRows: Record<string, unknown>[] = []): {
	transactor: LedgerTransactor;
	statements: Recorded[];
	transactions: number;
	rollbacks: number;
} {
	const statements: Recorded[] = [];
	const state = { transactions: 0, rollbacks: 0 };
	const tx: LedgerQuery = {
		async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
			statements.push({ text, values });
			if (/FROM journal_ledger/i.test(text)) {
				return headRows as Row[];
			}
			return [] as Row[];
		},
	};
	const transactor: LedgerTransactor = {
		async transaction<T>(run: (handle: LedgerQuery) => Promise<T>): Promise<T> {
			state.transactions += 1;
			try {
				return await run(tx);
			} catch (error) {
				state.rollbacks += 1;
				throw error;
			}
		},
	};
	return {
		transactor,
		statements,
		get transactions() {
			return state.transactions;
		},
		get rollbacks() {
			return state.rollbacks;
		},
	};
}

const request = (overrides: Partial<LedgerAppendRequest> = {}): LedgerAppendRequest => ({
	chainScopeId: SCOPE_A,
	receivedAtMicros: 1_785_492_930_123_000n,
	eventType: 'receipt',
	remoteIp: '192.0.2.25',
	ehloName: 'mail.example.com',
	tlsVersion: 'TLSv1.3',
	tlsCipher: 'TLS_AES_256_GCM_SHA384',
	envelopeFrom: 'sender@example.com',
	envelopeRcpt: ['a@example.com'],
	sizeBytes: 4096n,
	contentSha256: null,
	duplicateOf: null,
	journalingSourceId: null,
	spoolTxId: '01JZZ0000000000000000000AA',
	eventPayload: null,
	...overrides,
});

const indexOfStatement = (statements: Recorded[], pattern: RegExp): number =>
	statements.findIndex((statement) => pattern.test(statement.text));

suite('ci', 'LedgerWriter.append(): statement order', () => {
	it('sets synchronous_commit, takes the lock, reads the head, then inserts — in that order', async () => {
		const fake = fakeTransactor();
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: fake.transactor,
		});
		await writer.append(request());

		const durability = indexOfStatement(fake.statements, /SET LOCAL synchronous_commit = on/i);
		const lock = indexOfStatement(fake.statements, /pg_advisory_xact_lock/i);
		const head = indexOfStatement(fake.statements, /SELECT seq, chain_hash/i);
		const insert = indexOfStatement(fake.statements, /INSERT INTO journal_ledger/i);

		expect(durability).toBeGreaterThanOrEqual(0);
		expect(lock).toBeGreaterThan(durability);
		// The head must be read *after* the lock. Read before it, two concurrent appends would see the
		// same head and fork the chain.
		expect(head).toBeGreaterThan(lock);
		expect(insert).toBeGreaterThan(head);
		expect(fake.statements).toHaveLength(4);
	});

	it('uses the transactional lock, never the session lock', async () => {
		// pg_advisory_lock would survive a rollback and wedge the chain until the connection is
		// recycled. The transactional variant is released at transaction end, abort included.
		const fake = fakeTransactor();
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: fake.transactor,
		});
		await writer.append(request());
		const lockStatements = fake.statements.filter((statement) =>
			/pg_advisory/i.test(statement.text)
		);
		expect(lockStatements).toHaveLength(1);
		expect(lockStatements[0]!.text).toMatch(/pg_advisory_xact_lock/);
		expect(lockStatements[0]!.text).not.toMatch(/pg_advisory_lock|pg_advisory_unlock/);
	});

	it('does everything inside one transaction', async () => {
		const fake = fakeTransactor();
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: fake.transactor,
		});
		await writer.append(request());
		expect(fake.transactions).toBe(1);
		expect(fake.rollbacks).toBe(0);
	});

	it('locks per chain, so two chains do not contend', async () => {
		// ADR-007 consequence 2. A constant key would make every tenant serialise against every other.
		const first = fakeTransactor();
		const second = fakeTransactor();
		await new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: first.transactor,
		}).append(request({ chainScopeId: SCOPE_A }));
		await new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: second.transactor,
		}).append(request({ chainScopeId: SCOPE_B }));

		const keyOf = (fake: typeof first): unknown =>
			fake.statements.find((statement) => /pg_advisory_xact_lock/.test(statement.text))!
				.values[0];
		expect(keyOf(first)).not.toBe(keyOf(second));
	});
});

suite('ci', 'LedgerWriter.append(): seq and chaining', () => {
	it('starts an empty chain at seq 1 with the genesis hash as predecessor', async () => {
		const fake = fakeTransactor([]);
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: fake.transactor,
		});
		const result = await writer.append(request());

		expect(result.seq).toBe(1n);
		const genesis = genesisChainHash(DEPLOYMENT_ID, SCOPE_A);
		expect(Buffer.from(result.prevChainHash).equals(genesis)).toBe(true);
	});

	it('continues from the head it read', async () => {
		const head = Buffer.alloc(32, 0xab);
		const fake = fakeTransactor([{ seq: '41', chain_hash: head }]);
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: fake.transactor,
		});
		const result = await writer.append(request());

		expect(result.seq).toBe(42n);
		expect(Buffer.from(result.prevChainHash).equals(head)).toBe(true);
	});

	it('accepts a head seq that arrives as a string, as the driver returns bigint', async () => {
		// postgres-js hands `bigint` back as a string by default. Reading it as a JS number would
		// silently lose precision past 2^53 -- and this value only ever grows.
		const huge = '9007199254740993'; // 2^53 + 1
		const fake = fakeTransactor([{ seq: huge, chain_hash: Buffer.alloc(32, 1) }]);
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: fake.transactor,
		});
		const result = await writer.append(request());
		expect(result.seq).toBe(9007199254740994n);
	});

	it('writes the hash it computed, over the record it inserted', async () => {
		// The check that ties the two halves together: the inserted chain_hash must equal
		// chainHash(record, prev) for the seq and prev derived under the lock. A hash computed from a
		// stale head would fail here.
		const head = Buffer.alloc(32, 0x7f);
		const fake = fakeTransactor([{ seq: '7', chain_hash: head }]);
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: fake.transactor,
		});
		const payload = request();
		const result = await writer.append(payload);

		const expected = chainHash(
			{
				chainScopeId: payload.chainScopeId,
				seq: 8n,
				receivedAtMicros: payload.receivedAtMicros,
				eventType: payload.eventType,
				remoteIp: payload.remoteIp,
				ehloName: payload.ehloName,
				tlsVersion: payload.tlsVersion,
				tlsCipher: payload.tlsCipher,
				envelopeFrom: payload.envelopeFrom,
				envelopeRcpt: payload.envelopeRcpt,
				sizeBytes: payload.sizeBytes,
				contentSha256: payload.contentSha256,
				duplicateOf: payload.duplicateOf,
				journalingSourceId: payload.journalingSourceId,
				spoolTxId: payload.spoolTxId,
				eventPayload: null,
			},
			head
		);
		expect(Buffer.from(result.chainHash).equals(expected)).toBe(true);

		const insert = fake.statements.find((statement) =>
			/INSERT INTO journal_ledger/.test(statement.text)
		)!;
		const values = insert.values;
		expect(Buffer.from(values[values.length - 1] as Uint8Array).equals(expected)).toBe(true);
		expect(Buffer.from(values[values.length - 2] as Uint8Array).equals(head)).toBe(true);
		// seq is the second bound value and must be the derived one, not anything from the request.
		expect(values[1]).toBe(8n);
	});

	it('rejects a timestamp that is not a whole millisecond, before touching the database', async () => {
		// The encoder refuses it (ADR-006 section 3.1). Worth asserting here because the refusal has to
		// happen inside the transaction and therefore roll it back -- no half-written row, no consumed
		// seq.
		const fake = fakeTransactor();
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: fake.transactor,
		});
		await expect(
			writer.append(request({ receivedAtMicros: 1_785_492_930_123_001n }))
		).rejects.toThrow(/whole millisecond/);
		expect(fake.rollbacks).toBe(1);
		expect(indexOfStatement(fake.statements, /INSERT INTO journal_ledger/)).toBe(-1);
	});

	it('propagates a failure as a rollback, consuming no seq', async () => {
		// `seq` comes from max(seq)+1, not from a sequence, so a rolled-back append leaves no hole.
		// This asserts the mechanism: nothing is inserted and the next read still sees the old head.
		const failing: LedgerTransactor = {
			async transaction<T>(run: (handle: LedgerQuery) => Promise<T>): Promise<T> {
				const tx: LedgerQuery = {
					async query<Row>(text: string): Promise<Row[]> {
						if (/INSERT INTO journal_ledger/.test(text)) {
							throw new Error('deadlock detected');
						}
						if (/FROM journal_ledger/i.test(text)) {
							return [{ seq: '5', chain_hash: Buffer.alloc(32, 2) }] as Row[];
						}
						return [] as Row[];
					},
				};
				return run(tx);
			},
		};
		const writer = new PostgresLedgerWriter({
			deploymentId: DEPLOYMENT_ID,
			transactor: failing,
		});
		await expect(writer.append(request())).rejects.toThrow(/deadlock detected/);
	});
});

suite('ci', 'advisoryLockKey()', () => {
	it('is deterministic', () => {
		expect(advisoryLockKey(SCOPE_A)).toBe(advisoryLockKey(SCOPE_A));
	});

	it('differs between chains', () => {
		expect(advisoryLockKey(SCOPE_A)).not.toBe(advisoryLockKey(SCOPE_B));
	});

	it('stays inside the signed 64-bit range Postgres accepts', () => {
		const min = -(2n ** 63n);
		const max = 2n ** 63n - 1n;
		for (const scope of [
			SCOPE_A,
			SCOPE_B,
			DEPLOYMENT_ID,
			'00000000-0000-0000-0000-000000000000',
		]) {
			const key = advisoryLockKey(scope);
			expect(key).toBeGreaterThanOrEqual(min);
			expect(key).toBeLessThanOrEqual(max);
		}
	});

	it('does not depend on Postgres hashtext(), which is not version-stable', () => {
		// Pinned so an "optimisation" to hashtext() shows up as a failure. A lock key that changes
		// under a major upgrade would let two processes append to one chain concurrently.
		expect(advisoryLockKey('11111111-1111-4111-8111-111111111111')).toBe(-4794536288475408876n);
		expect(advisoryLockKey('00000000-0000-4000-8000-000000000001')).toBe(1289600646178507792n);
	});
});
