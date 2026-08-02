import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { loadFixture } from '../../tests/support/fixtures';
import { parseJournalReport } from './journal-report';

/**
 * `JR-5-08`: the parser test corpus. Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this file is for
 * ---------------------------------------------------------------------------------------------
 * `journal-report.test.ts` (JR-5-01..JR-5-07 plus PO reviews R1/R3/R4) already covers the
 * documented Exchange journal-report shapes and three measured MIME-structure-vs-message-kind
 * misclassifications. This file's job, per the backlog task and `06-status.md`'s "Der teuerste
 * Befund des Epics", is different: it is the adversarial pass looking for the *fourth*
 * manifestation of the same mistake, plus the everyday, non-journal mail forms the backlog itself
 * does not enumerate (autoreply, calendar invite, newsletter, nested multipart/alternative mail
 * with an attachment, a quoted report pasted into an ordinary email body).
 *
 * Every suite below states two things per fixture: what kind of message it is, and what survives
 * the parse -- never just "it doesn't throw" (that alone asserts nothing, per the tester role's
 * brief). Two of the suites below are, deliberately, RED: they assert the *correct* behaviour
 * (per this module's own documented "reduced fidelity, never fabricated evidence" rule) against
 * fixtures that demonstrate the current code does not follow it. Per the task's explicit
 * exception, they are left red rather than adjusted to match the current output -- a corpus that
 * builds itself around a bug it found is worthless. See the test report for full detail on both
 * findings.
 */

suite('ci', 'parseJournalReport() -- Bcc-only journal report (no To/Cc at all)', () => {
	it('is a genuine journal report whose only recipient evidence is Bcc/Recipient, To and Cc both empty', async () => {
		// Every existing Bcc fixture (bcc-and-dl-expansion.eml, missing-inner-part-bcc-and-dl.eml)
		// also carries a To. The backlog names "Bcc-only" as its own case -- this is the shape where
		// Recipient:/Bcc: are the *entire* evidentiary record, and To/Cc contribute nothing.
		const raw = loadFixture('bcc-only.eml');
		const result = await parseJournalReport(raw);
		expect(result.kind).toBe('journal_report');
		if (result.kind !== 'journal_report') {
			throw new Error('unreachable');
		}
		expect(result.envelope.to).toEqual([]);
		expect(result.envelope.cc).toEqual([]);
		expect(result.envelope.bcc).toEqual(['watcher@contoso.com']);
		expect(result.envelope.recipients).toEqual(['watcher@contoso.com']);
		expect(result.envelope.sender).toBe('alice@contoso.com');
		expect(result.innerMessage.present).toBe(true);
	});
});

/**
 * Everyday, non-journal mail forms the backlog itself does not enumerate (§ task instructions,
 * "Mindestens: ... Autoreply/Abwesenheitsnotiz ... Kalendereinladung ... Newsletter mit
 * List-Unsubscribe ... eine Mail, deren Körper wie ein Journal-Report aussieht"). Per requirement
 * 2 of the task, each asserts that the SMTP envelope is passed through unchanged and
 * `reducedEnvelopeFidelity`/no-mutation hold -- not just that classification "succeeds".
 */
suite(
	'ci',
	'parseJournalReport() -- everyday mail: calendar invite (text/calendar, method=REQUEST)',
	() => {
		it('classifies a multipart/alternative meeting invite (no multipart/mixed wrapper) as plain_bcc, full envelope pass-through', async () => {
			const raw = loadFixture('calendar-invite-request.eml');
			const envelope = {
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			};
			const result = await parseJournalReport(raw, envelope);
			expect(result.kind).toBe('plain_bcc');
			if (result.kind !== 'plain_bcc') {
				throw new Error('unreachable');
			}
			expect(result.reducedEnvelopeFidelity).toBe(true);
			expect(result.envelope).toEqual(envelope);
			expect(result.extractableHeaders.subject).toContain('Invitation');
		});

		it('never mutates the raw message buffer', async () => {
			const raw = loadFixture('calendar-invite-request.eml');
			const copy = Buffer.from(raw);
			await parseJournalReport(raw);
			expect(Buffer.compare(raw, copy)).toBe(0);
		});
	}
);

