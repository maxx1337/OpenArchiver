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
 * addressed to the journal mailbox -- `JR-5-06`) were left open here as an extensible union rather
 * than a closed two-case type, precisely so a caller that already switches on `kind` gets a compile
 * error at every such switch when a member is added, not a silent fallthrough -- and `JR-5-05`/
 * `JR-5-06` are the slice that spends that extensibility: both members are now implemented, by
 * `packages/journaling/src/parser/journal-report.ts`'s `classifyNonJournalMessage()`.
 *
 * The classification order between all four `kind`s is deliberate, not incidental (see that
 * function's doc comment for the full reasoning): an Exchange journal-report wrapper is checked
 * *first*, and wins regardless of what its inner message looks like -- Exchange can journal a bounce
 * exactly like any other message, so an NDR wrapped inside a well-formed journal report is still
 * `'journal_report'`, never `'ndr'`. Only once that shape is structurally absent does the parser ask
 * whether the message is an NDR (`'ndr'`) or an ordinary message that simply never had a journal
 * wrapper to begin with (`'plain_bcc'`).
 *
 * `JR-5-03` adds `InnerMessagePresent.contentEncrypted` (S/MIME-encrypted inner message: stored and
 * flagged, never rejected) and makes `InnerMessageAbsent` (below) an actually-produced case: a
 * missing inner `message/rfc822` part stays `kind: 'journal_report'` with `innerMessage: { present:
 * false }` rather than discarding the already-parsed envelope, so `parse_failed` never has to
 * substitute for a case the envelope parser already handled correctly (PO review R1). `JR-5-04`
 * adds `JournalParseFailed.extractableHeaders` for the cases where no envelope was ever parsed at
 * all.
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
	/**
	 * `JR-5-03`: true when the inner message's body is S/MIME-encrypted (`application/pkcs7-mime` --
	 * RFC 8551 -- or the deprecated `application/x-pkcs7-mime` alias; in practice usually carrying
	 * `smime-type=enveloped-data`, though this is set for any `pkcs7-mime` body regardless of that
	 * parameter, including the opaque-signed-data case, which is just as unreadable as ciphertext
	 * without unwrapping the PKCS#7 structure).
	 *
	 * `subject`/`messageId`/`from` above are still the plaintext RFC 5322 headers of the inner
	 * message -- S/MIME envelope encryption wraps the *body*, not the surrounding message headers --
	 * but from this flag being `true` onward, `raw`'s body portion is ciphertext, not plaintext
	 * content. **A caller (the `journal-inbound` worker, `JR-6-02`) must not feed `raw` to text
	 * extraction/indexing when this is `true`; only the header fields above are safe to index.**
	 * The bytes themselves are never altered either way -- `raw` is always the unmodified inner
	 * message, encrypted or not (README constraint 3).
	 *
	 * A `multipart/signed; protocol="application/pkcs7-signature"` inner message (clear-signed, not
	 * encrypted) leaves this `false`: its body is ordinary readable MIME with a detached signature
	 * alongside it, not wrapped inside anything, so it is fully indexable like any other message.
	 */
	readonly contentEncrypted: boolean;
}

/**
 * The report part parsed fine but no `message/rfc822` inner part was found (`JR-5-03`). `envelope`
 * on the surrounding `JournalReportParsed` is still complete -- this case is about the *original
 * message* being unrecoverable, not the envelope. A caller must treat `present === false` here as
 * the signal to additionally write a `parse_failed` ledger event and alert (`JR-5-04`): the outer
 * `kind` alone reads as success, deliberately, because the envelope genuinely is one.
 */
export interface InnerMessageAbsent {
	readonly present: false;
}

export type InnerMessagePart = InnerMessagePresent | InnerMessageAbsent;

/**
 * The outer message parsed as a well-formed Exchange envelope-journaling report. `envelope` is
 * always the **complete** result of `parseEnvelope()` -- including `bcc`/`recipients`/`onBehalfOf`/
 * `unknownFields` -- regardless of whether `innerMessage` turned out to be present, absent, or
 * encrypted; those three are properties of the *inner message*, never a reason to reduce or drop the
 * *envelope* (PO review R1, `JR-5-03`).
 */
export interface JournalReportParsed {
	readonly kind: 'journal_report';
	readonly envelope: ParsedEnvelope;
	/** The report part's decoded plain text, preserved verbatim alongside the parsed fields. */
	readonly reportText: string;
	readonly innerMessage: InnerMessagePart;
}

/**
 * Whatever header metadata could still be read off the raw bytes when the message could not be
 * parsed as a journal report (`JR-5-04`) -- best-effort, absent fields are `null`, never guessed.
 * This is what makes "index whatever is extractable" (RFC section 5.3, journal-ledger skill
 * section 6) possible for a `parse_failed` result: without it, `JournalParseFailed` carried only a
 * machine-readable `reason` string, which gives an indexer nothing to search on. Sourced either from
 * the journal report's own envelope fields (when the report text parsed but the inner message did
 * not -- the more accurate source, since these are the *original* message's fields) or, failing
 * that, from the raw top-level RFC 5322 header block of the bytes the caller was handed at all
 * (undecoded, so an encoded-word subject stays encoded here -- still better than nothing to index).
 */
