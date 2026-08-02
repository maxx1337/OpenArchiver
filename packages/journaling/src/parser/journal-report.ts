import { simpleParser } from 'mailparser';
import type {
	ExtractableHeaders,
	InnerMessagePart,
	JournalParseFailed,
	JournalReportParseResult,
	JournalReportParsed,
	ParsedEnvelope,
} from '@open-archiver/types';
import { parseEnvelope } from './envelope';
import { isSmimeWrappedMessage, locateJournalParts, splitHeaderAndBody } from './mime-split';

/**
 * Parses an Exchange envelope-journaling report (`JR-5-01`/`JR-5-02`, RFC section 6.1): the outer
 * message is `multipart/mixed` with a `text/plain` report part (envelope field lines, see
 * `envelope.ts`) and a `message/rfc822` part carrying the original message, unmodified.
 *
 * ---------------------------------------------------------------------------------------------
 * Hard rules this function upholds
 * ---------------------------------------------------------------------------------------------
 *  - **Never throws.** Every failure mode -- an unexpected MIME shape, a missing report or inner
 *    part, a `mailparser` exception -- becomes `{ kind: 'parse_failed' }`, never an exception and
 *    never a rejection of the message. `JR-5-04` (a later E5 slice) is what turns `parse_failed`
 *    into a ledger event and an alert; this function only has to make the failure representable
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
 * `JR-5-03`: a missing inner part is a defect, an encrypted one is not
 * ---------------------------------------------------------------------------------------------
 * These two "robustness" cases the backlog groups together are handled quite differently, on
 * purpose:
 *
 *  - **No inner `message/rfc822` part at all** is a malformed report -- the whole reason this parser
 *    exists is to hand the caller both the envelope and the original message, and only one showed
 *    up. That is `parse_failed`, but *not* an information void: `locateJournalParts()` (unlike
 *    `splitJournalReportMime()`) reports the report part even when the inner part is missing, so the
 *    envelope still gets parsed and its fields end up in `extractableHeaders` -- "completeness beats
 *    searchability" applies here too, not only to the fully-unrecognisable-input case.
 *  - **An S/MIME-encrypted inner part** is a well-formed report; the inner message parses fine, it
 *    is just unreadable ciphertext. That is `kind: 'journal_report'` with
 *    `innerMessage.contentEncrypted = true`, never `parse_failed` -- see
 *    `describeInnerMessage()`'s doc comment.
 */
export async function parseJournalReport(rawMessage: Buffer): Promise<JournalReportParseResult> {
	let located;
	try {
		located = locateJournalParts(rawMessage);
	} catch (error) {
		return parseFailed('failed while splitting the outer MIME structure', error, rawMessage);
	}

	if (!located.outerIsMultipartMixed) {
		return parseFailed(
			'outer message is not a multipart/mixed report (or has no boundary parameter)',
			null,
			rawMessage
		);
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
		// JR-5-03: report part parsed fine, but the message/rfc822 inner part is missing -- still
		// accepted, still surfaced with whatever the envelope gave us (see the module doc comment).
		return parseFailed(
			'journal report has a text/plain report part but no message/rfc822 inner part',
			null,
			rawMessage,
			envelopeToExtractableHeaders(envelope)
		);
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

/** `envelope`'s fields, reshaped into `JournalParseFailed.extractableHeaders` (`JR-5-04`). */
function envelopeToExtractableHeaders(envelope: ParsedEnvelope): ExtractableHeaders {
	return { subject: envelope.subject, from: envelope.sender, messageId: envelope.messageId };
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
