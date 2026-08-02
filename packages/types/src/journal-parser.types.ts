/**
 * Journal-report parser result types (epic E5, `JR-5-01`/`JR-5-02`).
 *
 * These describe the *shape* the Exchange envelope-journaling parser in `packages/journaling`
 * produces. They live here, not in `packages/journaling`, for the same reason
 * `journal-ledger.types.ts` does: `packages/journaling` may depend only on `@open-archiver/types`
 * (`docs/dev/journaling/02-architektur.md` section 2), and both the parser and its consumer (the
 * `journal-inbound` worker in `packages/backend`, epic E6) need to agree on the same shapes without
 * either importing the other's implementation.
 *
 * The result is a **discriminated union on `kind`**, deliberately never thrown as an exception --
 * `docs/dev/journaling/README.md` constraint 4 and RFC section 5.3: an unparseable journal report
 * is still accepted, stored, hashed and chained, never rejected. A caught `mailparser` exception
 * must never leave the parser as a thrown error.
 *
 * `'journal_report'` and `'parse_failed'` are implemented by `JR-5-01`/`JR-5-02`. `'plain_bcc'`
 * (no journal wrapper, envelope taken from the SMTP transaction -- `JR-5-05`) and `'ndr'` (a bounce
 * addressed to the journal mailbox -- `JR-5-06`) are added by a later E5 slice. Deliberately left
 * open here as an extensible union rather than a closed two-case type: a caller that already
 * switches on `kind` gets a compile error at every such switch when a member is added, not a silent
 * fallthrough -- so the extension is additive, not a breaking change to this file.
 */

/** One field line from the journal report text that the envelope parser does not otherwise model. */
export interface EnvelopeUnknownField {
	readonly name: string;
	readonly value: string;
}

/** The three envelope fields that can carry the RFC 5322 empty-group ("undisclosed recipients") placeholder. */
export type EnvelopeAddressField = 'to' | 'cc' | 'bcc';

/**
 * The envelope fields extracted from an Exchange journal report's `text/plain` part (RFC section
 * 6.1).
 *
 * `recipients` is the entire justification for this feature: Exchange's `Recipient:` lines record
 * the true SMTP envelope recipient list, which is where BCC recipients and distribution-list
 * expansion members appear. `to`/`cc`/`bcc` mirror the message headers instead, exactly the fields
 * a plain BCC transport rule already provides -- they are kept here for completeness, not as the
 * primary signal.
 */
export interface ParsedEnvelope {
	readonly sender: string | null;
	readonly subject: string | null;
	readonly messageId: string | null;
	readonly to: readonly string[];
	readonly cc: readonly string[];
	readonly bcc: readonly string[];
	/**
	 * Every `Recipient:` line's addresses, in report order, after unfolding indented continuation
	 * lines -- **not deduplicated, not reordered**. Exchange notes distribution-list expansion as
	 * additional addresses under a `Recipient:` entry, and the order recipients arrived in is part
	 * of the evidentiary record, mirroring `envelope_rcpt`'s ordering rule in the ledger encoding
	 * (`docs/dev/journaling/02-architektur.md` section 4, ADR-006).
	 */
	readonly recipients: readonly string[];
	readonly onBehalfOf: string | null;
	/**
	 * Which of `to`/`cc`/`bcc` carried the RFC 5322 empty-group placeholder
	 * `undisclosed-recipients:;`, in report order. Empty when none did.
	 *
	 * Deliberately not a single boolean: an earlier version of this field collapsed all three fields
	 * into one flag, which is itself the class of information loss this parser exists to avoid --
	 * "was it To or Bcc that used the placeholder" is exactly the kind of provenance the ledger and
	 * an auditor would want back. `To` and `Cc` carrying it simultaneously is unusual but not
	 * impossible, so this is a list, not an optional single field.
	 */
	readonly undisclosedRecipientFields: readonly EnvelopeAddressField[];
	/**
	 * Field lines the parser does not otherwise model, preserved verbatim rather than dropped.
	 * A silently discarded field is the single most expensive mistake this parser can make: it
	 * would look like a complete envelope while quietly having thrown evidence away.
	 */
	readonly unknownFields: readonly EnvelopeUnknownField[];
}

/**
 * The journal report's inner `message/rfc822` part is present, and its bytes were extracted
 * without any content-transfer-decoding (the MIME rules for the `message` top-level type forbid
 * `quoted-printable`/`base64` encoding of it, so no decoding step exists to introduce drift).
 *
 * Still metadata-only as far as this package's contract is concerned: **never** the input to
 * hashing or storage. The archived object is always the raw *outer* message the caller already
 * held before calling the parser (RFC section 6.1: "the archived object is the raw outer message
 * as received").
 */
export interface InnerMessagePresent {
	readonly present: true;
	readonly raw: Uint8Array;
	readonly subject: string | null;
	readonly messageId: string | null;
	readonly from: string | null;
}

export interface InnerMessageAbsent {
	readonly present: false;
}

export type InnerMessagePart = InnerMessagePresent | InnerMessageAbsent;

/** The outer message parsed as a well-formed Exchange envelope-journaling report. */
export interface JournalReportParsed {
	readonly kind: 'journal_report';
	readonly envelope: ParsedEnvelope;
	/** The report part's decoded plain text, preserved verbatim alongside the parsed fields. */
	readonly reportText: string;
	readonly innerMessage: InnerMessagePart;
}

/**
 * The outer message could not be parsed as a journal report. Per RFC section 5.3 this is not a
 * rejection: the caller still stores, hashes and chains the message, sets the `parse_failed`
 * ledger event (`JR-5-04`), indexes whatever is extractable, and alerts an operator.
 */
export interface JournalParseFailed {
	readonly kind: 'parse_failed';
	/** Short, stable machine-usable reason -- safe to log and to key an alert on. */
	readonly reason: string;
	/** Human-readable detail, e.g. a caught exception's message. Never message body content. */
	readonly detail: string | null;
}

export type JournalReportParseResult = JournalReportParsed | JournalParseFailed;