export interface ExtractableHeaders {
	readonly subject: string | null;
	readonly from: string | null;
	readonly messageId: string | null;
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
	/** See {@link ExtractableHeaders}. Always present, even when every field in it is `null`. */
	readonly extractableHeaders: ExtractableHeaders;
}

/**
 * Everything the parser needs from the SMTP transaction that delivered the message, for the two
 * cases where there is no journal-report wrapper to source an envelope from at all (`JR-5-05`'s
 * plain-BCC/routing-rule fallback, RFC section 6.2, and `JR-5-06`'s NDR detection, whose strongest
 * signal -- the null reverse-path -- lives in the transaction, not in any header).
 *
 * Deliberately narrower than `JournalTransactionInput`
 * (`packages/journaling/src/spool/acceptance.ts`): that type also carries `chunks` (the raw wire
 * bytes as an async iterable) and `chainScopeId` (which chain this receipt belongs to), neither of
 * which this package's pure parsing logic has any business touching -- the parser only ever sees
 * bytes already read into a buffer, and is not itself on the ledger/chain seam.
 *
 * Field names are exactly `envelopeFrom`/`envelopeRcpt`, matching `JournalTransactionInput` and the
 * ledger row (`journal-ledger.types.ts`'s `JournalLedgerRecord`) -- not `mailFrom`/`rcptTo` or any
 * other alias. Three different names for the same SMTP concept across ingress, ledger and parser is
 * exactly the vocabulary drift `CLAUDE.md` section 5.4 warns about for permissions, and it is just as
 * avoidable here: a caller (the `journal-inbound` worker, epic E6) should be able to pass its
 * `JournalTransactionInput` fields straight through without renaming anything.
 */
export interface SmtpTransactionEnvelope {
	/**
	 * `MAIL FROM` as the SMTP transaction that delivered this message carried it.
	 *
	 * **Convention this type establishes** (no earlier consumer of `envelopeFrom` had reason to
	 * distinguish these): `''` (empty string) is RFC 5321 section 4.5.5's null reverse-path,
	 * `MAIL FROM:<>` -- reserved for delivery status notifications and other messages that must
	 * never themselves generate a bounce -- and is this parser's single strongest NDR signal,
	 * because it comes from the transaction itself, not from a header a forwarded or forged message
	 * could carry regardless of what actually happened on the wire. `null` means "no SMTP envelope
	 * information available at all" (e.g. a caller outside a live transaction), never "known to be
	 * empty" -- collapsing those two into one `null` would silently discard the null-reverse-path
	 * signal for every message a future caller does have transaction data for.
	 */
	readonly envelopeFrom: string | null;
	/**
	 * `RCPT TO` in arrival order, or `null` if unavailable. For a `JournalPlainBcc` result this is
	 * **not** the original message's full distribution list -- see that type's doc comment for why.
	 */
	readonly envelopeRcpt: readonly string[] | null;
}

/**
 * `JR-5-05`, RFC section 6.2: the outer message carries no Exchange envelope-journaling wrapper at
 * all (`multipart/mixed` with a `text/plain` report part, RFC section 6.1) but is otherwise a
 * well-formed message -- the shape produced by a Postfix `always_bcc` copy (Zimbra and mailcow have
 * the same always-bcc pattern), or by a Google Workspace routing rule with "also deliver to"
 * (Workspace has no SMTP-journaling equivalent at all; RFC section 6.2 says to treat it identically
 * to plain BCC and to document the limitation -- this type's doc comment, and its use from both
 * patterns, is that documentation).
 *
 * There is no journal report to source Bcc recipients or distribution-list-expansion members from --
 * that information was never transmitted to this receiver in the first place, structurally, not
 * because parsing failed on it. `reducedEnvelopeFidelity` is therefore always the literal `true` for
 * this `kind`, never a best-effort flag that might someday read `false`: it is the defining fact of
 * the case, not an observation about one particular message. A caller must not treat `envelope` here
 * as if it were a `JournalReportParsed.envelope` with some fields missing -- there is no
 * `bcc`/`recipients`/`onBehalfOf`/`unknownFields` here to be a reduced version *of*; the whole
 * concept of a journal-report envelope does not apply to this case, only the raw SMTP transaction
 * does.
 */
export interface JournalPlainBcc {
	readonly kind: 'plain_bcc';
	/**
	 * `MAIL FROM`/`RCPT TO` exactly as this receiver's own SMTP transaction saw them -- **not** the
	 * original message's distribution list. A Postfix `always_bcc` copy's `RCPT TO` is typically just
	 * the archive mailbox address itself (Postfix does not replay the original message's recipients
	 * as additional `RCPT TO` commands on the always-bcc leg); the message's own `To`/`Cc` headers
	 * (readable via `extractableHeaders`, or by a caller's own header parse of the stored bytes) are
	 * the only surviving hint at the original recipients, and any genuine Bcc recipient is gone
	 * without a trace -- exactly the reduction `reducedEnvelopeFidelity` names.
	 */
	readonly envelope: SmtpTransactionEnvelope;
	readonly reducedEnvelopeFidelity: true;
	/** See {@link ExtractableHeaders}. Read from the message's own top-level RFC 5322 headers. */
	readonly extractableHeaders: ExtractableHeaders;
}

