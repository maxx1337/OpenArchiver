import { simpleParser } from 'mailparser';
import type {
	ExtractableHeaders,
	InnerMessagePart,
	JournalNdr,
	JournalParseFailed,
	JournalPlainBcc,
	JournalReportParseResult,
	JournalReportParsed,
	JournalReportSourceMode,
	NdrSignal,
	ParsedEnvelope,
	SmtpTransactionEnvelope,
} from '@open-archiver/types';
import { parseEnvelope, reportTextBeginsWithFieldLine } from './envelope';
import {
	isSmimeWrappedMessage,
	locateJournalParts,
	parseContentType,
	splitHeaderAndBody,
} from './mime-split';

/**
 * Parses an Exchange envelope-journaling report (`JR-5-01`/`JR-5-02`, RFC section 6.1): the outer
 * message is `multipart/mixed` with a `text/plain` report part (envelope field lines, see
 * `envelope.ts`) and a `message/rfc822` part carrying the original message, unmodified.
 *
 * ---------------------------------------------------------------------------------------------
 * Hard rules this function upholds
 * ---------------------------------------------------------------------------------------------
 *  - **Never throws.** Every failure mode -- an unexpected outer MIME shape, an unparseable report
 *    part, a `mailparser` exception -- becomes `{ kind: 'parse_failed' }`, never an exception and
 *    never a rejection of the message. A missing *inner* part is different (see "an invariant that
 *    holds across both robustness cases" below): the report still parsed, so it stays
 *    `kind: 'journal_report'`. `JR-5-04` (a later E5 slice) is what turns `parse_failed` into a
 *    ledger event and an alert; this function only has to make the failure representable
 *    (`docs/dev/journaling/README.md` constraint 4, RFC section 5.3).
 *  - **Never transforms the input bytes.** `rawMessage` is read only -- via `Buffer` views and
 *    `mailparser`, both of which are given copies/views for metadata extraction, never mutated.
 *    The caller already holds `rawMessage` and remains responsible for hashing and storing it
 *    unmodified; this function never returns bytes that are meant to replace it (see
 *    `mime-split.ts`'s doc comment for why the outer/inner split happens by hand instead of via
 *    `mailparser`'s full-tree parse, and `journal-parser.types.ts` for why the inner message's
 *    bytes stay metadata-only).
 *
 * Reuses `mailparser` (ADR-027) for exactly what it is good at once the message/rfc822 boundary has
 * already been separated out by hand: content-transfer-decoding and charset decoding of the report
 * part, and header extraction (subject/message-id/from) of the inner message for indexing.
 *
 * ---------------------------------------------------------------------------------------------
 * `JR-5-03`: an invariant that holds across both robustness cases
 * ---------------------------------------------------------------------------------------------
 * **Once the envelope has been parsed, no path here may drop it.** The report part -- `Sender`,
 * `Subject`, `Message-Id`, `To`/`Cc`/`Bcc`, `Recipient:` (which is where Bcc copies and
 * distribution-list expansion members show up, RFC section 6.1's "the entire justification for this
 * feature"), `On-Behalf-Of`, `unknownFields` -- is either fully there or the result is `parse_failed`
 * *before* it was ever parsed. There is no third option where an envelope got parsed and then only
 * three of its fields survive into the result; an earlier version of this function did exactly that
 * for the missing-inner-part case (reducing a fully parsed `ParsedEnvelope` to a
 * `{subject, from, messageId}` triple), which is precisely the kind of silent evidence loss this
 * parser exists to prevent (PO review R1, `JR-5-03`).
 *
 * Concretely, both "robustness" cases the backlog groups together end up **accepted, not rejected**,
 * but via different `kind`s:
 *
 *  - **No inner `message/rfc822` part at all**: the report part still parses, so the envelope is
 *    still complete. This is `kind: 'journal_report'` with `innerMessage: { present: false }` (the
 *    `InnerMessageAbsent` case `journal-parser.types.ts` already modelled but nothing produced until
 *    now) -- the caller gets the full envelope to index, and the missing inner part is what it must
 *    still act on: seeing `innerMessage.present === false` on an otherwise-successful parse is the
 *    signal to additionally write a `parse_failed` ledger event and alert (`JR-5-04`), exactly as
 *    unambiguous a check as switching on `kind`, just one level deeper.
 *  - **An S/MIME-encrypted inner part** is likewise a well-formed report; the inner message parses
 *    fine, it is just unreadable ciphertext. That is `kind: 'journal_report'` with
 *    `innerMessage.contentEncrypted = true` -- see `describeInnerMessage()`'s doc comment.
 *
 * `kind: 'parse_failed'` is reserved for the cases where the outer message *looked like* an attempt
 * at the journal-report shape (`multipart/mixed` with a boundary) but broke down while being read --
 * a `mailparser` exception on the report text, a thrown envelope parse, an internal exception while
 * splitting the outer MIME structure -- or where it looks like neither a journal report nor a
 * well-formed ordinary message at all (garbage, truncated headers, an empty buffer). See
 * `classifyNonJournalMessage()` below for the cases that are *not* `parse_failed` even though the
 * message never had a journal wrapper. `extractableHeaders` there is the best-effort fallback
 * (`extractFallbackHeaders()`) because no journal-report envelope exists to fall back on.
 *
 * `JR-5-08` finding 1 (the parser test corpus, TEST role) narrows this further: a `multipart/mixed`
 * outer message with **no `text/plain` candidate at all among its immediate children** -- wrong
 * boundary, a genuinely truncated part, or (the common real-world case) the report-shaped part
 * sitting one level deeper inside a nested `multipart/alternative`, which is exactly how Outlook and
 * Gmail emit "HTML mail with an attachment" by default -- is **no longer** `parse_failed` either. Per
 * this module's own generalised rule below, `locateJournalParts()`'s search is deliberately
 * shallow (`mime-split.ts`'s doc comment: "nothing more exotic than the shape RFC section 6.1
 * describes"), so when it finds no report-part candidate at all, the discriminator that would prove
 * or disprove a genuine journal report has nothing to run against -- there is no report text to
 * check for `Recipient:`/field-line shape. In that situation "this is not a journal report" is the
 * *only* claim the parser can actually support; `parse_failed` would assert "this looked like a
 * broken attempt", which is not something the parser has evidence for once there is no candidate to
 * examine. Concretely: `located.reportPart === null` now falls through to
 * {@link classifyNonJournalMessage} exactly as `!located.outerIsMultipartMixed` already does, rather
 * than returning `parse_failed` directly. Measured before this fix: `mail-with-attachment-nested-
 * alternative.eml` (multipart/mixed(multipart/alternative(text/plain, text/html), attachment)) came
 * back `parse_failed`, and would have raised a `parse_failed` ledger event/operator alert (`JR-5-04`)
 * for what is, structurally, the single most common "ordinary HTML mail with an attachment" shape --
 * at volume, that alert would drown in false positives and stop being useful for a real parse defect.
 * The one thing `locateJournalParts()` deliberately does **not** grow is a deeper search into nested
 * multiparts -- doing that would only relocate the same "structure implies report" mistake one level
 * further down (see the generalised rule below); moving the decision to "no candidate ⇒ not a
 * report" instead keeps the search shallow and the burden of proof unchanged.
 *
 * ---------------------------------------------------------------------------------------------
 * `JR-5-05`/`JR-5-06`: classification order across all four `kind`s (RFC section 6.2)
 * ---------------------------------------------------------------------------------------------
 * The Exchange journal-report shape is checked **first, unconditionally**, exactly as it was before
 * this slice: `located.outerIsMultipartMixed` decides it, before anything about NDR signals or
 * plain-BCC fallback is even looked at. This is a deliberate ordering decision, not a happy accident
 * of the code's structure, and it is the one fact this slice's tests care most about:
 *
 *  - **An NDR that Exchange itself journalled** -- a bounce message wrapped as the `message/rfc822`
 *    inner part of an otherwise well-formed journal report -- must stay `kind: 'journal_report'`,
 *    never `'ndr'`. Exchange journals a bounce exactly like any other message that transits the
 *    organization; nothing about the *inner* message's content type or headers is ever consulted to
 *    decide the *outer* `kind` once the outer shape itself already matched. See
 *    `journal-report-wraps-ndr.eml` for the fixture this is tested against.
 *  - Only once `located.outerIsMultipartMixed` is `false` -- there genuinely is no journal wrapper --
 *    does {@link classifyNonJournalMessage} run, and it decides between `'ndr'` and `'plain_bcc'`.
 *    An NDR is checked before falling through to plain-BCC, because an NDR is not itself a "plain BCC
 *    copy of an ordinary message" -- it is evidence of a delivery problem, and RFC section 6.2 asks
 *    for it to be flagged as such, not archived indistinguishably from routine traffic.
 *  - A `multipart/mixed` message whose boundary/parts do not resolve to a report part at all (wrong
 *    boundary, no `text/plain` child) stays `parse_failed` -- there is no report text to run the
 *    discriminator below against, so there is nothing left to reclassify with.
 *  - A `multipart/mixed` message that **does** resolve to a report part is where PO reviews R1, R3
 *    and R4 (`JR-5-05`/`JR-5-06`, on top of `JR-5-03`'s original rule) each corrected the same
 *    underlying mistake once more, at a different level of the MIME structure each time -- see the
 *    generalised rule below, which is the point of writing this down rather than leaving it as three
 *    separate war stories.
 *
 * ---------------------------------------------------------------------------------------------
 * The generalised rule (PO review R4, after R1 and R3 hit the same mistake twice already)
 * ---------------------------------------------------------------------------------------------
 * **MIME structure never proves a message is a journal report -- every one of its shapes also occurs
 * in ordinary mail.** Proof is exclusively the *content* of the report part: a `Recipient:` line and
 * a field-line beginning (`looksLikeGenuineJournalReport()` below). Structure only decides, after
 * that, what is *additionally* available -- never *whether* this is a journal report at all. Three
 * shapes of the same mistake, each measured by the PO against this parser's actual output, not
 * hypothesised:
 *
 *  - **R1**: "`multipart/mixed` with a `text/plain` report part" was treated as enough on its own --
 *    but a plain-BCC/routing-rule copy of an ordinary attachment-bearing email is *also* exactly that
 *    shape (the attachment is not a `message/rfc822` part), and the fix (`JR-5-03`'s "report found,
 *    inner missing ⇒ journal_report" rule) needed a look at the report part's own content.
 *  - **R3**: "the report part yielded a recognised field" (any of `Sender`/`Subject`/`Message-Id`/
 *    `On-Behalf-Of`/`To`/`Cc`/`Bcc`) was still too weak -- a **forwarded** message's quoted header
 *    block (`"---------- Forwarded message ---------"` plus `From`/`Date`/`Subject`/`To`/`Cc`, which
 *    every mail client inserts) satisfies exactly those fields, and would have read
 *    `envelope.to`/`envelope.cc` out of *quoted body text* as if they were real SMTP recipients.
 *  - **R4**: "a `message/rfc822` inner part is present" was assumed to be proof by itself, and the
 *    two-signal check from R3 was therefore only ever run when the inner part was *missing* -- but
 *    "Forward as Attachment" (Outlook's own menu item; Thunderbird's default forward style) produces
 *    `multipart/mixed` + `text/plain` + `message/rfc822` for ordinary mail, at volume, every day. That
 *    shape is **structurally identical** to a genuine journal report, and the report part's own
 *    content (empty here: `envelope.sender = null`, `recipients = []`, the message's own greeting
 *    sitting in `unknownFields` under `_unparsed`) was never consulted because the code path that
 *    consulted it only ran on the *other* branch. The result was worse than R1's original bug: not
 *    lost evidence, but a `journal_report` asserting an empty, authoritative envelope for a message
 *    that had real recipients -- they were just never in the report text, they were in the SMTP
 *    transaction this path never attaches. The fix: `looksLikeGenuineJournalReport()` now runs
 *    **before** the inner-part-present/absent branch, not inside only one arm of it -- the branch
 *    on `located.innerMessage` decides only what `innerMessage` looks like from here on, never
 *    whether `kind` is `'journal_report'`.
 *
 * The PO's principle these three reviews converge on: this parser's classification errors always
 * point toward "reduced fidelity" (`plain_bcc`, which admits its envelope is incomplete), never
 * toward "fabricated evidence" (`journal_report`, which asserts its envelope is authoritative).
 * Zero-signal report text means the "report part" was never a report to begin with, regardless of
 * what else surrounds it in the MIME tree, and the whole outer message is reclassified via
 * {@link classifyNonJournalMessage} -- `plain_bcc` or `ndr` -- exactly as if `outerIsMultipartMixed`
 * had been `false` from the start. A genuine journal report (`JR-5-03`'s original missing-inner-part
 * case, still covered by `missing-inner-part.eml`/`missing-inner-part-bcc-and-dl.eml`, and a complete
 * report with its inner part present, `basic-journal-report.eml`) always has `Recipient:` lines from
 * the first line of the report part onward, so both are unaffected and still return
 * `kind: 'journal_report'` with the full envelope intact.
 *
 * ---------------------------------------------------------------------------------------------
 * `JR-5-08` finding 2 / ADR-028: the content discriminator above is itself forgeable by the
 * message's own sender -- the fifth measured instance of this same mistake
 * ---------------------------------------------------------------------------------------------
 * R1/R3/R4 above disprove that MIME **structure** proves message kind. `looksLikeGenuineJournalReport()`'s
 * two-signal check is the *content* replacement -- and content is not a harder target to forge, it is
 * an easier one: composing a `text/plain` part that starts with `Recipient:` costs nothing. Measured
 * against two `JR-5-08` fixtures (`content-forged-fake-report-as-attachment.eml`,
 * `content-forged-fake-report-with-fake-inner.eml`), an external sender's own crafted text is accepted
 * as an authoritative `journal_report` envelope, `sender`/`recipients` sourced entirely from what the
 * attacker wrote.
 *
 * That forgery is exploitable **only** where an Exchange journal-report wrapper never occurs in the
 * first place -- a genuine Exchange journal always wraps the attacker's message in its *own* report,
 * and forged content in the inner `message/rfc822` part is never read for envelope fields; a
 * plain-BCC/routing source has no wrapper at all, so the attacker's message *is* the outer message.
 * See {@link JournalReportSourceMode}'s doc comment for the full reasoning and ADR-028's ruling:
 * **the operating mode is configuration the operator already knows, not something bytes can prove.**
 * `sourceMode: 'plain-bcc'` makes `journal_report` **not a reachable outcome** at all, regardless of
 * how convincing the content looks -- checked immediately after this discriminator, below.
 * `sourceMode: 'infer'` (the default) is today's behaviour, unchanged, and does **not** close this
 * forgery -- that is a documented limitation of `'infer'`, not an oversight; see the two forged-report
 * suites in `journal-report-corpus.test.ts` for what stays demonstrably true under each mode.
 *
 * **What this parser can never do, under any `sourceMode`:** it sees only the bytes it was handed.
 * Who actually delivered a message is decided at the SMTP transaction itself -- an `allowed_sources`
 * CIDR allow-list, explicit `journal_recipients`, no catch-all recipient, optional `AUTH` (RFC section
 * 4.3, `JR-4-05`). No content check this module performs can replace, or may be read as replacing,
 * that transport-level guarantee; a receiver that accepts journal reports from arbitrary senders is
 * broken at the transport layer, and no amount of parser-side scrutiny repairs that.
 */