suite('ci', 'parseJournalReport() -- everyday mail: bulk newsletter with List-Unsubscribe', () => {
	it('classifies bulk mail (Precedence: bulk, List-Unsubscribe) as plain_bcc, full envelope pass-through', async () => {
		const raw = loadFixture('newsletter-list-unsubscribe.eml');
		const envelope = {
			envelopeFrom: 'newsletter@contoso-updates.example',
			envelopeRcpt: ['journal-archive@example.org'],
		};
		const result = await parseJournalReport(raw, envelope);
		expect(result.kind).toBe('plain_bcc');
		if (result.kind !== 'plain_bcc') {
			throw new Error('unreachable');
		}
		expect(result.reducedEnvelopeFidelity).toBe(true);
		expect(result.envelope).toEqual(envelope);
		expect(result.extractableHeaders.subject).toBe('Your July digest');
	});

	it('never mutates the raw message buffer (the unusual but legal "=_Part_..." boundary is read, not rewritten)', async () => {
		const raw = loadFixture('newsletter-list-unsubscribe.eml');
		const copy = Buffer.from(raw);
		await parseJournalReport(raw);
		expect(Buffer.compare(raw, copy)).toBe(0);
	});
});

suite(
	'ci',
	'parseJournalReport() -- everyday mail: a quoted journal report pasted into an ordinary body',
	() => {
		it('classifies a single-part (non-multipart/mixed) message as plain_bcc even though its body starts with report-shaped field lines', async () => {
			// Brackets the exact scope of the content-forging finding below: this fixture's *body* text
			// is byte-for-byte the same field-line shape looksLikeGenuineJournalReport() looks for
			// (Recipient: lines, field-line-first), but the outer message is a single-part text/plain
			// message, never multipart/mixed -- so `located.outerIsMultipartMixed` is false and
			// looksLikeGenuineJournalReport() is never consulted on this path at all. Safe, by
			// construction of the code's branch order, not by luck.
			const raw = loadFixture('quoted-journal-report-in-plain-body.eml');
			const envelope = {
				envelopeFrom: 'compliance-officer@contoso.com',
				envelopeRcpt: ['legal@contoso.com'],
			};
			const result = await parseJournalReport(raw, envelope);
			expect(result.kind).toBe('plain_bcc');
			if (result.kind !== 'plain_bcc') {
				throw new Error('unreachable');
			}
			expect(result.reducedEnvelopeFidelity).toBe(true);
			expect(result.envelope).toEqual(envelope);
		});
	}
);

suite(
	'ci',
	'parseJournalReport() -- everyday mail: vacation autoresponder (Auto-Submitted: auto-replied)',
	() => {
		it(
			'classifies an out-of-office autoresponder as kind "ndr" via the auto-submitted-header ' +
				"signal -- a DOCUMENTED, not a new, trade-off (see NdrSignal's doc comment in " +
				'journal-parser.types.ts: "Also set by ordinary vacation autoresponders ... not only by ' +
				'bounces"). This test exists so that trade-off is measured against the built parser, not ' +
				'only asserted in a comment; see the test report for why it is flagged as worth revisiting ' +
				'even though it is not counted as a new misclassification.',
			async () => {
				const raw = loadFixture('autoreply-out-of-office.eml');
				const envelope = {
					envelopeFrom: 'bob@contoso.com',
					envelopeRcpt: ['alice@example.org'],
				};
				const result = await parseJournalReport(raw, envelope);
				expect(result.kind).toBe('ndr');
				if (result.kind !== 'ndr') {
					throw new Error('unreachable');
				}
				expect(result.signals).toEqual(['auto-submitted-header']);
				expect(result.envelope).toEqual(envelope);
			}
		);
	}
);

