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

suite(
	'ci',
	'parseJournalReport() -- missing inner part: accepted, envelope kept intact (JR-5-03, PO review R1)',
	() => {
		it('stays kind "journal_report" with innerMessage.present === false, never parse_failed', async () => {
			const raw = loadFixture('missing-inner-part.eml');
			const result = await parseJournalReport(raw);
			expect(result.kind).toBe('journal_report');
			if (result.kind !== 'journal_report') {
				throw new Error('unreachable');
			}
			expect(result.innerMessage.present).toBe(false);
			// The report part parsed fine (Sender/Subject/Message-Id/To/Recipient are all present in
			// the fixture) even though the inner message/rfc822 part is missing -- the envelope must
			// not be reduced to a header triple just because the inner message could not be found.
			expect(result.envelope.sender).toBe('sender@contoso.com');
			expect(result.envelope.subject).toBe('Broken report');
			expect(result.envelope.messageId).toBe('<inner-4@contoso.com>');
			expect(result.envelope.recipients).toEqual(['someone@contoso.com']);
		});

		it('keeps Bcc recipients and DL-expansion members even when the inner part is missing', async () => {
			// The sharpest form of PO review R1: this is the exact scenario JR-5-02's own acceptance
			// criterion names ("Bcc-Empfänger und DL-Mitglieder erscheinen in den gespeicherten
			// Metadaten") combined with JR-5-03's "kein Innenteil" case. Losing Bcc/DL here would be
			// losing RFC section 6.1's "entire justification for this feature", not a cosmetic gap.
			const raw = loadFixture('missing-inner-part-bcc-and-dl.eml');
			const result = await parseJournalReport(raw);
			expect(result.kind).toBe('journal_report');
			if (result.kind !== 'journal_report') {
				throw new Error('unreachable');
			}
			expect(result.innerMessage.present).toBe(false);
			expect(result.envelope.to).toEqual(['team@contoso.com']);
			expect(result.envelope.bcc).toEqual(['secretwatcher@contoso.com']);
			expect(result.envelope.onBehalfOf).toBe('assistant@contoso.com');
			expect(result.envelope.recipients).toEqual([
				'team@contoso.com',
				'dl-member-one@contoso.com',
				'dl-member-two@contoso.com',
				'secretwatcher@contoso.com',
			]);
			expect(result.envelope.unknownFields).toEqual([
				{ name: 'x-custom-marker', value: 'keep-me' },
			]);
		});
	}
);