export async function parseJournalReport(
	rawMessage: Buffer,
	smtpEnvelope: SmtpTransactionEnvelope = { envelopeFrom: null, envelopeRcpt: null },
	sourceMode: JournalReportSourceMode = 'infer'
): Promise<JournalReportParseResult> {
	let located;
	try {
		located = locateJournalParts(rawMessage);
	} catch (error) {
		return parseFailed('failed while splitting the outer MIME structure', error, rawMessage);
	}

	if (!located.outerIsMultipartMixed) {
		return classifyNonJournalMessage(rawMessage, smtpEnvelope);
	}
	if (located.reportPart === null) {
		// JR-5-08 finding 1: no text/plain candidate was found among the outer multipart/mixed's
		// immediate children at all -- wrong/missing boundary, genuine truncation, or (measured, and
		// the common case) the report-shaped part sitting one level deeper inside a nested
		// multipart/alternative (see the module doc comment). Without a report-part candidate there is
		// no report text to run `looksLikeGenuineJournalReport()` against, so this parser has no basis
		// to claim "this looked like a broken journal-report attempt" (`parse_failed`) -- only "this is
		// not a journal report" (the same fallback `!located.outerIsMultipartMixed` already takes).
		return classifyNonJournalMessage(rawMessage, smtpEnvelope);
	}

	let reportText: string;
	try {
		const parsedReportPart = await simpleParser(located.reportPart, MAILPARSER_OPTIONS);
		reportText = parsedReportPart.text ?? '';
	} catch (error) {
		return parseFailed(
			'mailparser threw while decoding the text/plain report part',
			error,
			rawMessage
		);
	}

	let envelope: ParsedEnvelope;
	try {
		envelope = await parseEnvelope(reportText);
	} catch (error) {
		return parseFailed(
			'failed while parsing the envelope fields from the report text',
			error,
			rawMessage
		);
	}

	// PO review R1/R3/R4 (JR-5-05/JR-5-06): the report part having parsed is not itself proof this was
	// a journal report, and -- R4's correction -- neither is the *presence* of a message/rfc822 inner
	// part. "Forward as attachment" (Outlook's "Forward as Attachment", Thunderbird's default forward
	// style) produces exactly this shape -- multipart/mixed, a text/plain part, a message/rfc822 part
	// -- for ordinary mail, at volume, all day. Only a report part that clears the two-signal check
	// earns `kind: 'journal_report'`, checked here **regardless of whether the inner part is present
	// or absent**; otherwise the whole message is reclassified as if it had never matched
	// multipart/mixed at all (see the module doc comment's generalised rule and
	// {@link looksLikeGenuineJournalReport}). Only past this point does the inner part's
	// presence/absence still matter -- but now only to decide what `innerMessage` looks like, never
	// whether this is a journal report at all.
	if (!looksLikeGenuineJournalReport(envelope, reportText)) {
		return classifyNonJournalMessage(rawMessage, smtpEnvelope);
	}

	// JR-5-08 finding 2 / ADR-028: the content discriminator just passed is exactly as forgeable by
	// the message's own sender as the MIME-structure signals R1/R3/R4 already ruled out (see the
	// module doc comment and `JournalReportSourceMode`'s doc comment) -- content alone can never prove
	// this parser is looking at a message an Exchange journal connector actually produced. When the
	// caller knows their source never emits genuine Exchange journal-report wrappers
	// (`sourceMode: 'plain-bcc'`), `journal_report` is excluded as an outcome altogether, regardless of
	// how convincing the content looks; the message is reclassified exactly as if the discriminator
	// above had failed. `'infer'` (the default) and `'exchange-journal'` do not add this check -- see
	// `JournalReportSourceMode`'s doc comment for why `'infer'` deliberately does not close this
	// forgery on its own.
	if (sourceMode === 'plain-bcc') {
		return classifyNonJournalMessage(rawMessage, smtpEnvelope);
	}

	if (located.innerMessage === null) {
		// JR-5-03 (PO review R1): report part parsed fine, so the envelope -- Bcc, DL expansion,
		// everything -- is complete and must not be dropped just because the inner message/rfc822
		// part is missing. `kind` stays 'journal_report'; `innerMessage.present === false` is the
		// caller's signal to also write a `parse_failed` ledger event and alert (see the module doc
		// comment).
		return {
			kind: 'journal_report',
			envelope,
			reportText,
			innerMessage: { present: false },
		} satisfies JournalReportParsed;
	}

	const innerMessage = await describeInnerMessage(located.innerMessage);

	return {
		kind: 'journal_report',
		envelope,
		reportText,
		innerMessage,
	} satisfies JournalReportParsed;
}

