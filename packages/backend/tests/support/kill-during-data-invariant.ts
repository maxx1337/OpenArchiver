import { createHash } from 'node:crypto';

/**
 * The central `JR-4-10` invariant, extracted into a pure, infrastructure-free function so it can be
 * **calibrated** independently of the real kill-during-DATA test (Testplan rule 3 / the tester role's
 * "your own tooling can be fail-open" rule).
 *
 * ---------------------------------------------------------------------------------------------
 * The claim, exactly as Testplan section 12.1 states it
 * ---------------------------------------------------------------------------------------------
 * For every SMTP transaction: **either** the client never observed `250`, **or** the message is
 * fully present in the spool and correctly chained in the ledger. Never partially.
 *
 * This module does not touch a socket, a child process, or a database. It takes one *observation* --
 * what the client actually read off the wire, and what a completely independent read of the spool and
 * the ledger row found afterwards -- and reports violations. `smtp-ingress-kill-during-data.adv.test.ts`
 * is the only caller that supplies real observations; `kill-during-data-invariant.test.ts` calibrates
 * this function itself against seven hand-built observations, four of which must be violations,
 * proving the checker is not fail-open before it is ever pointed at a real kill.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the ledger-row-exists check runs unconditionally, not only when the client saw 250
 * ---------------------------------------------------------------------------------------------
 * A ledger row that exists but whose content does not match what was actually written to disk is a
 * defect regardless of what the client happened to observe -- an auditor reading that row later has
 * no way to know the client never got its receipt. So `checkNeverPartial()` checks completeness of any
 * found row first, and only *afterwards* asks whether the client's own observation is consistent with
 * there being no row at all.
 */

export interface KillIterationObservation {
	/** Did the client's own read of the socket contain a `250 2.0.0 ... queued as <seq>` line? */
	readonly clientSaw250: boolean;
	/** Was a `journal_ledger` row found for this transaction's content hash, in this chain? */
	readonly ledgerRowFound: boolean;
	/** `content_sha256` as stored in that row, if one was found. */
	readonly ledgerContentSha256: Buffer | null;
	/** `size_bytes` as stored in that row, if one was found. */
	readonly ledgerSizeBytes: bigint | null;
	/** Did the spool file the row's `spool_txid` points at exist on disk? */
	readonly spoolFileExists: boolean;
	/** The spool file's bytes, if it existed. */
	readonly spoolFileBytes: Buffer | null;
	/** The exact bytes this iteration intended to send as the message body. */
	readonly expectedBytes: Buffer;
}

/**
 * Judge one iteration. An empty array means the invariant held for this transaction; anything else
 * is a violation description, safe to print verbatim in a test failure message.
 */
export function checkNeverPartial(observation: KillIterationObservation): string[] {
	const violations: string[] = [];
	const expectedHash = createHash('sha256').update(observation.expectedBytes).digest();
	const expectedSize = BigInt(observation.expectedBytes.length);

	if (observation.ledgerRowFound) {
		if (!observation.spoolFileExists || observation.spoolFileBytes === null) {
			violations.push(
				'a journal_ledger row exists for this transaction, but its spool_txid names no file ' +
					'on disk -- a ledger entry with nothing durable behind it.'
			);
		} else if (!observation.spoolFileBytes.equals(observation.expectedBytes)) {
			violations.push(
				`the spool file's bytes (${observation.spoolFileBytes.length} byte(s)) do not match ` +
					`the payload this transaction actually sent (${observation.expectedBytes.length} ` +
					`byte(s)) -- the message is not fully present, only partially.`
			);
		}

		if (
			observation.ledgerContentSha256 === null ||
			!observation.ledgerContentSha256.equals(expectedHash)
		) {
			violations.push(
				"the ledger row's content_sha256 does not match sha256() of the payload actually sent."
			);
		}
		if (observation.ledgerSizeBytes === null || observation.ledgerSizeBytes !== expectedSize) {
			violations.push(
				`the ledger row's size_bytes (${observation.ledgerSizeBytes ?? 'null'}) does not match ` +
					`the payload's actual length (${expectedSize}).`
			);
		}
	}

	if (observation.clientSaw250 && !observation.ledgerRowFound) {
		violations.push(
			'the client observed 250 (a durability promise) but no journal_ledger row exists for this ' +
				'transaction at all -- the central JR-4-10 invariant is broken: the client believes the ' +
				'message is archived and it is not.'
		);
	}

	return violations;
}
