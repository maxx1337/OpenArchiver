import { simpleParser } from 'mailparser';
import type { AddressObject, EmailAddress } from 'mailparser';
import type {
	EnvelopeAddressField,
	EnvelopeUnknownField,
	ParsedEnvelope,
} from '@open-archiver/types';

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
 *  - `To`/`Cc`/`Bcc` may carry the RFC 5322 empty-group placeholder `undisclosed-recipients:;`
 *    instead of an address list.
 *
 * `Recipient:` is the field this whole feature exists for (RFC section 6.1): it lists the true SMTP
 * envelope recipients, which is where BCC copies and DL-expansion members appear that `To`/`Cc`
 * never show. Exchange writes one bare SMTP address per `Recipient:` entry -- never a display name
 * -- so it is parsed as a repeatable, order-preserving, non-deduplicating list split on commas *or*
 * whitespace: both the one-address-per-continuation-line style and a hypothetical comma-separated
 * one land in the same list.
 *
 * `To`/`Cc`/`Bcc`, in contrast, mirror the original message headers and so can carry the full RFC
 * 5322 address-list grammar: display names, quoted strings (which may themselves contain commas or
 * semicolons), angle-address syntax. Splitting those on a bare `,`/whitespace regex -- this module's
 * first version did exactly that -- shreds a quoted display name like `"Doe, John"
 * <john@contoso.com>` into garbage tokens (`'"Doe'`, `'John"'`, `'<john@contoso.com>'`, ...).
 * `parseHeaderAddressList()` below fixes that not by hand-rolling the grammar and not by reaching
 * past `mailparser` (the only parsing dependency ADR-027 permits) into its internal
 * `nodemailer/lib/addressparser`, but by building a synthetic one-line header (`To: <value>`) and
 * running it through `mailparser`'s own public `simpleParser()` entry point, then reading back
 * `ParsedMail.to`/`.cc`/`.bcc`. That is a `mailparser` call like every other one in this package, not
 * a new dependency, and it reuses address-list parsing already exercised by the library's own test
 * suite instead of re-implementing RFC 5322 quoting here.
 *
 * ---------------------------------------------------------------------------------------------
 * Unknown fields
 * ---------------------------------------------------------------------------------------------
 * Any field-shaped line this module does not otherwise model (an Exchange version marker, a future
 * field, a customer transport-rule annotation) is preserved verbatim in `unknownFields` rather than
 * dropped. A line that is neither a recognisable `Field: value` line nor a continuation of one is
 * kept too, under the synthetic name `_unparsed` -- so nothing in the report text is silently
 * discarded, even content this parser was not written to expect.
 *
 * The field names this module recognises are exactly the keys of {@link FIELD_HANDLERS} --
 * {@link KNOWN_ENVELOPE_FIELD_NAMES} is *derived* from that same object rather than listed a second
 * time, so a field handled in the dispatch table and a field advertised as "known" cannot drift
 * apart the way a hand-maintained `switch` alongside a hand-maintained `Set` could.
 */

const FIELD_LINE = /^([A-Za-z][A-Za-z0-9-]*)\s*:[ \t]?(.*)$/;
const CONTINUATION_LINE = /^[ \t]+(\S.*)$/;
const UNDISCLOSED_RECIPIENTS = /^undisclosed[- ]recipients\s*:\s*;?\s*$/i;
const UNPARSED_FIELD_NAME = '_unparsed';

/** Options for the address-list-only `simpleParser()` calls: no HTML/text conversion needed. */
const ADDRESS_PARSE_OPTIONS = { skipHtmlToText: true, skipTextToHtml: true } as const;

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
 * Splits a plain SMTP-address list (no display names expected) on commas and/or whitespace. Used
 * only for `Recipient:` -- see the module doc comment for why `To`/`Cc`/`Bcc` need the
 * `mailparser`-backed parser instead.
 */