/**
 * PO review R3, correcting R1's first attempt, and R4, correcting where R3 was *called from*
 * (`JR-5-05`/`JR-5-06`): whether a report part proves itself to be a genuine (if possibly incomplete)
 * Exchange journal report, as opposed to an ordinary message (attachment-bearing, forwarded, or
 * forwarded **as an attachment**) that merely landed in the report-part position. See
 * `parseJournalReport()`'s module doc comment for the generalised rule this converges on and the
 * three measured failures that led to it -- in short, **MIME structure never proves this on its own**,
 * only the report part's own content does, so this function is called unconditionally on every report
 * part `parseJournalReport()` manages to extract, regardless of whether a `message/rfc822` inner part
 * is present, absent, or anything else about the surrounding MIME tree.
 *
 * The PO's principle for every classification in this parser: **the error direction is always
 * "reduced fidelity" (`plain_bcc`), never "fabricated evidence" (`journal_report` asserting an
 * authoritative envelope)**. This check follows it by requiring two independent signals to agree,
 * combined with a logical AND -- either one failing is reason enough to reclassify as `plain_bcc`/
 * `ndr`, the conservative direction:
 *
 *  - **Content**: `envelope.recipients.length > 0` -- at least one `Recipient:` line parsed.
 *    `Recipient:` is the field RFC section 6.1's whole feature exists for, Exchange always writes it,
 *    and -- unlike `Sender`/`Subject`/`Message-Id`/`To`/`Cc`/`Bcc`/`On-Behalf-Of` -- it is not a
 *    standard RFC 5322 header a mail client's quoted-forward block would ever reproduce. This is
 *    deliberately the *only* content field checked now; R1 checked the others too, which is exactly
 *    what let a forwarded message's quoted headers pass as "recognised".
 *  - **Structure**: {@link reportTextBeginsWithFieldLine} (`envelope.ts`) -- the report text's very
 *    first non-blank line is itself field-shaped, not prose or a `"---------- Forwarded
 *    message ---------"`-style separator. A genuine report's field-line block starts immediately; a
 *    forwarded message's quoted header block does not.
 *
 * `From` deliberately never appears in either signal, nor anywhere in `ParsedEnvelope`: the report
 * format writes `Sender`, not `From` (RFC section 6.1), so a quoted forward's `From:` line cannot
 * fool this check via that name no matter where it sits in the report text.
 *
 * This can, deliberately, let a genuine journal report with a missing inner part fall through to
 * `plain_bcc`/`ndr` in some pathological shape neither signal happens to catch (e.g. truncation that
 * cuts off exactly before Exchange would have written `Recipient:`) -- per the PO's principle above,
 * that direction of error is the accepted one; the reverse is not.
 */