/**
 * Which signal(s) `JR-5-06`'s NDR detection found, strongest first as listed here -- but a result
 * carries *all* signals it found, in no particular order, rather than picking one: collapsing that
 * down to a single reason or a boolean would be the same class of information loss
 * `ParsedEnvelope.undisclosedRecipientFields`'s doc comment already warns against for a different
 * field, and an auditor asking "why was this flagged as a bounce" deserves the real answer.
 *
 *  - `'null-envelope-sender'` -- **strongest**: `MAIL FROM:<>` (RFC 5321 section 4.5.5) on the
 *    transaction that delivered this message. Reserved by convention for delivery status
 *    notifications and their close cousins; comes from the SMTP layer, not from a header.
 *  - `'delivery-status-report'` -- **strong**: the outer message's own `Content-Type` is
 *    `multipart/report` with a `report-type` parameter of `delivery-status` (RFC 3464's canonical
 *    DSN shape).
 *  - `'auto-submitted-header'` -- **weak, corroborating**: an `Auto-Submitted` header (RFC 3834
 *    section 5) present with any value other than `no` (`no` is the explicit default, meaning *not*
 *    auto-submitted). Also set by ordinary vacation autoresponders and other automated notices, not
 *    only by bounces, so on its own this is weaker evidence than the other two -- but a malformed DSN
 *    that omits `report-type` is exactly the failure this project cannot afford to miss silently
 *    (RFC section 5.3: completeness over precision), so it is still sufficient by itself to classify
 *    as `'ndr'` rather than falling through to `'plain_bcc'`.
 */
export type NdrSignal = 'null-envelope-sender' | 'delivery-status-report' | 'auto-submitted-header';

/**
 * `JR-5-06`, RFC section 6.2: a non-delivery report or bounce addressed to the journal mailbox.
 * Stored and flagged like any other accepted message -- never rejected, this is not a `parse_failed`
 * variant -- because it is itself evidence of a delivery problem an auditor may want to see.
 *
 * Only reachable when the outer message did *not* match the Exchange journal-report shape first: an
 * NDR that Exchange itself journalled (wrapped as the `message/rfc822` inner part of an otherwise
 * well-formed report) stays `kind: 'journal_report'` -- see `journal-report.ts`'s module doc comment
 * for why that ordering is the deliberate, tested choice and not an oversight.
 */
export interface JournalNdr {
	readonly kind: 'ndr';
	/** See {@link NdrSignal}. Never empty for a value of this `kind` -- at least one signal fired. */
	readonly signals: readonly NdrSignal[];
	/**
	 * The same `SmtpTransactionEnvelope` the caller passed to `parseJournalReport()`, passed straight
	 * through rather than summarised away. The caller already held this value (it is their own
	 * input), so returning it here is not new information -- but a consumer that only keeps the
	 * `JournalReportParseResult` (logs it, queues it, stores it) rather than also holding onto the
	 * original argument would otherwise lose track of which transaction produced this classification.
	 * Kept symmetric with `JournalPlainBcc.envelope` for exactly that reason, not because this `kind`
	 * needs its own copy of the envelope for any other purpose.
	 */
	readonly envelope: SmtpTransactionEnvelope;
	/** See {@link ExtractableHeaders}. Read from the message's own top-level RFC 5322 headers. */
	readonly extractableHeaders: ExtractableHeaders;
}

export type JournalReportParseResult =
	| JournalReportParsed
	| JournalParseFailed
	| JournalPlainBcc
	| JournalNdr;

/**
 * `JR-5-04`'s alerting requirement ("Operator wird alarmiert") deliberately has **no type here**.
 * An earlier version of this file added `ParseFailedAlert`/`ParseFailedAlertSink`, modelled on
 * `QuarantineAlert`/`QuarantineAlertSink` (`packages/journaling/src/spool/quarantine.ts`) -- but
 * unlike that pair, which `runCrashRecoveryScan()` constructs and calls in the same package, nothing
 * in `packages/journaling` ever constructed a `ParseFailedAlert` or called a `ParseFailedAlertSink`
 * (PO review R2, `JR-5-03`/`JR-5-04`): a seam with no producer and no caller is a guess, not a
 * contract, and the risk is that E6 adopts it *because it exists* rather than because it fits what
 * the `journal-inbound` worker actually needs (a ledger `seq`, a spool path, neither of which the
 * parser has). `JournalReportParsed`/`JournalParseFailed` already carry everything the worker needs
 * to build whatever alert shape it settles on: `innerMessage.present === false` or
 * `kind === 'parse_failed'` as the signal, `reason`/`detail`/`extractableHeaders` as the payload.
 * Defining the alert sink is E6's job, once it knows what it needs.
 */
