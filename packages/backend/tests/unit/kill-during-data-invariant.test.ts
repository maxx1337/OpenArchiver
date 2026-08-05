import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	checkNeverPartial,
	type KillIterationObservation,
} from '../support/kill-during-data-invariant';

/**
 * Calibration for `checkNeverPartial()` (`JR-4-10`) -- the pure function that judges whether one
 * kill-during-DATA iteration upheld Testplan section 12.1's invariant. Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this file exists on its own, separate from the real kill test
 * ---------------------------------------------------------------------------------------------
 * The tester role's own standing rule: "I found nothing" is not a result until the same tool is shown
 * to find the *known* case. `smtp-ingress-kill-during-data.adv.test.ts` spawns a real process, sends
 * up to 50 MB, and kills it with a real `SIGKILL` -- on this Windows host, `fsyncDirectory()` fails
 * with `EPERM` (F48) before every single `accept()` call, so **every** iteration resolves to `451`
 * and never reaches the ledger at all. A green run of that file, on this host, proves nothing about
 * whether the checker would have caught a violation, because no iteration here can ever produce one.
 *
 * This file removes that platform dependency entirely: seven hand-built observations, four of them
 * deliberately violating the invariant, run through the exact function the real test calls. Four
 * failures reported, three clean passes -- that is the calibration, and it needs no process, no
 * socket, and no database.
 */

const payload = Buffer.from('X'.repeat(4096), 'utf8');
const payloadHash = createHash('sha256').update(payload).digest();
const otherPayload = Buffer.from('Y'.repeat(2048), 'utf8');

function baseObservation(overrides: Partial<KillIterationObservation>): KillIterationObservation {
	return {
		clientSaw250: false,
		ledgerRowFound: false,
		ledgerContentSha256: null,
		ledgerSizeBytes: null,
		spoolFileExists: false,
		spoolFileBytes: null,
		expectedBytes: payload,
		...overrides,
	};
}

suite('ci', 'checkNeverPartial() -- JR-4-10 invariant checker calibration', () => {
	it('GOOD: client saw 250, ledger row and spool file both match exactly -> no violation', () => {
		const observation = baseObservation({
			clientSaw250: true,
			ledgerRowFound: true,
			ledgerContentSha256: payloadHash,
			ledgerSizeBytes: BigInt(payload.length),
			spoolFileExists: true,
			spoolFileBytes: payload,
		});
		expect(checkNeverPartial(observation)).toEqual([]);
	});

	it('GOOD: client never saw 250 and no ledger row exists -> no violation (the ordinary killed-mid-transfer case)', () => {
		const observation = baseObservation({
			clientSaw250: false,
			ledgerRowFound: false,
		});
		expect(checkNeverPartial(observation)).toEqual([]);
	});

	it('GOOD: client never saw 250 but the ledger row exists and is fully correct -> no violation (the response-lost-in-the-kill race, not a defect)', () => {
		const observation = baseObservation({
			clientSaw250: false,
			ledgerRowFound: true,
			ledgerContentSha256: payloadHash,
			ledgerSizeBytes: BigInt(payload.length),
			spoolFileExists: true,
			spoolFileBytes: payload,
		});
		expect(checkNeverPartial(observation)).toEqual([]);
	});

	it('BAD (must be caught): client saw 250 but no ledger row exists at all -- the worst case, a receipt for nothing', () => {
		const observation = baseObservation({
			clientSaw250: true,
			ledgerRowFound: false,
		});
		const violations = checkNeverPartial(observation);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations.some((v) => v.includes('no journal_ledger row exists'))).toBe(true);
	});

	it('BAD (must be caught): client saw 250, a ledger row exists, but the spool file is missing', () => {
		const observation = baseObservation({
			clientSaw250: true,
			ledgerRowFound: true,
			ledgerContentSha256: payloadHash,
			ledgerSizeBytes: BigInt(payload.length),
			spoolFileExists: false,
			spoolFileBytes: null,
		});
		const violations = checkNeverPartial(observation);
		expect(violations.some((v) => v.includes('names no file on disk'))).toBe(true);
	});

	it('BAD (must be caught): ledger row exists, but the spool file on disk is truncated -- not the payload that was sent', () => {
		const truncated = payload.subarray(0, payload.length - 16);
		const observation = baseObservation({
			clientSaw250: true,
			ledgerRowFound: true,
			ledgerContentSha256: payloadHash,
			ledgerSizeBytes: BigInt(payload.length),
			spoolFileExists: true,
			spoolFileBytes: truncated,
		});
		const violations = checkNeverPartial(observation);
		expect(violations.some((v) => v.includes('do not match the payload'))).toBe(true);
	});

	it('BAD (must be caught): ledger row exists and its own hash matches, but it is the wrong message entirely (content_sha256 for a different payload)', () => {
		const observation = baseObservation({
			clientSaw250: false,
			ledgerRowFound: true,
			ledgerContentSha256: createHash('sha256').update(otherPayload).digest(),
			ledgerSizeBytes: BigInt(otherPayload.length),
			spoolFileExists: true,
			spoolFileBytes: otherPayload,
			expectedBytes: payload,
		});
		const violations = checkNeverPartial(observation);
		expect(
			violations.some((v) => v.includes('content_sha256 does not match')) ||
				violations.some((v) => v.includes('do not match the payload'))
		).toBe(true);
	});
});
