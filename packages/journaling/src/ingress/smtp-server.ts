import * as net from 'node:net';
import type { SmtpServerConfig } from './smtp-config';

/**
 * The ESMTP protocol engine (`JR-4-02`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is hand-rolled on `node:net` instead of a third-party SMTP server library
 * ---------------------------------------------------------------------------------------------
 * This is the library-choice slice for the whole product, and the choice is: **no library**. Every
 * Node SMTP *server* package findable on the npm registry at the time of writing fails the binding
 * criterion first, before any of the others matter:
 *
 *   - `smtp-server` (nodemailer, MIT-0, the most maintained candidate, v3.19.2 as measured) --
 *     inspected the shipped source directly (`smtp-connection.js`): its own comment reads "Note:
 *     BINARYMIME is not supported as it requires BDAT command (RFC 3030)". It does not implement
 *     `CHUNKING`/`BDAT` at all. `JR-4-03` needs it and the project README calls it non-optional for
 *     Exchange Online -- this alone disqualifies the package regardless of how well it does
 *     everything else.
 *   - `simplesmtp` -- unmaintained since 2015, same inspection method, no `BDAT`/`CHUNKING`
 *     reference anywhere in its source. Abandoned besides.
 *   - `haraka` (MIT) -- inspected its packed source: no `BDAT`/`CHUNKING` reference either, **and**
 *     it ships a full `outbound/` module (queueing, relaying, bounce generation) because Haraka is
 *     designed to *be* an MTA, not to receive-and-stop. That fails the second binding criterion
 *     (`JR-4-07`, skill section 10: no outbound mail path in this package) even if BDAT had been
 *     present.
 *
 * With every candidate eliminated on the one criterion that cannot be worked around later, the
 * remaining options were "wait for a library that does not exist" or "implement the protocol
 * against `node:net`/`node:tls` directly". The second is what this file does. It also resolves the
 * "package vs. app" dependency question the Product Owner asked to be decided deliberately: since
 * `node:net` is a Node builtin rather than an npm dependency, this lives in `packages/journaling`
 * without adding anything to its dependency list at all (still only `@open-archiver/types` and
 * `zod`, unchanged since `JR-2-01`) -- there was no library to place in the package or the app,
 * because there was no usable library.
 *
 * ---------------------------------------------------------------------------------------------
 * Scope of this task
 * ---------------------------------------------------------------------------------------------
 * `EHLO`/`HELO`, `MAIL`/`RCPT`/`DATA` far enough to reach and terminate a `DATA` transfer,
 * `PIPELINING`/`8BITMIME`/`SMTPUTF8`/`SIZE` (RFC 1870's `MAIL FROM ... SIZE=` parameter included),
 * and the three timeouts. Deliberately **not** here: TLS/`STARTTLS` (`JR-4-04`), source/recipient
 * ACLs (`JR-4-05`), and wiring `JournalAcceptance.accept()` (`JR-4-06`). End-of-`DATA` always
 * answers `451 4.3.0` until that wiring lands -- see {@link SmtpConnection.finishData}'s doc
 * comment for why that is not a shortcut but the Product Owner's explicit instruction for this
 * slice.
 *
 * ---------------------------------------------------------------------------------------------
 * `CHUNKING`/`BDAT` (`JR-4-03`)
 * ---------------------------------------------------------------------------------------------
 * `JR-4-02` deliberately left `CHUNKING`/`BDAT` out and did not advertise it, precisely so a
 * client talking to that task's server never attempted an extension it could not honour. This
 * task implements it and the `EHLO` line above now names it -- see {@link BdatContentTracker} and
 * {@link SmtpConnection.handleBdatCommand}/{@link SmtpConnection.handleBdatChunkBytes} for the
 * chunk-transfer state machine, and {@link SmtpConnection.completeTransfer} for why `DATA`'s
 * terminator and `BDAT ... LAST` share one completion path. RFC 3030 section 2 is unambiguous that
 * `DATA` and `BDAT` cannot be mixed within one transaction ("If a DATA statement is issued after a
 * BDAT for the current transaction, a 503 ... MUST be issued") -- {@link SmtpConnection.handleDataCommand}'s
 * existing "must be in `rcpt` state" check already produces that `503` once a `BDAT` has moved the
 * state to `'bdat'`, with no separate case needed; RSET clears chunking state the same way it
 * already clears the envelope.
 *
 * ---------------------------------------------------------------------------------------------
 * `DATA` no longer desyncs the connection on a `SIZE` overflow (`JR-4-16`, finding F44)
 * ---------------------------------------------------------------------------------------------
 * Before this fix, {@link DataScanner} answered a `SIZE` overflow by setting its internal `finished`
 * flag mid-stream, without ever reading as far as the `<CRLF>.<CRLF>` terminator. The connection
 * answered `552` and moved back to command state immediately -- but the sender has no way to know
 * that happened and keeps transmitting the rest of the message body, which then arrived at
 * {@link SmtpConnection.processCommandLine} and was interpreted as SMTP commands. `BDAT`
 * ({@link SmtpConnection.handleBdatChunkBytes}) never had this problem, because it always counts
 * down the declared chunk length in full before reacting to anything. `DATA` has no declared
 * length to count down, so the fix instead keeps scanning and discarding body bytes -- across
 * as many further `push()` calls as it takes -- until the real terminator is found, and only then
 * calls back into {@link SmtpConnection.finishData}/{@link SmtpConnection.completeTransfer}. See
 * {@link DataScanner}'s own doc comment for the two distinct places oversize can be detected and how
 * each one hands off into that discard scan, and {@link DataScanner.scanDiscard} for why the scan's
 * own retained state stays O(1) regardless of how much more the sender transmits before either the
 * terminator arrives or {@link SmtpConnection.armDataTimer}'s existing per-chunk timer resets --
 * unchanged, and still the only bound on a sender that never sends a terminator at all.
 */

/** Injected structured-logging port -- see this module's "Where `logLevel` actually gets used"
 * section below. Deliberately shaped like `pino`'s call signature (`logger.error({ ... }, 'msg')`,
 * CLAUDE.md section 5.7's convention) so a real `pino` instance satisfies this interface without an
 * adapter, and a test can hand in a tiny recording fake without pulling in the dependency. */
