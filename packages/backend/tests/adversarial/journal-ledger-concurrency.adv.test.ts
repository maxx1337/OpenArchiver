import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import { resolveSeed, seededRng } from '@oa-test/seed';
import {
	PostgresLedgerWriter,
	type LedgerAppendRequest,
	type LedgerQuery,
	type LedgerTransactor,
} from '@open-archiver/journaling';
import { acquireTestDatabase } from '../support/pg-harness';
import { postgresTransactor, rollingBackTransactor } from '../support/postgres-transactor';
import { seedIngestionSource } from '../support/iam-seed';
import { readLedgerChain, verifyChain } from '../support/ledger-verifier';

/**
 * Ledger concurrency under load — `JR-208`, Testplan section 12.6. Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this file is for
 * ---------------------------------------------------------------------------------------------
 * `journal-ledger-writer.int.test.ts` already shows ten concurrent appends coming out as 1..10. That
 * is the functional case, and it is the wrong instrument for this question: ten appends against a
 * warm database rarely overlap long enough to expose a missing lock, so it would stay green against
 * a writer whose serialisation is merely *usually* right.
 *
 * This is the load version the backlog asks for — **20 writers × 500 appends into one chain** — plus
 * the two things that make a load test more than a stress test:
 *
 *  1. A **rollback forced between the sequence being derived and the commit**, running concurrently
 *     with real appends. `seq` comes from `max(seq) + 1` rather than a Postgres sequence precisely so
 *     that this leaves no hole (`nextval()` is not rolled back), and a hole is a tamper signal — a
 *     benign gap would destroy the completeness argument the whole ledger exists for.
 *  2. A **counter-check that the test has teeth**: the same load against a transactor that swallows
 *     the advisory lock has to break. A concurrency test that cannot fail is a decoration, and the
 *     way it usually cannot fail is that the load never actually overlapped.
 *
 * The chain is not spot-checked. Every one of the ten thousand rows is read back, re-encoded and
 * re-hashed through `verifyChain()`, which walks the chain independently of the writer.
 *
 * ---------------------------------------------------------------------------------------------
 * F13: why this file touches `OA_TEST_PG_STALE_MS`
 * ---------------------------------------------------------------------------------------------
 * `acquireTestDatabase()` sweeps harness databases that look abandoned, and "abandoned" is decided by
 * age against `OA_TEST_PG_STALE_MS` (default 2 h). Guard 2 — "something is still connected" — does not
 * protect a live run reliably, because postgres-js closes idle connections after seconds. So the
 * threshold is the only real protection, and this is the first test in the repository whose runtime is
 * measured in minutes rather than seconds. Both directions of the hazard are real:
 *
 *  - **Outward**, and this is the one this file can actually fix: *our* sweep, running when this file
 *    acquires its database, must not drop a foreign long-running run. Raising the threshold in this
 *    process makes our own sweep more conservative, which is exactly F13's ask.
 *  - **Inward**: a foreign process could sweep the database this file is using. That one is not
 *    fixable from here — a different process reads its own environment — so it is stated rather than
 *    papered over. Guard 2 covers it while the soak is actively connected, which it is throughout.
 *
 * The threshold is only ever raised, never lowered: lowering it is the failure mode F12 was, and
 * `sweepStaleHarnessDatabases()` structurally refuses a lowered threshold without `restrictTo`.
 */

/** 20 writers × 500 appends, as the backlog specifies. Not reduced, and not silently sampled. */
const WRITERS = 20;
const APPENDS_PER_WRITER = 500;
const TOTAL_APPENDS = WRITERS * APPENDS_PER_WRITER;

/** Concurrent real appends and rollbacks for the gap case. */
const ROLLBACK_WRITERS = 4;
const ROLLBACKS_PER_WRITER = 25;
const COMMITTING_WRITERS = 8;
const COMMITS_PER_WRITER = 100;

/**
 * What the soak is allowed to take. Also the test timeout, so the two cannot drift: a soak that runs
 * past its own budget fails as a timeout instead of quietly redefining the budget.
 */
const SOAK_BUDGET_MS = 10 * 60 * 1000;

/* -------------------------------------------------------------------------------------------- */
/* F13 — raise the sweeper threshold before anything is acquired                                */
/* -------------------------------------------------------------------------------------------- */

/** Mirrors the default in `pg-harness.ts`. An unset variable means this, not "no threshold". */
const HARNESS_DEFAULT_STALE_MS = 2 * 60 * 60 * 1000;
/** Three times the budget: the run must be able to overrun substantially and stay protected. */
const REQUIRED_STALE_MS = SOAK_BUDGET_MS * 3;

