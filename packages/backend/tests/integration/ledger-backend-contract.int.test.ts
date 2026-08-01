import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { PostgresLedgerWriter } from '@open-archiver/journaling';
import { acquireTestDatabase } from '../support/pg-harness';
import { postgresTransactor } from '../support/postgres-transactor';
import { seedIngestionSource } from '../support/iam-seed';
import {
	ledgerBackendContractCases,
	type LedgerBackendFixture,
} from '../support/ledger-backend-contract';

/**
 * The same `LedgerBackend` contract as `ledger-backend-contract.test.ts`, against variant (a)
 * (`JR-2-07`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the same suite twice
 * ---------------------------------------------------------------------------------------------
 * One suite, two implementations — that is the construction that turns "the port is pluggable" from a
 * claim into a measurement. Run only against the in-memory backend, the contract would prove the
 * *contract* is satisfiable and nothing about the real writer. Run only against Postgres, it would be
 * indistinguishable from an ordinary integration test and could quietly acquire Postgres-specific
 * expectations, at which point variant (b) would need a signature change after all — the exact outcome
 * `JR-2-07` exists to rule out.
 *
 * The Postgres-specific half of the writer's behaviour is not here: the round trip through the columns,
 * microsecond preservation, array order, the `CHECK` constraints and the rollback path all live in
 * `journal-ledger-writer.int.test.ts`, because they are properties of variant (a) rather than of the
 * port.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('ledger-contract') : undefined;

/**
 * A fresh fixture per case: two newly seeded archives, so every case starts on empty chains.
 *
 * The contract assumes seq begins at 1. Reusing one archive across cases would make the cases
 * order-dependent, and an order-dependent ledger test is worse than none — it would go green or red
 * depending on which case ran first.
 */
async function makeFixture(): Promise<LedgerBackendFixture> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	const deploymentId = rows[0]!.deployment_id;

	const [archiveA, archiveB] = await Promise.all([
		seedIngestionSource(harness!.db),
		seedIngestionSource(harness!.db),
	]);

	return {
		backend: new PostgresLedgerWriter({
			deploymentId,
			transactor: postgresTransactor(harness!.sql),
		}),
		deploymentId,
		chainA: archiveA.id,
		chainB: archiveB.id,
	};
}

suiteRequiring(
	'ci',
	'LedgerBackend contract: PostgresLedgerWriter (JR-2-07)',
	postgresProbe,
	() => {
		// No extra cases here on purpose. Anything this file added would be a case the in-memory backend
		// is not held to, and the two suites would stop being the same contract -- which is the one thing
		// this construction exists to guarantee. Variant (a)'s own properties are in
		// `journal-ledger-writer.int.test.ts`.
		ledgerBackendContractCases(makeFixture);
	}
);