export interface IngressLogger {
	debug(fields: Record<string, unknown>, message: string): void;
	info(fields: Record<string, unknown>, message: string): void;
	warn(fields: Record<string, unknown>, message: string): void;
	error(fields: Record<string, unknown>, message: string): void;
}

/** Discards everything. The default when a caller does not care -- explicit and visible at the call
 * site, the same pattern `JournalAcceptanceOptions.alertSink` established (`spool/acceptance.ts`). */
export const noopIngressLogger: IngressLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/*
 * ---------------------------------------------------------------------------------------------
 * Where `logLevel` (`JR-4-01`) actually gets used
 * ---------------------------------------------------------------------------------------------
 * `IngressConfig.logLevel` had no reader anywhere in the codebase before this task -- a
 * configuration field that changes nothing is a promise to the operator with nothing behind it
 * (the same shape of problem as an alert sink that silently discards, `spool/acceptance.ts`'s own
 * reasoning). This task is where every structured logging call this server needs (connection
 * events, timeout firings, oversize rejections) comes into existence, so it is also where the field
 * gets a reader: `apps/smtp-ingress/src/index.ts` constructs a real `pino` instance with
 * `level: config.logLevel` and passes it in as {@link EsmtpServerOptions.logger}. `packages/journaling`
 * still never reads `logLevel` or constructs a logger itself -- consistent with "configuration and
 * loggers are injected, never imported" -- it only declares the port `apps/smtp-ingress` must satisfy.
 */

const CRLF = Buffer.from('\r\n');
const DOT = 0x2e;
const CR_BYTE = 0x0d;
const LF_BYTE = 0x0a;

/** RFC 5321 section 4.5.3.1.4: 512 octets including the trailing CRLF for a command line. Enforced
 * a little loosely here (against the line body only) -- a client that needs the extra slack is not
 * the case this guards against; an unbounded command line with no CRLF ever is. */
const MAX_COMMAND_LINE_BYTES = 512;

/** Enhanced status code used for all three timeouts (see the module doc comment's rationale in
 * `smtp-config.ts` is about the *durations*; this is about the *code*): the same
 * `421 4.4.2 ... Error: timeout exceeded` wording Postfix uses for the same condition, chosen
 * because it is the de facto standard a sending MTA already knows how to interpret as "transient,
 * retry" -- never `5xx` (skill section 1, "why 4xx and never 5xx for local failures"). */
const TIMEOUT_ENHANCED_CODE = '4.4.2';

/**
 * Build the `EHLO` extension lines: `PIPELINING`, `8BITMIME`, `SMTPUTF8`, `SIZE <configured
 * value>`, and -- since `JR-4-03` -- `CHUNKING`. Still deliberately excludes `STARTTLS`
 * (`JR-4-04`): advertising an extension this server cannot yet honour would be a protocol lie a
 * real client (Exchange Online) could act on, exactly the reasoning `CHUNKING` was withheld under
 * before this task implemented it.
 *
 * Pure and socket-free on purpose: the wire-level proof that a real client sees exactly these lines
 * lives in `packages/journaling/tests/unit/smtp-server-protocol.test.ts` (a real client is required
 * by the Product Owner's instruction -- an options-object assertion would only prove this function
 * was called correctly, not that a client sees it), while this function's own line-construction
 * logic -- including the boundary between the greeting line and the extension lines -- is covered
 * directly, without a socket, in `smtp-server.test.ts`.
 */
export function buildEhloResponseLines(
	hostname: string,
	sizeLimitBytes: number
): readonly string[] {
	return [
		`${hostname} greets you`,
		'PIPELINING',
		'8BITMIME',
		'SMTPUTF8',
		`SIZE ${sizeLimitBytes}`,
		'CHUNKING',
	];
}

/** Format a multiline SMTP reply: `<code>-` on every line but the last, `<code> ` (space) on the
 * last -- RFC 5321 section 4.2.1. No enhanced status code on any line: real `EHLO` extension lines
 * never carry one. */
export function formatMultilineResponse(code: number, lines: readonly string[]): string {
	if (lines.length === 0) {
		throw new Error('formatMultilineResponse requires at least one line');
	}
	return lines
		.map((line, i) => `${code}${i === lines.length - 1 ? ' ' : '-'}${line}\r\n`)
		.join('');
}

/** Parsed `MAIL FROM:<addr> [SIZE=n] [...]`. `sizeParam` is `null` when the client did not declare
 * one -- RFC 1870 makes the parameter optional; a client that omits it is not in violation. */
export interface ParsedMailFrom {
	readonly address: string;
	readonly sizeParam: number | null;
}

const MAIL_FROM_PATTERN = /^FROM:\s*<([^>]*)>\s*(.*)$/i;
const RCPT_TO_PATTERN = /^TO:\s*<([^>]*)>\s*(.*)$/i;
const SIZE_PARAM_PATTERN = /^SIZE=(\d+)$/i;

/** Parse the argument text following the `MAIL` verb (i.e. everything after `MAIL `). Returns
 * `null` on a syntax error -- the caller maps that to `501 5.5.4`. */
export function parseMailFromArguments(rest: string): ParsedMailFrom | null {
	const match = MAIL_FROM_PATTERN.exec(rest.trim());
	if (!match) {
		return null;
	}
	const [, address, params] = match;
	let sizeParam: number | null = null;
	for (const token of params!.split(/\s+/).filter((t) => t.length > 0)) {
		const sizeMatch = SIZE_PARAM_PATTERN.exec(token);
		if (sizeMatch) {
			sizeParam = Number(sizeMatch[1]);
		}
	}
	return { address: address!, sizeParam };
}

/** Parse the argument text following the `RCPT` verb. `null` on a syntax error (`501 5.5.4`). */
export function parseRcptToArguments(rest: string): { address: string } | null {
	const match = RCPT_TO_PATTERN.exec(rest.trim());
	if (!match) {
		return null;
	}
	return { address: match[1]! };
}

/** Parsed `BDAT <chunk-size> [LAST]` (RFC 3030 section 2). */
export interface ParsedBdat {
	readonly chunkSize: number;
	readonly last: boolean;
}

const BDAT_ARGS_PATTERN = /^\s*(\S+)(?:\s+(\S+))?\s*$/;

