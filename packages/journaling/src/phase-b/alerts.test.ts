import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	alertSeverityFor,
	noopPhaseBAlertSink,
	type PhaseBAlert,
	type PhaseBAlertSink,
} from './alerts';
import type { SpoolEntryVerdict } from './spool-entry-gate';

/**
 * Phase-B alerting (`JR-6-02a`). Classification: `ci`.
 *
 * The severity mapping is the only behaviour here, and it is worth pinning because the failure mode is
 * social rather than technical: if the expected consequence of an abrupt shutdown (`no_receipt`) pages
 * someone at the same level as a byte-level integrity failure (`content_mismatch`), the channel gets
 * ignored and the one alert that needed a human is the one that gets missed.
 */

function verdictOf(kind: SpoolEntryVerdict['kind']): SpoolEntryVerdict {
	switch (kind) {
		case 'archive':
			return {
				kind: 'archive',
				seq: 1n,
				chainScopeId: 'c',
				journalingSourceId: null,
				receivedAt: new Date(0),
				contentSha256Hex: '0'.repeat(64),
				sizeBytes: 1,
			};
		case 'no_receipt':
			return { kind: 'no_receipt', reason: 'r' };
		case 'not_a_receipt':
			return { kind: 'not_a_receipt', eventType: 'anchor', reason: 'r' };
		case 'receipt_without_hash':
			return { kind: 'receipt_without_hash', seq: 1n, reason: 'r' };
		case 'content_mismatch':
			return {
				kind: 'content_mismatch',
				seq: 1n,
				expectedSha256Hex: '0'.repeat(64),
				actualSha256Hex: '1'.repeat(64),
				expectedSizeBytes: 1n,
				actualSizeBytes: 2,
				reason: 'r',
			};
	}
}

suite('ci', 'alertSeverityFor()', () => {
	it('rates a content mismatch critical -- it is the only integrity event of the five', () => {
		expect(alertSeverityFor(verdictOf('content_mismatch'))).toBe('critical');
	});

	it.each([['no_receipt'], ['not_a_receipt'], ['receipt_without_hash']] as const)(
		'rates %s a warning -- recoverable, and nothing was lost or altered',
		(kind) => {
			expect(alertSeverityFor(verdictOf(kind))).toBe('warning');
		}
	);

	it('throws for an archive verdict instead of inventing a severity', () => {
		// A caller that alerts on the success path has a bug. Returning 'warning' quietly would hide it.
		expect(() => alertSeverityFor(verdictOf('archive'))).toThrow(/not\s+an alertable event/);
	});
});

suite('ci', 'PhaseBAlertSink', () => {
	it('is synchronous by contract -- an alert channel may not add a failure mode to archiving', () => {
		const seen: PhaseBAlert[] = [];
		const sink: PhaseBAlertSink = (alert) => {
			seen.push(alert);
		};
		const verdict = verdictOf('content_mismatch');
		const returned = sink({
			spoolTxId: '01JQZX0000000000000000000A',
			spoolPath: '/spool/incoming/ab/01JQZX0000000000000000000A.eml',
			verdict,
			severity: alertSeverityFor(verdict),
		});
		// `void`, not a promise: a sink that awaited a network round trip inside the Phase-B path would
		// put archiving behind the availability of the alert channel.
		expect(returned).toBeUndefined();
		expect(seen).toHaveLength(1);
		expect(seen[0]!.severity).toBe('critical');
	});

	it('passes the verdict through verbatim, so a sink can act on `kind` without parsing prose', () => {
		let received: PhaseBAlert | undefined;
		const sink: PhaseBAlertSink = (alert) => {
			received = alert;
		};
		const verdict = verdictOf('content_mismatch');
		sink({ spoolTxId: 'x'.repeat(26), spoolPath: '/p', verdict, severity: 'critical' });
		expect(received?.verdict).toBe(verdict);
		if (received?.verdict.kind === 'content_mismatch') {
			expect(received.verdict.actualSha256Hex).toBe('1'.repeat(64));
		} else {
			throw new Error('the verdict did not survive the sink unchanged');
		}
	});

	it('the noop sink swallows an alert and returns nothing', () => {
		expect(
			noopPhaseBAlertSink({
				spoolTxId: 'y'.repeat(26),
				spoolPath: '/p',
				verdict: verdictOf('no_receipt'),
				severity: 'warning',
			})
		).toBeUndefined();
	});
});
