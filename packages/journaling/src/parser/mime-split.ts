/**
 * Minimal, top-level-only MIME splitting for Exchange envelope-journaling reports (`JR-5-01`, RFC
 * section 6.1).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this exists instead of handing the whole outer message to `mailparser`
 * ---------------------------------------------------------------------------------------------
 * `mailparser` (permitted in this package by ADR-027) parses a full MIME tree, and it descends
 * across a `message/rfc822` boundary **conditionally**, not always -- this is a correction of an
 * earlier version of this comment, which stated the crossing as unconditional. Measured against the
 * installed `mailparser@3.7.4`, three otherwise-identical fixtures that differ only in the
 * `message/rfc822` part's `Content-Disposition` (see `mime-split.test.ts`, "mailparser's
 * message/rfc822 boundary is conditional on Content-Disposition: inline"):
 *
 * ```
 * disposition=(none)     | inner text in .text = false | attachments=1
 * disposition=inline     | inner text in .text = TRUE  | attachments=0
 * disposition=attachment | inner text in .text = false | attachments=1
 * ```
 *
 * The condition lives in `mailsplit/lib/message-splitter.js` (v5.4.5, lines 373-378): a
 * `message/rfc822` node only becomes a `messageNode` -- the flag that makes `mail-parser.js` (line
 * 806) `break` instead of emitting an attachment, and that makes the embedded message's own child
 * nodes carry `showMeta = true` (`mail-parser.js` line 811) -- when its encoding is one of
 * `7bit`/`8bit`/`binary` **and** its `Content-Disposition` is `inline` (with this library's default
 * config, where `defaultInlineEmbedded` is falsy; the alternative branch there would instead require
 * disposition *not* to be `attachment`, which is not the configuration this package uses). Only in
 * that case does `getTextContent()` (`mail-parser.js`, `processNode`) walk into the embedded
 * message's own MIME tree and merge its `text/plain` body into the *same* `ParsedMail.text` as the
 * outer report part, prefixed with the embedded message's `From`/`Subject`/`Date`/`To`/`Cc`/`Bcc` as
 * a text block (`showMeta` handling, same file, ~line 657).
 *
 * RFC section 6.1 does not mandate a `Content-Disposition` on the journal report's `message/rfc822`
 * part, and Exchange's own envelope-journaling reports do not appear to set one either -- but this
 * package cannot assume every sender does the same, and a sender (or a future Exchange version) that
 * does set `inline` would silently interleave the inner message's body into the same text the
 * envelope parser reads field lines from, with no error and no visible sign in the output. That is
 * exactly the kind of undetectable data-mixing the project's rule on preserving both parts distinctly
 * (`JR-5-01`'s acceptance criterion, RFC section 6.1: "Both must be preserved") rules out, so this
 * module does not rely on the default case holding.
 *
 * This module does only the one thing `mailparser` cannot be told not to do under every
 * `Content-Disposition`: split the *outer* `multipart/mixed` envelope into its immediate child parts
 * by hand, without ever handing `mailparser` the combined buffer. Each child part is then handed to
 * `mailparser` independently (in `journal-report.ts`) -- at that point there is no nested boundary
 * left to cross, so the conditional crossing above cannot apply regardless of the inner part's
 * `Content-Disposition`, and decoding (charset, quoted-printable, base64) is still delegated to the
 * library exactly as ADR-027 intends.
 *
 * Deliberately **not** a general-purpose MIME parser: it understands exactly the shape RFC section
 * 6.1 describes (one `multipart/mixed` envelope, boundary-delimited child parts, each child with its
 * own small header block) and nothing more exotic (nested multipart alternatives inside a child,
 * RFC 2231 continuation parameters, etc.). Anything outside that shape is surfaced as `null` by
 * {@link splitJournalReportMime} -- never a thrown error, per the parser's no-throw contract. What a
 * caller *does* with that `null` is the caller's decision, not this module's: `splitJournalReportMime`
 * itself makes none. `journal-report.ts`'s actual caller (`locateJournalParts()`, below, which reports
 * the report/inner parts independently rather than collapsing them into one `null`) deliberately does
 * **not** treat "no report-part candidate among the immediate children" as proof of a broken
 * journal-report attempt (`JR-5-08` finding 1) -- a shape "nothing more exotic" already disclaims,
 * such as the report-shaped part sitting inside a nested `multipart/alternative`, is not evidence of
 * breakage, only of a shape this deliberately shallow search does not look inside. See
 * `journal-report.ts`'s module doc comment for the reasoning and `parseJournalReport()`'s handling of
 * `located.reportPart === null`.
 *
 * **Never transforms the input bytes.** Every function here only reads `raw`/`body` via
 * `Buffer.indexOf`/`.subarray()` (a view, not a copy, but never written to) and `.toString()` on
 * header regions. The bytes handed back as a part's body are exact subranges of the caller's
 * buffer.
 */