function raiseStaleThresholdForThisRun(): void {
	const configured = process.env.OA_TEST_PG_STALE_MS?.trim();
	const effective = configured ? Number(configured) : HARNESS_DEFAULT_STALE_MS;
	if (Number.isFinite(effective) && effective >= REQUIRED_STALE_MS) {
		return;
	}
	process.env.OA_TEST_PG_STALE_MS = String(REQUIRED_STALE_MS);
	coverageNotice(
		`JR-208: raised OA_TEST_PG_STALE_MS from ${configured ?? `${HARNESS_DEFAULT_STALE_MS} (default)`} ` +
			`to ${REQUIRED_STALE_MS} ms for this process. This soak runs for minutes, and a threshold ` +
			`below its runtime lets our own sweep drop a concurrently running foreign harness database ` +
			`(F13). Raised only, never lowered.`
	);
}

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
if (enabled) {
	// Before the acquire: `acquireTestDatabase()` sweeps as its first action.
	raiseStaleThresholdForThisRun();
}
const harness = enabled ? await acquireTestDatabase('ledger-concurrency') : undefined;

/**
 * A pool wide enough for the writers to actually be concurrent.
 *
 * The harness client is capped at `max: 4`, which is right for ordinary integration files and wrong
 * here: with four connections, "20 concurrent writers" would be four writers and sixteen waiting in
 * the driver's queue — the contention would happen in the client rather than in Postgres, and the
 * advisory lock would barely be exercised. One connection per writer moves the contention to where
 * the claim is.
 */
const pool = harness
	? postgres(harness.url, {
			max: WRITERS,
			idle_timeout: 30,
			connect_timeout: 15,
			onnotice: () => {},
		})
	: undefined;

afterAll(async () => {
	await pool?.end({ timeout: 30 }).catch(() => undefined);
});

const seed = enabled ? resolveSeed('journal-ledger-concurrency') : 0;
const rng = seededRng(seed, 'journal-ledger-concurrency');

const BASE_MICROS = 1_785_492_930_000_000n;

async function deploymentId(): Promise<string> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

function writer(transactor: LedgerTransactor, deployment: string): PostgresLedgerWriter {
	return new PostgresLedgerWriter({ deploymentId: deployment, transactor });
}

/**
 * A varied request. The variation is seeded rather than fixed so that the load exercises different
 * encodings — null-heavy rows, different recipient counts, payloads with keys out of order — and a
 * failure is replayable with `OA_TEST_SEED`.
 */
function request(chainScopeId: string, index: number): LedgerAppendRequest {
	const recipients = Array.from({ length: 1 + rng.int(4) }, (_, position) => {
		return `rcpt-${index}-${position}@example.com`;
	});
	const sparse = rng.next() < 0.2;
	return {
		chainScopeId,
		// Whole milliseconds only (ADR-006 section 3.1); the writer refuses anything finer.
		receivedAtMicros: BASE_MICROS + BigInt(index) * 1000n,
		eventType: sparse ? 'anchor' : 'receipt',
		remoteIp: sparse ? null : rng.pick(['192.0.2.25', '198.51.100.7', '2001:db8::1']),
		ehloName: sparse ? null : `mail-${rng.int(8)}.example.com`,
		tlsVersion: sparse ? null : rng.pick(['TLSv1.2', 'TLSv1.3']),
		tlsCipher: sparse ? null : 'TLS_AES_256_GCM_SHA384',
		envelopeFrom: sparse ? null : `sender-${index}@example.com`,
		envelopeRcpt: sparse ? null : recipients,
		sizeBytes: sparse ? null : BigInt(1024 + rng.int(65536)),
		contentSha256: sparse
			? null
			: createHash('sha256').update(`object-${index}`, 'utf8').digest(),
		duplicateOf: null,
		journalingSourceId: null,
		spoolTxId: sparse ? null : `01JZZ${String(index).padStart(21, '0')}`,
		eventPayload: sparse ? null : { z: index, a: 'load', nested: { m: [1, 2, 3] } },
	};
}

/**
 * A transactor that silently drops the advisory lock statement.
 *
 * This is the counter-check, and it is built as a decorator rather than as a second writer on
 * purpose: everything else — the durability setting, the head read, the hash under the (now absent)
 * lock, the insert — stays the production path, so a break can only come from the missing lock.
 */
function withoutAdvisoryLock(inner: LedgerTransactor): LedgerTransactor {
	return {
		transaction<T>(run: (tx: LedgerQuery) => Promise<T>): Promise<T> {
			return inner.transaction((tx) =>
				run({
					async query<Row>(text: string, values?: readonly unknown[]): Promise<Row[]> {
						if (text.includes('pg_advisory_xact_lock')) {
							return [] as Row[];
						}
						return tx.query<Row>(text, values);
					},
				})
			);
		},
	};
}

