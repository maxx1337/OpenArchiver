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
	it('returns parse_failed when the inner message/rfc822 part is missing, still accepted -- not rejected', async () => {
		const raw = loadFixture('missing-inner-part.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('parse_failed');
		if (result.kind !== 'parse_failed') {
			throw new Error('unreachable');
		}
		expect(result.reason.length).toBeGreaterThan(0);
		expect(result.reason).toContain('no message/rfc822 inner part');
	});

	it('JR-5-03: a missing inner part still surfaces the report envelope as extractableHeaders, not an information void', async () => {
		const raw = loadFixture('missing-inner-part.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('parse_failed');
		if (result.kind !== 'parse_failed') {
			throw new Error('unreachable');
		}
		// The report part parsed fine (see the fixture: Sender/Subject/Message-Id lines are all
		// present) even though the inner message/rfc822 part is missing -- JR-5-04's "index what's
		// extractable" needs exactly this, and a `parse_failed` carrying only `reason` could not
		// provide it.
		expect(result.extractableHeaders).toEqual({
			subject: 'Broken report',
			from: 'sender@contoso.com',
			messageId: '<inner-4@contoso.com>',
		});
	});

	it('returns parse_failed when the outer message is not multipart/mixed at all', async () => {
		const raw = loadFixture('not-multipart.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('parse_failed');
		if (result.kind !== 'parse_failed') {
			throw new Error('unreachable');
		}
		// Fallback header extraction (JR-5-04): this fixture's own top-level headers are still
		// readable RFC 5322 headers, even though the message never matched the journal-report shape.
		expect(result.extractableHeaders.subject).not.toBeNull();
	});

	it('returns parse_failed rather than throwing on a completely empty buffer', async () => {
		const result = await parseJournalReport(Buffer.alloc(0));
		expect(result.kind).toBe('parse_failed');
		if (result.kind !== 'parse_failed') {
			throw new Error('unreachable');
		}
		expect(result.extractableHeaders).toEqual({ subject: null, from: null, messageId: null });
	});

	it('returns parse_failed rather than throwing on random binary garbage', async () => {
		const random = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 37 + 11) % 256));
		const result = await parseJournalReport(random);
		expect(result.kind).toBe('parse_failed');
	});

	/**
	 * `JR-5-03`'s acceptance criterion is "kein Fall führt zu einer Ablehnung": this loop is the
	 * direct evidence, over the specific shapes the task names -- truncated, wrong boundary, nested
	 * multiparts, 8-bit garbage, empty buffer, headers-only, and an unterminated boundary -- that
	 * none of them ever throws out of `parseJournalReport()`. `Promise.allSettled` would hide a
	 * thrown rejection inside a per-item catch; awaiting each call directly, inside the `it`, is what
	 * lets a thrown exception fail the test instead.
	 */
	const brokenInputs: ReadonlyArray<{ readonly name: string; readonly raw: () => Buffer }> = [
		{
			name: 'truncated mid-inner-part (no closing boundary at all)',
			raw: () =>
				Buffer.from(
					[
						'From: journal@contoso.com',
						'To: journal-archive@example.org',
						'Subject: FW: cut off',
						'MIME-Version: 1.0',
						'Content-Type: multipart/mixed; boundary="TruncBoundary"',
						'',
						'--TruncBoundary',
						'Content-Type: text/plain; charset="us-ascii"',
						'',
						'Sender: alice@contoso.com',
						'',
						'--TruncBoundary',
						'Content-Type: message/rfc822',
						'',
						'From: alice@contoso.com',
						'Subject: cut off mid-h',
					].join('\r\n'),
					'utf8'
				),
		},
		{
			name: 'wrong boundary (Content-Type names one boundary, body delimits with another)',
			raw: () =>
				Buffer.from(
					[
						'From: journal@contoso.com',
						'To: journal-archive@example.org',
						'Subject: FW: wrong boundary',
						'MIME-Version: 1.0',
						'Content-Type: multipart/mixed; boundary="DeclaredBoundary"',
						'',
						'--ActuallyUsedBoundary',
						'Content-Type: text/plain; charset="us-ascii"',
						'',
						'Sender: alice@contoso.com',
						'',
						'--ActuallyUsedBoundary',
						'Content-Type: message/rfc822',
						'',
						'From: alice@contoso.com',
						'',
						'body',
						'--ActuallyUsedBoundary--',
						'',
					].join('\r\n'),
					'utf8'
				),
		},
		{
			name: 'nested multipart/alternative where the report part is expected',
			raw: () =>
				Buffer.from(
					[
						'From: journal@contoso.com',
						'To: journal-archive@example.org',
						'Subject: FW: nested',
						'MIME-Version: 1.0',
						'Content-Type: multipart/mixed; boundary="OuterBoundary"',
						'',
						'--OuterBoundary',
						'Content-Type: multipart/alternative; boundary="InnerAltBoundary"',
						'',
						'--InnerAltBoundary',
						'Content-Type: text/plain; charset="us-ascii"',
						'',
						'Sender: alice@contoso.com',
						'--InnerAltBoundary--',
						'',
						'--OuterBoundary',
						'Content-Type: message/rfc822',
						'',
						'From: alice@contoso.com',
						'',
						'body',
						'--OuterBoundary--',
						'',
					].join('\r\n'),
					'utf8'
				),
		},
		{
			name: '8-bit garbage with no recognisable header block at all',
			raw: () => Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 251 + 37) % 256)),
		},
		{ name: 'completely empty buffer', raw: () => Buffer.alloc(0) },
		{
			name: 'headers only, no blank-line body separator at all',
			raw: () =>
				Buffer.from(
					'From: journal@contoso.com\r\nSubject: only headers\r\nContent-Type: multipart/mixed; boundary="X"',
					'utf8'
				),
		},
		{
			name: 'boundary opened but never terminated (only one delimiter line)',
			raw: () =>
				Buffer.from(
					[
						'From: journal@contoso.com',
						'To: journal-archive@example.org',
						'Subject: FW: unterminated',
						'MIME-Version: 1.0',
						'Content-Type: multipart/mixed; boundary="Unterminated"',
						'',
						'--Unterminated',
						'Content-Type: text/plain; charset="us-ascii"',
						'',
						'Sender: alice@contoso.com',
						'',
					].join('\r\n'),
					'utf8'
				),
		},
	];

	for (const { name, raw } of brokenInputs) {
		it(`never throws: ${name}`, async () => {
			const result = await parseJournalReport(raw());
			expect(result.kind === 'journal_report' || result.kind === 'parse_failed').toBe(true);
		});
	}
});