/**
 * ---------------------------------------------------------------------------------------------
 * FINDING 1 of 2: the report-part search only looks at the outer multipart/mixed's IMMEDIATE
 * children -- a real message whose text/plain part sits one level deeper (inside a nested
 * multipart/alternative, which is how virtually every HTML-composed mail client emits a
 * plain+HTML body) never finds a report part at all and is misclassified `parse_failed` instead
 * of `plain_bcc`.
 * ---------------------------------------------------------------------------------------------
 * This is the same root mistake the module doc comment already names ("MIME structure never
 * proves a message is a journal report") applied one decision earlier: `located.reportPart ===
 * null` is treated as "this looked like an attempt at the journal-report shape that broke down",
 * but an ordinary multipart/mixed(multipart/alternative(text/plain, text/html), attachment)
 * message -- the single most common real-world "HTML mail with an attachment" shape, produced by
 * Outlook and Gmail by default whenever rich-text composition is on -- has exactly this
 * structure and is not a broken journal-report attempt at all.
 *
 * Measured against the built package (not hypothesised): `mail-with-attachment-nested-
 * alternative.eml` comes back `{ kind: 'parse_failed', reason: 'outer multipart/mixed message
 * has no text/plain report part' }`. Per JR-5-04/RFC section 5.3 this is not silent data loss --
 * the message is still stored/hashed/chained downstream -- but it does mean every such message
 * additionally raises a `parse_failed` ledger event and an operator alert (JR-5-04's contract),
 * which for this MIME shape is not an actual parse failure, just an ordinary message with no
 * journal wrapper. At scale this shape is common enough that the false-alert rate this produces
 * is likely to drown out genuine parse failures.
 *
 * This test asserts the CORRECT behaviour (plain_bcc, matching every other "ordinary mail with no
 * journal wrapper" fixture in this corpus) and is deliberately left RED against the current code
 * -- see the test report. Fixing this is the PO's call, not this task's.
 */
suite(
	'ci',
	'parseJournalReport() -- FINDING: nested multipart/alternative + attachment (common HTML-mail shape) should be plain_bcc, not parse_failed',
	() => {
		it('RED: a text/plain part nested one level inside multipart/alternative is still "no journal wrapper", not "broken journal-report attempt"', async () => {
			const raw = loadFixture('mail-with-attachment-nested-alternative.eml');
			const envelope = {
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			};
			const result = await parseJournalReport(raw, envelope);
			// EXPECTED (per this module's own "reduced fidelity, not a rejection or a false alert for
			// ordinary mail" principle): plain_bcc.
			// ACTUAL (measured): 'parse_failed', reason "outer multipart/mixed message has no
			// text/plain report part" -- because the plain-text part is nested inside a child
			// multipart/alternative, one level below where locateJournalParts() looks.
			expect(result.kind).toBe('plain_bcc');
			if (result.kind !== 'plain_bcc') {
				throw new Error('unreachable');
			}
			expect(result.reducedEnvelopeFidelity).toBe(true);
			expect(result.envelope).toEqual(envelope);
		});

		it('the raw bytes are at least never mutated even while misclassified (the narrower guarantee that does hold)', async () => {
			const raw = loadFixture('mail-with-attachment-nested-alternative.eml');
			const copy = Buffer.from(raw);
			await parseJournalReport(raw);
			expect(Buffer.compare(raw, copy)).toBe(0);
		});
	}
);