/**
 * Parse the argument text following the `BDAT` verb: `<chunk-size> [LAST]`. RFC 3030 section 2's
 * ABNF is `bdat-cmd ::= "BDAT" SP chunk-size [ SP end-marker ] CR LF`, `chunk-size ::= 1*DIGIT`,
 * `end-marker ::= "LAST"`.
 *
 * Returns `null` on any syntax error -- the caller maps that to `501 5.5.4`, matching every other
 * malformed-argument case in this file:
 *
 *   - a missing chunk-size (`BDAT` with no argument at all);
 *   - a non-numeric one -- a leading `-` is not a digit, so a negative chunk-size is really the
 *     same case, not a separate one;
 *   - one that parses but cannot be represented exactly as a JS number (`Number.isSafeInteger`);
 *   - a second token that is not literally `LAST` (case-insensitively).
 */
export function parseBdatArguments(rest: string): ParsedBdat | null {
	const match = BDAT_ARGS_PATTERN.exec(rest);
	if (!match) {
		return null;
	}
	const [, sizeToken, lastToken] = match;
	if (!/^\d+$/.test(sizeToken!)) {
		return null;
	}
	const chunkSize = Number(sizeToken);
	if (!Number.isSafeInteger(chunkSize)) {
		return null;
	}
	if (lastToken !== undefined && lastToken.toUpperCase() !== 'LAST') {
		return null;
	}
	return { chunkSize, last: lastToken !== undefined };
}

/**
 * Scans `DATA`-phase bytes for the end-of-data terminator (a line consisting of a single `.`) and
 * performs dot-unstuffing (RFC 5321 section 4.5.2) as it goes -- the only transformation the
 * project's hard prohibitions allow (skill section 10). Content bytes are counted, never retained
 * beyond the current chunk: this task does not yet wire `JournalAcceptance.accept()` (`JR-4-06`),
 * so there is nothing to hand the unstuffed bytes to, but the 150 MB `SIZE` default makes
 * "do not accumulate the whole message in this process's heap" a live constraint even for a
 * message this task only counts and discards -- `spool/durable-write.ts` established that rule for
 * the storage path; this scanner keeps the ingress side to the same rule so `JR-4-06` only has to
 * change *what* receives each unstuffed chunk, not *how* the bytes are read off the wire.
 *
 * Deliberately not the byte-perfect, chunk-boundary-in-the-middle-of-a-terminator rigor `JR-4-03`
 * and `JR-4-11` require of the `BDAT` path -- this scanner handles the ordinary cases (a terminator
 * split across TCP packets) correctly by concatenating into `carry` before searching, but the
 * exhaustive adversarial matrix over chunk boundaries is that task's acceptance criterion, not this
 * one's. `BDAT`'s equivalent is {@link BdatContentTracker}, which needs none of this scanner's line
 * search or dot-unstuffing at all -- see that class's own doc comment for why a chunk boundary mid
 * line, or even mid-CRLF, cannot go wrong there by construction.
 *
 * `onContent`, added in `JR-4-03`, is the hook this doc comment already promised: called with each
 * unstuffed content line (plus its CRLF) as it is produced, never retained here past the call. A
 * no-op by default -- production has nothing to hand it to until `JR-4-06` -- it exists so a test
 * can reconstruct exactly what a `DATA` transfer delivered without buffering the whole message in
 * this class, the same way {@link BdatContentTracker}'s `onContent` does for `BDAT`. This is what
 * makes the two paths' output comparable byte-for-byte in `smtp-server.test.ts`.
 *
 * ---------------------------------------------------------------------------------------------
 * Oversize handling (`JR-4-16`, finding F44)
 * ---------------------------------------------------------------------------------------------
 * There are two distinct places this class can notice the `SIZE` limit was exceeded, and both used
 * to set `finished = true` immediately, mid-stream:
 *
 *   1. {@link scan}'s own line-by-line byte count, the ordinary case -- a complete, CRLF-terminated
 *      content line pushes the running total over `limitBytes`.
 *   2. `push()`'s guard against a pathological "line" that never contains a CRLF at all, which
 *      would otherwise grow `carry` without bound.
 *
 * Neither point is actually the end of the `DATA` transfer on the wire: the sender does not know
 * the limit was hit and keeps sending the rest of the message body. Stopping there left whatever
 * came next to be read as SMTP command lines by {@link SmtpConnection.processCommandLine} -- F44.
 * Both points now hand off into {@link scanDiscard} instead, which keeps consuming and discarding
 * body bytes (across as many further `push()` calls as it takes) until it finds the real
 * `<CRLF>.<CRLF>` terminator, exactly mirroring the discipline {@link BdatContentTracker} already
 * had by construction (drain the declared length in full before reacting). Only once the
 * terminator is found does `push()` report `done: true`; `oversize` is set the moment either abort
 * point fires and stays `true` from then on, so a caller can tell "rejected" from "still waiting"
 * without needing a third flag.
 *
 * `scanDiscard` deliberately does **not** buffer the discarded bytes anywhere: it is a tiny
 * automaton (`discardSawCr`/`discardLineDisqualified`/`discardLineLength`/`discardFirstByte`) that
 * only needs to know, at each CRLF, whether the line that just ended was exactly a lone `.` --
 * which needs at most the first two bytes of that line, not the whole thing. Retained state is
 * therefore a handful of scalars, never proportional to how much more a sender transmits before
 * the terminator arrives (or never arrives at all, in which case
 * {@link SmtpConnection.armDataTimer}'s existing per-chunk data timeout is what eventually ends the
 * connection -- unchanged, since {@link SmtpConnection.handleDataChunk} still re-arms it on every
 * chunk regardless of which scanning mode is active).
 */
