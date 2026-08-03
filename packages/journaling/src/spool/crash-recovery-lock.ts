import type { LedgerTransactor } from '../ledger/ledger-port';
import { advisoryLockKey } from '../ledger/ledger-writer';
import {
	runCrashRecoveryScan,
	type CrashRecoveryScanOptions,
	type CrashRecoveryScanResult,
} from './crash-recovery';

/**
 * `runExclusiveCrashRecoveryScan()` — the cross-process exclusivity `runCrashRecoveryScan()` itself
 * does not provide (`JR-4-18`, architecture doc section 5, "Vorbedingung: der Scan läuft über einen
 * Spool, in den niemand schreibt").
 *
 * ---------------------------------------------------------------------------------------------
 * The gap this closes, and the one it deliberately does not
 * ---------------------------------------------------------------------------------------------
 * Architecture doc section 5 names two obligations for whoever calls `runCrashRecoveryScan()`:
 *
 *   1. Run it **before** binding the listening port, never concurrently with it. `apps/smtp-ingress`
 *      satisfies this by construction — the call sits in `main()` before `server.listen()`, in the
 *      same sequential `async function`, so nothing in that process can be mid-`accept()` while its
 *      own scan runs.
 *   2. Run it **exclusively** over a spool, because a second process (the future `journal-inbound`
 *      worker, E6) starts independently and could run its own scan while `apps/smtp-ingress` is
 *      already accepting mail. This module is obligation 2.
 *
 * `runExclusiveCrashRecoveryScan()` wraps `runCrashRecoveryScan()` in a Postgres advisory lock so that
 * **two overlapping calls to this function, from any number of processes, fully serialise** — the
 * second waits for the first to finish rather than racing it. `crash-recovery.ts`'s own doc comment
 * already tolerates a *lost* race (a `rename()` meeting `ENOENT` because a competing scan won); this
 * module removes the race itself for the case both callers go through it, which is a strictly stronger
 * guarantee and closes the backlog criterion "zwei gleichzeitig startende Prozesse räumen sich nicht
 * gegenseitig ab" outright rather than by tolerating the collision after the fact.
 *
 * **What this does not, and structurally cannot, fix:** a scan racing a *live in-flight acceptance* in
 * another process (the worker restarts long after `apps/smtp-ingress` has been accepting mail for
 * hours). Closing that completely would require the accept path itself to hold this same lock for
 * every SMTP transaction — turning a lock that today serialises only within one chain
 * (`ledger-writer.ts`'s `pg_advisory_xact_lock(advisoryLockKey(chainScopeId))`) into one that
 * serialises the entire spool across every chain, for every transaction, for as long as any scan might
 * ever run. That is a throughput and availability regression out of proportion to the risk it would
 * remove: architecture doc section 5 already classifies the residual outcome — a file quarantined a
 * moment before its ledger append actually commits — as "Verloren ist dabei nichts" (nothing lost, the
 * bytes sit in `quarantine/`, unharmed), the same tolerable, non-alarming shape `JR-3-09`/F40 already
 * gave the ordinary-write-failure case. So this module removes the *cheap* race (scan vs. scan) in
 * full, and deliberately leaves the *expensive* one (scan vs. accept) exactly as tolerable as the
 * architecture doc already says it is.
 *
 * ---------------------------------------------------------------------------------------------
 * The binding rule this leaves for `journal-inbound` (E6, not built yet)
 * ---------------------------------------------------------------------------------------------
 * Because the worker does not exist yet, nothing today enforces which of the two processes starts
 * first, or whether they ever run at the same time. A rule of the shape "only one process ever scans"
 * would need something to enforce it — a deployment convention nobody has written down yet, easy to
 * violate the first time an operator's process manager restarts things in an unexpected order. A lock
 * that serialises regardless of start order needs no such convention, so that is the rule: **whenever
 * `journal-inbound` is built, its startup scan must call `runExclusiveCrashRecoveryScan()` — never the
 * bare `runCrashRecoveryScan()` — with a `transactor` reaching the *same* database
 * `apps/smtp-ingress` uses for its ledger, and the *same* `spoolRoot`.** Doing so costs it nothing extra
 * to write (the lock key is derived from `spoolRoot` alone, see {@link crashRecoveryScanLockKey}) and
 * automatically serialises its scan against `apps/smtp-ingress`'s own boot-time scan and against a
 * second replica of either process sharing the same spool.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `pg_advisory_xact_lock`, not `pg_advisory_lock` — the session variant
 * ---------------------------------------------------------------------------------------------
 * The exact reasoning `ledger-writer.ts` already gives for the per-chain append lock applies here
 * verbatim: the *transactional* variant is released automatically when the transaction ends, including
 * when the connection simply drops (a crash mid-scan, or the process being killed). The *session*
 * variant would leak a held lock on any such path — a scan that never gets to release it wedges every
 * future scan on this spool until the leaked connection is recycled, which is a strictly worse failure
 * mode than the thing this module exists to prevent. So the whole scan runs inside one
 * `LedgerTransactor.transaction()` call: `runCrashRecoveryScan()`'s own filesystem operations
 * (`readdir`, `rename`) do not participate in that transaction at all — only the lock does — but they
 * run while it is held, and the transaction commits (releasing the lock) only once the scan function
 * returns.
 *
 * One consequence worth naming rather than hiding: this holds a Postgres transaction open for the
 * scan's whole wall-clock duration, which (per `crash-recovery.ts`'s own "Cost" section) is
 * proportional to the number of files needing quarantine at a large, previously-unreconciled spool.
 * A transaction that does nothing but hold an advisory lock takes no row locks and touches no table, so
 * this does not block unrelated ledger appends (those lock on a *different* key,
 * `advisoryLockKey(chainScopeId)`) or ordinary reads — the cost is one held connection and one open
 * transaction ID for the scan's duration, not lock contention with the write path. Flagged, not solved:
 * an operator running `idle_in_transaction_session_timeout` aggressively on this connection's role
 * could abort a long scan; the role this connection uses should exempt it, the same way any other
 * long-running, deliberately-idle-between-round-trips transaction would need to.
 *
 * ---------------------------------------------------------------------------------------------
 * The lock key
 * ---------------------------------------------------------------------------------------------
 * Reuses {@link advisoryLockKey} unchanged rather than inventing a second derivation — that function
 * already documents why a collision is harmless (two different keys mapping to the same 64-bit value
 * only serialises them against each other, never produces a wrong answer) and why SHA-256 is used
 * instead of Postgres' `hashtext()` (not stable across major versions). The input string is namespaced
 * (`'crash-recovery-scan:'` plus the spool root) so this lock's key space cannot collide with a chain's
 * `advisoryLockKey(chainScopeId)` unless a chain's `ingestion_sources.id` were ever literally
 * `crash-recovery-scan:<spoolRoot>` — not a value ADR-007's UUID-shaped chain ids can take. Keying by
 * `spoolRoot` rather than a single fixed constant costs nothing today (one spool per deployment) and
 * means a hypothetical future deployment running two independent spools does not serialise their scans
 * against each other for no reason.
 */