function looksLikeGenuineJournalReport(envelope: ParsedEnvelope, reportText: string): boolean {
	return envelope.recipients.length > 0 && reportTextBeginsWithFieldLine(reportText);
}

/**
 * RFC 5322's *field-name* grammar: one or more printable US-ASCII characters excluding `:`
 * (`%d33-57 / %d59-126`). Used by {@link looksLikeOrdinaryMessage} to reject buffers that merely
 * happen to contain a `:` byte -- e.g. random binary -- from being misread as a header name; a
 * genuine header name a real MTA writes can never contain a control character, a raw 8-bit byte, or
 * whitespace, all of which `splitHeaderAndBody()`'s deliberately permissive line-based parser (built
 * for the journal-report shape, not for input validation) would otherwise let through unchallenged.
 */
const VALID_HEADER_NAME = /^[\x21-\x39\x3b-\x7e]+$/;

/**
 * `JR-5-05`'s guard against misclassifying garbage as a plain-BCC copy: a buffer only reaches
 * `'plain_bcc'`/`'ndr'` classification if it looks like an actual RFC 5322 message, not merely
 * "not multipart/mixed" (which random bytes, an empty buffer, and truncated headers all also are).
 *
 * Requires at least one header, and every header name found to be valid RFC 5322 `field-name` text
 * (see {@link VALID_HEADER_NAME}). This is what keeps `parseJournalReport()`'s existing
 * "never throws on malformed input" fixtures (empty buffer, random binary, 8-bit garbage) landing on
 * `parse_failed` exactly as before this slice: `splitHeaderAndBody()`'s fallback -- treating the whole
 * buffer as one giant header line when no blank-line separator exists at all -- reliably produces a
 * "header name" containing control bytes or raw 8-bit characters for those fixtures, which this check
 * rejects. A real Postfix `always_bcc` copy or Google-routed message, by contrast, always has a
 * well-formed header block (that is what made it a deliverable email in the first place), so it
 * always passes.
 */