export class DataScanner {
	private carry: Buffer = Buffer.alloc(0);
	private bytesSeen = 0;
	private finished = false;
	private oversize = false;
	/** `true` from the moment either abort point above fires until the real terminator is found --
	 * see this class's doc comment. While `true`, `push()` routes incoming bytes to
	 * {@link scanDiscard} instead of {@link scan}. */
	private discarding = false;
	/** Whether the previous byte examined while discarding was a bare `CR` not yet resolved into a
	 * `CRLF` -- the discard scan's equivalent of {@link scan}'s `carry`, needed only to let a
	 * terminator split exactly between `\r` and `\n` across two `push()` calls still be found. */
	private discardSawCr = false;
	/** `true` once the line currently being discarded is already known not to be a lone `.` --
	 * either because it started that way (the pathological-line abort point always does) or because
	 * a second byte has arrived since its last CRLF. Reset at the start of each new line. */
	private discardLineDisqualified = false;
	/** Bytes seen so far in the line currently being discarded, saturating at the one value that
	 * matters (`1`) -- a second byte immediately disqualifies the line, so nothing past that is ever
	 * counted or stored. */
	private discardLineLength = 0;
	/** The current discard line's first byte, meaningful only while `discardLineLength === 1`. */
	private discardFirstByte = 0;

	constructor(
		private readonly limitBytes: number,
		private readonly onContent?: (chunk: Buffer) => void
	) {}

	/** Feed the next raw chunk. Returns the scanner's status after processing as much of it as
	 * forms complete lines; a chunk arriving once `done` is reported is ignored. Note that `oversize`
	 * can be `true` while `done` is still `false` -- the transfer is rejected but the connection must
	 * keep reading (and discarding) until the terminator is found; see the class doc comment. */
	push(chunk: Buffer): { readonly done: boolean; readonly oversize: boolean } {
		if (this.finished) {
			return { done: true, oversize: this.oversize };
		}
		if (this.discarding) {
			this.scanDiscard(chunk);
			return { done: this.finished, oversize: this.oversize };
		}
		this.carry = Buffer.concat([this.carry, chunk]);
		this.scan();
		if (!this.finished && !this.discarding && this.carry.length > this.limitBytes) {
			// The pathological-line abort point (no CRLF anywhere in `carry` yet). Hand the whole
			// run of undecided bytes to the discard scanner rather than dropping it -- it may
			// already contain the terminator (or bytes that end the current garbage line), and
			// `scanDiscard`'s own retained state is O(1) regardless of how much that turns out to be.
			const remainder = this.carry;
			this.carry = Buffer.alloc(0);
			this.enterDiscardMode(remainder, true);
		}
		return { done: this.finished, oversize: this.oversize };
	}

	/** Total content bytes seen so far (post-dot-unstuffing, including each line's terminating
	 * CRLF, excluding the terminator line itself). Stops growing once oversize is detected -- bytes
	 * discarded afterward were never counted, by design. */
	get contentByteLength(): number {
		return this.bytesSeen;
	}

	private scan(): void {
		for (;;) {
			const idx = this.carry.indexOf(CRLF);
			if (idx === -1) {
				return;
			}
			const line = this.carry.subarray(0, idx);
			this.carry = this.carry.subarray(idx + 2);
			if (line.length === 1 && line[0] === DOT) {
				this.finished = true;
				return;
			}
			const contentLine = line.length > 0 && line[0] === DOT ? line.subarray(1) : line;
			this.bytesSeen += contentLine.length + 2;
			if (this.onContent) {
				this.onContent(Buffer.concat([contentLine, CRLF]));
			}
			if (this.bytesSeen > this.limitBytes) {
				// The line-count abort point. Unlike the pathological-line case above, this is
				// always at a clean line boundary -- the CRLF that ended the just-processed line has
				// already been consumed out of `carry`, so whatever remains starts a fresh line and
				// needs no "already disqualified" flag.
				const remainder = this.carry;
				this.carry = Buffer.alloc(0);
				this.enterDiscardMode(remainder, false);
				return;
			}
		}
	}

	private enterDiscardMode(initial: Buffer, startDisqualified: boolean): void {
		this.oversize = true;
		this.discarding = true;
		this.discardSawCr = false;
		this.discardLineDisqualified = startDisqualified;
		this.discardLineLength = 0;
		this.discardFirstByte = 0;
		this.scanDiscard(initial);
	}

	/** Consume raw bytes while oversize, looking only for the end-of-DATA terminator (a line whose
	 * entire content is a single `.`) -- see the class doc comment for why this never buffers what
	 * it discards. */
	private scanDiscard(chunk: Buffer): void {
		for (const byte of chunk) {
			if (this.finished) {
				return;
			}
			if (byte === CR_BYTE) {
				if (this.discardSawCr) {
					// The previous CR was not part of a CRLF after all -- it was itself an ordinary
					// content byte of the line still being discarded.
					this.recordDiscardByte(CR_BYTE);
				}
				this.discardSawCr = true;
				continue;
			}
			if (this.discardSawCr) {
				this.discardSawCr = false;
				if (byte === LF_BYTE) {
					if (
						!this.discardLineDisqualified &&
						this.discardLineLength === 1 &&
						this.discardFirstByte === DOT
					) {
						this.finished = true;
						return;
					}
					this.discardLineDisqualified = false;
					this.discardLineLength = 0;
					continue;
				}
				// A bare CR not followed by LF: record it as an ordinary content byte of the current
				// line before falling through to record `byte` itself.
				this.recordDiscardByte(CR_BYTE);
			}
			this.recordDiscardByte(byte);
		}
	}

	private recordDiscardByte(byte: number): void {
		if (this.discardLineDisqualified) {
			return;
		}
		this.discardLineLength += 1;
		if (this.discardLineLength === 1) {
			this.discardFirstByte = byte;
		} else {
			this.discardLineDisqualified = true;
		}
	}
}

/**
 * Accumulates the raw byte stream of one `BDAT` transaction across all of its chunks (`JR-4-03`).
 * Unlike {@link DataScanner}, this performs **no line-oriented interpretation and no
 * dot-unstuffing** -- RFC 3030 section 2 transfers a declared-length octet stream verbatim, and the
 * only transformation the project's hard prohibitions allow at all (skill section 10, "no
 * rewriting, normalizing, re-encoding, or 'cleaning' received bytes") is `DATA`'s dot-unstuffing,
 * which simply does not apply to a counted byte stream. A chunk boundary that happens to fall in
 * the middle of a line -- or even between the `\r` and `\n` of a CRLF, the hardest case this task's
 * acceptance criterion names -- changes nothing about the bytes this class produces: there is no
 * line boundary to find or get wrong, by construction, because nothing here ever looks for one.
 *
 * `onContent` is a no-op by default (production has nothing to hand raw content to until `JR-4-06`
 * wires `JournalAcceptance.accept()`) and exists purely so a test can reconstruct exactly what a
 * transaction delivered without this class ever buffering the whole message itself -- each pushed
 * slice is forwarded verbatim and forgotten immediately afterward, which is also why the SIZE
 * accounting below stays proportional to the configured limit rather than to message size.
 */