function splitPlainAddressList(value: string): string[] {
	if (value.trim().length === 0) {
		return [];
	}
	return value
		.split(/[,\s]+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

/** Recursively flattens `EmailAddress[]` (which may nest via `.group`) into bare address strings. */
function collectAddresses(addresses: readonly EmailAddress[] | undefined, out: string[]): void {
	if (!addresses) {
		return;
	}
	for (const entry of addresses) {
		if (entry.group && entry.group.length > 0) {
			collectAddresses(entry.group, out);
			continue;
		}
		if (entry.address) {
			out.push(entry.address);
		}
	}
}

function addressObjectsOf(value: AddressObject | AddressObject[] | undefined): AddressObject[] {
	if (!value) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

/**
 * Parses a `To`/`Cc`/`Bcc`/`From` value's full RFC 5322 address-list grammar via `mailparser`, by
 * building a synthetic one-header message and reading back the corresponding `ParsedMail` field. Never
 * throws -- a `mailparser` failure on this synthetic, deliberately tiny input is treated as "no
 * addresses" rather than failing the whole envelope over one malformed address list (consistent with
 * this parser's overall no-throw contract, see `journal-report.ts`).
 *
 * **Exported since `JR-6-02b`, and `'From'` added there.** Phase B has to build an
 * `OwnerResolutionEnvelope` out of the *outer* message's own RFC 5322 headers for the three parse
 * results that carry no journal-report envelope (`plain_bcc`, `ndr`, `parse_failed` -- **ADR-033**), and
 * that needs exactly this grammar. Re-implementing it there would have meant two address parsers with
 * two answers for the same header, which is the shape ADR-027 keeps this package away from: `mailparser`
 * is the only parsing dependency, and this is the one place that calls it for an address list.
 */
export async function parseHeaderAddressList(
	headerName: 'To' | 'Cc' | 'Bcc' | 'From',
	value: string
): Promise<string[]> {
	if (value.trim().length === 0) {
		return [];
	}
	let parsedField: AddressObject | AddressObject[] | undefined;
	try {
		const synthetic = Buffer.from(`${headerName}: ${value}\r\n\r\n`, 'utf8');
		const parsed = await simpleParser(synthetic, ADDRESS_PARSE_OPTIONS);
		parsedField =
			headerName === 'To'
				? parsed.to
				: headerName === 'Cc'
					? parsed.cc
					: headerName === 'Bcc'
						? parsed.bcc
						: parsed.from;
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const addressObject of addressObjectsOf(parsedField)) {
		collectAddresses(addressObject.value, out);
	}
	return out;
}

/** The envelope fields accumulated while walking the unfolded lines, before freezing into `ParsedEnvelope`. */
interface EnvelopeAccumulator {
	sender: string | null;
	subject: string | null;
	messageId: string | null;
	onBehalfOf: string | null;
	to: string[];
	cc: string[];
	bcc: string[];
	recipients: string[];
	undisclosedRecipientFields: EnvelopeAddressField[];
	unknownFields: EnvelopeUnknownField[];
}

function newAccumulator(): EnvelopeAccumulator {
	return {
		sender: null,
		subject: null,
		messageId: null,
		onBehalfOf: null,
		to: [],
		cc: [],
		bcc: [],
		recipients: [],
		undisclosedRecipientFields: [],
		unknownFields: [],
	};
}

async function handleAddressField(
	acc: EnvelopeAccumulator,
	field: EnvelopeAddressField,
	value: string
): Promise<void> {
	if (UNDISCLOSED_RECIPIENTS.test(value)) {
		acc.undisclosedRecipientFields.push(field);
		return;
	}
	const headerName = field === 'to' ? 'To' : field === 'cc' ? 'Cc' : 'Bcc';
	const addresses = await parseHeaderAddressList(headerName, value);
	acc[field].push(...addresses);
}

type FieldHandler = (acc: EnvelopeAccumulator, value: string) => Promise<void>;

/**
 * The single source of truth for which field names this parser recognises.
 * {@link KNOWN_ENVELOPE_FIELD_NAMES} is derived from this object's keys -- see the module doc
 * comment for why that derivation, rather than a hand-maintained second list, is the point.
 */
const FIELD_HANDLERS: Readonly<Record<string, FieldHandler>> = {
	sender: async (acc, value) => {
		acc.sender = value;
	},
	subject: async (acc, value) => {
		acc.subject = value;
	},
	'message-id': async (acc, value) => {
		acc.messageId = value;
	},
	'on-behalf-of': async (acc, value) => {
		acc.onBehalfOf = value;
	},
	recipient: async (acc, value) => {
		acc.recipients.push(...splitPlainAddressList(value));
	},
	to: async (acc, value) => handleAddressField(acc, 'to', value),
	cc: async (acc, value) => handleAddressField(acc, 'cc', value),
	bcc: async (acc, value) => handleAddressField(acc, 'bcc', value),
};

/** Exposed for tests that want to assert exactly which field names this parser recognises. */
export const KNOWN_ENVELOPE_FIELD_NAMES: ReadonlySet<string> = new Set(Object.keys(FIELD_HANDLERS));

/**
 * PO review R3 (`JR-5-05`/`JR-5-06`): whether the report text's very first non-blank line is itself
 * field-shaped (`unfold()`'s classification, not `_unparsed`) rather than prose or a quoted-forward
 * separator line (`"---------- Forwarded message ---------"`, or the message's own free text). A
 * genuine Exchange journal report's field-line block starts immediately (RFC section 6.1); a
 * forwarded message's quoted header block -- which can itself contain field-shaped lines like `To:`/
 * `Cc:`/`Subject:` -- is preceded by exactly that kind of separator or prose in every mail client this
 * parser has been checked against.
 *
 * `false` for an entirely blank/empty report text too (no lines at all) -- there is nothing here to
 * prove itself a report, and this function only ever answers "did it prove itself", never "was
 * nothing found to disprove it".
 *
 * One of two independent signals `journal-report.ts`'s `looksLikeGenuineJournalReport()` requires
 * together before treating a report-part-found/inner-missing message as a genuine (if incomplete)
 * journal report rather than an ordinary message that happened to land in the report-part position --
 * see that function's doc comment for the other signal and the full reasoning.
 */
export function reportTextBeginsWithFieldLine(reportText: string): boolean {
	const lines = unfold(reportText);
	return lines.length > 0 && lines[0]!.name !== UNPARSED_FIELD_NAME;
}

export async function parseEnvelope(reportText: string): Promise<ParsedEnvelope> {
	const lines = unfold(reportText);
	const acc = newAccumulator();

	for (const line of lines) {
		const handler = FIELD_HANDLERS[line.name];
		if (handler) {
			await handler(acc, line.value);
			continue;
		}
		acc.unknownFields.push({ name: line.name, value: line.value });
	}

	return {
		sender: acc.sender,
		subject: acc.subject,
		messageId: acc.messageId,
		to: acc.to,
		cc: acc.cc,
		bcc: acc.bcc,
		recipients: acc.recipients,
		onBehalfOf: acc.onBehalfOf,
		undisclosedRecipientFields: acc.undisclosedRecipientFields,
		unknownFields: acc.unknownFields,
	};
}