function looksLikeOrdinaryMessage(raw: Buffer): boolean {
	const { headers } = splitHeaderAndBody(raw);
	if (headers.size === 0) {
		return false;
	}
	for (const name of headers.keys()) {
		if (!VALID_HEADER_NAME.test(name)) {
			return false;
		}
	}
	return true;
}

/**
 * RFC 3834 section 5: `Auto-Submitted: no` is the explicit default (equivalent to the header being
 * absent) and means the message was *not* auto-submitted; any other token (`auto-replied`,
 * `auto-generated`, `auto-notified`, or a value this parser has not seen) marks it as automatically
 * generated. Whitespace-trimmed, case-insensitive: header values fold case and can carry incidental
 * surrounding whitespace under RFC 5322's unfolding rules, and this parser already unfolds via
 * `splitHeaderAndBody()` -- this only normalises the token itself.
 */
function isAutoSubmitted(headers: ReadonlyMap<string, string>): boolean {
	const value = headers.get('auto-submitted');
	return value !== undefined && value.trim().toLowerCase() !== 'no';
}

/**
 * `JR-5-06`'s NDR detection, run only once {@link parseJournalReport} has already established the
 * outer message is not shaped like an Exchange journal report at all (RFC section 6.2). Never throws:
 * every signal check here is a header lookup or an equality check against an already-parsed value,
 * none of which can fail the way decoding a MIME body can.
 *
 * Returns every signal that fired -- see `NdrSignal`'s doc comment (`journal-parser.types.ts`) for
 * why a caller gets the full list rather than a single verdict, and for the relative strength of each
 * one. This function only reports what it measured; it does **not** itself decide `'ndr'` vs.
 * `'plain_bcc'` -- since `JR-5-08` finding 3, a result containing only `'auto-submitted-header'` is
 * not sufficient for `'ndr'` (see {@link classifyNonJournalMessage}), so an empty array is no longer
 * the only "not NDR" case; `classifyNonJournalMessage()` is what applies that threshold.
 */
