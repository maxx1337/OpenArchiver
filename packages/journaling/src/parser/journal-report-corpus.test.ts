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
 * Befund des Epics", is different: it is the adversarial pass looking for further manifestations of
 * the same mistake, plus the everyday, non-journal mail forms the backlog itself does not enumerate
 * (autoreply, calendar invite, newsletter, nested multipart/alternative mail with an attachment, a
 * quoted report pasted into an ordinary email body).
 *
 * Every suite below states two things per fixture: what kind of message it is, and what survives
 * the parse -- never just "it doesn't throw" (that alone asserts nothing, per the tester role's
 * brief).
 *
 * ---------------------------------------------------------------------------------------------
 * This corpus originally shipped with three suites deliberately RED (the TEST role's checkpoint,
 * commit `4836beb`) -- three measured misclassifications, left unadjusted on purpose so the corpus
 * named what it found instead of building itself around it. A subsequent fixing pass (DEV role)
 * closed all three; every suite below is green again, but by changing the *parser*, never by
 * softening what these suites claim:
 *
 *  - **Finding 1** (nested `multipart/alternative`, a common HTML-mail-with-attachment shape):
 *    `locateJournalParts()` still only looks at the outer `multipart/mixed`'s immediate children
 *    (unchanged, deliberately shallow) -- but `parseJournalReport()` no longer treats "no
 *    report-part candidate found" as `parse_failed`. See `journal-report.ts`'s module doc comment
 *    and the suite below for the corrected reasoning.
 *  - **Finding 2** (content-based discriminator is forgeable by the message's own sender): fixed by
 *    ADR-028's `sourceMode` parameter, **not** by a stronger content check (there is no such thing --
 *    see the suite below for why). The finding itself is *not* fully closed: under the default
 *    `sourceMode: 'infer'` both forged fixtures still classify as `journal_report`, and that is
 *    asserted explicitly below as the documented, measured limit of `'infer'`, not swept away.
 *    `sourceMode: 'plain-bcc'` is what closes it, for the operating mode where it is actually
 *    exploitable.
 *  - **Finding 3** (`Auto-Submitted` alone was sufficient for `kind: 'ndr'`): fixed by requiring at
 *    least one of the two decisive NDR signals (RFC 3464 structure or the null envelope sender);
 *    `Auto-Submitted` is corroboration only now. The autoresponder fixture below asserts the
 *    corrected `plain_bcc` outcome, with the reasoning for the change spelled out at its suite.
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

/**
 * ---------------------------------------------------------------------------------------------
 * FINDING 3 (JR-5-08): `Auto-Submitted` alone is not evidence of a delivery failure.
 * ---------------------------------------------------------------------------------------------
 * This test originally asserted `kind: 'ndr'` here, on the theory that treating
 * `Auto-Submitted: auto-replied` as sufficient by itself was a documented trade-off (see the
 * superseded quote from `NdrSignal`'s doc comment in the title above), not a bug -- "some
 * autoresponders will be misfiled as NDRs, and that is accepted". Measured against the RFC instead
 * of assumed: RFC 3834 section 5 permits `auto-replied` on a genuine DSN, but its own worked example
 * in section 7 sets that *exact* token on a **vacation autoresponder** -- the header's value cannot
 * by itself separate "bounce" from "ordinary automatic reply", so "documented trade-off" was really
 * "the parser cannot tell these apart from this signal", not an accepted cost of a real distinction.
 * Filing this fixture as `'ndr'` asserts a delivery failure that never happened -- exactly the
 * "fabricated evidence" direction this parser's own principle rules out (see `journal-report.ts`'s
 * module doc comment). The decisive signals are RFC 3464's own DSN structure
 * (`multipart/report; report-type=delivery-status`) and the transaction-level null reverse-path,
 * neither of which this fixture has; `Auto-Submitted` is now corroboration only (see
 * `classifyNonJournalMessage()`'s and `NdrSignal`'s doc comments), so this fixture correctly lands on
 * `'plain_bcc'` -- what an out-of-office reply actually is.
 */