const CRLF_BLANK_LINE = Buffer.from('\r\n\r\n', 'latin1');
const LF_BLANK_LINE = Buffer.from('\n\n', 'latin1');

/** A MIME part's header block (decoded as a lowercase-keyed map) and its raw, unmodified body. */
export interface SplitHeaderAndBody {
	readonly headers: ReadonlyMap<string, string>;
	readonly body: Buffer;
}

/**
 * Splits a buffer at its first header/body blank-line separator (`\r\n\r\n` or `\n\n`, whichever
 * occurs first) and parses the header block. If no blank line is found, the whole buffer is treated
 * as headers with an empty body -- callers reject that shape rather than guessing.
 */
export function splitHeaderAndBody(buf: Buffer): SplitHeaderAndBody {
	const crlfIndex = buf.indexOf(CRLF_BLANK_LINE);
	const lfIndex = buf.indexOf(LF_BLANK_LINE);
	let separatorIndex = -1;
	let separatorLength = 0;
	if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex <= lfIndex)) {
		separatorIndex = crlfIndex;
		separatorLength = 4;
	} else if (lfIndex !== -1) {
		separatorIndex = lfIndex;
		separatorLength = 2;
	}
	if (separatorIndex === -1) {
		return { headers: parseHeaderBlock(buf.toString('latin1')), body: Buffer.alloc(0) };
	}
	return {
		headers: parseHeaderBlock(buf.subarray(0, separatorIndex).toString('latin1')),
		body: buf.subarray(separatorIndex + separatorLength),
	};
}

/**
 * Unfolds RFC 5322 continuation lines (leading whitespace continues the previous header) and
 * returns a lowercase-keyed map of header name to raw value. Header *names* are always ASCII;
 * decoding RFC 2047 encoded-word values is not this module's job -- it only needs `Content-Type`
 * (and only the `multipart/mixed`/`text/plain`/`message/rfc822` distinction and the `boundary`
 * parameter), both of which are themselves ASCII tokens.
 */
function parseHeaderBlock(headerText: string): Map<string, string> {
	const normalized = headerText.replace(/\r\n/g, '\n');
	const rawLines = normalized.split('\n');
	const unfolded: string[] = [];
	for (const line of rawLines) {
		if (line.length === 0) {
			continue;
		}
		if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
			unfolded[unfolded.length - 1] = `${unfolded[unfolded.length - 1]} ${line.trim()}`;
			continue;
		}
		unfolded.push(line);
	}
	const headers = new Map<string, string>();
	for (const line of unfolded) {
		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) {
			continue;
		}
		const name = line.slice(0, colonIndex).trim().toLowerCase();
		const value = line.slice(colonIndex + 1).trim();
		headers.set(name, value);
	}
	return headers;
}

export interface ParsedContentType {
	/** Lowercased `type/subtype`, e.g. `'multipart/mixed'`. Defaults to `'text/plain'` when absent -- the MIME default for a body part with no `Content-Type` header. */
	readonly type: string;
	/** Parameter names lowercased; values keep their original case (boundary values are case-sensitive). */
	readonly params: Readonly<Record<string, string>>;
}