function detectNdrSignals(raw: Buffer, smtpEnvelope: SmtpTransactionEnvelope): NdrSignal[] {
	const { headers } = splitHeaderAndBody(raw);
	const signals: NdrSignal[] = [];

	// Strongest: RFC 5321 section 4.5.5's null reverse-path, MAIL FROM:<>. Read from the SMTP
	// transaction itself, not from any header -- see `SmtpTransactionEnvelope.envelopeFrom`'s doc
	// comment for why `''` (not `null`) is what signals this.
	if (smtpEnvelope.envelopeFrom === '') {
		signals.push('null-envelope-sender');
	}

	// Strong: RFC 3464's canonical delivery-status-notification shape.
	const contentType = parseContentType(headers.get('content-type'));
	const reportType = (contentType.params['report-type'] ?? '').toLowerCase();
	if (contentType.type === 'multipart/report' && reportType === 'delivery-status') {
		signals.push('delivery-status-report');
	}

	// Corroborating only, never decisive by itself -- see `NdrSignal`'s doc comment (`JR-5-08` finding
	// 3) for why: RFC 3834 permits `auto-replied` on a genuine DSN, but a vacation autoresponder sets
	// the *identical* token (RFC 3834 section 7's own worked example), so this header's value cannot
	// by itself distinguish a bounce from an ordinary automatic reply. Still recorded when it fires --
	// `classifyNonJournalMessage()` decides whether it is *sufficient*, this function only reports
	// what it measured.
	if (isAutoSubmitted(headers)) {
		signals.push('auto-submitted-header');
	}

	return signals;
}

