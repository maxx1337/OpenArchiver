import { simpleParser } from 'mailparser';
import type {
	InnerMessagePart,
	JournalParseFailed,
	JournalReportParseResult,
	JournalReportParsed,
} from '@open-archiver/types';
import { parseEnvelope } from './envelope';
import { splitJournalReportMime } from './mime-split';

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
 */
export async function parseJournalReport(rawMessage: Buffer): Promise<JournalReportParseResult> {
	let split;
	try {
		split = splitJournalReportMime(rawMessage);
	} catch (error) {
		return parseFailed('failed while splitting the outer MIME structure', error);
	}

	if (split === null) {
		return parseFailed(
			'outer message is not a multipart/mixed report with a text/plain report part and a ' +
				'message/rfc822 inner part',
			null
		);
	}

	let reportText: string;
	try {
		const parsedReportPart = await simpleParser(split.reportPart, MAILPARSER_OPTIONS);
		reportText = parsedReportPart.text ?? '';
	} catch (error) {
		return parseFailed('mailparser threw while decoding the text/plain report part', error);
	}

	let envelope;
	try {
		envelope = await parseEnvelope(reportText);
	} catch (error) {
		return parseFailed('failed while parsing the envelope fields from the report text', error);
	}
	const innerMessage = await describeInnerMessage(split.innerMessage);

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
 * Extracts header metadata from the already-isolated inner message for indexing. Not this slice's
 * job to classify a S/MIME-encrypted or otherwise unparseable inner message (`JR-5-03`) -- if
 * `mailparser` cannot make sense of it, the inner part is still reported `present: true` with its
 * raw bytes, just without header metadata, rather than turning the whole report into
 * `parse_failed`: the outer report parsed fine, and the RFC's "completeness beats searchability"
 * principle applies here too.
 */
async function describeInnerMessage(raw: Buffer): Promise<InnerMessagePart> {
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
	return { present: true, raw: new Uint8Array(raw), subject, messageId, from };
}

function parseFailed(reason: string, error: unknown): JournalParseFailed {
	return { kind: 'parse_failed', reason, detail: error === null ? null : errorDetail(error) };
}

function errorDetail(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