suite('ci', 'parseJournalReport() -- S/MIME-encrypted inner part (JR-5-03)', () => {
	it('is accepted as kind "journal_report", stores the inner message unchanged, and flags contentEncrypted', async () => {
		const raw = loadFixture('smime-encrypted-inner.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('journal_report');
		if (result.kind !== 'journal_report') {
			throw new Error('unreachable');
		}
		expect(result.innerMessage.present).toBe(true);
		if (!result.innerMessage.present) {
			throw new Error('unreachable');
		}
		expect(result.innerMessage.contentEncrypted).toBe(true);
		// The (still-plaintext) inner message headers are readable and indexable...
		expect(result.innerMessage.subject).toBe('Confidential contract');
		expect(result.innerMessage.messageId).toBe('<inner-5@contoso.com>');
		// ...but the raw bytes handed back are the unmodified inner message, ciphertext body
		// included -- never re-encoded, never stripped (README constraint 3) -- and a caller must
		// consult contentEncrypted before treating any of it as indexable body text.
		expect(Buffer.from(result.innerMessage.raw).toString('utf8')).toContain(
			'application/pkcs7-mime'
		);
	});

	it('never mutates the raw message buffer for an S/MIME-encrypted inner part', async () => {
		const raw = loadFixture('smime-encrypted-inner.eml');
		const copy = Buffer.from(raw);
		await parseJournalReport(raw);
		expect(Buffer.compare(raw, copy)).toBe(0);
	});
});

suite(
	'ci',
	'parseJournalReport() -- S/MIME clear-signed inner part is readable, not encrypted (JR-5-03)',
	() => {
		it('leaves contentEncrypted false for multipart/signed + application/pkcs7-signature', async () => {
			const raw = loadFixture('smime-signed-inner.eml');
			const result = await parseJournalReport(raw);
			expect(result.kind).toBe('journal_report');
			if (result.kind !== 'journal_report') {
				throw new Error('unreachable');
			}
			expect(result.innerMessage.present).toBe(true);
			if (!result.innerMessage.present) {
				throw new Error('unreachable');
			}
			expect(result.innerMessage.contentEncrypted).toBe(false);
			expect(result.innerMessage.subject).toBe('Signed announcement');
			expect(Buffer.from(result.innerMessage.raw).toString('utf8')).toContain(
				'SIGNED-BODY-MARKER'
			);
		});
	}
);