/**
 * `JR-5-05`/`JR-5-06`, RFC section 6.2: classifies a message that is definitively *not* shaped like an
 * Exchange journal report (`parseJournalReport()` already checked `located.outerIsMultipartMixed` and
 * found it `false`) as either an NDR or a plain-BCC/routing-rule copy -- see `parseJournalReport()`'s
 * module doc comment for why this function only ever runs after that check, never before or instead
 * of it.
 *
 * NDR is checked before falling through to plain-BCC (not the other way around): a bounce is not
 * "an ordinary message that happens to lack a journal wrapper", it is itself evidence of a delivery
 * problem RFC section 6.2 asks to have flagged distinctly, so the stronger claim is decided first.
 *
 * Garbage that does not even look like a well-formed RFC 5322 message (see
 * {@link looksLikeOrdinaryMessage}) still falls back to `parse_failed`, exactly as it did before this
 * slice existed -- `'plain_bcc'` asserts "this is a real message that simply arrived without a journal
 * wrapper", which is not true of an empty buffer or random bytes.
 *
 * `JR-5-08` finding 3: `'ndr'` requires at least one of the two *decisive* signals --
 * `'null-envelope-sender'` (from the SMTP transaction, not a header the sender controls) or
 * `'delivery-status-report'` (RFC 3464's own machine-readable DSN structure). `'auto-submitted-header'`
 * firing on its own is **not** sufficient (see `NdrSignal`'s doc comment for why: RFC 3834 permits the
 * same `auto-replied` token on both a genuine DSN and an ordinary vacation autoresponder, so the header
 * alone cannot tell them apart) -- a message with only that signal falls through to `'plain_bcc'`
 * exactly as if `detectNdrSignals()` had found nothing at all. Measured: `autoreply-out-of-office.eml`
 * (an out-of-office reply, `Auto-Submitted: auto-replied`, no DSN structure, no null sender) came back
 * `kind: 'ndr'` before this fix -- asserting a delivery failure that never happened. When a decisive
 * signal *does* fire, `'auto-submitted-header'` still appears in `signals` alongside it if present, so
 * an auditor asking "why was this flagged" still gets the complete answer, not a truncated one.
 */