suite(
	'ci',
	'parseJournalReport() -- everyday mail: vacation autoresponder (Auto-Submitted: auto-replied)',
	() => {
		it(
			'classifies an out-of-office autoresponder as kind "plain_bcc", not "ndr" -- ' +
				'Auto-Submitted alone no longer asserts a delivery failure (JR-5-08 finding 3)',
			async () => {
				const raw = loadFixture('autoreply-out-of-office.eml');
				const envelope = {
					envelopeFrom: 'bob@contoso.com',
					envelopeRcpt: ['alice@example.org'],
				};
				const result = await parseJournalReport(raw, envelope);
				expect(result.kind).toBe('plain_bcc');
				if (result.kind !== 'plain_bcc') {
					throw new Error('unreachable');
				}
				expect(result.reducedEnvelopeFidelity).toBe(true);
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
 * **Fixed**: `parseJournalReport()` no longer treats "no report-part candidate among the outer
 * message's immediate children" as proof of a broken journal-report attempt -- see
 * `journal-report.ts`'s module doc comment ("`JR-5-08` finding 1") for the chosen direction and why:
 * `locateJournalParts()`'s search stays deliberately shallow (unchanged), but the absence of any
 * candidate to run the content discriminator against is treated as "not a journal report" rather
 * than "a broken one", falling through to the same `classifyNonJournalMessage()` path
 * `!outerIsMultipartMixed` already used. This test now asserts the corrected behaviour, measured
 * against the built code, not the pre-fix bug.
 */
suite(
	'ci',
	'parseJournalReport() -- FINDING: nested multipart/alternative + attachment (common HTML-mail shape) should be plain_bcc, not parse_failed',
	() => {
		it('a text/plain part nested one level inside multipart/alternative is "no journal wrapper" (plain_bcc), not "broken journal-report attempt" (parse_failed)', async () => {
			const raw = loadFixture('mail-with-attachment-nested-alternative.eml');
			const envelope = {
				envelopeFrom: 'alice@contoso.com',
				envelopeRcpt: ['journal-archive@example.org'],
			};
			const result = await parseJournalReport(raw, envelope);
			// Before the fix (measured): 'parse_failed', reason "outer multipart/mixed message has no
			// text/plain report part" -- because the plain-text part is nested inside a child
			// multipart/alternative, one level below where locateJournalParts() looks. Now:
			// classifyNonJournalMessage() runs instead of returning parse_failed directly, and this
			// fixture's own content -- ordinary prose, no Recipient:/field-line shape -- correctly lands
			// on plain_bcc.
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
 * FINDING 2 (the "fourth manifestation", now the fifth if `Auto-Submitted` above is counted): the
 * content-based discriminator itself is forgeable, by the message's own author -- and the fix is
 * ADR-028, not a stronger content check.
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
 * **This is not fixable by a stronger content check** -- any signal expressed as message content is
 * exactly as forgeable as the last one, by construction (that is the whole lesson of R1/R3/R4 one
 * level further down). ADR-028's fix instead moves the decision out of content entirely: whether
 * `journal_report` is even a reachable outcome is now `parseJournalReport()`'s third, optional
 * `sourceMode` parameter (`'exchange-journal' | 'plain-bcc' | 'infer'`, default `'infer'`) -- see
 * `JournalReportSourceMode`'s doc comment (`@open-archiver/types`) for the full reasoning: the
 * forgery is exploitable *only* on a plain-BCC/routing source (there is no genuine wrapper to compete
 * with), never on genuine Exchange journaling (Exchange's own wrapper always wins, forged content
 * only ever reaches the *inner*, non-authoritative part), so an operator who knows their source is
 * plain-BCC can exclude `journal_report` as an outcome entirely, regardless of content.
 *
 * Both fixtures below are measured against the built package, not hypothesised. Each is asserted
 * **twice**, matching ADR-028's own claim about itself precisely -- this is not softened away, it is
 * named on both sides:
 *  - under `sourceMode: 'infer'` (the default, i.e. omitted): still `journal_report`, sourced entirely
 *    from the attacker's own text. This is the **documented, measured limit** of `'infer'`, not a
 *    fixed bug -- `'infer'` is explicitly the transitional default that keeps E5 runnable standalone,
 *    and ADR-028 says outright that it "does not close this forgery". Asserting `plain_bcc` here
 *    would misrepresent the fix as broader than it is.
 *  - under `sourceMode: 'plain-bcc'`: `plain_bcc`, on the identical bytes -- proof the fix works for
 *    the one operating mode where the attack is actually exploitable (a plain-BCC/routing source),
 *    which is the mode ADR-028 exists for.
 */
suite(
	'ci',
	"parseJournalReport() -- FINDING: report-part CONTENT is forgeable by the message's own sender, not just its MIME structure",
	() => {
		it(
			'under sourceMode "infer" (the default): an external sender-authored "report" attachment ' +
				'with no inner message is STILL accepted as journal_report -- the measured, documented ' +
				'limit of "infer" (ADR-028), not a regression this task fixes away',
			async () => {
				const raw = loadFixture('content-forged-fake-report-as-attachment.eml');
				const envelope = {
					envelopeFrom: 'mallory@external-example.net',
					envelopeRcpt: ['journal-archive@example.org'],
				};
				const result = await parseJournalReport(raw, envelope);
				expect(result.kind).toBe('journal_report');
				if (result.kind !== 'journal_report') {
					throw new Error('unreachable');
				}
				// The attacker-authored report text, not the SMTP envelope, is what "wins" here -- this
				// is exactly the fabricated-evidence failure mode: `sender`/`recipients` come from
				// content Mallory composed, not from anything Exchange or the SMTP transaction attests
				// to.
				expect(result.envelope.sender).toBe('someone-innocent@contoso.com');
				expect(result.envelope.recipients).toEqual([
					'someone-innocent@contoso.com',
					'another-innocent@contoso.com',
				]);
				expect(result.innerMessage.present).toBe(false);
			}
		);

		it(
			'under sourceMode "plain-bcc": the identical bytes are correctly reclassified as ' +
				'plain_bcc -- ADR-028 closes the forgery for the one operating mode where it is ' +
				'actually exploitable',
			async () => {
				const raw = loadFixture('content-forged-fake-report-as-attachment.eml');
				const envelope = {
					envelopeFrom: 'mallory@external-example.net',
					envelopeRcpt: ['journal-archive@example.org'],
				};
				const result = await parseJournalReport(raw, envelope, 'plain-bcc');
				expect(result.kind).toBe('plain_bcc');
				if (result.kind !== 'plain_bcc') {
					throw new Error('unreachable');
				}
				expect(result.reducedEnvelopeFidelity).toBe(true);
				expect(result.envelope).toEqual(envelope);
			}
		);

		it(
			'under sourceMode "infer" (the default): a forged report AND a forged message/rfc822 ' +
				'"original message" are STILL accepted as authoritative -- the sharper case of the same ' +
				'documented limit',
			async () => {
				const raw = loadFixture('content-forged-fake-report-with-fake-inner.eml');
				const envelope = {
					envelopeFrom: 'mallory@external-example.net',
					envelopeRcpt: ['journal-archive@example.org'],
				};
				const result = await parseJournalReport(raw, envelope);
				expect(result.kind).toBe('journal_report');
				if (result.kind !== 'journal_report') {
					throw new Error('unreachable');
				}
				// Same fabricated-evidence failure mode as the fixture above, sharper: the "board
				// resignation" report AND its wholesale-fabricated message/rfc822 "original message" are
				// both entirely Mallory's own text.
				expect(result.envelope.sender).toBe('ceo@contoso.com');
				expect(result.envelope.recipients).toEqual(['board@contoso.com']);
				expect(result.innerMessage.present).toBe(true);
				if (!result.innerMessage.present) {
					throw new Error('unreachable');
				}
				expect(Buffer.from(result.innerMessage.raw).toString('utf8')).toContain(
					'FORGED-BODY-MARKER'
				);
			}
		);

		it(
			'under sourceMode "plain-bcc": the sharper forged-inner-message case is also correctly ' +
				'reclassified as plain_bcc',
			async () => {
				const raw = loadFixture('content-forged-fake-report-with-fake-inner.eml');
				const envelope = {
					envelopeFrom: 'mallory@external-example.net',
					envelopeRcpt: ['journal-archive@example.org'],
				};
				const result = await parseJournalReport(raw, envelope, 'plain-bcc');
				expect(result.kind).toBe('plain_bcc');
				if (result.kind !== 'plain_bcc') {
					throw new Error('unreachable');
				}
				expect(result.reducedEnvelopeFidelity).toBe(true);
				expect(result.envelope).toEqual(envelope);
			}
		);
	}
);