/** Splits a header value on `;` while respecting double-quoted parameter values. */
function splitHeaderParams(value: string): string[] {
	const parts: string[] = [];
	let current = '';
	let inQuotes = false;
	for (const char of value) {
		if (char === '"') {
			inQuotes = !inQuotes;
		}
		if (char === ';' && !inQuotes) {
			parts.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
}

export function parseContentType(value: string | undefined): ParsedContentType {
	if (!value) {
		return { type: 'text/plain', params: {} };
	}
	const segments = splitHeaderParams(value);
	const type = (segments[0] ?? '').trim().toLowerCase();
	const params: Record<string, string> = {};
	for (const segment of segments.slice(1)) {
		const eqIndex = segment.indexOf('=');
		if (eqIndex === -1) {
			continue;
		}
		const key = segment.slice(0, eqIndex).trim().toLowerCase();
		let paramValue = segment.slice(eqIndex + 1).trim();
		if (paramValue.length >= 2 && paramValue.startsWith('"') && paramValue.endsWith('"')) {
			paramValue = paramValue.slice(1, -1);
		}
		params[key] = paramValue;
	}
	return { type, params };
}

/**
 * RFC 2046: a boundary delimiter line is `--<boundary>` optionally followed by linear whitespace
 * (some generators pad it), then the line terminator -- or, for the *closing* delimiter, an extra
 * `--` before that same optional whitespace and terminator. `afterDelimiterText` is the offset right
 * after the matched `--<boundary>` bytes; this checks only what follows it on the same line.
 *
 * Without this check, a body line that merely *starts with* `--<boundary>` -- e.g. a boundary value
 * that is a prefix of a longer token appearing in the encapsulated content -- would be misread as a
 * delimiter and would truncate or misattribute a part's content.
 */
function isBoundaryLineTail(body: Buffer, afterDelimiterText: number): boolean {
	let index = afterDelimiterText;
	if (body[index] === 0x2d && body[index + 1] === 0x2d) {
		index += 2; // the closing delimiter's extra "--"
	}
	while (index < body.length && (body[index] === 0x20 || body[index] === 0x09)) {
		index += 1; // linear whitespace between the delimiter and its line terminator
	}
	return index >= body.length || body[index] === 0x0a || body[index] === 0x0d;
}

/**
 * Byte offsets where a valid `--<boundary>` delimiter line begins: at the start of a line (position
 * 0, or right after a `\n`), and followed only by what {@link isBoundaryLineTail} allows -- never a
 * bare substring match in the middle of a line or as the prefix of an unrelated token.
 */
function findLineStarts(body: Buffer, needle: Buffer): number[] {
	const starts: number[] = [];
	let searchFrom = 0;
	while (searchFrom <= body.length) {
		const index = body.indexOf(needle, searchFrom);
		if (index === -1) {
			break;
		}
		const atLineStart = index === 0 || body[index - 1] === 0x0a;
		if (atLineStart && isBoundaryLineTail(body, index + needle.length)) {
			starts.push(index);
		}
		searchFrom = index + needle.length;
	}
	return starts;
}

/** The index just past the end of the line (including its terminator) starting at `lineStart`. */
function lineEndAfter(body: Buffer, lineStart: number): number {
	const newlineIndex = body.indexOf(0x0a, lineStart);
	return newlineIndex === -1 ? body.length : newlineIndex + 1;
}

/**
 * RFC 2046: the CRLF (or bare LF) immediately preceding a boundary delimiter line belongs to the
 * delimiter, not to the preceding part's body. Returns how many bytes to strip from the end of a
 * part for that reason.
 */
function terminatorLengthBefore(body: Buffer, position: number): number {
	if (position >= 2 && body[position - 2] === 0x0d && body[position - 1] === 0x0a) {
		return 2;
	}
	if (position >= 1 && body[position - 1] === 0x0a) {
		return 1;
	}
	return 0;
}

/**
 * Splits a `multipart/*` body into its child parts (each still headers+body together -- callers
 * run {@link splitHeaderAndBody} again per part). Returns an empty array if fewer than two boundary
 * delimiter lines are found (i.e. there cannot be a complete part).
 *
 * Preamble (before the first delimiter line) and epilogue (after the last one) are silently
 * excluded, per RFC 2046 -- they carry no part content by definition.
 */
export function splitMultipartBody(body: Buffer, boundary: string): Buffer[] {
	const delimiter = Buffer.from(`--${boundary}`, 'ascii');
	const starts = findLineStarts(body, delimiter);
	if (starts.length < 2) {
		return [];
	}
	const parts: Buffer[] = [];
	for (let i = 0; i < starts.length - 1; i += 1) {
		const lineStart = starts[i]!;
		const contentStart = lineEndAfter(body, lineStart);
		const nextLineStart = starts[i + 1]!;
		const contentEnd = nextLineStart - terminatorLengthBefore(body, nextLineStart);
		if (contentEnd <= contentStart) {
			continue;
		}
		parts.push(body.subarray(contentStart, contentEnd));
	}
	return parts;
}

/** The two parts a `JR-5-01` journal report is made of, already separated at the byte level. */
export interface SplitJournalMime {
	/** Headers + body of the `text/plain` report part -- fed to `mailparser` as its own message. */
	readonly reportPart: Buffer;
	/** The `message/rfc822` part's body only (its own container headers stripped): the raw inner message, byte for byte. */
	readonly innerMessage: Buffer;
}

/**
 * The same search `splitJournalReportMime()` does, but reporting what it found even when the shape
 * doesn't fully match RFC section 6.1 -- `JR-5-03`'s "kein Innenteil (fehlerhaft)" case needs to
 * know that the *report* part was found (so the envelope can still be parsed and surfaced) even
 * though the *inner* message/rfc822 part was not, which `splitJournalReportMime()`'s all-or-nothing
 * `null` cannot distinguish from "not multipart/mixed at all".
 */
export interface LocatedJournalParts {
	readonly outerIsMultipartMixed: boolean;
	/** `text/plain` report part (headers + body together), or `null` if none was found. */
	readonly reportPart: Buffer | null;
	/** `message/rfc822` part's body only, or `null` if none was found. */
	readonly innerMessage: Buffer | null;
}

function locateJournalPartsInternal(raw: Buffer): LocatedJournalParts {
	const outer = splitHeaderAndBody(raw);
	const outerContentType = parseContentType(outer.headers.get('content-type'));
	if (outerContentType.type !== 'multipart/mixed') {
		return { outerIsMultipartMixed: false, reportPart: null, innerMessage: null };
	}
	const boundary = outerContentType.params['boundary'];
	if (!boundary) {
		return { outerIsMultipartMixed: true, reportPart: null, innerMessage: null };
	}

	const rawParts = splitMultipartBody(outer.body, boundary);

	let reportPart: Buffer | null = null;
	let innerMessage: Buffer | null = null;

	for (const rawPart of rawParts) {
		const part = splitHeaderAndBody(rawPart);
		const partContentType = parseContentType(part.headers.get('content-type'));
		if (reportPart === null && partContentType.type === 'text/plain') {
			reportPart = rawPart;
			continue;
		}
		if (innerMessage === null && partContentType.type === 'message/rfc822') {
			innerMessage = part.body;
			continue;
		}
	}

	return { outerIsMultipartMixed: true, reportPart, innerMessage };
}

/**
 * Locates the report and inner-message parts of an outer message, reporting each independently
 * instead of collapsing every shape mismatch into `null` the way {@link splitJournalReportMime} does.
 * Used by `journal-report.ts` to distinguish "not a journal report at all" from "report part present,
 * inner message missing" (`JR-5-03`). Never throws for a shape mismatch, for the same reason
 * {@link splitJournalReportMime} does not -- it can still throw on a genuinely unexpected internal
 * error, which the caller catches.
 */
export function locateJournalParts(raw: Buffer): LocatedJournalParts {
	return locateJournalPartsInternal(raw);
}

/**
 * Splits the outer message into its report (`text/plain`) and inner (`message/rfc822`) parts.
 * Returns `null` for any shape that does not match RFC section 6.1 -- not multipart/mixed, no
 * boundary parameter, or either expected child part missing. The caller (`journal-report.ts`) turns
 * `null` into a `parse_failed` result; this function itself never throws for a shape mismatch (it
 * can still throw on a genuinely unexpected internal error, which the caller also catches).
 *
 * A thin wrapper over {@link locateJournalParts} kept for its existing all-or-nothing callers and
 * tests -- `journal-report.ts` calls `locateJournalParts()` directly where the distinction matters.
 */
export function splitJournalReportMime(raw: Buffer): SplitJournalMime | null {
	const located = locateJournalPartsInternal(raw);
	if (located.reportPart === null || located.innerMessage === null) {
		return null;
	}
	return { reportPart: located.reportPart, innerMessage: located.innerMessage };
}

/**
 * `Content-Type` values (RFC 8551) whose body is S/MIME-wrapped and therefore not readable
 * plaintext without unwrapping the PKCS#7 structure first -- both the "enveloped-data" (encrypted)
 * and "signed-data" (opaque-signed) `smime-type`s land here, since both leave the body unreadable
 * without extra work this parser does not do. `multipart/signed` (clear-signing) is deliberately
 * **not** included: its body is ordinary readable MIME with a detached signature alongside it, not
 * wrapped inside anything (`JR-5-03`).
 */
const SMIME_WRAPPED_CONTENT_TYPES = new Set(['application/pkcs7-mime', 'application/x-pkcs7-mime']);

/**
 * `JR-5-03`: true when a MIME part's `Content-Type` marks its body as S/MIME-wrapped (see
 * {@link SMIME_WRAPPED_CONTENT_TYPES}'s doc comment for exactly which forms and why).
 */
export function isSmimeWrappedContentType(contentType: ParsedContentType): boolean {
	return SMIME_WRAPPED_CONTENT_TYPES.has(contentType.type);
}

/**
 * Reads only the top-level `Content-Type` header of `raw` (expected to be a full RFC 5322 message)
 * to decide whether its body is S/MIME-wrapped. Never decodes, transforms, or even looks at the
 * body itself -- header-only, so it is safe to call on a body that turns out to be ciphertext.
 */
export function isSmimeWrappedMessage(raw: Buffer): boolean {
	const { headers } = splitHeaderAndBody(raw);
	return isSmimeWrappedContentType(parseContentType(headers.get('content-type')));
}
