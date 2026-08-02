import { simpleParser } from 'mailparser';
import type {
	ExtractableHeaders,
	InnerMessagePart,
	JournalNdr,
	JournalParseFailed,
	JournalPlainBcc,
	JournalReportParseResult,
	JournalReportParsed,
	NdrSignal,
	ParsedEnvelope,
	SmtpTransactionEnvelope,
} from '@open-archiver/types';
import { parseEnvelope } from './envelope';
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
 * wrong/missing boundary, no `text/plain` part, a `mailparser` exception on the report text, a thrown
 * envelope parse -- or where it looks like neither a journal report nor a well-formed ordinary
 * message at all (garbage, truncated headers, an empty buffer). See `classifyNonJournalMessage()`
 * below for the two cases that are *not* `parse_failed` even though the message never had a journal
 * wrapper. `extractableHeaders` there is the best-effort fallback (`extractFallbackHeaders()`)
 * because no journal-report envelope exists to fall back on.
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
 *  - A `multipart/mixed` message whose boundary/parts do not resolve to a report part (wrong
 *    boundary, no `text/plain` child, etc.) is deliberately **left as `parse_failed`**, not
 *    reclassified as `'plain_bcc'`, even though in principle an ordinary email can legitimately be
 *    `multipart/mixed` (e.g. one with a file attachment). Widening `'plain_bcc'` to cover that shape
 *    would mean re-deciding, for every `multipart/mixed` message, whether it is a broken journal
 *    report or an ordinary attachment-bearing email -- exactly the ambiguity `JR-5-03`'s "missing
 *    inner part" case already resolved one way (report part found, no inner part ⇒ still
 *    `'journal_report'`) after a PO review (R1) about not silently re-deciding settled, tested
 *    behaviour. That is a real gap for a plain-BCC copy of an email that happens to carry an
 *    attachment -- flagged here rather than fixed quietly, and left for the PO to decide whether it
 *    belongs in this slice or a later one.
 */
export async function parseJournalReport(
	rawMessage: Buffer,
	smtpEnvelope: SmtpTransactionEnvelope = { envelopeFrom: null, envelopeRcpt: null }
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
		return parseFailed(
			'outer multipart/mixed message has no text/plain report part',
			null,
			rawMessage
		);
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
 * one. An empty array means "not an NDR by any signal this parser checks", which is
 * {@link classifyNonJournalMessage}'s cue to classify as `'plain_bcc'` instead.
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

	// Weak, corroborating: see `isAutoSubmitted()`'s and `NdrSignal`'s doc comments for why this is
	// sufficient alone despite being the weakest signal -- a malformed DSN missing `report-type` must
	// not silently fall through to `'plain_bcc'` and lose its NDR flag.
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
	if (signals.length > 0) {
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