export class BdatContentTracker {
	private totalBytes = 0;
	private oversizeFlag = false;

	constructor(
		private readonly limitBytes: number,
		private readonly onContent?: (chunk: Buffer) => void
	) {}

	/**
	 * Feed raw content bytes belonging to the transaction's current `BDAT` chunk -- the caller has
	 * already carved off exactly the declared chunk-size worth of bytes and any bytes belonging to
	 * the next command are not included. Forwarded to `onContent` verbatim, in wire order, and
	 * counted toward the *whole transaction's* cumulative `SIZE` check -- across every chunk seen
	 * so far, not just this one, since RFC 3030 has no per-chunk size limit, only a message one.
	 */
	push(chunk: Buffer): { readonly oversize: boolean } {
		if (chunk.length > 0) {
			this.totalBytes += chunk.length;
			if (this.onContent) {
				this.onContent(chunk);
			}
			if (this.totalBytes > this.limitBytes) {
				this.oversizeFlag = true;
			}
		}
		return { oversize: this.oversizeFlag };
	}

	/** Total raw content bytes accumulated across every chunk pushed so far. */
	get contentByteLength(): number {
		return this.totalBytes;
	}
}

type SessionState = 'initial' | 'ready' | 'mail' | 'rcpt' | 'bdat' | 'data';
type TimeoutKind = 'connection' | 'command' | 'data';

/** One accepted TCP connection's protocol state machine. Not exported -- `EsmtpServer` is the
 * public surface; a connection only exists for as long as the socket does. */
