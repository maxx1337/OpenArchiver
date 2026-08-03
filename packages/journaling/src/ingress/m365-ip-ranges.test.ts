import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	diffM365Ranges,
	formatM365RangeDiff,
	M365EndpointFeedError,
	parseM365SmtpRanges,
} from './m365-ip-ranges';

/**
 * `JR-4-09` -- the Microsoft 365 range refresh helper's diff logic. Classification: `ci`.
 *
 * No network access anywhere in this file: the feed is a fixture shaped like the real endpoint web
 * service response (the shape is documented in `m365-ip-ranges.ts`), which is the only way this can
 * be a `ci` test at all -- a test that reaches out to `endpoints.office.com` would fail in an
 * offline CI runner and, worse, would change its own expected values whenever Microsoft edits the
 * feed.
 *
 * The two properties worth stating outright, because they are what makes this helper safe:
 *  - the port-25 filter is what keeps the ACL from being widened to every Exchange front end, so it
 *    is tested against an entry that is Exchange but *not* SMTP;
 *  - the diff never recommends a removal, so the "in the ACL but not official" direction is tested
 *    for what it reports (`unmatched`, with `containedIn` when it is a subnet) rather than for a
 *    delete list.
 */

/** Shaped like the real feed, trimmed to the fields this helper reads. */
const FEED = [
	{
		id: 1,
		serviceArea: 'Exchange',
		serviceAreaDisplayName: 'Exchange Online',
		urls: ['outlook.office.com'],
		ips: ['13.107.6.152/31', '2603:1006::/40'],
		tcpPorts: '80,443',
		category: 'Optimize',
	},
	{
		id: 10,
		serviceArea: 'Exchange',
		urls: ['*.mail.protection.outlook.com'],
		ips: ['40.92.0.0/15', '40.107.0.0/16', '2a01:111:f403::/48'],
		tcpPorts: '25',
		category: 'Allow',
	},
	{
		id: 31,
		serviceArea: 'SharePoint',
		ips: ['13.107.136.0/22'],
		tcpPorts: '443',
	},
	{
		id: 12,
		serviceArea: 'Exchange',
		ips: ['52.100.0.0/14'],
		tcpPorts: '25,587',
	},
];

suite('ci', 'JR-4-09 Microsoft 365 range refresh helper -- parsing the official feed', () => {
	it('keeps only Exchange entries that actually speak port 25', () => {
		const result = parseM365SmtpRanges(FEED);
		expect(result.ranges).toEqual([
			'40.92.0.0/15',
			'40.107.0.0/16',
			'2a01:111:f403::/48',
			'52.100.0.0/14',
		]);
		expect(result.matchedEntryIds).toEqual([10, 12]);
		expect(result.entriesInFeed).toBe(4);
	});

	it('does not take the Exchange web front end (ports 80/443) into the ACL', () => {
		// This is the widening the port filter exists to prevent -- entry id 1 is Exchange, and its
		// ranges must not appear.
		const result = parseM365SmtpRanges(FEED);
		expect(result.ranges).not.toContain('13.107.6.152/31');
		expect(result.ranges).not.toContain('2603:1006::/40');
		expect(result.matchedEntryIds).not.toContain(1);
	});

	it('reads a port range in tcpPorts', () => {
		const result = parseM365SmtpRanges([
			{ id: 7, serviceArea: 'Exchange', ips: ['203.0.113.0/24'], tcpPorts: '20-30' },
		]);
		expect(result.ranges).toEqual(['203.0.113.0/24']);
	});

	it('tolerates unknown fields and a missing id, because Microsoft adds fields without notice', () => {
		const result = parseM365SmtpRanges([
			{
				serviceArea: 'Exchange',
				ips: ['198.51.100.0/24'],
				tcpPorts: '25',
				somethingNewMicrosoftAdded: { nested: true },
			},
		]);
		expect(result.ranges).toEqual(['198.51.100.0/24']);
		expect(result.matchedEntryIds).toEqual([]);
	});

	it('deduplicates a range repeated across entries', () => {
		const result = parseM365SmtpRanges([
			{ id: 10, serviceArea: 'Exchange', ips: ['40.92.0.0/15'], tcpPorts: '25' },
			{ id: 11, serviceArea: 'Exchange', ips: ['40.92.0.0/15'], tcpPorts: '25' },
		]);
		expect(result.ranges).toEqual(['40.92.0.0/15']);
	});

	it('throws rather than returning an empty list when the payload is not the feed', () => {
		// An empty range list would make every official range look absent and the whole ACL look
		// obsolete -- the caller must be able to tell "could not read" from "nothing matched".
		expect(() => parseM365SmtpRanges({ value: [] })).toThrow(M365EndpointFeedError);
		expect(() =>
			parseM365SmtpRanges([{ serviceArea: 'Exchange', ips: 'not-an-array' }])
		).toThrow(M365EndpointFeedError);
	});

	it('returns an empty list, without throwing, for a valid feed that has no SMTP entry', () => {
		const result = parseM365SmtpRanges([
			{ id: 31, serviceArea: 'SharePoint', ips: ['13.107.136.0/22'], tcpPorts: '443' },
		]);
		expect(result.ranges).toEqual([]);
		expect(result.entriesInFeed).toBe(1);
	});
});

