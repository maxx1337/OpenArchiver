import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { loadFixture } from '../../tests/support/fixtures';
import { parseJournalReport } from './journal-report';

/**
 * `parseJournalReport()` (`JR-5-01`/`JR-5-02`, RFC section 6.1). Classification: `ci`.
 *
 * Covers the acceptance criteria directly:
 *  - "Innen- und Außenteil verfügbar" -- both parts show up in the result.
 *  - "das archivierte Objekt ist die rohe Außenmail" -- this module never returns bytes meant to
 *    replace the caller's copy, and (separately, structurally) never mutates the buffer it is
 *    given -- proved here byte-for-byte, not just asserted.
 *  - "Bcc-Empfänger und DL-Mitglieder erscheinen in den gespeicherten Metadaten" -- via the
 *    envelope's `bcc`/`recipients` fields, on the fixture built for exactly that case.
 *  - The parser never throws, for any of the malformed-input fixtures.
 */

suite('ci', 'parseJournalReport() -- the basic case', () => {
	it('returns kind "journal_report" with both the envelope and the inner message available', async () => {
		const raw = loadFixture('basic-journal-report.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('journal_report');
		if (result.kind !== 'journal_report') {
			throw new Error('unreachable');
		}
		expect(result.envelope.sender).toBe('alice@contoso.com');
		expect(result.envelope.subject).toBe('Quarterly numbers');
		expect(result.envelope.messageId).toBe('<inner-1@contoso.com>');
		expect(result.envelope.to).toEqual(['bob@contoso.com', 'carol@contoso.com']);
		expect(result.envelope.cc).toEqual(['dave@contoso.com']);
		expect(result.envelope.recipients).toEqual([
			'bob@contoso.com',
			'carol@contoso.com',
			'dave@contoso.com',
		]);
		expect(result.innerMessage.present).toBe(true);
		if (!result.innerMessage.present) {
			throw new Error('unreachable');
		}
		expect(result.innerMessage.subject).toBe('Quarterly numbers');
		expect(result.innerMessage.messageId).toBe('<inner-1@contoso.com>');
		expect(Buffer.from(result.innerMessage.raw).toString('utf8')).toContain(
			'Please find the quarterly numbers attached.'
		);
	});

	it('never mutates the raw message buffer it was given', async () => {
		const raw = loadFixture('basic-journal-report.eml');
		const copy = Buffer.from(raw);
		await parseJournalReport(raw);
		expect(Buffer.compare(raw, copy)).toBe(0);
	});
});

suite('ci', 'parseJournalReport() -- Bcc and distribution-list expansion in the metadata', () => {
	it('surfaces Bcc recipients and DL-expansion members that never appear in To/Cc', async () => {
		const raw = loadFixture('bcc-and-dl-expansion.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('journal_report');
		if (result.kind !== 'journal_report') {
			throw new Error('unreachable');
		}
		// The transport-visible headers only ever show the distribution list address itself and the
		// on-behalf-of sender -- never the Bcc recipient, never the expanded DL members.
		expect(result.envelope.to).toEqual(['team@contoso.com']);
		expect(result.envelope.bcc).toEqual(['secretwatcher@contoso.com']);
		expect(result.envelope.onBehalfOf).toBe('assistant@contoso.com');
		// Recipient: is where all of it shows up, in report order, including the DL expansion noted
		// on indented continuation lines under the DL's own Recipient: entry.
		expect(result.envelope.recipients).toEqual([
			'team@contoso.com',
			'dl-member-one@contoso.com',
			'dl-member-two@contoso.com',
			'dl-member-three@contoso.com',
			'secretwatcher@contoso.com',
		]);
	});
});

suite('ci', 'parseJournalReport() -- undisclosed recipients', () => {
	it('records that To carried the placeholder while still reporting the true Recipient: list', async () => {
		const raw = loadFixture('undisclosed-recipients.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('journal_report');
		if (result.kind !== 'journal_report') {
			throw new Error('unreachable');
		}
		expect(result.envelope.undisclosedRecipientFields).toEqual(['to']);
		expect(result.envelope.to).toEqual([]);
		expect(result.envelope.recipients).toEqual([
			'hidden-one@contoso.com',
			'hidden-two@contoso.com',
		]);
	});
});

suite('ci', 'parseJournalReport() -- display names in To/Cc (R2)', () => {
	it('extracts bare addresses out of quoted display names and angle-address syntax', async () => {
		const raw = loadFixture('display-names-in-headers.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('journal_report');
		if (result.kind !== 'journal_report') {
			throw new Error('unreachable');
		}
		expect(result.envelope.to).toEqual(['john@contoso.com', 'bob@contoso.com']);
		expect(result.envelope.cc).toEqual(['ann@contoso.com']);
	});
});

suite('ci', 'parseJournalReport() -- inner part with Content-Disposition: inline (R1)', () => {
	it('keeps the report text free of the inner message body even when mailparser would otherwise merge them', async () => {
		const raw = loadFixture('inline-inner-message.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('journal_report');
		if (result.kind !== 'journal_report') {
			throw new Error('unreachable');
		}
		expect(result.reportText).not.toContain('INNER-BODY-MARKER');
		expect(result.envelope.sender).toBe('alice@contoso.com');
		expect(result.envelope.unknownFields).toEqual([]);
		expect(result.innerMessage.present).toBe(true);
		if (!result.innerMessage.present) {
			throw new Error('unreachable');
		}
		expect(Buffer.from(result.innerMessage.raw).toString('utf8')).toContain(
			'INNER-BODY-MARKER'
		);
	});
});

suite('ci', 'parseJournalReport() -- never throws on malformed input', () => {
	it('returns parse_failed when the inner message/rfc822 part is missing', async () => {
		const raw = loadFixture('missing-inner-part.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('parse_failed');
		if (result.kind !== 'parse_failed') {
			throw new Error('unreachable');
		}
		expect(result.reason.length).toBeGreaterThan(0);
	});

	it('returns parse_failed when the outer message is not multipart/mixed at all', async () => {
		const raw = loadFixture('not-multipart.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('parse_failed');
	});

	it('returns parse_failed rather than throwing on a completely empty buffer', async () => {
		const result = await parseJournalReport(Buffer.alloc(0));
		expect(result.kind).toBe('parse_failed');
	});

	it('returns parse_failed rather than throwing on random binary garbage', async () => {
		const random = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 37 + 11) % 256));
		const result = await parseJournalReport(random);
		expect(result.kind).toBe('parse_failed');
	});
});