suite('ci', 'parseJournalReport() -- never throws on malformed input', () => {
	it('classifies a well-formed message with no journal wrapper as plain_bcc, not parse_failed (JR-5-05)', async () => {
		// `not-multipart.eml` is a well-formed, ordinary RFC 5322 message ("This message was sent to
		// the journaling address by mistake") -- exactly the shape JR-5-05 exists for, not a broken
		// journal report. Before JR-5-05 there was no `'plain_bcc'` kind to put it in, so it fell into
		// `parse_failed`; now that the kind exists, that was a temporary approximation, not the
		// intended final classification -- see `parseJournalReport()`'s module doc comment.
		const raw = loadFixture('not-multipart.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('plain_bcc');
		if (result.kind !== 'plain_bcc') {
			throw new Error('unreachable');
		}
		expect(result.reducedEnvelopeFidelity).toBe(true);
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

	it('returns parse_failed rather than throwing on random binary garbage (not a well-formed message, JR-5-05)', async () => {
		// Distinguishes "no journal wrapper, but a real message" (plain_bcc, above) from "not
		// recognisable as a message at all" -- these must not be conflated
		// (`looksLikeOrdinaryMessage()`'s guard in journal-report.ts).
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
	 *
	 * The assertion below accepts all four `kind`s the union now has (`JR-5-05`/`JR-5-06` added
	 * `'plain_bcc'`/`'ndr'` to the two that existed when this loop was written) -- this loop was never
	 * about *which* kind comes back, only that *some* well-formed, non-throwing result does. One
	 * fixture's classification changed with PO review R3's stricter discriminator:
	 * "truncated mid-inner-part" produces a report part containing only `Sender:` and no `Recipient:`
	 * line (the truncation happens in the *second* part, not this one) -- `looksLikeGenuineJournalReport()`
	 * now requires `Recipient:` specifically, so this lands on `plain_bcc` rather than `journal_report`.
	 * That is the intended, conservative direction (reduced fidelity, not fabricated evidence), not a
	 * regression; the fixture's actual point -- no throw -- still holds.
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

	const VALID_RESULT_KINDS = new Set(['journal_report', 'parse_failed', 'plain_bcc', 'ndr']);

	for (const { name, raw } of brokenInputs) {
		it(`never throws: ${name}`, async () => {
			const result = await parseJournalReport(raw());
			expect(VALID_RESULT_KINDS.has(result.kind)).toBe(true);
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

	it('recognises the deprecated application/x-pkcs7-mime alias the same way (PO review R3)', async () => {
		const raw = loadFixture('smime-encrypted-inner-legacy.eml');
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
		expect(result.innerMessage.subject).toBe('Confidential contract (legacy content type)');
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

/**
 * `JR-5-05`, RFC section 6.2: plain-BCC/routing-rule fallback. Acceptance criterion: "Postfix-
 * `always_bcc`- und Google-Routing-Muster werden korrekt erkannt und markiert" -- both patterns are
 * byte-for-byte the same shape (an ordinary message with no journal wrapper at all; RFC section 6.2
 * says Google Workspace routing gets identical treatment to plain BCC, precisely because Workspace has
 * no SMTP-journaling equivalent of its own), so both fixtures below assert the same `kind` and the
 * same `reducedEnvelopeFidelity` -- the "recognition" is that neither is misclassified as
 * `parse_failed` (the outcome before this slice existed) nor silently treated as a full-fidelity
 * journal report.
 */
suite('ci', 'parseJournalReport() -- plain BCC / routing-rule fallback (JR-5-05)', () => {
	it('classifies a Postfix always_bcc-style copy as plain_bcc with the SMTP envelope attached', async () => {
		const raw = loadFixture('plain-bcc-postfix-always-bcc.eml');
		const result = await parseJournalReport(raw, {
			envelopeFrom: 'alice@contoso.com',
			envelopeRcpt: ['journal-archive@example.org'],
		});
		expect(result.kind).toBe('plain_bcc');
		if (result.kind !== 'plain_bcc') {
			throw new Error('unreachable');
		}
		// Reduced fidelity is a structural fact of this kind, not a per-message observation -- always
		// literally `true` (see `JournalPlainBcc`'s doc comment).
		expect(result.reducedEnvelopeFidelity).toBe(true);
		// The envelope carried through is this receiver's own SMTP transaction, using exactly the
		// `envelopeFrom`/`envelopeRcpt` field names `JournalTransactionInput` and the ledger row use --
		// not a renamed or reshaped copy.
		expect(result.envelope).toEqual({
			envelopeFrom: 'alice@contoso.com',
			envelopeRcpt: ['journal-archive@example.org'],
		});
		expect(result.extractableHeaders.subject).toBe('Q3 budget draft');
		expect(result.extractableHeaders.from).toContain('alice@contoso.com');
	});

	it('classifies a Google Workspace "also deliver to" routing copy identically (RFC section 6.2)', async () => {
		const raw = loadFixture('plain-bcc-google-routing.eml');
		const result = await parseJournalReport(raw, {
			envelopeFrom: 'dave@workspace-example.com',
			envelopeRcpt: ['journal-archive@example.org'],
		});
		expect(result.kind).toBe('plain_bcc');
		if (result.kind !== 'plain_bcc') {
			throw new Error('unreachable');
		}
		expect(result.reducedEnvelopeFidelity).toBe(true);
		expect(result.envelope).toEqual({
			envelopeFrom: 'dave@workspace-example.com',
			envelopeRcpt: ['journal-archive@example.org'],
		});
		expect(result.extractableHeaders.subject).toBe('Vendor contract renewal');
	});

	it('falls back to an unknown envelope rather than fabricating one when the caller supplies none', async () => {
		// `parseJournalReport()`'s second parameter defaults to "no SMTP envelope information
		// available" -- this must surface as `null`/`null`, never as an empty array or an invented
		// address, so a caller can tell "we don't know" apart from "we know it was empty".
		const raw = loadFixture('plain-bcc-postfix-always-bcc.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('plain_bcc');
		if (result.kind !== 'plain_bcc') {
			throw new Error('unreachable');
		}
		expect(result.envelope).toEqual({ envelopeFrom: null, envelopeRcpt: null });
	});

	/**
	 * PO review R2: a green suite that never asserted the full envelope survives is exactly how the
	 * last round's silent data loss went unnoticed. This test names the failure mode directly --
	 * every `envelopeRcpt` entry, in arrival order, including a repeated one, must come back
	 * unchanged. A `Set`-based dedup or a `.sort()` introduced by a future refactor would pass every
	 * other test in this file (they all use single-recipient envelopes) and only fail here.
	 */
	it('passes every envelopeRcpt entry through in order, without deduplicating, alongside reducedEnvelopeFidelity', async () => {
		const raw = loadFixture('plain-bcc-postfix-always-bcc.eml');
		const envelopeRcpt = [
			'journal-archive@example.org',
			'journal-archive@example.org',
			'compliance-audit@example.org',
		];
		const result = await parseJournalReport(raw, {
			envelopeFrom: 'alice@contoso.com',
			envelopeRcpt,
		});
		expect(result.kind).toBe('plain_bcc');
		if (result.kind !== 'plain_bcc') {
			throw new Error('unreachable');
		}
		expect(result.reducedEnvelopeFidelity).toBe(true);
		expect(result.envelope.envelopeRcpt).toEqual(envelopeRcpt);
		expect(result.envelope.envelopeRcpt).toHaveLength(3);
	});
});

/**
 * PO review R1 (on top of `JR-5-03`): the report-part-found/inner-part-missing shape
 * (`multipart/mixed`, `text/plain` body, no `message/rfc822` child) is not, by itself, proof of a
 * journal report -- an ordinary attachment-bearing email delivered via Postfix `always_bcc` or a
 * Google routing rule is *also* exactly that shape, because the attachment is not a `message/rfc822`
 * part either. `JR-5-03`'s original rule ("report found, inner missing ⇒ `journal_report`") is
 * refined here, not replaced: it now additionally requires the report part to have yielded at least
 * one field this parser recognises (see `hasRecognizedEnvelopeField()` in `journal-report.ts`).
 *
 * Both fixtures in this suite share the exact same MIME shape at the top level
 * (`multipart/mixed` / `text/plain` / no inner part) and must land on opposite `kind`s -- that
 * contrast is the whole point of the discriminator this suite proves.
 */
suite(
	'ci',
	'parseJournalReport() -- MIME structure never proves a journal report (PO review R1/R3/R4)',
	() => {
		it('classifies a plain-BCC copy of an ordinary attachment-bearing email as plain_bcc, not journal_report', async () => {
			// Measured by the PO against the pre-R1 code: this fixture used to come back as
			// `kind: 'journal_report'`, `innerMessage.present: false`, `envelope.sender: null`, with the
			// message's own prose body ("Hallo Bob, anbei die Rechnung." / "Viele Gruesse") sitting in
			// `unknownFields` under the synthetic `_unparsed` name -- free text in an envelope metadata
			// field, no `reducedEnvelopeFidelity`, and no SMTP envelope attached at all despite this
			// being exactly the case (a plain-BCC copy) that has no other recipient evidence to offer.
			const raw = loadFixture('plain-bcc-with-attachment.eml');
			const result = await parseJournalReport(raw, {
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			});
			expect(result.kind).toBe('plain_bcc');
			if (result.kind !== 'plain_bcc') {
				throw new Error('unreachable');
			}
			expect(result.reducedEnvelopeFidelity).toBe(true);
			expect(result.envelope).toEqual({
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			});
			expect(result.extractableHeaders.subject).toBe('Rechnung Oktober');
		});

		it('classifies a FORWARDED message with a quoted header and an attachment as plain_bcc, not journal_report (PO review R3)', async () => {
			// Measured by the PO against R1's first discriminator version: R1 accepted any of
			// Sender/Subject/Message-Id/On-Behalf-Of/To/Cc/Bcc as proof of a journal report, and a
			// forwarded message's quoted "---------- Forwarded message ---------" header block
			// satisfies exactly To/Cc/Subject -- so R1's version returned `kind: 'journal_report'` with
			// `envelope.to = ['bob@contoso.com']`/`envelope.cc = ['dave@contoso.com']`, fabricated out of
			// quoted body text, never out of an actual SMTP transaction. This is the sharper failure R3
			// fixed: R1 lost evidence, this invented it. There is no `Recipient:` line anywhere in this
			// fixture (a quoted forward never reproduces it -- it is not a standard RFC 5322 header) and
			// the report text begins with the separator line, not a field line -- both of
			// `looksLikeGenuineJournalReport()`'s signals correctly say "no" here.
			const raw = loadFixture('plain-bcc-forwarded-with-attachment.eml');
			const result = await parseJournalReport(raw, {
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			});
			expect(result.kind).toBe('plain_bcc');
			if (result.kind !== 'plain_bcc') {
				throw new Error('unreachable');
			}
			expect(result.reducedEnvelopeFidelity).toBe(true);
			expect(result.envelope).toEqual({
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			});
			expect(result.extractableHeaders.subject).toBe('Fwd: Rechnung');
		});

		it('classifies "Forward as Attachment" (message/rfc822 inner part present) as plain_bcc, not journal_report (PO review R4)', async () => {
			// The sharpest case, and the one that showed R3's discriminator was called from the wrong
			// place: "Forward as Attachment" (Outlook's own menu item; Thunderbird's default forward
			// style) produces multipart/mixed + text/plain + message/rfc822 -- structurally identical to
			// a genuine journal report, inner part and all. Measured by the PO against the pre-R4 code:
			// this fixture came back `kind: 'journal_report'`, `innerMessage.present: true`,
			// `envelope.sender: null`, `recipients: []` -- an envelope that was empty, not wrong, but
			// still asserted as authoritative. A caller reading that result learns "this journal report
			// had no recipients", which is false: the message had real recipients, they were simply
			// never in the report text (there is no report text -- this was never a journal report) and
			// the SMTP envelope that does have them was never attached because this path never runs
			// classifyNonJournalMessage(). R4's fix moves `looksLikeGenuineJournalReport()` before the
			// inner-part-present/absent branch so it runs regardless of which side of that branch this
			// fixture lands on.
			const raw = loadFixture('plain-bcc-forward-as-attachment.eml');
			const result = await parseJournalReport(raw, {
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			});
			expect(result.kind).toBe('plain_bcc');
			if (result.kind !== 'plain_bcc') {
				throw new Error('unreachable');
			}
			expect(result.reducedEnvelopeFidelity).toBe(true);
			expect(result.envelope).toEqual({
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			});
			expect(result.extractableHeaders.subject).toBe('Fwd: Rechnung (Anhang)');
		});

		it('still classifies a genuine journal report missing its inner part as journal_report (JR-5-03 unaffected)', async () => {
			// Same top-level shape as the two fixtures above -- multipart/mixed, text/plain report part,
			// no message/rfc822 child -- but this report part's content is a real (if incomplete)
			// Exchange journal report: it begins with a field line (`Sender:`) and carries `Recipient:`
			// lines, which is exactly what `looksLikeGenuineJournalReport()`'s two signals require to
			// keep JR-5-03's rule in force. Side by side with the two tests above, this is the
			// discriminator's full contrast.
			const raw = loadFixture('missing-inner-part-bcc-and-dl.eml');
			const result = await parseJournalReport(raw);
			expect(result.kind).toBe('journal_report');
			if (result.kind !== 'journal_report') {
				throw new Error('unreachable');
			}
			expect(result.innerMessage.present).toBe(false);
			expect(result.envelope.to).toEqual(['team@contoso.com']);
			expect(result.envelope.bcc).toEqual(['secretwatcher@contoso.com']);
			expect(result.envelope.onBehalfOf).toBe('assistant@contoso.com');
			expect(result.envelope.recipients).toEqual([
				'team@contoso.com',
				'dl-member-one@contoso.com',
				'dl-member-two@contoso.com',
				'secretwatcher@contoso.com',
			]);
		});

		it('leaves a complete journal report (inner message present) unaffected by the discriminator (PO review R4)', async () => {
			// Since R4, `looksLikeGenuineJournalReport()` runs unconditionally -- including on this
			// fixture, which has its `message/rfc822` inner part present. It passes both signals
			// (`Recipient:` lines present, report text begins with `Sender:`) the same way the
			// missing-inner-part fixture above does; this is the test the PO asked for to keep the
			// now-unconditional discriminator from being tightened into rejecting genuine reports.
			const raw = loadFixture('basic-journal-report.eml');
			const result = await parseJournalReport(raw);
			expect(result.kind).toBe('journal_report');
			if (result.kind !== 'journal_report') {
				throw new Error('unreachable');
			}
			expect(result.innerMessage.present).toBe(true);
			expect(result.envelope.sender).toBe('alice@contoso.com');
			expect(result.envelope.recipients.length).toBeGreaterThan(0);
		});
	}
);

/**
 * `JR-5-06`, RFC section 6.2: NDRs and bounces addressed to the journal mailbox. Acceptance
 * criterion: "NDR wird archiviert und ist als solcher erkennbar" -- each fixture below isolates one
 * signal (or, for the canonical DSN fixture, several at once) so the "erkennbar" half of the
 * criterion is demonstrated per-signal, not just for the easiest case.
 */
suite('ci', 'parseJournalReport() -- NDR / bounce detection (JR-5-06)', () => {
	it('recognises a canonical RFC 3464 delivery-status notification (all three signals present)', async () => {
		const raw = loadFixture('ndr-delivery-status.eml');
		const result = await parseJournalReport(raw, {
			envelopeFrom: '',
			envelopeRcpt: ['journal-archive@example.org'],
		});
		expect(result.kind).toBe('ndr');
		if (result.kind !== 'ndr') {
			throw new Error('unreachable');
		}
		expect(result.signals).toEqual(
			expect.arrayContaining([
				'null-envelope-sender',
				'delivery-status-report',
				'auto-submitted-header',
			])
		);
		expect(result.signals).toHaveLength(3);
		expect(result.extractableHeaders.subject).toBe('Undelivered Mail Returned to Sender');
		// The SMTP envelope that led to this classification is passed through, not summarised away --
		// symmetric with `plain_bcc` (see `JournalNdr.envelope`'s doc comment).
		expect(result.envelope).toEqual({
			envelopeFrom: '',
			envelopeRcpt: ['journal-archive@example.org'],
		});
	});

	it('recognises a null envelope sender (MAIL FROM:<>) as sufficient by itself', async () => {
		const raw = loadFixture('ndr-null-sender-only.eml');
		const result = await parseJournalReport(raw, { envelopeFrom: '', envelopeRcpt: null });
		expect(result.kind).toBe('ndr');
		if (result.kind !== 'ndr') {
			throw new Error('unreachable');
		}
		expect(result.signals).toEqual(['null-envelope-sender']);
		expect(result.envelope).toEqual({ envelopeFrom: '', envelopeRcpt: null });
	});

	it('recognises Auto-Submitted alone as sufficient by itself, even without a null sender', async () => {
		const raw = loadFixture('ndr-auto-submitted-only.eml');
		const result = await parseJournalReport(raw, {
			envelopeFrom: 'mailer-daemon@mx.example.org',
			envelopeRcpt: null,
		});
		expect(result.kind).toBe('ndr');
		if (result.kind !== 'ndr') {
			throw new Error('unreachable');
		}
		expect(result.signals).toEqual(['auto-submitted-header']);
		expect(result.envelope).toEqual({
			envelopeFrom: 'mailer-daemon@mx.example.org',
			envelopeRcpt: null,
		});
	});

	it('treats Auto-Submitted: no as explicitly NOT auto-submitted (RFC 3834 section 5 default)', async () => {
		// Reuses the plain-BCC fixture's ordinary shape but adds an explicit "no" -- must not fire the
		// weak signal just because the header is present at all.
		const raw = Buffer.from(
			loadFixture('plain-bcc-postfix-always-bcc.eml')
				.toString('latin1')
				.replace('MIME-Version: 1.0', 'Auto-Submitted: no\r\nMIME-Version: 1.0'),
			'latin1'
		);
		const result = await parseJournalReport(raw, {
			envelopeFrom: 'alice@contoso.com',
			envelopeRcpt: ['journal-archive@example.org'],
		});
		expect(result.kind).toBe('plain_bcc');
	});

	it('classification order: an NDR that Exchange itself journalled stays kind "journal_report", never "ndr"', async () => {
		// The sharpest test of the ordering decision documented in `parseJournalReport()`'s module doc
		// comment: the outer message matches the Exchange journal-report shape, so it wins outright --
		// regardless of the inner message being shaped exactly like the RFC 3464 fixture above
		// (multipart/report; report-type=delivery-status, plus Auto-Submitted). A null envelope sender
		// here would describe the *outer* SMTP transaction (Exchange delivering the journal report to
		// this receiver), which is not itself null in this fixture, and is irrelevant to the inner
		// message's own history in any case.
		const raw = loadFixture('journal-report-wraps-ndr.eml');
		const result = await parseJournalReport(raw, {
			envelopeFrom: 'journal@contoso.com',
			envelopeRcpt: ['journal-archive@example.org'],
		});
		expect(result.kind).toBe('journal_report');
		if (result.kind !== 'journal_report') {
			throw new Error('unreachable');
		}
		expect(result.envelope.sender).toBe('MAILER-DAEMON@contoso.com');
		expect(result.innerMessage.present).toBe(true);
		if (!result.innerMessage.present) {
			throw new Error('unreachable');
		}
		expect(result.innerMessage.subject).toBe('Undelivered Mail Returned to Sender');
	});
});