/**
 * ---------------------------------------------------------------------------------------------
 * FINDING 2 of 2 (the "fourth manifestation"): the content-based discriminator itself is
 * forgeable, by the message's own author.
 * ---------------------------------------------------------------------------------------------
 * R1/R3/R4 (see `journal-report.ts`'s module doc comment) each corrected an instance of "MIME
 * STRUCTURE proves message kind" -- structure any ordinary mail client can also produce by
 * accident. The fix requires *content* proof instead: a `Recipient:` line and a field-line-first
 * report part (`looksLikeGenuineJournalReport()`).
 *
 * But content is not a harder target to forge than structure -- it is easier: it costs nothing
 * more than composing a plain-text part that starts with the two required signals. Nothing in
 * `parseJournalReport()` ties a `journal_report` classification to any property of the actual
 * SMTP transport (there is no check that the outer message even originated from an Exchange
 * server, no signature, no required Exchange-specific header such as
 * `X-MS-Journal-Report-Version` that the genuine fixtures in this corpus happen to carry but nothing
 * requires). Any sender able to deliver a message to the journal mailbox address -- including an
 * ordinary EXTERNAL sender, per RFC 5321 nothing stops `MAIL FROM` from being anyone -- can
 * fabricate an "authoritative" journal_report envelope: exactly the "erfundener Nachweis"
 * (fabricated evidence) failure mode the module's whole discriminator exists to prevent, achieved
 * by the discriminator's own rule.
 *
 * Two fixtures make the point at increasing severity:
 *  - `content-forged-fake-report-as-attachment.eml`: the forged envelope only (no inner message at
 *    all -- innerMessage.present stays false, same shape as JR-5-03's genuine missing-inner-part
 *    case).
 *  - `content-forged-fake-report-with-fake-inner.eml`: the sharper case -- the attacker ALSO
 *    supplies a wholesale fabricated message/rfc822 "original message" (forged From/To/Subject/
 *    Date and body), which the parser accepts as `innerMessage.present: true` with no signal
 *    distinguishing it from a message Exchange itself actually transported.
 *
 * Both are measured against the built package, not hypothesised (see this file's own probe
 * output in the test report). Both tests assert the CORRECT, conservative-direction behaviour
 * (plain_bcc, per this module's own stated principle) and are deliberately left RED -- a corpus
 * that works around this finding instead of naming it would be worthless, per the task brief.
 */
suite(
	'ci',
	"parseJournalReport() -- FINDING: report-part CONTENT is forgeable by the message's own sender, not just its MIME structure",
	() => {
		it('RED: an external sender-authored "report" attachment with no inner message should not be treated as an authoritative journal report', async () => {
			const raw = loadFixture('content-forged-fake-report-as-attachment.eml');
			const envelope = {
				envelopeFrom: 'mallory@external-example.net',
				envelopeRcpt: ['journal-archive@example.org'],
			};
			const result = await parseJournalReport(raw, envelope);
			// EXPECTED: plain_bcc -- nothing here proves an Exchange journal connector produced this
			// envelope; it is exactly as forgeable as the MIME-structure signals R1/R3/R4 already ruled
			// out, just one level deeper (content instead of structure).
			// ACTUAL (measured): 'journal_report', with envelope.recipients/to sourced entirely from
			// the attacker-authored attachment text, asserted as authoritative.
			expect(result.kind).toBe('plain_bcc');
			if (result.kind !== 'plain_bcc') {
				throw new Error('unreachable');
			}
			expect(result.reducedEnvelopeFidelity).toBe(true);
			expect(result.envelope).toEqual(envelope);
		});

		it('RED: a forged report AND a forged message/rfc822 "original message" should not be accepted as authoritative either', async () => {
			const raw = loadFixture('content-forged-fake-report-with-fake-inner.eml');
			const envelope = {
				envelopeFrom: 'mallory@external-example.net',
				envelopeRcpt: ['journal-archive@example.org'],
			};
			const result = await parseJournalReport(raw, envelope);
			// EXPECTED: plain_bcc, for the same reason as above.
			// ACTUAL (measured): 'journal_report' with a fully fabricated inner message ("FORGED-BODY-
			// MARKER" body, forged From: ceo@contoso.com) reported as innerMessage.present: true --
			// indistinguishable, at this parser's level, from a message Exchange itself transported.
			expect(result.kind).toBe('plain_bcc');
			if (result.kind !== 'plain_bcc') {
				throw new Error('unreachable');
			}
			expect(result.reducedEnvelopeFidelity).toBe(true);
			expect(result.envelope).toEqual(envelope);
		});
	}
);