suite('ci', 'JR-4-09 Microsoft 365 range refresh helper -- the diff', () => {
	it('reports an official range the ACL does not have', () => {
		const diff = diffM365Ranges({
			configured: ['40.92.0.0/15'],
			official: ['40.92.0.0/15', '40.107.0.0/16'],
		});
		expect(diff.missing).toEqual(['40.107.0.0/16']);
		expect(diff.covered).toEqual(['40.92.0.0/15']);
		expect(diff.upToDate).toBe(false);
	});

	it('compares networks, not strings: two spellings of one IPv6 network are the same entry', () => {
		const diff = diffM365Ranges({
			configured: ['2a01:0111:f403:0000::/48'],
			official: ['2a01:111:f403::/48'],
		});
		expect(diff.missing).toEqual([]);
		expect(diff.unmatched).toEqual([]);
		expect(diff.upToDate).toBe(true);
	});

	it('treats an ACL entry wider than the official range as covering it', () => {
		const diff = diffM365Ranges({ configured: ['40.107.0.0/15'], official: ['40.107.0.0/16'] });
		expect(diff.covered).toEqual(['40.107.0.0/16']);
		expect(diff.missing).toEqual([]);
		// The wider entry is still not *in* the official list, so it is surfaced -- as a question,
		// never as a removal.
		expect(diff.unmatched).toEqual([{ value: '40.107.0.0/15', containedIn: null }]);
	});

	it('never recommends removing an ACL entry the official list does not contain', () => {
		const diff = diffM365Ranges({
			configured: ['192.0.2.0/24', '40.92.0.0/15'],
			official: ['40.92.0.0/15'],
		});
		expect(diff.unmatched).toEqual([{ value: '192.0.2.0/24', containedIn: null }]);
		// Nothing in the result names a deletion, and an unrelated entry does not make the ACL
		// out of date: only a *missing* official range does.
		expect(diff.upToDate).toBe(true);
		expect(Object.keys(diff)).not.toContain('remove');
	});

	it('says when an unmatched ACL entry is narrower than an official range', () => {
		const diff = diffM365Ranges({ configured: ['40.107.5.0/24'], official: ['40.107.0.0/16'] });
		expect(diff.unmatched).toEqual([{ value: '40.107.5.0/24', containedIn: '40.107.0.0/16' }]);
		// The narrower entry does not cover the official range, so the official range is missing.
		expect(diff.missing).toEqual(['40.107.0.0/16']);
	});

	it('does not confuse the two address families', () => {
		const diff = diffM365Ranges({
			configured: ['0.0.0.0/0'],
			official: ['2a01:111:f403::/48'],
		});
		expect(diff.missing).toEqual(['2a01:111:f403::/48']);
	});

	it('reports an unparseable entry on either side instead of dropping it', () => {
		const diff = diffM365Ranges({
			configured: ['not-a-cidr', '40.92.0.0/15'],
			official: ['40.92.0.0/15', '40.107.0.0/999'],
		});
		expect(diff.invalidConfigured.map((i) => i.value)).toEqual(['not-a-cidr']);
		expect(diff.invalidOfficial.map((i) => i.value)).toEqual(['40.107.0.0/999']);
		// An unreadable official entry cannot be called up to date -- it might be a range the ACL
		// is missing.
		expect(diff.upToDate).toBe(false);
	});

	it('over-reports a range covered only by the union of two ACL entries -- the named limitation', () => {
		// Documented in m365-ip-ranges.ts: two /17s cover a /16, but no single entry does. The
		// over-report costs a look and can never widen the ACL silently.
		const diff = diffM365Ranges({
			configured: ['40.107.0.0/17', '40.107.128.0/17'],
			official: ['40.107.0.0/16'],
		});
		expect(diff.missing).toEqual(['40.107.0.0/16']);
	});
});

suite('ci', 'JR-4-09 Microsoft 365 range refresh helper -- the operator report', () => {
	const feed = { matchedEntryIds: [10, 12], entriesInFeed: 78 };

	it('states that nothing was changed, in every case', () => {
		const upToDate = formatM365RangeDiff(
			diffM365Ranges({ configured: ['40.92.0.0/15'], official: ['40.92.0.0/15'] }),
			{ sourceLabel: 'tenant-a', feed }
		);
		const withChanges = formatM365RangeDiff(
			diffM365Ranges({ configured: [], official: ['40.92.0.0/15'] }),
			{ sourceLabel: 'tenant-a', feed }
		);
		for (const report of [upToDate, withChanges]) {
			expect(report).toContain('Nothing was changed');
			expect(report).toContain('apply additions yourself after review');
		}
	});

	it('lists additions with a + and questions with a ?, and names the source', () => {
		const report = formatM365RangeDiff(
			diffM365Ranges({ configured: ['192.0.2.0/24'], official: ['40.92.0.0/15'] }),
			{ sourceLabel: 'tenant-a', feed }
		);
		expect(report).toContain('journaling source: tenant-a');
		expect(report).toContain('+ 40.92.0.0/15');
		expect(report).toContain('? 192.0.2.0/24');
		expect(report).toContain('NOT a removal');
		expect(report).toContain('id 10, 12');
	});

	it('warns that an empty official list means "feed not read", not "ACL obsolete"', () => {
		const report = formatM365RangeDiff(
			diffM365Ranges({ configured: ['192.0.2.0/24'], official: [] }),
			{
				sourceLabel: 'tenant-a',
				feed: { matchedEntryIds: [], entriesInFeed: 78 },
			}
		);
		expect(report).toContain('feed not read');
	});
});
