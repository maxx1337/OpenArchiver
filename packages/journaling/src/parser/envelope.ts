import type { EnvelopeUnknownField, ParsedEnvelope } from '@open-archiver/types';

/**
 * Parses the plain-text body of an Exchange envelope-journaling report into structured envelope
 * fields (`JR-5-02`, RFC section 6.1).
 *
 * ---------------------------------------------------------------------------------------------
 * Format
 * ---------------------------------------------------------------------------------------------
 * The report body is a sequence of `Field: value` lines (`Sender`, `Subject`, `Message-Id`, `To`,
 * `Cc`, `Bcc`, `Recipient`, `On-Behalf-Of`, ...), with two conventions carried over from RFC 5322
 * header folding rather than being reinvented for this format:
 *
 *  - A line beginning with whitespace **continues** the previous field's value rather than
 *    starting a new one. Exchange uses this to note distribution-list expansion: a `Recipient:`
 *    line for a DL address is followed by one indented line per expanded member.
 *  - `To`/`Cc` may carry the RFC 5322 empty-group placeholder `undisclosed-recipients:;` instead of
 *    an address list.
 *
 * `Recipient:` is the field this whole feature exists for (RFC section 6.1): it lists the true SMTP
 * envelope recipients, which is where BCC copies and DL-expansion members appear that `To`/`Cc`
 * never show. It is therefore parsed as a repeatable, order-preserving, non-deduplicating list, not
 * folded into `to`/`cc`.
 *
 * ---------------------------------------------------------------------------------------------
 * Unknown fields
 * ---------------------------------------------------------------------------------------------
 * Any field-shaped line this module does not otherwise model (an Exchange version marker, a future
 * field, a customer transport-rule annotation) is preserved verbatim in `unknownFields` rather than
 * dropped. A line that is neither a recognisable `Field: value` line nor a continuation of one is
 * kept too, under the synthetic name `_unparsed` -- so nothing in the report text is silently
 * discarded, even content this parser was not written to expect.
 */

const FIELD_LINE = /^([A-Za-z][A-Za-z0-9-]*)\s*:[ \t]?(.*)$/;
const CONTINUATION_LINE = /^[ \t]+(\S.*)$/;
const UNDISCLOSED_RECIPIENTS = /^undisclosed[- ]recipients\s*:\s*;?\s*$/i;
const UNPARSED_FIELD_NAME = '_unparsed';

interface UnfoldedLine {
	/** Lowercased field name, or `_unparsed` for a line that matched neither pattern. */
	readonly name: string;
	/** Value with continuation lines merged in (joined by a single space) and trimmed. */
	readonly value: string;
}

/**
 * Splits report text into logical lines, merging indented continuation lines into the field line
 * above them. A line that is neither a `Field:` line nor a continuation of one is kept as its own
 * `_unparsed` entry rather than being dropped.
 */
function unfold(reportText: string): UnfoldedLine[] {
	const lines = reportText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	const result: UnfoldedLine[] = [];

	for (const line of lines) {
		if (line.trim().length === 0) {
			continue;
		}

		const continuation = CONTINUATION_LINE.exec(line);
		if (continuation && result.length > 0) {
			const previous = result[result.length - 1]!;
			result[result.length - 1] = {
				name: previous.name,
				value: `${previous.value} ${continuation[1]!.trim()}`.trim(),
			};
			continue;
		}

		const field = FIELD_LINE.exec(line);
		if (field) {
			result.push({ name: field[1]!.toLowerCase(), value: field[2]!.trim() });
			continue;
		}

		result.push({ name: UNPARSED_FIELD_NAME, value: line.trim() });
	}

	return result;
}

/**
 * Splits an address-list field's merged value into individual addresses. Continuation lines are
 * merged with a single space (see {@link unfold}), so both comma-separated (`Recipient: a@x, b@x`)
 * and one-per-line (`Recipient: a@x` + indented `b@x`) styles end up splittable the same way.
 */
function splitAddressList(value: string): string[] {
	if (value.trim().length === 0) {
		return [];
	}
	return value
		.split(/[,\s]+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

const KNOWN_FIELD_NAMES = new Set([
	'sender',
	'subject',
	'message-id',
	'on-behalf-of',
	'recipient',
	'to',
	'cc',
	'bcc',
]);

export function parseEnvelope(reportText: string): ParsedEnvelope {
	const lines = unfold(reportText);

	let sender: string | null = null;
	let subject: string | null = null;
	let messageId: string | null = null;
	let onBehalfOf: string | null = null;
	let undisclosedRecipients = false;
	const to: string[] = [];
	const cc: string[] = [];
	const bcc: string[] = [];
	const recipients: string[] = [];
	const unknownFields: EnvelopeUnknownField[] = [];

	for (const line of lines) {
		switch (line.name) {
			case 'sender':
				sender = line.value;
				break;
			case 'subject':
				subject = line.value;
				break;
			case 'message-id':
				messageId = line.value;
				break;
			case 'on-behalf-of':
				onBehalfOf = line.value;
				break;
			case 'recipient':
				recipients.push(...splitAddressList(line.value));
				break;
			case 'to':
			case 'cc':
			case 'bcc': {
				if (UNDISCLOSED_RECIPIENTS.test(line.value)) {
					undisclosedRecipients = true;
					break;
				}
				const target = line.name === 'to' ? to : line.name === 'cc' ? cc : bcc;
				target.push(...splitAddressList(line.value));
				break;
			}
			default:
				unknownFields.push({ name: line.name, value: line.value });
		}
	}

	return {
		sender,
		subject,
		messageId,
		to,
		cc,
		bcc,
		recipients,
		onBehalfOf,
		undisclosedRecipients,
		unknownFields,
	};
}

/** Exposed for tests that want to assert exactly which field names this parser recognises. */
export const KNOWN_ENVELOPE_FIELD_NAMES: ReadonlySet<string> = KNOWN_FIELD_NAMES;