class SmtpConnection {
	private state: SessionState = 'initial';
	private ehloName: string | null = null;
	private mailFrom: string | null = null;
	private rcptTo: string[] = [];
	private dataScanner: DataScanner | null = null;
	/** Non-`null` for the whole `BDAT` transaction (created on the first `BDAT`, cleared by
	 * {@link resetEnvelope}), not just the chunk currently being read -- RFC 3030 has one
	 * cumulative `SIZE` check per message, not one per chunk. */
	private bdatTracker: BdatContentTracker | null = null;
	/** Bytes still owed for the `BDAT` chunk currently being read off the wire. `null` means "not
	 * currently consuming raw `BDAT` content" -- {@link onData}/{@link drainCommandCarry} use that
	 * to decide whether incoming bytes are chunk content or the next command line, the same role
	 * `state === 'data'` plays for the `DATA` path. */
	private bdatChunkRemaining: number | null = null;
	/** Whether the chunk currently being read (or just finished) carried `BDAT`'s `LAST` marker. */
	private bdatChunkIsLast = false;
	private commandCarry: Buffer = Buffer.alloc(0);
	private protocolTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly socket: net.Socket,
		private readonly smtp: SmtpServerConfig,
		private readonly logger: IngressLogger
	) {
		// Connection-level backstop, independent of protocol state: Node re-arms this internally on
		// any read *or* write activity on the socket, so it fires only on genuine idleness --
		// deliberately given no manual reset code here, unlike the command/data timers below, which
		// are this project's own timers over and above Node's.
		this.socket.setTimeout(this.smtp.connectionTimeoutMs, () => this.onTimeout('connection'));

		this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
		this.socket.on('close', () => this.disarmProtocolTimer());
		this.socket.on('error', (err) => {
			this.logger.warn(
				{ err, remoteAddress: this.socket.remoteAddress },
				'smtp-ingress: socket error'
			);
		});

		this.writePlain(220, `${this.smtp.hostname} ESMTP ready`);
		this.armCommandTimer();
	}

	private onData(chunk: Buffer): void {
		if (this.state === 'data') {
			this.handleDataChunk(chunk);
			return;
		}
		if (this.bdatChunkRemaining !== null) {
			this.handleBdatChunkBytes(chunk);
			return;
		}
		this.commandCarry = Buffer.concat([this.commandCarry, chunk]);
		this.drainCommandCarry();
	}

	/**
	 * The command-line parsing loop, extracted out of {@link onData} in `JR-4-03` so it can be
	 * re-entered from {@link handleBdatChunkBytes} once a `BDAT` chunk finishes and leaves a
	 * remainder behind -- the same "bytes after the boundary belong to whatever comes next" shape
	 * {@link onData} already handled for a pipelined `DATA` command, generalised to a second
	 * direction (chunk bytes -> command line, not just command line -> chunk bytes).
	 */
	private drainCommandCarry(): void {
		for (;;) {
			if (this.socket.destroyed) {
				return;
			}
			const idx = this.commandCarry.indexOf(CRLF);
			if (idx === -1) {
				if (this.commandCarry.length > MAX_COMMAND_LINE_BYTES) {
					this.writeResponse(500, '5.5.1', 'Line too long');
					this.socket.end();
				}
				return;
			}
			const lineBuf = this.commandCarry.subarray(0, idx);
			this.commandCarry = this.commandCarry.subarray(idx + 2);
			this.processCommandLine(lineBuf.toString('utf8'));
			if (this.socket.destroyed) {
				return;
			}
			// Checked through a separate method rather than `this.state === 'data'` inline:
			// TypeScript's control-flow narrowing from the early-return check at the top of *this*
			// method otherwise keeps treating `this.state` as excluding 'data' for the rest of the
			// function, even after a call (`processCommandLine` -> `handleDataCommand`) that reassigns
			// it -- `enteredDataState()`'s own, unrelated flow has no such narrowing to fight.
			if (this.enteredDataState()) {
				// A pipelined DATA command plus its content arrived in the same packet (Exchange Online
				// and other real senders do this -- proving it works is part of this task's PIPELINING
				// criterion). Whatever remains in commandCarry is message content, not further commands.
				const remainder = this.commandCarry;
				this.commandCarry = Buffer.alloc(0);
				if (remainder.length > 0) {
					this.handleDataChunk(remainder);
				}
				return;
			}
			if (this.bdatChunkRemaining !== null) {
				// Same idea, for a pipelined `BDAT <n>` command plus (some or all of) its raw content
				// arriving in the same packet.
				const remainder = this.commandCarry;
				this.commandCarry = Buffer.alloc(0);
				if (remainder.length > 0) {
					this.handleBdatChunkBytes(remainder);
				}
				return;
			}
		}
	}

	/** Plain boolean wrapper around `this.state === 'data'` -- see the call site's comment in
	 * {@link onData} for why this needs its own method rather than an inline comparison there. */
	private enteredDataState(): boolean {
		return this.state === 'data';
	}

	private processCommandLine(line: string): void {
		const spaceIdx = line.indexOf(' ');
		const verb = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toUpperCase();
		const rest = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1);

		switch (verb) {
			case 'EHLO':
				this.ehloName = rest.trim() || null;
				this.resetEnvelope();
				this.state = 'ready';
				this.socket.write(
					formatMultilineResponse(
						250,
						buildEhloResponseLines(this.smtp.hostname, this.smtp.sizeLimitBytes)
					)
				);
				this.armCommandTimer();
				return;
			case 'HELO':
				this.ehloName = rest.trim() || null;
				this.resetEnvelope();
				this.state = 'ready';
				this.writePlain(250, `${this.smtp.hostname} Hello`);
				this.armCommandTimer();
				return;
			case 'NOOP':
				this.writeResponse(250, '2.0.0', 'Ok');
				this.armCommandTimer();
				return;
			case 'RSET':
				this.resetEnvelope();
				this.state = this.ehloName ? 'ready' : 'initial';
				this.writeResponse(250, '2.0.0', 'Ok');
				this.armCommandTimer();
				return;
			case 'QUIT':
				this.writeResponse(221, '2.0.0', 'Bye');
				this.disarmProtocolTimer();
				this.socket.end();
				return;
			case 'MAIL':
				this.handleMail(rest);
				return;
			case 'RCPT':
				this.handleRcpt(rest);
				return;
			case 'DATA':
				this.handleDataCommand();
				return;
			case 'BDAT':
				this.handleBdatCommand(rest);
				return;
			default:
				this.writeResponse(500, '5.5.1', 'Command not recognized');
				this.armCommandTimer();
				return;
		}
	}

	private handleMail(rest: string): void {
		if (this.state !== 'ready') {
			this.writeResponse(503, '5.5.1', 'Bad sequence of commands');
			this.armCommandTimer();
			return;
		}
		const parsed = parseMailFromArguments(rest);
		if (!parsed) {
			this.writeResponse(501, '5.5.4', 'Syntax error in MAIL FROM command');
			this.armCommandTimer();
			return;
		}
		if (parsed.sizeParam !== null && parsed.sizeParam > this.smtp.sizeLimitBytes) {
			// RFC 1870: a declared SIZE over the advertised limit is rejected immediately, before any
			// DATA is transferred. Logged loudly per the skill's instruction for the SIZE condition --
			// a silent oversize rejection is exactly the data-loss vector the skill calls out.
			this.logger.warn(
				{
					remoteAddress: this.socket.remoteAddress,
					declaredSize: parsed.sizeParam,
					sizeLimitBytes: this.smtp.sizeLimitBytes,
				},
				'smtp-ingress: rejecting MAIL FROM, declared SIZE exceeds configured limit'
			);
			this.writeResponse(552, '5.3.4', 'Message size exceeds fixed maximum message size');
			this.armCommandTimer();
			return;
		}
		this.mailFrom = parsed.address;
		this.state = 'mail';
		this.writeResponse(250, '2.1.0', 'Ok');
		this.armCommandTimer();
	}

	private handleRcpt(rest: string): void {
		if (this.state !== 'mail' && this.state !== 'rcpt') {
			this.writeResponse(503, '5.5.1', 'Bad sequence of commands');
			this.armCommandTimer();
			return;
		}
		const parsed = parseRcptToArguments(rest);
		if (!parsed) {
			this.writeResponse(501, '5.5.4', 'Syntax error in RCPT TO command');
			this.armCommandTimer();
			return;
		}
		// No recipient ACL here -- JR-4-05. Every syntactically valid recipient is accepted for now.
		this.rcptTo.push(parsed.address);
		this.state = 'rcpt';
		this.writeResponse(250, '2.1.5', 'Ok');
		this.armCommandTimer();
	}

	private handleDataCommand(): void {
		if (this.state !== 'rcpt') {
			// Also the `503` RFC 3030 section 2 requires when `DATA` follows a `BDAT` in the same
			// transaction ("If a DATA statement is issued after a BDAT for the current transaction, a
			// 503 ... MUST be issued") -- a `BDAT` moves `state` to `'bdat'`, which is not `'rcpt'`
			// either, so that mixing case falls out of this same check with no separate branch.
			this.writeResponse(503, '5.5.1', 'Bad sequence of commands');
			this.armCommandTimer();
			return;
		}
		this.writePlain(354, 'Start mail input; end with <CRLF>.<CRLF>');
		this.state = 'data';
		this.dataScanner = new DataScanner(this.smtp.sizeLimitBytes);
		this.armDataTimer();
	}

	private handleDataChunk(chunk: Buffer): void {
		if (!this.dataScanner) {
			return;
		}
		this.armDataTimer();
		const result = this.dataScanner.push(chunk);
		// `JR-4-16` (F44): `oversize` alone must NOT end the transaction here -- the scanner keeps
		// discarding body bytes until the real terminator is found (or the data timeout above fires),
		// so the connection never reads the rejected message's own bytes as commands. Only `done`
		// means the scanner is finished, one way or the other; `finishData` reads `oversize` off the
		// scanner itself to decide the response.
		if (result.done) {
			this.finishData(result.oversize);
		}
	}

	/**
	 * End of `DATA`. Delegates the actual response/reset logic to {@link completeTransfer} -- see
	 * that method's doc comment for why it always answers `451 4.3.0` in this task, never `250`.
	 */
	private finishData(oversize: boolean): void {
		this.disarmProtocolTimer();
		this.completeTransfer(oversize, this.dataScanner?.contentByteLength ?? 0, 'DATA');
	}

	/**
	 * `BDAT <chunk-size> [LAST]` (RFC 3030 section 2). Requires the same envelope state `DATA`
	 * does (`'rcpt'`) for the *first* `BDAT` of a transaction, or `'bdat'` for a subsequent one --
	 * `'bdat'` is not `'rcpt'`, so a stray `BDAT` with no prior `MAIL`/`RCPT` at all is rejected by
	 * the same check with no extra case.
	 *
	 * A chunk-size of zero needs no raw-byte phase at all: RFC 3030 explicitly allows it for the
	 * `LAST` chunk ("the last BDAT command MAY have a byte-count of zero indicating there is no
	 * additional data to be sent"), including as the *only* `BDAT` of a transaction, and this
	 * implementation also allows it for a non-`LAST` chunk (harmless no-op, not forbidden by the
	 * grammar). Anything else arms {@link bdatChunkRemaining} and waits for that many raw bytes,
	 * exactly like {@link handleDataCommand} arms {@link dataScanner} and waits for a terminator.
	 */
	private handleBdatCommand(rest: string): void {
		if (this.state !== 'rcpt' && this.state !== 'bdat') {
			this.writeResponse(503, '5.5.1', 'Bad sequence of commands');
			this.armCommandTimer();
			return;
		}
		const parsed = parseBdatArguments(rest);
		if (!parsed) {
			this.writeResponse(501, '5.5.4', 'Syntax error in BDAT command');
			this.armCommandTimer();
			return;
		}
		if (!this.bdatTracker) {
			this.bdatTracker = new BdatContentTracker(this.smtp.sizeLimitBytes);
		}
		this.bdatChunkIsLast = parsed.last;
		if (parsed.chunkSize === 0) {
			if (parsed.last) {
				this.finishBdatTransaction(false);
			} else {
				this.writeResponse(250, '2.0.0', 'Ok: chunk received');
				this.state = 'bdat';
				this.armCommandTimer();
			}
			return;
		}
		this.state = 'bdat';
		this.bdatChunkRemaining = parsed.chunkSize;
		this.armDataTimer();
	}

	/**
	 * Consume raw `BDAT` content bytes -- no line search, no dot-unstuffing, just counting down
	 * {@link bdatChunkRemaining}. `chunk` may be shorter than what remains (wait for more), exactly
	 * what remains (finish this chunk, nothing left over), or longer (finish this chunk *and* carry
	 * the remainder back into command parsing, e.g. a pipelined next `BDAT` or `QUIT`) -- the split
	 * point is always `min(chunk.length, bdatChunkRemaining)`, decided purely by the byte count RFC
	 * 3030 declared, regardless of where TCP happened to break the stream up. That is also why a
	 * chunk boundary between a `\r` and `\n` cannot matter here: nothing in this method ever looks
	 * for either byte.
	 *
	 * The full declared chunk-size is always drained before this method reacts to an oversize
	 * result, never bailed out of mid-chunk -- unlike {@link DataScanner}, which has no declared
	 * total to drain toward and so must react as soon as it notices. That keeps this connection's
	 * future command parsing correctly aligned even for a chunk that is going to be rejected.
	 */
	private handleBdatChunkBytes(chunk: Buffer): void {
		if (this.bdatChunkRemaining === null || !this.bdatTracker) {
			return; // unreachable in normal operation; defensive against a stray call
		}
		this.armDataTimer();
		const take = Math.min(chunk.length, this.bdatChunkRemaining);
		const { oversize } = this.bdatTracker.push(chunk.subarray(0, take));
		this.bdatChunkRemaining -= take;
		const remainder = chunk.subarray(take);
		if (this.bdatChunkRemaining > 0) {
			return; // still waiting for more of this chunk's declared bytes
		}
		this.bdatChunkRemaining = null;
		if (oversize) {
			this.finishBdatTransaction(true);
		} else if (this.bdatChunkIsLast) {
			this.finishBdatTransaction(false);
		} else {
			this.writeResponse(250, '2.0.0', 'Ok: chunk received');
			this.state = 'bdat';
			this.armCommandTimer();
		}
		if (remainder.length > 0 && !this.socket.destroyed) {
			this.commandCarry = Buffer.concat([remainder, this.commandCarry]);
			this.drainCommandCarry();
		}
	}

	/**
	 * `BDAT ... LAST`'s completion, the moment a whole message assembled from one or more chunks is
	 * decided -- RFC 3030 gives it no reply semantics of its own beyond "the last chunk of message
	 * data" (section 2); operationally, this is the same "the message is now fully in hand" moment
	 * `DATA`'s terminator is, so it shares {@link completeTransfer} with {@link finishData} rather
	 * than duplicating the response/reset logic.
	 */
	private finishBdatTransaction(oversize: boolean): void {
		this.disarmProtocolTimer();
		this.completeTransfer(oversize, this.bdatTracker?.contentByteLength ?? 0, 'BDAT');
	}

	/**
	 * Shared end of a mail transaction's body transfer, reached either from `DATA`'s terminator
	 * ({@link finishData}) or from `BDAT ... LAST` ({@link finishBdatTransaction}) -- kept as one
	 * method precisely so `JR-4-06` has a single call site to change, not two.
	 *
	 * **Always answers `451 4.3.0` in this task, never `250`, for either path** -- this is the
	 * Product Owner's explicit instruction, not an oversight: `JournalAcceptance.accept()`
	 * (`packages/journaling`, `JR-3-04`) is wired into this server in `JR-4-06`, and until that
	 * wiring exists nothing durable has happened to either path's bytes -- no spool write, no
	 * ledger append. Answering anything but a `4xx` here (skill section 1: "`250 OK` is a
	 * promise... never issue it before that is true") would be exactly the failure mode this
	 * entire project exists to prevent, and the fact that this is "only an intermediate
	 * development state" does not excuse it -- a sender cannot tell an intermediate `250` from a
	 * real one, and a real one is a promise this file cannot back yet. When `JR-4-06` wires the
	 * real path, the oversize branch is unaffected and the non-oversize branch is replaced with a
	 * call into `JournalAcceptance.accept()`, fed by this connection's
	 * `remoteIp`/`ehloName`/`mailFrom`/`rcptTo` and a bridge from whichever of
	 * `DataScanner`/`BdatContentTracker` produced `contentByteLength` to the
	 * `AsyncIterable<Uint8Array>` `accept()` expects.
	 *
	 * A non-`LAST` `BDAT` chunk's own `250` (written directly in {@link handleBdatCommand}/
	 * {@link handleBdatChunkBytes}, never through this method) is a **different, weaker** promise
	 * than the one this method's `451`/future `250` makes: RFC 3030 section 2 requires a `250` per
	 * successful chunk ("A 250 response MUST be sent to each successful BDAT data block"), but that
	 * is flow control -- "I read that chunk" -- not the durable-acceptance signal a sender relies on
	 * to stop retrying. That signal is exclusively this method's, exactly once per transaction,
	 * for both paths alike.
	 */
	private completeTransfer(
		oversize: boolean,
		contentByteLength: number,
		transferMode: 'DATA' | 'BDAT'
	): void {
		if (oversize) {
			this.logger.error(
				{
					remoteAddress: this.socket.remoteAddress,
					sizeLimitBytes: this.smtp.sizeLimitBytes,
					transferMode,
				},
				'smtp-ingress: rejecting message, exceeds configured SIZE limit'
			);
			this.writeResponse(552, '5.3.4', 'Message size exceeds fixed maximum message size');
		} else {
			this.logger.info(
				{
					remoteAddress: this.socket.remoteAddress,
					ehloName: this.ehloName,
					contentByteLength,
					transferMode,
				},
				'smtp-ingress: message received; acceptance path not yet wired'
			);
			this.writeResponse(451, '4.3.0', 'Requested action aborted: local error in processing');
		}
		this.resetEnvelope();
		this.state = 'ready';
		this.armCommandTimer();
	}

	/** Clears the envelope **and** any in-progress chunking state -- RFC 3030's requirement that
	 * `RSET` mid-`BDAT` "clears all segments sent during that transaction" falls out of this being
	 * the one reset path every command that starts a fresh envelope (`EHLO`/`HELO`/`RSET`) already
	 * called, plus the two body-transfer completions above. */
	private resetEnvelope(): void {
		this.mailFrom = null;
		this.rcptTo = [];
		this.dataScanner = null;
		this.bdatTracker = null;
		this.bdatChunkRemaining = null;
		this.bdatChunkIsLast = false;
	}

	private disarmProtocolTimer(): void {
		if (this.protocolTimer) {
			clearTimeout(this.protocolTimer);
			this.protocolTimer = null;
		}
	}

	private armCommandTimer(): void {
		this.disarmProtocolTimer();
		this.protocolTimer = setTimeout(
			() => this.onTimeout('command'),
			this.smtp.commandTimeoutMs
		);
	}

	private armDataTimer(): void {
		this.disarmProtocolTimer();
		this.protocolTimer = setTimeout(() => this.onTimeout('data'), this.smtp.dataTimeoutMs);
	}

	/** Fired for all three timeout kinds (connection/command/data). Always `421`, never `5xx` --
	 * a stalled peer is a local/network condition, not a permanent rejection (skill section 1). */
	private onTimeout(kind: TimeoutKind): void {
		if (this.socket.destroyed) {
			return;
		}
		this.logger.warn(
			{ remoteAddress: this.socket.remoteAddress, kind },
			'smtp-ingress: closing connection after timeout'
		);
		this.writeResponse(
			421,
			TIMEOUT_ENHANCED_CODE,
			`${this.smtp.hostname} Error: timeout exceeded`
		);
		this.disarmProtocolTimer();
		this.socket.end();
		// A peer that stopped reading (the exact condition that produced this timeout) may never
		// acknowledge the FIN. Force the socket closed shortly after so it cannot linger forever.
		const forceClose = setTimeout(() => {
			if (!this.socket.destroyed) {
				this.socket.destroy();
			}
		}, 1_000);
		forceClose.unref();
	}

	private writeResponse(code: number, enhancedCode: string, message: string): void {
		if (!this.socket.destroyed) {
			this.socket.write(`${code} ${enhancedCode} ${message}\r\n`);
		}
	}

	private writePlain(code: number, message: string): void {
		if (!this.socket.destroyed) {
			this.socket.write(`${code} ${message}\r\n`);
		}
	}
}