function classifyNonJournalMessage(
	rawMessage: Buffer,
	smtpEnvelope: SmtpTransactionEnvelope
): JournalReportParseResult {
	if (!looksLikeOrdinaryMessage(rawMessage)) {
		return parseFailed(
			'outer message is not a multipart/mixed report (or has no boundary parameter), and does not look like a well-formed RFC 5322 message either',
			null,
			rawMessage
		);
	}

	const extractableHeaders = extractFallbackHeaders(rawMessage);
	const signals = detectNdrSignals(rawMessage, smtpEnvelope);
	const hasDecisiveSignal =
		signals.includes('null-envelope-sender') || signals.includes('delivery-status-report');
	if (hasDecisiveSignal) {
		return {
			kind: 'ndr',
			signals,
			envelope: smtpEnvelope,
			extractableHeaders,
		} satisfies JournalNdr;
	}

	return {
		kind: 'plain_bcc',
		envelope: smtpEnvelope,
		reducedEnvelopeFidelity: true,
		extractableHeaders,
	} satisfies JournalPlainBcc;
}

/**
 * Only used to skip needless HTML round-tripping and image-link rewriting -- this call site never
 * looks at `.html`/`.textAsHtml`, only `.text` (report part) or the header fields (inner message).
 */
const MAILPARSER_OPTIONS = {
	skipHtmlToText: true,
	skipTextToHtml: true,
	skipImageLinks: true,
} as const;

/**
 * Extracts header metadata from the already-isolated inner message for indexing, and classifies
 * whether its body is S/MIME-encrypted (`JR-5-03`).
 *
 * `contentEncrypted` is decided purely from the inner message's own top-level `Content-Type` header
 * (`isSmimeWrappedMessage()`, header-only, never touches the body) -- not from whether `mailparser`
 * happens to succeed or fail on it. That matters because `mailparser` does not throw on an encrypted
 * body: `application/pkcs7-mime` is just another non-text content type to it, so it happily returns
 * with `subject`/`messageId`/`from` populated from the still-plaintext headers and no `.text` at
 * all. Relying on a `mailparser` exception to detect encryption would therefore never fire; the
 * header check is the only reliable signal.
 *
 * Not this slice's job to classify every other kind of unparseable inner message -- if `mailparser`
 * cannot make sense of it for an unrelated reason, the inner part is still reported `present: true`
 * with its raw bytes, just without header metadata, rather than turning the whole report into
 * `parse_failed`: the outer report parsed fine, and the RFC's "completeness beats searchability"
 * principle applies here too.
 */
async function describeInnerMessage(raw: Buffer): Promise<InnerMessagePart> {
	let contentEncrypted = false;
	try {
		contentEncrypted = isSmimeWrappedMessage(raw);
	} catch {
		// Header-only and never throws by construction (see mime-split.ts), but this parser never
		// lets an unexpected exception anywhere escape regardless -- defaults to "not encrypted"
		// rather than losing the inner message over a classification failure.
	}

	let subject: string | null = null;
	let messageId: string | null = null;
	let from: string | null = null;
	try {
		const inner = await simpleParser(raw, MAILPARSER_OPTIONS);
		subject = inner.subject ?? null;
		messageId = inner.messageId ?? null;
		from = inner.from?.text ?? null;
	} catch {
		// Swallowed deliberately -- see the doc comment above.
	}
	return { present: true, raw: new Uint8Array(raw), subject, messageId, from, contentEncrypted };
}

/**
 * Best-effort fallback for `JournalParseFailed.extractableHeaders` (`JR-5-04`) when the caller never
 * got far enough to parse an envelope at all -- reads the *outer* message's own top-level RFC 5322
 * headers directly via `splitHeaderAndBody()` (the same header-block parser `mime-split.ts` uses,
 * never throws by construction) rather than a second `mailparser` call, so a buffer that already
 * defeated every other parsing attempt in this module cannot defeat this one too. Values are raw,
 * unfolded header text -- not RFC 2047 decoded -- still better than nothing to index.
 */
function extractFallbackHeaders(raw: Buffer): ExtractableHeaders {
	try {
		const { headers } = splitHeaderAndBody(raw);
		return {
			subject: headers.get('subject') ?? null,
			from: headers.get('from') ?? null,
			messageId: headers.get('message-id') ?? null,
		};
	} catch {
		return { subject: null, from: null, messageId: null };
	}
}

function parseFailed(
	reason: string,
	error: unknown,
	rawMessage: Buffer,
	extractableHeaders?: ExtractableHeaders
): JournalParseFailed {
	return {
		kind: 'parse_failed',
		reason,
		detail: error === null ? null : errorDetail(error),
		extractableHeaders: extractableHeaders ?? extractFallbackHeaders(rawMessage),
	};
}

function errorDetail(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