suiteRequiring(
	'ci',
	`ledger appends under concurrency (JR-208) -- ${WRITERS}x${APPENDS_PER_WRITER}`,
	postgresProbe,
	() => {
		it(
			`stays gapless and correctly chained across ${TOTAL_APPENDS} concurrent appends`,
			async () => {
				const deployment = await deploymentId();
				const source = await seedIngestionSource(harness!.db);
				const transactor = postgresTransactor(pool!);

				const started = Date.now();
				// One writer instance per concurrent producer, each appending its slice back to back.
				// `Promise.all` over the writers rather than over all ten thousand appends: the latter
				// would queue ten thousand promises in the driver at once and measure the driver.
				const results = await Promise.all(
					Array.from({ length: WRITERS }, async (_, writerIndex) => {
						const own = writer(transactor, deployment);
						const seqs: bigint[] = [];
						for (let n = 0; n < APPENDS_PER_WRITER; n += 1) {
							const result = await own.append(
								request(source.id, writerIndex * APPENDS_PER_WRITER + n)
							);
							seqs.push(result.seq);
						}
						return seqs;
					})
				);
				const elapsed = Date.now() - started;
				coverageNotice(
					`JR-208: ${TOTAL_APPENDS} appends by ${WRITERS} concurrent writers in ${elapsed} ms ` +
						`(${(TOTAL_APPENDS / (elapsed / 1000)).toFixed(0)}/s), seed ${seed}.`
				);

				// 1. Every writer got a distinct seq, and together they are exactly 1..N. Asserted on
				//    the *returned* values first: if the writer handed two callers the same seq, the
				//    insert would have failed, but the return value is what an SMTP reply would carry.
				const returned = results.flat().sort((a, b) => Number(a - b));
				expect(returned).toHaveLength(TOTAL_APPENDS);
				const misnumbered = returned.filter((value, index) => value !== BigInt(index + 1));
				expect(
					misnumbered.slice(0, 5),
					`the returned seqs are not exactly 1..${TOTAL_APPENDS}`
				).toEqual([]);

				// 2. The stored chain verifies end to end, recomputed from the values that came back
				//    out of the database.
				const chain = await readLedgerChain(harness!.sql, source.id);
				expect(chain).toHaveLength(TOTAL_APPENDS);
				// The read order itself, before trusting the walk: a lexicographic sort (1, 10, 2, …)
				// would turn a sound chain into a reported break and could hide a real one. At ten
				// thousand rows this is not a theoretical concern.
				const outOfOrder = chain.findIndex(
					(entry, index) => entry.record.seq !== BigInt(index + 1)
				);
				expect(outOfOrder, 'readLedgerChain() did not return the rows in seq order').toBe(
					-1
				);

				const findings = verifyChain({
					deploymentId: deployment,
					chainScopeId: source.id,
					entries: chain,
					expectedLength: TOTAL_APPENDS,
				});
				expect(findings.slice(0, 3)).toEqual([]);

				// 3. Every append saw a different head. A duplicate here means two appends read the
				//    same predecessor — a fork — even if the seqs happened to come out clean.
				const predecessors = new Set(chain.map((entry) => entry.prev.toString('hex')));
				expect(predecessors.size).toBe(TOTAL_APPENDS);
			},
			SOAK_BUDGET_MS
		);

		it('leaves no gap when appends roll back between seq derivation and commit', async () => {
			// The rollbacks run *alongside* real appends, not before or after them: a rollback in a
			// quiet chain proves only that `max(seq) + 1` is recomputed, while a rollback interleaved
			// with committing writers is the case where a Postgres sequence would leave a permanent
			// hole. `rollingBackTransactor` lets the writer finish everything it wanted to do and then
			// aborts the transaction, which is precisely "between derivation and commit".
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db);
			const committing = writer(postgresTransactor(pool!), deployment);
			const abandoning = writer(rollingBackTransactor(pool!), deployment);

			const rolledBackSeqs: bigint[] = [];
			await Promise.all([
				...Array.from({ length: COMMITTING_WRITERS }, async (_, writerIndex) => {
					for (let n = 0; n < COMMITS_PER_WRITER; n += 1) {
						await committing.append(
							request(source.id, writerIndex * COMMITS_PER_WRITER + n)
						);
					}
				}),
				...Array.from({ length: ROLLBACK_WRITERS }, async (_, writerIndex) => {
					for (let n = 0; n < ROLLBACKS_PER_WRITER; n += 1) {
						const result = await abandoning.append(
							request(source.id, 900_000 + writerIndex * 1000 + n)
						);
						rolledBackSeqs.push(result.seq);
					}
				}),
			]);

			const expectedRows = COMMITTING_WRITERS * COMMITS_PER_WRITER;
			const expectedRollbacks = ROLLBACK_WRITERS * ROLLBACKS_PER_WRITER;

			// The rollback writers really ran and really derived sequence numbers. Without this the
			// test could pass with the rollback half never having executed, which is the way a
			// negative test quietly becomes a tautology.
			expect(rolledBackSeqs).toHaveLength(expectedRollbacks);
			expect(
				rolledBackSeqs.every((value) => value >= 1n && value <= BigInt(expectedRows))
			).toBe(true);

			const chain = await readLedgerChain(harness!.sql, source.id);
			expect(chain).toHaveLength(expectedRows);
			expect(chain.map((entry) => entry.record.seq).slice(-1)).toEqual([
				BigInt(expectedRows),
			]);

			const findings = verifyChain({
				deploymentId: deployment,
				chainScopeId: source.id,
				entries: chain,
				expectedLength: expectedRows,
			});
			expect(findings.slice(0, 3)).toEqual([]);
		});

		it('stores event_payload as an object on a driver drizzle never touched (F38)', async () => {
			// This is the finding this file turned up, kept as its own case because the load test
			// above would report it only as ten thousand hash mismatches.
			//
			// The writer hands `event_payload` over as a JSON string. postgres-js takes the parameter
			// type from the server's parameter description, sees `jsonb`, and JSON-encodes the string
			// a second time — so the column ends up holding the JSON *string* `"{\"k\":1}"` rather
			// than the object. Reading it back yields a string, `canonicalJson()` encodes that
			// differently, and the row cannot be verified. Measured: `$16` and `$16::jsonb` both store
			// a string, `$16::text::jsonb` stores the object.
			//
			// Why it survived `JR-206`: the only postgres-js client in this repository that does *not*
			// behave that way is `harness.sql`, because `drizzle()` patches the client it is given —
			// and that is the client every integration test writes through. The ingress process of
			// E3/E4 will not have drizzle anywhere near it (`packages/journaling` must not depend on
			// `packages/backend`), so production would have been the first place to find out. `pool`
			// here is a plain client, which is why this file sees it.
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db);
			const payload = { z: 1, a: 'x', nested: { m: [1, 2, 3] } };
			await writer(postgresTransactor(pool!), deployment).append({
				...request(source.id, 1),
				eventPayload: payload,
			});

			const [stored] = await harness!.sql<{ t: string | null }[]>`
				select jsonb_typeof(event_payload) as t
				from journal_ledger where chain_scope_id = ${source.id}
			`;
			expect(
				stored!.t,
				'event_payload was stored as a JSON string, not an object -- F38 is back'
			).toBe('object');

			const chain = await readLedgerChain(harness!.sql, source.id);
			expect(chain[0]!.record.eventPayload).toEqual(payload);
			expect(
				verifyChain({ deploymentId: deployment, chainScopeId: source.id, entries: chain })
			).toEqual([]);
		});

		it('breaks without the advisory lock -- the counter-check that this suite has teeth', async () => {
			// If this ever passes, the load above is measuring nothing: it would mean concurrent
			// appends produce a sound chain even when nothing serialises them, which can only happen
			// because they never actually overlapped.
			//
			// Up to three rounds, each on a fresh chain. One round is enough in practice; the loop is
			// there so that an unlucky scheduling round does not make the *counter-check* the flaky
			// part of the suite. A round that produces neither an error nor a fork is reported.
			const deployment = await deploymentId();
			const unlocked = writer(withoutAdvisoryLock(postgresTransactor(pool!)), deployment);
			const CONCURRENT = 20;

			let broke = false;
			let rounds = 0;
			for (; rounds < 3 && !broke; rounds += 1) {
				const source = await seedIngestionSource(harness!.db);
				const outcomes = await Promise.allSettled(
					Array.from({ length: CONCURRENT }, (_, index) =>
						unlocked.append(request(source.id, index))
					)
				);
				const rejected = outcomes.filter((outcome) => outcome.status === 'rejected').length;
				const chain = await readLedgerChain(harness!.sql, source.id);
				const findings = verifyChain({
					deploymentId: deployment,
					chainScopeId: source.id,
					entries: chain,
					expectedLength: CONCURRENT,
				});
				if (rejected > 0 || findings.length > 0) {
					broke = true;
					coverageNotice(
						`JR-208 counter-check: without the advisory lock, ${rejected} of ${CONCURRENT} ` +
							`appends failed and the chain reported ${findings.length} finding(s) ` +
							`(${findings[0]?.kind ?? 'none'}). Round ${rounds + 1}.`
					);
				}
			}

			expect(
				broke,
				`${CONCURRENT} concurrent appends without the advisory lock produced a complete, sound ` +
					`chain in ${rounds} round(s). Either the appends did not overlap -- in which case ` +
					`the load test above proves nothing about serialisation -- or something other than ` +
					`the lock is serialising them.`
			).toBe(true);
		});
	}
);