/** Derive the advisory lock key for the crash-recovery scan over `spoolRoot`. See the module doc
 * comment, "The lock key". */
export function crashRecoveryScanLockKey(spoolRoot: string): bigint {
	return advisoryLockKey(`crash-recovery-scan:${spoolRoot}`);
}

export interface ExclusiveCrashRecoveryScanOptions extends CrashRecoveryScanOptions {
	/**
	 * A transaction boundary over the *same* database every other caller sharing this spool uses.
	 * `apps/smtp-ingress` supplies this from its own `LedgerTransactor` (the same one
	 * `PostgresLedgerWriter` is built with) — see this file's module doc comment for why the future
	 * `journal-inbound` worker must do the same.
	 */
	readonly transactor: LedgerTransactor;
}

/**
 * Run `runCrashRecoveryScan()` while holding an exclusive, transaction-scoped advisory lock keyed by
 * `spoolRoot` (see the module doc comment). A second, overlapping call — from this process or another
 * — blocks until the first call's wrapping transaction commits, rather than racing it.
 */
export async function runExclusiveCrashRecoveryScan(
	options: ExclusiveCrashRecoveryScanOptions
): Promise<CrashRecoveryScanResult> {
	const { transactor, ...scanOptions } = options;
	const lockKey = crashRecoveryScanLockKey(scanOptions.spoolRoot);
	return transactor.transaction(async (tx) => {
		// Blocking, not `pg_try_advisory_xact_lock`: two processes starting together must both
		// eventually scan, not have the loser give up. See the module doc comment for why the loser
		// waiting is safe (the winner already resolved everything it found).
		await tx.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
		return runCrashRecoveryScan(scanOptions);
	});
}
