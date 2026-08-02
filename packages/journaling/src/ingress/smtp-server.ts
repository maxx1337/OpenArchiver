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
 * and the three timeouts. Deliberately **not** here: `CHUNKING`/`BDAT` (`JR-4-03` -- not
 * advertised in `EHLO` by this file precisely so a client that only received this task's server
 * never attempts it), TLS/`STARTTLS` (`JR-4-04`), source/recipient ACLs (`JR-4-05`), and wiring
 * `JournalAcceptance.accept()` (`JR-4-06`). End-of-`DATA` always answers `451 4.3.0` until that
 * wiring lands -- see {@link SmtpConnection.finishData}'s doc comment for why that is not a
 * shortcut but the Product Owner's explicit instruction for this slice.
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
 * Build the `EHLO` extension lines this task's acceptance criterion names: `PIPELINING`,
 * `8BITMIME`, `SMTPUTF8`, `SIZE <configured value>`. Deliberately excludes `CHUNKING` (`JR-4-03`)
 * and `STARTTLS` (`JR-4-04`) -- advertising an extension this server cannot yet honour would be a
 * protocol lie a real client (Exchange Online) could act on.
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
 * one's.
 */
export class DataScanner {
	private carry: Buffer = Buffer.alloc(0);
	private bytesSeen = 0;
	private finished = false;
	private oversize = false;

	constructor(private readonly limitBytes: number) {}

	/** Feed the next raw chunk. Returns the scanner's status after processing as much of it as
	 * forms complete lines; a chunk arriving after `done`/`oversize` is ignored. */
	push(chunk: Buffer): { readonly done: boolean; readonly oversize: boolean } {
		if (!this.finished) {
			this.carry = Buffer.concat([this.carry, chunk]);
			this.scan();
			// A pathological "line" that never contains a CRLF would otherwise grow `carry` without
			// bound. Capping it at the configured SIZE limit keeps worst-case memory use proportional
			// to the configured limit rather than to whatever an attacker chooses to send.
			if (!this.finished && this.carry.length > this.limitBytes) {
				this.oversize = true;
				this.finished = true;
				this.carry = Buffer.alloc(0);
			}
		}
		return { done: this.finished, oversize: this.oversize };
	}

	/** Total content bytes seen so far (post-dot-unstuffing, including each line's terminating
	 * CRLF, excluding the terminator line itself). */
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
			if (this.bytesSeen > this.limitBytes) {
				this.oversize = true;
				this.finished = true;
				return;
			}
		}
	}
}

type SessionState = 'initial' | 'ready' | 'mail' | 'rcpt' | 'data';
type TimeoutKind = 'connection' | 'command' | 'data';

/** One accepted TCP connection's protocol state machine. Not exported -- `EsmtpServer` is the
 * public surface; a connection only exists for as long as the socket does. */
class SmtpConnection {
	private state: SessionState = 'initial';
	private ehloName: string | null = null;
	private mailFrom: string | null = null;
	private rcptTo: string[] = [];
	private dataScanner: DataScanner | null = null;
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
		this.commandCarry = Buffer.concat([this.commandCarry, chunk]);
		for (;;) {
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
		if (result.done || result.oversize) {
			this.finishData(result.oversize);
		}
	}

	/**
	 * End of `DATA`. **Always answers `451 4.3.0` in this task, never `250`** -- this is the Product
	 * Owner's explicit instruction, not an oversight: `JournalAcceptance.accept()` (`packages/journaling`,
	 * `JR-3-04`) is wired into this server in `JR-4-06`, and until that wiring exists nothing durable
	 * has happened to the bytes this method just finished scanning -- no spool write, no ledger append.
	 * Answering anything but a `4xx` here (skill section 1: "`250 OK` is a promise... never issue it
	 * before that is true") would be exactly the failure mode this entire project exists to prevent, and
	 * the fact that this is "only an intermediate development state" does not excuse it -- a sender
	 * cannot tell an intermediate `250` from a real one, and a real one is a promise this file cannot
	 * back yet. When `JR-4-06` wires the real path, this method's oversize branch is unaffected and its
	 * non-oversize branch is replaced with a call into `JournalAcceptance.accept()`, fed by this
	 * connection's `remoteIp`/`ehloName`/`mailFrom`/`rcptTo` and a bridge from `DataScanner`'s
	 * chunk-at-a-time interface to the `AsyncIterable<Uint8Array>` `accept()` expects.
	 */
	private finishData(oversize: boolean): void {
		this.disarmProtocolTimer();
		if (oversize) {
			this.logger.error(
				{
					remoteAddress: this.socket.remoteAddress,
					sizeLimitBytes: this.smtp.sizeLimitBytes,
				},
				'smtp-ingress: rejecting DATA, message exceeds configured SIZE limit'
			);
			this.writeResponse(552, '5.3.4', 'Message size exceeds fixed maximum message size');
		} else {
			this.logger.info(
				{
					remoteAddress: this.socket.remoteAddress,
					ehloName: this.ehloName,
					contentByteLength: this.dataScanner?.contentByteLength ?? 0,
				},
				'smtp-ingress: DATA received; acceptance path not yet wired'
			);
			this.writeResponse(451, '4.3.0', 'Requested action aborted: local error in processing');
		}
		this.resetEnvelope();
		this.state = 'ready';
		this.armCommandTimer();
	}

	private resetEnvelope(): void {
		this.mailFrom = null;
		this.rcptTo = [];
		this.dataScanner = null;
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
