import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	InMemoryLedgerBackend,
	UnsynchronisedInMemoryLedgerBackend,
} from '../support/in-memory-ledger';
import {
	contractRequest,
	ledgerBackendContractCases,
	type LedgerBackendFixture,
} from '../support/ledger-backend-contract';

/**
 * `JR-2-07`: the evidence that variant (b) of RFC section 5.4 is retrofittable.
 *
 * Classification: `ci`. No database, no socket — that is the point of the file.
 *
 * ---------------------------------------------------------------------------------------------
 * What a passing run here establishes
 * ---------------------------------------------------------------------------------------------
 * `ledger-backend-contract.ts` is the same suite that runs against `PostgresLedgerWriter` in
 * `ledger-backend-contract.int.test.ts`. Here it runs against a backend that has no database at all.
 * Both passing means the `LedgerBackend` port carries nothing Postgres-specific, which is exactly the
 * acceptance criterion "(b) not implemented, but retrofittable without a signature change" — measured
 * rather than asserted in a comment.
 *
 * What it does **not** establish is durability. An in-memory backend is durable for as long as the
 * process lives, and it passes. The obligations a real WAL implementation carries beyond the signature
 * are listed in `ledger-port.ts`.
 */

const DEPLOYMENT_ID = '00000000-0000-4000-8000-000000000001';

const makeFixture = async (): Promise<LedgerBackendFixture> => ({
	backend: new InMemoryLedgerBackend({ deploymentId: DEPLOYMENT_ID }),
	deploymentId: DEPLOYMENT_ID,
	chainA: randomUUID(),
	chainB: randomUUID(),
});

suite('ci', 'LedgerBackend contract: in-memory backend (JR-2-07)', () => {
	ledgerBackendContractCases(makeFixture);
});

suite('ci', 'LedgerBackend contract: the concurrency case has teeth', () => {
	it('forks the chain when the same backend is run without its lock', async () => {
		// Without this, the concurrency assertion in the contract would be unfalsifiable. A
		// single-threaded runtime serialises appends by accident whenever there is no `await` between
		// reading the head and writing the entry, so a contract case that passes might be observing
		// the runtime rather than the lock.
		//
		// `UnsynchronisedInMemoryLedgerBackend` is the same code with the mutex removed. Run
		// concurrently it must break, and the shape of the break is the one a real ledger would
		// suffer: every append reads the same head and claims the same seq.
		const backend = new UnsynchronisedInMemoryLedgerBackend({ deploymentId: DEPLOYMENT_ID });
		const chain = randomUUID();
		const count = 12;

		const results = await Promise.all(
			Array.from({ length: count }, () => backend.append(contractRequest(chain)))
		);

		const distinctSeqs = new Set(results.map((entry) => String(entry.seq)));
		expect(distinctSeqs.size).toBeLessThan(count);

		// And the failure is a fork, not merely a duplicate number: several entries name the same
		// predecessor, which is what makes one of them silently wrong.
		const distinctPredecessors = new Set(
			results.map((entry) => Buffer.from(entry.prevChainHash).toString('hex'))
		);
		expect(distinctPredecessors.size).toBeLessThan(count);
	});

	it('and the locked backend survives the identical run', async () => {
		// Same input, same concurrency, mutex restored: the contrast is the evidence.
		const backend = new InMemoryLedgerBackend({ deploymentId: DEPLOYMENT_ID });
		const chain = randomUUID();
		const count = 12;

		const results = await Promise.all(
			Array.from({ length: count }, () => backend.append(contractRequest(chain)))
		);

		expect(new Set(results.map((entry) => String(entry.seq))).size).toBe(count);
		expect(
			new Set(results.map((entry) => Buffer.from(entry.prevChainHash).toString('hex'))).size
		).toBe(count);
	});

	it('does not wedge a chain when an append fails', async () => {
		// `pg_advisory_xact_lock` releases on abort; the in-memory lock has to behave the same way, or
		// one bad append would block the chain for the life of the process. A sub-millisecond
		// timestamp is the cheapest way to make `append()` throw from inside the lock.
		const backend = new InMemoryLedgerBackend({ deploymentId: DEPLOYMENT_ID });
		const chain = randomUUID();

		await expect(
			backend.append(contractRequest(chain, { receivedAtMicros: 1_785_492_930_123_001n }))
		).rejects.toThrow(/whole millisecond/);

		// The chain is still usable, and the failed attempt consumed no seq.
		const after = await backend.append(contractRequest(chain));
		expect(after.seq).toBe(1n);
	});
});