export interface EsmtpServerOptions {
	readonly smtp: SmtpServerConfig;
	/** Structured-logging port. Defaults to {@link noopIngressLogger} -- see this module's
	 * "Where `logLevel` actually gets used" section for why a caller that cares passes a real one. */
	readonly logger?: IngressLogger;
}

/**
 * The ESMTP listener. `apps/smtp-ingress/src/index.ts` is the only thing that constructs one, binds
 * it to the configured port, and wires process signals to {@link EsmtpServer.close} -- this class
 * has no knowledge of `process.env`, signals, or the process lifecycle.
 */
export class EsmtpServer {
	private readonly server: net.Server;
	private readonly smtp: SmtpServerConfig;
	private readonly logger: IngressLogger;
	private readonly sockets = new Set<net.Socket>();

	constructor(options: EsmtpServerOptions) {
		this.smtp = options.smtp;
		this.logger = options.logger ?? noopIngressLogger;
		this.server = net.createServer((socket) => this.handleConnection(socket));
	}

	listen(port: number, host?: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server.once('error', reject);
			this.server.listen(port, host, () => {
				this.server.off('error', reject);
				resolve();
			});
		});
	}

	get address(): net.AddressInfo | null {
		const address = this.server.address();
		return address === null || typeof address === 'string' ? null : address;
	}

	/**
	 * Stops accepting new connections and waits for the ones already open to end on their own.
	 * Does **not** forcibly close them or send them anything -- a graceful drain that answers
	 * `421 4.3.2` to in-flight sessions (skill section 2, "Shutdown in progress") is `JR-4-06`'s job,
	 * once there is an acceptance path whose in-flight state that response needs to describe.
	 */
	close(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server.close((err) => (err ? reject(err) : resolve()));
		});
	}

	private handleConnection(socket: net.Socket): void {
		this.sockets.add(socket);
		socket.on('close', () => this.sockets.delete(socket));
		new SmtpConnection(socket, this.smtp, this.logger);
	}
}
