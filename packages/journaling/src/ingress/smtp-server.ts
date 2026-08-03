import * as net from 'node:net';
import * as tls from 'node:tls';
import type { SmtpServerConfig } from './smtp-config';
import { TLS_MIN_VERSION, type IngressTlsConfig } from './tls-config';
import { SpoolWriteBridge } from './spool-write-bridge';
import {
	isAccepted,
	type JournalAcceptanceResult,
	type JournalTransactionInput,
} from '../spool/acceptance';

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
 * and the three timeouts. Deliberately **not** here (added by later tasks, see below): TLS/`STARTTLS`,
 * source/recipient ACLs, and wiring `JournalAcceptance.accept()` -- the last of which is `JR-4-06a`,
 * see this file's "`JournalAcceptance.accept()` is wired in" section further down. Before that task,
 * end-of-`DATA` always answered `451 4.3.0`, unconditionally -- the Product Owner's explicit
 * instruction for every slice before it, so that no intermediate state of this file could ever send a
 * `250` it could not back.
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
 *
 * ---------------------------------------------------------------------------------------------
 * TLS / `STARTTLS` (`JR-4-04`)
 * ---------------------------------------------------------------------------------------------
 * `EHLO` now advertises `STARTTLS` whenever a certificate/key is configured and the connection is
 * not already secure (never after a successful handshake, and never at all if this deployment has
 * no certificate -- see {@link buildEhloResponseLines}). `STARTTLS` itself, the upgrade, and the
 * `require_tls` gate live in {@link SmtpConnection.handleStarttlsCommand}/
 * {@link SmtpConnection.beginTlsUpgrade}/{@link SmtpConnection.onTlsHandshakeComplete} and the check
 * at the top of {@link SmtpConnection.processCommandLine}.
 *
 * Three things this task had to get right, in order of how easy each is to get wrong silently:
 *
 * 1. **Which commands `530 5.7.0` applies to.** RFC 3207 section 4 is specific, not "everything":
 *    "...SHOULD return the reply code: 530 Must issue a STARTTLS command first ... to every command
 *    other than NOOP, EHLO, STARTTLS, or QUIT". `HELO` is not literally named by the RFC (it predates
 *    ESMTP's extension mechanism) but the Product Owner's instruction for this slice groups it with
 *    `EHLO` for the obvious reason: a client that cannot see `STARTTLS` advertised (no `EHLO`
 *    response has extension lines under `HELO`) must still be able to attempt it blindly, and must
 *    still be able to leave via `QUIT`. `RSET` is deliberately **included** in the gated set --
 *    RFC 3207's list above does not exempt it, and nothing about resetting the envelope requires
 *    plaintext. The gate runs once, before the command switch, so it applies uniformly and cannot be
 *    bypassed by a state the individual command handlers do not otherwise check.
 * 2. **The session resets completely after a successful handshake**, not just "now encrypted".
 *    RFC 3207 section 4.2: "Upon completion of the TLS handshake, the SMTP protocol is reset to the
 *    initial state (the state in SMTP after a server issues a 220 service ready greeting)." A client
 *    is required to re-issue `EHLO`; this server enforces the server-side half of that by discarding
 *    `ehloName` and the whole envelope and returning `state` to `'initial'` --
 *    {@link SmtpConnection.onTlsHandshakeComplete}, reusing {@link SmtpConnection.resetEnvelope} the
 *    same way every other envelope-clearing command already does.
 * 3. **Bytes sent immediately after `STARTTLS\r\n`, before the handshake, are discarded -- never
 *    executed, before or after the handshake.** This is the STARTTLS "command injection" class of
 *    bug (widely documented against Postfix/Exim/Dovecot implementations around 2011, and structurally
 *    the same defect this project already found and fixed once this slice, one layer down: F44,
 *    `JR-4-16`, where message-body bytes shaped like commands were read as commands after a rejected
 *    `DATA` transfer). RFC 2920 forbids a client from pipelining anything after `STARTTLS` precisely
 *    because it cannot know in advance whether the handshake will succeed -- bytes present in
 *    `commandCarry` at that point are therefore either a non-conformant client or bytes an on-path
 *    attacker smuggled ahead of the encrypted session. {@link SmtpConnection.handleStarttlsCommand}
 *    unconditionally empties `commandCarry` (logging a warning if it was non-empty) **before** the
 *    `220` reply and the handshake begin, so those bytes are never fed to
 *    {@link SmtpConnection.processCommandLine} either as a stray plaintext command or, worse, as if
 *    the newly-authenticated encrypted client had sent them. This is the companion half of point 2:
 *    point 2 discards what the server *learned*; this discards what the client *sent but the server
 *    never acted on yet*.
 *
 * `require_tls` (`JR-4-04`) is process configuration for this task, not per-source -- the source is
 * not known at connect time, only once `JR-4-05` loads it by IP or recipient. See
 * {@link RequireTlsResolver}'s doc comment for the seam that task extends and the rule ("tighten,
 * never loosen") that governs it.
 *
 * ---------------------------------------------------------------------------------------------
 * Recipient ACL, no catch-all (`JR-4-05b`)
 * ---------------------------------------------------------------------------------------------
 * Every `RCPT TO` is checked against {@link RecipientAclEvaluator} (implemented by
 * `SourceAclCache`, reusing the *same* database connection and refresh cycle `JR-4-05a` already
 * built rather than opening a second polling loop against `journaling_sources` -- see
 * `./source-acl-cache.ts`'s doc comment). `'denied'` -- a syntactically valid address that matches
 * no active source's `routing_address` -- answers `550 5.1.1` at the `RCPT` command itself, per the
 * skill's response table; `'unavailable'` -- the ACL is not currently known, the same condition
 * `SourceAclEvaluator` reports at connect time -- answers `451 4.3.0` instead (skill section 1:
 * never a `5xx` for a local problem), but unlike the connect-time gate does **not** close the
 * connection: the client may still retry the command. See `./recipient-address.ts` for how an
 * address is folded before comparison and the full list of deliberately-unhandled edge cases
 * (`postmaster`, angle-bracket comments, `SMTPUTF8`).
 *
 * **No catch-all is reachable from here, structurally, not just by omission.** `'allowed'` is only
 * ever returned for an address that matched a real row in `SourceAclCache`'s snapshot -- there is
 * no code path in this file, `source-acl-cache.ts`, or `source-acl.ts` that can turn "no rows
 * loaded" or "empty routing_address" into an admit-everyone decision; both fall through to
 * `'unavailable'`/`'denied'` the same as any other non-match. See this handler's own doc comment
 * (`handleRcpt`) for the three concrete ways a catch-all could otherwise sneak in and why each is
 * closed.
 *
 * **The recipient determines the chain (ADR-007).** Every accepted `RCPT TO` is recorded together
 * with the source and `chainScopeId` the ACL matched it to -- see {@link matchedRecipients} --
 * because `JR-4-06` needs exactly that mapping to fill `JournalTransactionInput.chainScopeId`/
 * `journalingSourceId` when it wires `completeTransfer()` into `JournalAcceptance.accept()`. A
 * transaction can no longer end up with recipients resolving to **more than one** chain: `JR-4-05b`
 * recorded the case and left it undecided, and `ADR-027` (`docs/dev/journaling/05-entscheidungen.md`,
 * implemented by `JR-4-17`) decided it -- the second and every later `RCPT TO` that would add a
 * *different* `chainScopeId` to this transaction is rejected with `452 4.5.3` in {@link handleRcpt},
 * before it ever reaches {@link recordMatchedRecipient}. See that method's doc comment for what
 * stays recorded once a transaction is committed to its one chain, and `handleRcpt`'s own doc
 * comment for why `452` and not `550`.
 *
 * `tlsVersion`/`tlsCipher` (ADR-006 section 1: two of the sixteen hashed ledger fields, added
 * precisely because the RFC's eight-field formula would let them change after the fact without
 * breaking the chain) are read from the real, negotiated {@link tls.TLSSocket} in
 * {@link SmtpConnection.onTlsHandshakeComplete} -- never from configuration, never guessed. They sit
 * on the connection (`this.tlsVersion`/`this.tlsCipher`) exactly where
 * {@link SmtpConnection.completeTransfer}'s doc comment already says `JR-4-06` will read
 * `remoteIp`/`ehloName`/`mailFrom`/`rcptTo` from -- see that method's doc comment for the updated list.
 * **The ledger side of this task's acceptance criterion is not implemented here**: `JR-4-06` is what
 * wires `completeTransfer()` into `JournalAcceptance.accept()`, whose `JournalTransactionInput`
 * (`packages/journaling/src/spool/acceptance.ts`) already has `tlsVersion`/`tlsCipher` fields to
 * receive exactly these two values. Until that wiring lands, this task's job is only to have the
 * measured values sitting ready at that handover point, which is what is done and tested here.
 *
 * ---------------------------------------------------------------------------------------------
 * `AUTH` PLAIN/LOGIN, TLS-only (`JR-4-05c`)
 * ---------------------------------------------------------------------------------------------
 * `AUTH` is an **additional**, optional proof of identity for a non-Exchange sender (Exchange
 * Online's journal rule cannot authenticate at all, `00-rfc.md`'s own `AUTH` note) -- the *primary*
 * access control stays the connect-time source ACL (`JR-4-05a`). Credentials come from
 * `journaling_sources.smtp_username`/`smtp_password_hash`, read and cached by the *same*
 * `SourceAclCache` refresh cycle `JR-4-05a`/`JR-4-05b` already built (`./source-acl-cache.ts`'s
 * `authIndex`/`lookupCredential()`) -- no second database connection, no second polling loop.
 *
 * 1. **"Over plaintext is impossible" is structural, both directions.** `buildEhloResponseLines`'s
 *    new fourth argument only ever adds the `AUTH` extension line when `tls.active` is already
 *    true -- it can never be advertised before a handshake (the same "never lie about what is on
 *    offer" posture `STARTTLS`'s own advertisement already has). Independently, and regardless of
 *    what `EHLO` advertised or what `require_tls` is configured to, {@link SmtpConnection.handleAuthCommand}
 *    itself refuses a bare `AUTH` on a connection where `this.tlsActive` is still `false` with
 *    `538 5.7.11` (RFC 4954 section 4's dedicated code for exactly this) -- a client that never saw
 *    `AUTH` offered can still attempt it blindly, and is still refused. This is deliberately a
 *    *second*, independent gate from `TLS_MANDATED_VERBS`'s pre-existing `530 5.7.0` (which only
 *    fires when `require_tls` is configured `true`; `AUTH` needs encryption unconditionally, even in
 *    a deployment that never mandates TLS for `MAIL`/`RCPT`/`DATA` at all).
 * 2. **An authenticated source addressing a *different* source's recipient is refused, not merged.**
 *    `JR-4-05b` established that the *recipient* determines the chain (ADR-007); `AUTH` adds a
 *    second identity to the same transaction, and the two can disagree (source A authenticates, then
 *    sends `RCPT TO` a `routing_address` belonging to source B). Silently accepting that would let an
 *    authenticated sender write into a chain its own credentials say nothing about -- so
 *    {@link SmtpConnection.handleRcpt} rejects the recipient with `550 5.7.1` whenever
 *    `this.authenticatedSourceId` is set and differs from the recipient ACL's matched `sourceId`,
 *    while every recipient of the authenticated source's *own* chain is unaffected. See this slice's
 *    report for why `5.7.1` ("delivery not authorized") rather than `5.1.1` ("no such user") is the
 *    correct enhanced code here -- the recipient is a real, configured address; this authenticated
 *    session simply is not the one allowed to deliver to it.
 * 3. **Authentication persists for the whole connection, across `EHLO`/`RSET`.** Unlike the envelope
 *    (`mailFrom`/`rcptTo`/`matchedRecipients`), `authenticatedSourceId` is **not** cleared by
 *    {@link SmtpConnection.resetEnvelope} -- RFC 4954 section 4's "a second `AUTH` on an
 *    already-authenticated connection is `503`" only makes sense if authentication outlives the
 *    transactions sent under it, exactly the way a real MTA's multi-message connection expects.
 * 4. **Mechanisms, ports, and where bcrypt lives.** `PLAIN` (RFC 4616, either as `AUTH PLAIN
 *    <initial-response>` or as the answer to an empty `334` challenge) and `LOGIN` (the de facto
 *    two-step `334`-prompted dialogue) are both implemented; parsing (`parseAuthArguments`,
 *    `decodeSaslBase64`, `decodeSaslPlain`) is pure and tested without any bcrypt dependency at all.
 *    The actual comparison goes through the injected {@link PasswordVerifier} port -- this package
 *    depends on nothing but `@open-archiver/types`/`zod` (architecture section 2), so bcrypt itself
 *    is `apps/smtp-ingress`'s concern (`bcryptjs`, the same library `packages/backend`'s
 *    `AuthService`/`UserService` already use), the same "port in the package, implementation in the
 *    app" split `JR-4-05a` already established for `SourceAclLookup` and `JR-4-02` for `IngressLogger`.
 * 5. **Timing and information disclosure.** {@link AUTH_DUMMY_PASSWORD_HASH} is compared against on
 *    every `'not_found'` username lookup (see {@link SmtpConnection.verifyCredentials}) so an
 *    unknown username costs the same wall-clock time as a known one with a wrong password -- the
 *    *absence* of a bcrypt call would itself be a timing oracle. Both failure classes -- unknown
 *    username and wrong password for a real one -- answer with the exact same `535 5.7.8`, never a
 *    distinguishing code or wording.
 * 6. **`MAX_AUTH_ATTEMPTS_PER_CONNECTION`** bounds failed attempts on one already-open connection;
 *    once exceeded, the *next* failure's own response code is replaced with `421` and the connection
 *    is closed -- see that constant's doc comment for the chosen number and why `421`, never a `5xx`
 *    (skill section 1: a local policy decision to stop this connection is not the same thing as a
 *    permanent rejection of the sender).
 * 7. **Nothing secret reaches the logger.** No log call in this `AUTH` implementation is ever passed
 *    a password, a raw base64 SASL response, or a bcrypt hash; only usernames, source ids, and
 *    outcome/enhanced-status-code fields are logged, the same posture `IngressLogger`'s own module
 *    doc comment already holds every other log call in this file to.
 *
 * ---------------------------------------------------------------------------------------------
 * `JournalAcceptance.accept()` is wired in (`JR-4-06a`) -- `250` is now possible
 * ---------------------------------------------------------------------------------------------
 * Every prior task's doc comment in this file said "`JR-4-06` wires `completeTransfer()` into
 * `JournalAcceptance.accept()`" as a promise about the future. This is that task -- **the PO
 * instruction lifting the "always `451`" constraint applies from here on**: `completeTransfer()` now
 * calls `accept()` whenever {@link EsmtpServerOptions.journalAcceptance} is configured, and only then;
 * `undefined` (the default, same convention every other optional evaluator in this file already
 * uses) preserves the exact pre-`JR-4-06a` behaviour, which is what keeps every earlier task's
 * protocol tests passing unchanged. Production (`apps/smtp-ingress/src/index.ts`) always supplies it
 * once a ledger database is configured.
 *
 *  1. **The bridge, not a buffer.** `accept()` wants an `AsyncIterable<Uint8Array>`;
 *     `DataScanner`/`BdatContentTracker` deliver content synchronously off socket `data` events, with
 *     no `await` anywhere in that call stack. Collecting chunks into an array and handing
 *     `accept()` a generator over it once the message ends would buffer the whole message in this
 *     process's heap -- exactly what `JR-3-02`'s streaming durable write exists to avoid.
 *     {@link SpoolWriteBridge} (`./spool-write-bridge.ts`) is the actual bridge: a `node:stream.Readable`
 *     in object mode that `onContent` pushes into and `accept()`'s internal `for await` pulls out of,
 *     with real backpressure -- `socket.pause()`/`socket.resume()` are wired to the bridge's own
 *     `onPause`/`onResume` callbacks in {@link SmtpConnection.tryBeginAcceptance}. See that file's
 *     module doc comment for the full design and for why a heap-growth proof needs `arrayBuffers`,
 *     not `heapUsed` (F43).
 *  2. **`accept()` starts at the first `DATA`/`BDAT`, not at the terminator.** By the time `DATA`
 *     (state `'rcpt'` -> `'data'`) or the first `BDAT` of a transaction runs, `MAIL`/`RCPT` are
 *     already frozen (neither command is reachable again until the transaction resets), so every
 *     field `JournalTransactionInput` needs except the content itself is already known --
 *     {@link SmtpConnection.tryBeginAcceptance} builds the request and calls `accept()` right there,
 *     before writing `354`/the first chunk's `250`. `writeDurableSpoolFile()`'s first two
 *     sub-operations (`mkdir`, `createFile`) already run, in the background, before a single content
 *     byte exists -- see `durable-write.ts`'s doc comment for why that rules out "wait until we know
 *     the message is not oversize before starting the write" as an alternative (`finalizeAcceptance`'s
 *     own doc comment below has the full argument).
 *  3. **Oversize aborts the in-flight write; `552` always wins.** `JR-4-16`'s discard-scan already
 *     detects oversize mid-transfer and keeps reading to the real terminator without desyncing the
 *     connection (F44); this task adds what happens to the *durable write* already in flight for that
 *     rejected message. See {@link SmtpConnection.finalizeAcceptance}'s doc comment for the full
 *     argument: the bridge is aborted rather than ended, `durable-write.ts`'s `F45` fix turns that into
 *     a typed, `accept()`-catchable failure instead of an uncaught exception, and the SMTP layer -- the
 *     only thing that knows this particular failure was actually an oversize rejection -- overrides
 *     whatever `accept()` settles to with `552 5.3.4`, unconditionally.
 *  4. **A transaction abandoned mid-`BDAT` is not leaked.** `RSET`, a fresh `EHLO`/`HELO`, or a
 *     `STARTTLS` handshake can all fire {@link resetEnvelope} between two `BDAT` chunks, i.e. after
 *     `tryBeginAcceptance()` already started an `accept()` call that will now never see `BDAT ...
 *     LAST`. {@link SmtpConnection.abandonInFlightAcceptance}, called from {@link resetEnvelope} every
 *     time, aborts that bridge the same way an oversize rejection does, so the write does not hang
 *     forever waiting for chunks that will never arrive.
 *  5. **A pipelined command must never race the transaction's own reply.** Awaiting `accept()` is the
 *     first genuinely asynchronous step `DATA`/`BDAT` completion has ever had; a client that
 *     pipelines the next command right behind `BDAT ... LAST`'s bytes must not have it parsed (against
 *     a state that has not been reset yet) before this transaction's `250`/`4xx`/`552` reply is
 *     written. {@link SmtpConnection.runCompleteTransfer} reuses {@link commandProcessingSuspended} --
 *     the exact mechanism {@link verifyCredentials} already established for its own asynchronous
 *     bcrypt comparison -- and {@link onData} now checks it before routing a raw byte chunk at all, not
 *     only before parsing a command line (see that method's own comment for why both DATA/BDAT-content
 *     routing and command parsing both need the check now, where only the latter did before).
 *  6. **The mapping (skill `journal-ledger` section 2):** `accepted` -> `250 2.0.0 Ok: queued as
 *     <seq>`; `high-water-mark-exceeded`/`spool-capacity-exceeded` -> `452 4.3.1`;
 *     `spool-write-failed`/`ledger-append-failed` -> `451 4.3.0`. See
 *     {@link SmtpConnection.finalizeAcceptance} for the implementation and for oversize's override of
 *     all of the above.
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

/** Verbs `530 5.7.0` applies to when TLS is mandated and not yet active (`JR-4-04`) -- see
 * {@link SmtpConnection.processCommandLine}'s call site for the RFC 3207 citation and the reasoning
 * behind each inclusion/exclusion. `AUTH` is included since `JR-4-02`/`JR-4-04` in anticipation of
 * this task; since `JR-4-05c` it is a recognised verb, gated *twice* -- this set only fires when
 * `require_tls` is configured `true` (see {@link SmtpConnection.isTlsMandated}), while
 * {@link SmtpConnection.handleAuthCommand}'s own `538 5.7.11` check fires unconditionally. See the
 * module doc comment's "AUTH" section, point 1. */
const TLS_MANDATED_VERBS = new Set(['MAIL', 'RCPT', 'DATA', 'BDAT', 'RSET', 'AUTH']);

/**
 * RFC 4954's two SASL mechanisms this receiver implements (`JR-4-05c`). Exchange Online's journal
 * rule cannot authenticate at all (this file's module doc comment, "AUTH" section), so this exists
 * only for non-Exchange senders such as a Postfix `always_bcc` configuration -- `PLAIN` and `LOGIN`
 * together cover that case; nothing else (`CRAM-MD5`, `XOAUTH2`, ...) is in scope. Order is the
 * advertised order in `EHLO`'s `AUTH` line.
 */
export const AUTH_MECHANISMS = ['PLAIN', 'LOGIN'] as const;

/**
 * Per-connection cap on failed `AUTH` attempts (`JR-4-05c`). An unbounded counter turns one already
 * -open connection into a free credential-stuffing oracle limited only by TCP round-trip time.
 * Three: generous enough that a legitimate client mistyping a password once or twice is not
 * disconnected on the first slip, small enough that an automated guesser is cut off within a
 * handful of round trips on any *single* connection. This is a per-connection backstop only --
 * `JR-4-08` is what bounds attempts across many connections/IPs; this constant exists purely so one
 * already-open connection cannot be reused for unlimited guesses regardless of what that broader
 * limit ends up being.
 */
export const MAX_AUTH_ATTEMPTS_PER_CONNECTION = 3;

/**
 * A syntactically valid bcrypt hash (cost factor 10, matching `packages/backend`'s
 * `hash(password, 10)` calls -- see `UserService.ts`) of a fixed, randomly generated, never-used
 * placeholder password. Compared against on every `'not_found'` `AUTH` username lookup (see
 * {@link SmtpConnection.verifyCredentials}) purely so the wall-clock cost of "unknown username" is
 * the same as "known username, wrong password" -- skipping the bcrypt call for an unknown username
 * would itself be a timing oracle revealing which usernames exist, independent of anything RFC 4954
 * says about credential secrecy. This is not, and must never become, a real credential: no
 * `journaling_sources` row is ever created with this exact hash by this product's own code (hashes
 * are always generated from an operator-chosen or random password), and the result of comparing
 * against it is always discarded -- see the call site.
 */
export const AUTH_DUMMY_PASSWORD_HASH =
	'$2b$10$GyvVBF7BxkO7XFmTtMk.J.vGYQ7qoteJVuQ1GxsJbdZBNhZQbucwm';

/**
 * Build the options {@link SmtpConnection.beginTlsUpgrade} passes to `new tls.TLSSocket(...)`.
 * Pulled out into its own pure, socket-free function for exactly the reason `buildEhloResponseLines`
 * already is: a test can assert `minVersion === TLS_MIN_VERSION` directly against this function's
 * return value, without spying on or re-implementing Node's own `tls.TLSSocket` constructor. The
 * fixed floor itself (`TLS_MIN_VERSION`, `'TLSv1.2'`) is documented in `tls-config.ts`; no `maxVersion`
 * is set, deliberately, so Node's own default ceiling (currently TLSv1.3) is inherited rather than
 * pinned in this file too.
 */
export function buildTlsSocketOptions(secureContext: tls.SecureContext): tls.TLSSocketOptions {
	return {
		isServer: true,
		secureContext,
		minVersion: TLS_MIN_VERSION,
	};
}

/** Whether to advertise `STARTTLS` in an `EHLO` response (`JR-4-04`). `available` is "this
 * deployment has a certificate/key configured at all"; `active` is "this connection already
 * completed a TLS handshake". Both are needed independently: `STARTTLS` must never be advertised
 * with no certificate behind it (the protocol lie `CHUNKING` was withheld against before `JR-4-03`
 * implemented it, the same reasoning applied here), and must never be advertised a second time once
 * already active (RFC 3207 section 4: a server "MUST NOT" announce `STARTTLS` after a TLS handshake
 * has completed). */
export interface EhloTlsStatus {
	readonly available: boolean;
	readonly active: boolean;
}

const TLS_NOT_OFFERED: EhloTlsStatus = { available: false, active: false };

/**
 * Build the `EHLO` extension lines: `PIPELINING`, `8BITMIME`, `SMTPUTF8`, `SIZE <configured
 * value>`, `CHUNKING` (`JR-4-03`), -- since `JR-4-04`, only when `tls.available && !tls.active` --
 * `STARTTLS`, and -- since `JR-4-05c`, only when `authAvailable && tls.active` -- `AUTH PLAIN
 * LOGIN`. `tls` defaults to "not offered" and `authAvailable` defaults to `false` so every existing
 * call site that predates `JR-4-04`/`JR-4-05c` keeps its prior behaviour unchanged.
 *
 * `AUTH` is deliberately gated on `tls.active`, not merely `tls.available` the way `STARTTLS` is --
 * see this file's module doc comment, "AUTH" section point 1: advertising an authentication
 * mechanism this receiver will refuse with `538` the moment it is actually attempted would be
 * exactly the kind of protocol lie `CHUNKING`/`STARTTLS` were already careful never to make.
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
	sizeLimitBytes: number,
	tls: EhloTlsStatus = TLS_NOT_OFFERED,
	authAvailable = false
): readonly string[] {
	const lines = [
		`${hostname} greets you`,
		'PIPELINING',
		'8BITMIME',
		'SMTPUTF8',
		`SIZE ${sizeLimitBytes}`,
		'CHUNKING',
	];
	if (tls.available && !tls.active) {
		lines.push('STARTTLS');
	}
	if (authAvailable && tls.active) {
		lines.push(`AUTH ${AUTH_MECHANISMS.join(' ')}`);
	}
	return lines;
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

/** Parsed `AUTH <mechanism> [initial-response]` (RFC 4954 section 4). `initialResponse` is `null`
 * when the client did not include one -- the caller must then challenge with a `334` continuation
 * (see `SmtpConnection.startAuthPlain`/`startAuthLogin`). */
export interface ParsedAuthCommand {
	readonly mechanism: string;
	readonly initialResponse: string | null;
}

const AUTH_ARGS_PATTERN = /^(\S+)(?:\s+(\S+))?\s*$/;

/**
 * Parse the argument text following the `AUTH` verb. Returns `null` on a syntax error (a bare
 * `AUTH` with no mechanism at all) -- the caller maps that to `501 5.5.4`, the same bucket every
 * other malformed-argument case in this file uses. `mechanism` is upper-cased here so callers never
 * repeat a case-insensitive comparison (RFC 4954 does not require a client to send it upper-case).
 */
export function parseAuthArguments(rest: string): ParsedAuthCommand | null {
	const match = AUTH_ARGS_PATTERN.exec(rest.trim());
	if (!match) {
		return null;
	}
	const [, mechanism, initialResponse] = match;
	return { mechanism: mechanism!.toUpperCase(), initialResponse: initialResponse ?? null };
}

/**
 * Strict base64 decode for a SASL continuation response (RFC 4954's `base64` production). Rejects
 * anything `Buffer.from(_, 'base64')` would otherwise silently tolerate (stray characters, wrong
 * padding length) -- malformed base64 must produce `501 5.5.2`, never a garbage-but-accepted decode.
 * The literal token `"="` is RFC 4954's grammar for an explicitly *empty* response (distinct from
 * simply not sending an initial response at all, which is `null` in {@link ParsedAuthCommand}) and
 * is special-cased to decode to a zero-length buffer rather than being rejected by the regex below
 * (a lone `"="` is not valid base64 padding on its own).
 */
export function decodeSaslBase64(input: string): Buffer | null {
	if (input === '=') {
		return Buffer.alloc(0);
	}
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input) || input.length % 4 !== 0) {
		return null;
	}
	return Buffer.from(input, 'base64');
}

/** A decoded SASL PLAIN response (RFC 4616): `authzid`/`authcid`/`password`, NUL-separated in the
 * wire payload. `authzid` (the authorization identity) is parsed but never used for a decision --
 * this receiver authenticates against `authcid` (the authentication identity) only, the same
 * simplification most SASL PLAIN servers make when there is no separate notion of "act as another
 * identity" to support. */
export interface DecodedSaslPlain {
	readonly authzid: string;
	readonly authcid: string;
	readonly password: string;
}

/**
 * Decode a SASL PLAIN payload into its three NUL-separated fields. Returns `null` if the payload is
 * not *exactly* three fields -- the caller maps that to `501 5.5.2`, the same code a malformed
 * base64 envelope gets: a best-effort guess at which bytes are the username versus the password
 * would be exactly the kind of silent misinterpretation this project's parsers avoid elsewhere
 * (`parseBdatArguments`, `parseRcptToArguments`).
 */
export function decodeSaslPlain(payload: Buffer): DecodedSaslPlain | null {
	const parts: Buffer[] = [];
	let start = 0;
	for (let i = 0; i < payload.length; i++) {
		if (payload[i] === 0x00) {
			parts.push(payload.subarray(start, i));
			start = i + 1;
		}
	}
	parts.push(payload.subarray(start));
	if (parts.length !== 3) {
		return null;
	}
	return {
		authzid: parts[0]!.toString('utf8'),
		authcid: parts[1]!.toString('utf8'),
		password: parts[2]!.toString('utf8'),
	};
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

/**
 * What {@link EsmtpServer} needs from the source ACL to gate a connection at accept-time
 * (`JR-4-05a`, skill `journal-ledger` section 2 -- "Source IP not in ACL" ⇒ `554 5.7.1` at
 * connect). Implemented by `SourceAclCache` (`./source-acl-cache.ts`); the type lives here, next to
 * its consumer, the same layering `LedgerBackend`/`LedgerQuery` already use (defined next to the
 * port's consumer, not next to the concrete class that satisfies it) -- so this file never needs to
 * import anything from `./source-acl-cache.ts`.
 */
export interface SourceAclEvaluator {
	evaluate(remoteIp: string): SourceAclDecision;
}

/**
 * The three outcomes {@link SourceAclEvaluator.evaluate} can report:
 *
 *  - `'allowed'`: the connecting IP matched a configured, active source's `allowed_ips`. Carries
 *    that source's identity and `require_tls` so a caller can compose the tighten-only
 *    {@link RequireTlsResolver} contract without a second lookup.
 *  - `'denied'`: the ACL is known (a snapshot has been loaded recently enough) and the IP matched
 *    no source. `554 5.7.1` (a permanent rejection is correct here: the caller knows who this is
 *    and has decided they may never send, skill section 1's "local failure ⇒ 4xx" does not apply
 *    to "you are not on the list").
 *  - `'unavailable'`: the ACL is *not* known right now -- no snapshot has ever loaded successfully,
 *    or the last successful load is older than the configured staleness tolerance. This is a local
 *    failure, not a verdict about the connecting IP, so it must never become `554`
 *    (`421 4.3.2` instead) -- see `./source-acl-cache.ts`'s doc comment for the fail-closed
 *    reasoning ("ACL unknown" must not mean "admit everyone" either).
 */
export type SourceAclDecision =
	| {
			readonly kind: 'allowed';
			readonly sourceId: string;
			readonly chainScopeId: string;
			readonly requireTls: boolean;
	  }
	| { readonly kind: 'denied' }
	| { readonly kind: 'unavailable' };

/**
 * What {@link EsmtpServer} needs from the recipient ACL to gate each `RCPT TO` (`JR-4-05b`, skill
 * `journal-ledger` section 2 -- "Recipient not a configured journal address" ⇒ `550 5.1.1`).
 * Implemented by `SourceAclCache` (`./source-acl-cache.ts`) alongside {@link SourceAclEvaluator} --
 * see that file's doc comment for why this is the *same* cache and refresh cycle, not a second one.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this method is named `evaluateRecipient`, not `evaluate` (F46, `JR-4-20`)
 * ---------------------------------------------------------------------------------------------
 * It used to be named `evaluate`, identically to {@link SourceAclEvaluator.evaluate}. Because
 * {@link SourceAclDecision} and {@link RecipientAclDecision} are structurally the same shape
 * (`'allowed' | 'denied' | 'unavailable'`, TypeScript's structural typing let a single
 * `evaluate(remoteIp): SourceAclDecision` method on `SourceAclCache` satisfy *both* interfaces at
 * once -- the compiler never checked that the method meant to answer `RCPT TO` was the one that
 * actually ran. `SourceAclCache` already had a separate, correctly-behaving `evaluateRecipient()`
 * method; it just was never part of any interface, so nothing ever called it. Every real `RCPT TO`
 * silently ran through the connect-time IP matcher instead, which throws on an email address
 * (caught into `'unavailable'`) -- production answered `451` to every recipient, never `250` or
 * `550`. Giving this port its own method name closes the hole structurally: a type implementing
 * only {@link SourceAclEvaluator} (with `evaluate`, no `evaluateRecipient`) no longer satisfies
 * `RecipientAclEvaluator`, and vice versa -- see
 * `packages/journaling/tests/unit/acl-evaluator-port-shapes.test.ts` for the compiled proof that a
 * future re-collision of the two names does not compile.
 */
export interface RecipientAclEvaluator {
	evaluateRecipient(rcptToAddress: string): RecipientAclDecision;
}

/**
 * The three outcomes {@link RecipientAclEvaluator.evaluateRecipient} can report -- deliberately the
 * same shape as {@link SourceAclDecision}, and for the same reasons:
 *
 *  - `'allowed'`: `rcptToAddress` (after `./recipient-address.ts`'s comparison rules) matched an
 *    active source's `routing_address`. Carries that source's identity and `chainScopeId` (ADR-007)
 *    -- see the module doc comment's "Recipient ACL" section for why a caller needs this per
 *    recipient, not just a boolean.
 *  - `'denied'`: the ACL is known and the address matched no source. `550 5.1.1` -- a permanent
 *    rejection is correct here, the same reasoning `SourceAclDecision`'s `'denied'` case already
 *    documents: this is the sender's problem (the address does not exist), not a transient one.
 *  - `'unavailable'`: the ACL is not currently known (no snapshot ever loaded, or the last one is
 *    stale) -- a local failure, never `550` (`451 4.3.0` instead; skill section 1).
 */
export type RecipientAclDecision =
	| { readonly kind: 'allowed'; readonly sourceId: string; readonly chainScopeId: string }
	| { readonly kind: 'denied' }
	| { readonly kind: 'unavailable' };

/**
 * What {@link EsmtpServer} needs from the `AUTH` credential store (`JR-4-05c`). Implemented by
 * `SourceAclCache` (`./source-acl-cache.ts`), the same cache and refresh cycle
 * {@link SourceAclEvaluator}/{@link RecipientAclEvaluator} already use -- see that file's doc
 * comment for why this is deliberately not a fourth database connection.
 */
export interface AuthCredentialEvaluator {
	lookupCredential(username: string): AuthCredentialLookupResult;
}

/**
 * The three outcomes {@link AuthCredentialEvaluator.lookupCredential} can report -- deliberately the
 * same three-shape family as {@link SourceAclDecision}/{@link RecipientAclDecision}:
 *
 *  - `'found'`: `username` matched an active source's `smtp_username`. Carries that source's
 *    identity, `chainScopeId`, and the stored bcrypt hash for the caller to compare the supplied
 *    password against via {@link PasswordVerifier}.
 *  - `'not_found'`: the ACL is known and no active source's `smtp_username` matches -- covers both
 *    a genuinely unknown username and a real source that simply has no `AUTH` credentials
 *    configured (see `./source-acl-cache.ts`'s `lookupCredential` doc comment for why the two are
 *    not distinguished). Always a proven authentication failure (`535 5.7.8`), never a local one.
 *  - `'unavailable'`: the ACL is not currently known (no snapshot ever loaded, or the last one is
 *    stale) -- a local failure, never `535` (`454 4.7.0` instead; skill section 1).
 */
export type AuthCredentialLookupResult =
	| {
			readonly kind: 'found';
			readonly sourceId: string;
			readonly chainScopeId: string;
			readonly passwordHash: string;
	  }
	| { readonly kind: 'not_found' }
	| { readonly kind: 'unavailable' };

/**
 * Verify a plaintext password against a stored bcrypt hash (`JR-4-05c`). The only reason this port
 * exists at all: `packages/journaling` depends on nothing but `@open-archiver/types`/`zod`
 * (architecture section 2), so bcrypt itself cannot be imported here -- `apps/smtp-ingress` supplies
 * the real implementation over `bcryptjs`, the same library `packages/backend`'s `AuthService`
 * already uses. A test supplies a trivial fake instead (see `smtp-server.test.ts`/
 * `tests/unit/smtp-auth-protocol.test.ts`), so none of this file's own tests need a real bcrypt
 * comparison to run.
 */
export interface PasswordVerifier {
	compare(password: string, hash: string): Promise<boolean>;
}

/**
 * What {@link EsmtpServer} needs to durably accept a message (`JR-4-06a`, skill `journal-ledger`
 * sections 1-2). Implemented by `JournalAcceptance` (`../spool/acceptance.ts`) -- the real class
 * satisfies this structurally, without importing it here, the same "the type lives here, next to its
 * consumer" layering `SourceAclEvaluator`/`RecipientAclEvaluator`/`AuthCredentialEvaluator` already
 * use. A test can supply a trivial fake instead (see this file's own module doc comment's
 * "`JournalAcceptance.accept()` is wired in" section).
 */
export interface JournalAcceptancePort {
	accept(input: JournalTransactionInput): Promise<JournalAcceptanceResult>;
}

/** Everything {@link RequireTlsResolver} needs to decide (`JR-4-04`, extended by `JR-4-05`). */
export interface RequireTlsContext {
	readonly remoteIp: string | null;
	readonly ehloName: string | null;
	readonly rcptTo: readonly string[];
}

/**
 * Decide, per connection and per command, whether TLS is mandatory right now. Defaults to the
 * process-wide `tls.requireTls` configuration value (`EsmtpServerOptions.tls`), ignoring `context`
 * entirely -- `JR-4-05` is what gives this a reason to look at `context` at all, once source lookup
 * by IP or recipient exists.
 *
 * **The contract a `JR-4-05` override must keep: tighten, never loosen.** The process-wide default
 * is a floor a per-source answer can never fall beneath; a source's `require_tls = true` may raise
 * it, a source's `require_tls = false` must never lower it. Concretely, a correct override composes
 * with the process default (`(ctx) => processDefault || sourceRequireTls(ctx)`), never replaces it
 * (`(ctx) => sourceRequireTls(ctx)` alone would let a source with `require_tls = false` reopen a
 * plaintext path the operator deliberately closed process-wide).
 */
export type RequireTlsResolver = (context: RequireTlsContext) => boolean;

type SessionState = 'initial' | 'ready' | 'mail' | 'rcpt' | 'bdat' | 'data';
type TimeoutKind = 'connection' | 'command' | 'data';

/** One accepted TCP connection's protocol state machine. Not exported -- `EsmtpServer` is the
 * public surface; a connection only exists for as long as the socket does. */
class SmtpConnection {
	private state: SessionState = 'initial';
	private ehloName: string | null = null;
	private mailFrom: string | null = null;
	private rcptTo: string[] = [];
	/** Recipients the recipient ACL has matched so far this transaction (`JR-4-05b`), each tagged
	 * with the source and `chainScopeId` (ADR-007) it resolved to. This is the handover point
	 * `JR-4-06` reads from when it wires `completeTransfer()` into `JournalAcceptance.accept()` --
	 * the same role `tlsVersion`/`tlsCipher` already play for TLS, see the module doc comment's "TLS
	 * / STARTTLS" section. Cleared by {@link resetEnvelope} same as `rcptTo`. */
	private matchedRecipients: { address: string; sourceId: string; chainScopeId: string }[] = [];
	/** Distinct `chainScopeId`s matched so far this transaction -- a `Set` specifically so a
	 * duplicate recipient, or a second recipient of the *same* source, never re-triggers the
	 * cross-chain warning in {@link recordMatchedRecipient}: both add no new element. */
	private matchedChainScopeIds: Set<string> = new Set();
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
	/** `true` from the moment {@link onTlsHandshakeComplete} fires -- never set anywhere else, and
	 * never cleared once set: a session does not downgrade. */
	private tlsActive = false;
	/** The negotiated protocol version (e.g. `'TLSv1.3'`), read from the real
	 * {@link tls.TLSSocket} in {@link onTlsHandshakeComplete}. `null` until then. This is the value
	 * `JR-4-06` reads for `JournalTransactionInput.tlsVersion` -- see the module doc comment's
	 * "TLS / STARTTLS" section. */
	private tlsVersion: string | null = null;
	/** The negotiated cipher suite name (e.g. `'TLS_AES_256_GCM_SHA384'`), same source and same
	 * consumer as {@link tlsVersion}. */
	private tlsCipher: string | null = null;
	/** `null` until a successful `AUTH` (`JR-4-05c`); the authenticated source's identity from then
	 * on. **Not** cleared by {@link resetEnvelope} -- see the module doc comment's "AUTH" section,
	 * point 3: authentication persists for the whole connection, across `EHLO`/`RSET`, exactly what
	 * makes "a second AUTH is 503" (RFC 4954 section 4) a meaningful check at all. */
	private authenticatedSourceId: string | null = null;
	/** The authenticated source's `chainScopeId`, same lifetime as {@link authenticatedSourceId}. Not
	 * read by anything in this task -- `JR-4-06` is the eventual consumer, the same "value sits ready
	 * at the handover point" pattern `tlsVersion`/`tlsCipher` already follow. */
	private authenticatedChainScopeId: string | null = null;
	/** Failed `AUTH` attempts so far this connection (`JR-4-05c`) -- never reset except by a
	 * *successful* `AUTH` (see {@link verifyCredentials}). Compared against
	 * {@link MAX_AUTH_ATTEMPTS_PER_CONNECTION} in {@link rejectAuthAttempt}. */
	private authFailureCount = 0;
	/** Set while a `LOGIN` dialogue has sent the username prompt and is waiting for the client's
	 * base64-encoded username response; cleared once that response has been read (whether it
	 * decodes successfully or not). `null` at every other time, including while `PLAIN`'s single
	 * continuation is pending -- that path never needs to remember a partial credential. */
	private authLoginUsername: string | null = null;
	/**
	 * Redirects the *next* CRLF-terminated line {@link drainCommandCarry} reads to an `AUTH`
	 * continuation handler instead of {@link processCommandLine} -- a SASL continuation response is
	 * not an SMTP command and must never be parsed as one (unlike `DATA`/`BDAT`'s raw-byte phases,
	 * which need their own byte-counting state, a continuation response is just an ordinary line, so
	 * this reuses the same line-splitting loop rather than adding a second one). Set by
	 * {@link startAuthPlain}/{@link startAuthLogin}/{@link continueAuthLoginUsername}, consumed
	 * (read and cleared) exactly once by {@link drainCommandCarry}.
	 */
	private authContinuation: ((line: string) => void) | null = null;
	/**
	 * `true` while {@link verifyCredentials}'s bcrypt comparison is in flight -- the one place this
	 * connection does asynchronous work mid-command. {@link drainCommandCarry} stops pulling further
	 * lines out of `commandCarry` while this is `true` (any bytes a pipelining client already sent
	 * stay buffered) so a second command can never be processed, and its reply written, ahead of the
	 * `AUTH` verdict still being computed. Reset in {@link verifyCredentials}'s `finally`, which then
	 * resumes {@link drainCommandCarry} itself so nothing buffered during verification is stranded.
	 */
	private commandProcessingSuspended = false;
	/**
	 * Non-`null` for the whole time an `accept()` call is in flight for the current transaction --
	 * from {@link tryBeginAcceptance} (the first `DATA`/`BDAT` of the transaction) until
	 * {@link finalizeAcceptance} or {@link abandonInFlightAcceptance} clears it. `null` at every other
	 * time, including whenever `journalAcceptance` is not configured at all (`JR-4-06a`).
	 */
	private acceptPromise: Promise<JournalAcceptanceResult> | null = null;
	/** The bridge feeding `acceptPromise`'s `chunks` -- see {@link SpoolWriteBridge}'s own doc
	 * comment. Same lifetime as {@link acceptPromise}. */
	private spoolBridge: SpoolWriteBridge | null = null;

	constructor(
		private socket: net.Socket,
		private readonly smtp: SmtpServerConfig,
		private readonly logger: IngressLogger,
		/** `null` when this deployment has no certificate/key configured -- `STARTTLS` is then
		 * never advertised and the bare command is answered `454 4.7.0` (see
		 * {@link handleStarttlsCommand}). Built once per {@link EsmtpServer}, not per connection --
		 * `tls.createSecureContext()` parses the certificate, and there is no reason to repeat that
		 * for every accepted socket. */
		private readonly tlsSecureContext: tls.SecureContext | null,
		private readonly requireTlsResolver: RequireTlsResolver,
		/** `undefined` disables the recipient ACL entirely -- every syntactically valid recipient is
		 * accepted, exactly this class's behaviour before `JR-4-05b` (the same convention
		 * `tlsSecureContext`/`sourceAclEvaluator` already established, so every pre-existing test that
		 * does not care about the recipient ACL keeps constructing a bare `EsmtpServer`). Production
		 * always supplies a `SourceAclCache`. */
		private readonly recipientAclEvaluator: RecipientAclEvaluator | undefined,
		/** `undefined` disables `AUTH` entirely -- the verb is never advertised (see
		 * {@link buildEhloResponseLines}'s `authAvailable` argument) and a bare `AUTH` command falls
		 * through to the ordinary "not recognised" `500`, the same convention every other optional
		 * evaluator in this constructor already established. Production always supplies the same
		 * `SourceAclCache` instance passed as `recipientAclEvaluator` (`JR-4-05c`, one refresh cycle
		 * serving a third ACL). */
		private readonly authCredentialEvaluator: AuthCredentialEvaluator | undefined,
		/** `undefined` alongside `authCredentialEvaluator` -- both are set together in production
		 * (`apps/smtp-ingress`'s `createBcryptPasswordVerifier()`) or both left `undefined` to
		 * disable `AUTH`. See {@link PasswordVerifier}'s doc comment for why this is a separate
		 * injected port rather than a dependency of this package. */
		private readonly passwordVerifier: PasswordVerifier | undefined,
		/** `undefined` (the default) preserves the exact pre-`JR-4-06a` behaviour: end of `DATA`/
		 * `BDAT ... LAST` always answers `451 4.3.0`, the same convention every other optional
		 * dependency in this constructor already established -- see this file's module doc comment,
		 * "`JournalAcceptance.accept()` is wired in", for why that convention is what keeps every
		 * earlier task's protocol tests passing unchanged. Production always supplies a real
		 * `JournalAcceptance` once a ledger database is configured (`apps/smtp-ingress/src/index.ts`). */
		private readonly journalAcceptance: JournalAcceptancePort | undefined
	) {
		// Connection-level backstop, independent of protocol state: Node re-arms this internally on
		// any read *or* write activity on the socket, so it fires only on genuine idleness --
		// deliberately given no manual reset code here, unlike the command/data timers below, which
		// are this project's own timers over and above Node's. Left attached to the underlying raw
		// socket for the connection's whole lifetime, including across a STARTTLS upgrade: `.setTimeout()`
		// registers on the transport-level socket object, which `beginTlsUpgrade()` continues to be the
		// same object underneath the wrapping `tls.TLSSocket` -- see that method's doc comment.
		this.socket.setTimeout(this.smtp.connectionTimeoutMs, () => this.onTimeout('connection'));

		this.attachSocketHandlers(this.socket);

		this.writePlain(220, `${this.smtp.hostname} ESMTP ready`);
		this.armCommandTimer();
	}

	/** `data`/`close`/`error` handlers, bound to whichever socket object is currently `this.socket`
	 * -- the plain one at construction time, the wrapping {@link tls.TLSSocket} after
	 * {@link beginTlsUpgrade}. Extracted so both call sites attach the exact same three handlers
	 * rather than risking the two copies drifting apart. */
	private attachSocketHandlers(socket: net.Socket): void {
		socket.on('data', (chunk: Buffer) => this.onData(chunk));
		socket.on('close', () => this.disarmProtocolTimer());
		socket.on('error', (err) => {
			this.logger.warn(
				{ err, remoteAddress: socket.remoteAddress },
				'smtp-ingress: socket error'
			);
		});
	}

	private onData(chunk: Buffer): void {
		if (this.commandProcessingSuspended) {
			// `JR-4-06a`: an `accept()` call is settling (see {@link runCompleteTransfer}) or a bcrypt
			// comparison is in flight (`JR-4-05c`). `state`/`bdatChunkRemaining` may still describe the
			// transaction that is *finishing*, not the one these bytes actually belong to -- e.g. `state`
			// is still `'data'` until {@link resetEnvelope} runs, which only happens after `accept()`
			// settles. Routing on stale state here would let bytes belonging to whatever comes next be
			// mis-read against it. Parked in `commandCarry` regardless of what they are; `drainCommandCarry()`
			// (called once processing resumes, from the same place `verifyCredentials` already resumes it
			// for its own asynchronous step) re-interprets them once state is current again.
			this.commandCarry = Buffer.concat([this.commandCarry, chunk]);
			return;
		}
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
			if (this.socket.destroyed || this.commandProcessingSuspended) {
				// `commandProcessingSuspended` (`JR-4-05c`): a bcrypt comparison is in flight for the
				// line just read -- see that field's doc comment. Any further bytes already sitting in
				// `commandCarry` stay put; `verifyCredentials`'s `finally` re-enters this loop once the
				// comparison resolves.
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
			if (this.authContinuation) {
				// A pending SASL continuation response (`JR-4-05c`) -- not an SMTP command, see
				// `authContinuation`'s own doc comment for why this line-splitting loop is reused rather
				// than parsing it through `processCommandLine`.
				const continuation = this.authContinuation;
				this.authContinuation = null;
				continuation(lineBuf.toString('utf8'));
			} else {
				this.processCommandLine(lineBuf.toString('utf8'));
			}
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

		// `JR-4-04`, RFC 3207 section 4: "...SHOULD return the reply code: 530 Must issue a STARTTLS
		// command first ... to every command other than NOOP, EHLO, STARTTLS, or QUIT". `HELO` is
		// grouped with `EHLO` (the Product Owner's instruction: a client that cannot even see
		// `STARTTLS` advertised under a plain `HELO` reply must still be able to attempt it blindly),
		// and `RSET` is deliberately gated -- the RFC's exempt list does not include it, and nothing
		// about resetting the envelope requires plaintext. `AUTH` is included too, but only fires this
		// gate when `require_tls` is configured `true` (`isTlsMandated()`) -- `handleAuthCommand`'s own
		// `538 5.7.11` check (module doc comment, "AUTH" section point 1) is what makes AUTH-over-
		// plaintext impossible unconditionally, independent of that configuration. Checked once, before
		// the switch, so it applies uniformly and cannot be bypassed by whatever envelope state a
		// handler would otherwise accept.
		if (!this.tlsActive && TLS_MANDATED_VERBS.has(verb) && this.isTlsMandated()) {
			this.writeResponse(530, '5.7.0', 'Must issue a STARTTLS command first');
			this.armCommandTimer();
			return;
		}

		switch (verb) {
			case 'EHLO':
				this.ehloName = rest.trim() || null;
				this.resetEnvelope();
				this.state = 'ready';
				this.socket.write(
					formatMultilineResponse(
						250,
						buildEhloResponseLines(
							this.smtp.hostname,
							this.smtp.sizeLimitBytes,
							{
								available: this.tlsSecureContext !== null,
								active: this.tlsActive,
							},
							this.authCredentialEvaluator !== undefined
						)
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
			case 'STARTTLS':
				this.handleStarttlsCommand(rest);
				return;
			case 'AUTH':
				this.handleAuthCommand(rest);
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

	/** Whether {@link requireTlsResolver} says TLS is mandatory for this connection right now. Reads
	 * `remoteAddress` fresh from whichever socket object is currently `this.socket`, so it reflects
	 * reality even if that ever differs from the address the connection was accepted on. */
	private isTlsMandated(): boolean {
		return this.requireTlsResolver({
			remoteIp: this.socket.remoteAddress ?? null,
			ehloName: this.ehloName,
			rcptTo: this.rcptTo,
		});
	}

	/**
	 * `STARTTLS` (RFC 3207 section 4). Three rejections before the upgrade is even attempted, then
	 * the upgrade itself -- see the module doc comment's "TLS / STARTTLS" section for the full
	 * rationale, in particular point 3 (discarding whatever the client sent immediately after
	 * `STARTTLS\r\n`, before this method ever runs its own logic on it).
	 */
	private handleStarttlsCommand(rest: string): void {
		if (this.tlsActive) {
			// RFC 3207 section 4: a client MUST NOT attempt STARTTLS a second time.
			this.writeResponse(503, '5.5.1', 'Already using TLS');
			this.armCommandTimer();
			return;
		}
		if (this.tlsSecureContext === null) {
			// Reachable only if a client sends STARTTLS unprompted -- EHLO never advertised it (see
			// buildEhloResponseLines). 454 4.7.0 ("TLS not available due to temporary reason") is what
			// Postfix and Exim answer for the same case; RFC 3207 defines no dedicated code for it.
			this.writeResponse(454, '4.7.0', 'TLS not available due to temporary reason');
			this.armCommandTimer();
			return;
		}
		if (rest.trim().length > 0) {
			// RFC 3207 section 4: "the STARTTLS command ... has no parameters" -- the same syntax-error
			// bucket every other verb's malformed-argument case in this file already uses.
			this.writeResponse(501, '5.5.4', 'Syntax error (no parameters allowed)');
			this.armCommandTimer();
			return;
		}

		// Point 3 of the module doc comment's "TLS / STARTTLS" section: anything the client already
		// sent in the same TCP segment as "STARTTLS\r\n" is discarded here, unconditionally, before the
		// 220 reply and the handshake begin -- never executed as a command now, and never fed into the
		// TLS engine or read as a command once the handshake completes. RFC 2920 forbids a client from
		// pipelining anything after STARTTLS for exactly this reason (it cannot know in advance whether
		// the handshake will succeed); bytes here anyway are either a non-conformant client or an
		// on-path attacker smuggling plaintext ahead of the encrypted session.
		if (this.commandCarry.length > 0) {
			this.logger.warn(
				{
					remoteAddress: this.socket.remoteAddress,
					discardedByteLength: this.commandCarry.length,
				},
				'smtp-ingress: discarding bytes pipelined immediately after STARTTLS (forbidden by RFC 2920; treated as a possible injection attempt)'
			);
			this.commandCarry = Buffer.alloc(0);
		}

		this.writeResponse(220, '2.0.0', 'Ready to start TLS');
		this.beginTlsUpgrade();
	}

	/**
	 * Upgrade the connection to TLS in place. Detaches completely from the plain socket's own events
	 * first -- from this point on every byte on the wire is either TLS handshake traffic or
	 * ciphertext, neither of which this class may read directly -- then wraps it in a
	 * {@link tls.TLSSocket} and re-attaches the same three handlers {@link attachSocketHandlers}
	 * already gave the plain socket, this time to the secure one. `this.socket` is reassigned so every
	 * later `write()`/`remoteAddress`/`destroyed` access transparently goes through the secure layer;
	 * the connection-level idle timeout from the constructor is untouched (see that field's comment)
	 * because it was registered on the same underlying transport this still wraps.
	 */
	private beginTlsUpgrade(): void {
		const plainSocket = this.socket;
		this.disarmProtocolTimer();
		plainSocket.removeAllListeners('data');
		plainSocket.removeAllListeners('close');
		plainSocket.removeAllListeners('error');

		const secureSocket = new tls.TLSSocket(
			plainSocket,
			buildTlsSocketOptions(this.tlsSecureContext!)
		);
		this.attachSocketHandlers(secureSocket);
		secureSocket.once('secure', () => this.onTlsHandshakeComplete(secureSocket));

		this.socket = secureSocket;
	}

	/**
	 * RFC 3207 section 4.2: "Upon completion of the TLS handshake, the SMTP protocol is reset to the
	 * initial state (the state in SMTP after a server issues a 220 service ready greeting)." Discards
	 * the `EHLO` name and the whole envelope the same way every other envelope-clearing command
	 * already does ({@link resetEnvelope}), and returns `state` to `'initial'` rather than `'ready'` --
	 * a client is required to re-issue `EHLO`/`HELO` before anything else. This is the companion half
	 * of {@link handleStarttlsCommand}'s point 3: that discards what the client sent but the server
	 * never acted on; this discards what the server had already learned before the handshake.
	 *
	 * Reads the negotiated version and cipher from the real, now-secure socket -- never from
	 * configuration -- and stores them on the connection for `JR-4-06` to read out of
	 * {@link completeTransfer}'s handover point. See the module doc comment's "TLS / STARTTLS" section.
	 */
	private onTlsHandshakeComplete(secureSocket: tls.TLSSocket): void {
		this.tlsActive = true;
		this.tlsVersion = secureSocket.getProtocol();
		this.tlsCipher = secureSocket.getCipher()?.name ?? null;

		this.ehloName = null;
		this.resetEnvelope();
		this.state = 'initial';

		this.logger.info(
			{
				remoteAddress: secureSocket.remoteAddress,
				tlsVersion: this.tlsVersion,
				tlsCipher: this.tlsCipher,
			},
			'smtp-ingress: TLS handshake complete, session reset'
		);
		this.armCommandTimer();
	}

	/**
	 * `AUTH <mechanism> [initial-response]` (RFC 4954 section 4, `JR-4-05c`). See the module doc
	 * comment's "AUTH" section for the full design; this method is the entry gate -- every rejection
	 * that does not depend on which mechanism was requested lives here, in the order the RFC and the
	 * skill's response table both put local/structural failures ahead of anything mechanism-specific.
	 */
	private handleAuthCommand(rest: string): void {
		if (this.authCredentialEvaluator === undefined || this.passwordVerifier === undefined) {
			// AUTH is not configured for this deployment at all -- never advertised in EHLO either
			// (see buildEhloResponseLines's authAvailable argument), so a client that attempts it
			// unprompted gets exactly what an actually-unrecognised verb gets.
			this.writeResponse(500, '5.5.1', 'Command not recognized');
			this.armCommandTimer();
			return;
		}
		if (this.authenticatedSourceId !== null) {
			// RFC 4954 section 4: a client MUST NOT attempt AUTH a second time once authenticated.
			this.writeResponse(503, '5.5.1', 'Already authenticated');
			this.armCommandTimer();
			return;
		}
		if (this.mailFrom !== null) {
			// RFC 4954 section 4: AUTH is not permitted once a mail transaction is in progress.
			this.writeResponse(503, '5.5.1', 'Bad sequence of commands');
			this.armCommandTimer();
			return;
		}
		if (!this.tlsActive) {
			// Unconditional -- independent of `require_tls`/`requireTlsResolver` (see the module doc
			// comment's "AUTH" section, point 1, and TLS_MANDATED_VERBS's updated comment for how this
			// differs from the pre-existing 530 gate). RFC 4954 section 4's dedicated code for exactly
			// this condition.
			this.writeResponse(
				538,
				'5.7.11',
				'Encryption required for requested authentication mechanism'
			);
			this.armCommandTimer();
			return;
		}
		const parsed = parseAuthArguments(rest);
		if (!parsed) {
			this.writeResponse(501, '5.5.4', 'Syntax error in AUTH command');
			this.armCommandTimer();
			return;
		}
		if (parsed.mechanism === 'PLAIN') {
			this.startAuthPlain(parsed.initialResponse);
			return;
		}
		if (parsed.mechanism === 'LOGIN') {
			this.startAuthLogin(parsed.initialResponse);
			return;
		}
		// RFC 4954 section 5's own example uses this exact wording for an unsupported mechanism.
		this.writeResponse(504, '5.5.4', 'Unrecognized authentication type');
		this.armCommandTimer();
	}

	/** `AUTH PLAIN` (RFC 4616 payload, RFC 4954 framing). Two forms, both handled here: the
	 * initial-response form (`initialResponse` non-`null`, decoded immediately) and the
	 * empty-challenge form (`null`: a `334` continuation is sent and the next line is the whole
	 * SASL-PLAIN blob, read back through {@link authContinuation}). */
	private startAuthPlain(initialResponse: string | null): void {
		if (initialResponse === null) {
			this.authContinuation = (line) => this.continueAuthPlain(line);
			this.writeContinuation('');
			this.armCommandTimer();
			return;
		}
		this.continueAuthPlain(initialResponse);
	}

	private continueAuthPlain(responseText: string): void {
		if (responseText.trim() === '*') {
			// RFC 4954 section 4: the client may cancel by sending a lone "*"; the server MUST reject
			// the AUTH command with 501. No enhanced code is given in the RFC text itself -- 5.7.0 is
			// the wording Postfix/Exim use for this exact case, the same "well-known real-world
			// precedent, cited" posture handleStarttlsCommand's 454 4.7.0 already follows.
			this.rejectAuthAttempt(501, '5.7.0', 'Authentication cancelled');
			return;
		}
		const decoded = decodeSaslBase64(responseText);
		if (decoded === null) {
			this.rejectAuthAttempt(501, '5.5.2', 'Cannot Base64-decode response');
			return;
		}
		const plain = decodeSaslPlain(decoded);
		if (plain === null) {
			this.rejectAuthAttempt(501, '5.5.2', 'Cannot Base64-decode response');
			return;
		}
		this.verifyCredentials(plain.authcid, plain.password);
	}

	/** `AUTH LOGIN` -- the de facto two-step `334`-prompted dialogue (not itself defined by RFC 4954,
	 * which only standardises the `AUTH` framing and `PLAIN`; `LOGIN` is the near-universal
	 * convention every major mail client and server also implements). An `initialResponse` is
	 * accepted too (some real clients send `AUTH LOGIN <base64-username>`), skipping straight to the
	 * password prompt. */
	private startAuthLogin(initialResponse: string | null): void {
		if (initialResponse !== null) {
			this.continueAuthLoginUsername(initialResponse);
			return;
		}
		this.authContinuation = (line) => this.continueAuthLoginUsername(line);
		this.writeContinuation(Buffer.from('Username:', 'utf8').toString('base64'));
		this.armCommandTimer();
	}

	private continueAuthLoginUsername(responseText: string): void {
		if (responseText.trim() === '*') {
			this.rejectAuthAttempt(501, '5.7.0', 'Authentication cancelled');
			return;
		}
		const decoded = decodeSaslBase64(responseText);
		if (decoded === null) {
			this.rejectAuthAttempt(501, '5.5.2', 'Cannot Base64-decode response');
			return;
		}
		this.authLoginUsername = decoded.toString('utf8');
		this.authContinuation = (line) => this.continueAuthLoginPassword(line);
		this.writeContinuation(Buffer.from('Password:', 'utf8').toString('base64'));
		this.armCommandTimer();
	}

	private continueAuthLoginPassword(responseText: string): void {
		const username = this.authLoginUsername;
		this.authLoginUsername = null;
		if (responseText.trim() === '*') {
			this.rejectAuthAttempt(501, '5.7.0', 'Authentication cancelled');
			return;
		}
		const decoded = decodeSaslBase64(responseText);
		if (decoded === null) {
			this.rejectAuthAttempt(501, '5.5.2', 'Cannot Base64-decode response');
			return;
		}
		this.verifyCredentials(username ?? '', decoded.toString('utf8'));
	}

	/**
	 * The credential check both mechanisms converge on. Looks up `username` synchronously (the
	 * cache, like every other ACL lookup in this file), then runs the actual bcrypt comparison
	 * through {@link passwordVerifier} -- the one asynchronous step in this connection's whole
	 * command path, guarded by {@link commandProcessingSuspended} (see that field's doc comment).
	 *
	 * **Timing and information disclosure** (module doc comment "AUTH" section, point 5): when
	 * `lookup.kind === 'not_found'`, the comparison still runs, against
	 * {@link AUTH_DUMMY_PASSWORD_HASH} instead of a real hash, and its result is unconditionally
	 * discarded -- `matches` is only ever consulted when `lookup.kind === 'found'`. Skipping the
	 * bcrypt call for an unknown username would make the *absence* of that call itself a timing
	 * oracle; running it against a fixed dummy hash keeps the wall-clock cost indistinguishable from
	 * a real, wrong-password comparison. Both failure classes converge on the exact same `535 5.7.8`,
	 * with no wording that could tell a caller which one occurred.
	 */
	private verifyCredentials(username: string, password: string): void {
		const lookup = this.authCredentialEvaluator!.lookupCredential(username);
		if (lookup.kind === 'unavailable') {
			// The cache is not currently known -- a local failure (skill section 1), never 535.
			this.writeResponse(454, '4.7.0', 'Temporary authentication failure');
			this.armCommandTimer();
			return;
		}
		this.commandProcessingSuspended = true;
		const hashToCompare =
			lookup.kind === 'found' ? lookup.passwordHash : AUTH_DUMMY_PASSWORD_HASH;
		this.passwordVerifier!.compare(password, hashToCompare)
			.then(
				(matches) => {
					if (lookup.kind === 'found' && matches) {
						this.authenticatedSourceId = lookup.sourceId;
						this.authenticatedChainScopeId = lookup.chainScopeId;
						this.authFailureCount = 0;
						this.writeResponse(235, '2.7.0', 'Authentication successful');
						this.armCommandTimer();
					} else {
						// `lookup.kind === 'not_found'` always lands here regardless of `matches` -- see
						// this method's own doc comment.
						this.rejectAuthAttempt(535, '5.7.8', 'Authentication credentials invalid');
					}
				},
				(err: unknown) => {
					// The verifier itself failed (e.g. a corrupt stored hash) -- a local/environment
					// problem, not a proven-wrong credential: it does not count against
					// MAX_AUTH_ATTEMPTS_PER_CONNECTION and gets skill section 1's "never a 5xx for a
					// local failure" code, not 535.
					this.logger.error(
						{ err },
						'smtp-ingress: password verifier failed during AUTH'
					);
					this.writeResponse(454, '4.7.0', 'Temporary authentication failure');
					this.armCommandTimer();
				}
			)
			.finally(() => {
				this.commandProcessingSuspended = false;
				if (!this.socket.destroyed) {
					this.drainCommandCarry();
				}
			});
	}

	/**
	 * Common failure path for every rejected `AUTH` attempt except an unrecognised mechanism (`504`
	 * is a different rejection class, handled directly in {@link handleAuthCommand} without counting
	 * against the limit -- naming a mechanism this server never implements is not a credential
	 * guess). Counts the failure against {@link MAX_AUTH_ATTEMPTS_PER_CONNECTION}; once exceeded, this
	 * attempt's own response code is replaced with `421` and the connection is closed instead -- see
	 * that constant's doc comment for the chosen number and why `421`, never a `5xx`.
	 */
	private rejectAuthAttempt(code: number, enhancedCode: string, message: string): void {
		this.authFailureCount += 1;
		this.authLoginUsername = null;
		this.authContinuation = null;
		if (this.authFailureCount > MAX_AUTH_ATTEMPTS_PER_CONNECTION) {
			this.writeResponse(
				421,
				'4.7.0',
				`${this.smtp.hostname} Error: too many authentication failures`
			);
			this.disarmProtocolTimer();
			this.socket.end();
			// Mirrors onTimeout's forced close: a peer that stopped reading may never acknowledge the
			// FIN.
			const forceClose = setTimeout(() => {
				if (!this.socket.destroyed) {
					this.socket.destroy();
				}
			}, 1_000);
			forceClose.unref();
			return;
		}
		this.writeResponse(code, enhancedCode, message);
		this.armCommandTimer();
	}

	/** `334 <base64>` continuation prompt (RFC 4954's `continue-req` grammar). Never carries an
	 * enhanced status code -- the same rule {@link formatMultilineResponse}'s doc comment already
	 * states for `EHLO` extension lines. */
	private writeContinuation(base64Text: string): void {
		if (!this.socket.destroyed) {
			this.socket.write(`334 ${base64Text}\r\n`);
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

		if (this.recipientAclEvaluator) {
			const decision = this.recipientAclEvaluator.evaluateRecipient(parsed.address);
			if (decision.kind === 'denied') {
				// JR-4-05b, skill section 2: an address that matches no active source's
				// routing_address is the sender's problem, not a transient one -- 550, never a 4xx.
				this.writeResponse(550, '5.1.1', 'Recipient address rejected: user unknown');
				this.armCommandTimer();
				return;
			}
			if (decision.kind === 'unavailable') {
				// The recipient ACL is not currently known -- a local failure, not a verdict about
				// this address (skill section 1: never a 5xx for a local problem). Unlike the
				// connect-time gate (421, closes the whole connection because nothing at all can be
				// decided yet), this keeps the session open: RCPT is a per-command reply, and the
				// client may retry it or the sending MTA may requeue just this recipient.
				this.writeResponse(
					451,
					'4.3.0',
					'Requested action aborted: local error in processing'
				);
				this.armCommandTimer();
				return;
			}
			// `JR-4-05c`, module doc comment "AUTH" section point 2: an authenticated source
			// addressing a *different* source's routing_address. The recipient ACL matched a real,
			// configured address (so this is not "no such user", `5.1.1`) -- but this authenticated
			// session's own credentials say nothing about that source's chain, so delivering into it
			// would let one authenticated identity write into another's archive. `550 5.7.1`
			// ("delivery not authorized") is a permanent rejection, correct here the same way every
			// other `'denied'`-shaped case in this file is: this is the sender's own doing (it chose
			// to authenticate as one source and address another's recipient), not a transient
			// condition. Recipients of the authenticated source's *own* chain are unaffected -- only a
			// mismatch is rejected, never every RCPT on an authenticated connection.
			if (
				this.authenticatedSourceId !== null &&
				decision.sourceId !== this.authenticatedSourceId
			) {
				this.writeResponse(
					550,
					'5.7.1',
					'Recipient address rejected: not authorized for this authenticated session'
				);
				this.armCommandTimer();
				return;
			}
			// ADR-027 (docs/dev/journaling/05-entscheidungen.md), JR-4-17: a second, or later, RCPT TO
			// that would add a *different* chainScopeId to the one(s) already matched in this
			// transaction. One SMTP transaction produces one receipt in exactly one chain (ADR-007,
			// skill journal-ledger section 5) -- JR-4-05b's recordMatchedRecipient only ever logged
			// this case; ADR-027 is the decision. Rejected with 452 4.5.3 ("too many recipients"),
			// deliberately not 550: sending MTAs already implement recipient-limit splitting for
			// exactly this enhanced code and resend the rejected recipient in a transaction of its
			// own, where it is unambiguous again -- a 550 would be permanent and would silently lose
			// the second chain instead of merely delaying it into a visible NDR (see the ADR's
			// "Restrisiko" section). This check must run after every other RCPT verdict above (unknown
			// recipient, ACL unavailable, authenticated-source mismatch) so those keep their own, more
			// specific codes, and it must run *before* recordMatchedRecipient so a rejected recipient
			// never enters `rcptTo`/`matchedRecipients`/`matchedChainScopeIds` -- the transaction stays
			// assigned to exactly one chain even after a rejection (asserted in this file's tests).
			if (
				this.matchedChainScopeIds.size > 0 &&
				!this.matchedChainScopeIds.has(decision.chainScopeId)
			) {
				this.logger.error(
					{
						remoteAddress: this.socket.remoteAddress,
						rejectedAddress: parsed.address,
						rejectedSourceId: decision.sourceId,
						rejectedChainScopeId: decision.chainScopeId,
						matchedRecipients: this.matchedRecipients.map((r) => ({ ...r })),
					},
					'smtp-ingress: rejecting RCPT TO with 452 4.5.3 -- this transaction already ' +
						'matched a different journal chain (ADR-027: a transaction stays assigned to ' +
						'exactly one chain; the sending MTA is expected to resend this recipient in its ' +
						'own transaction)'
				);
				this.writeResponse(
					452,
					'4.5.3',
					'Too many recipients: recipient belongs to a different journal chain than a ' +
						'previously accepted recipient in this transaction'
				);
				this.armCommandTimer();
				return;
			}
			this.recordMatchedRecipient(parsed.address, decision.sourceId, decision.chainScopeId);
		}
		// No recipientAclEvaluator configured: every syntactically valid recipient is accepted --
		// pre-JR-4-05b behaviour, unchanged (see the constructor parameter's doc comment).
		this.rcptTo.push(parsed.address);
		this.state = 'rcpt';
		this.writeResponse(250, '2.1.5', 'Ok');
		this.armCommandTimer();
	}

	/**
	 * Record one recipient the recipient ACL matched to a source/chain. By the time this runs,
	 * `handleRcpt`'s `ADR-027` guard has already rejected -- with `452 4.5.3`, before reaching here --
	 * any recipient that would add a *second*, distinct `chainScopeId` to this transaction, so every
	 * call here only ever adds the transaction's first chain or repeats one already matched (the same
	 * recipient again, or another recipient of the same source). `matchedChainScopeIds` stays a `Set`
	 * for exactly that reason: it is the source of truth `handleRcpt` reads to tell "this
	 * transaction's chain" from "a different chain", not just a bookkeeping detail.
	 *
	 * `JR-4-06` reads `matchedRecipients` when it wires `completeTransfer()` into
	 * `JournalAcceptance.accept()`.
	 */
	private recordMatchedRecipient(address: string, sourceId: string, chainScopeId: string): void {
		this.matchedChainScopeIds.add(chainScopeId);
		this.matchedRecipients.push({ address, sourceId, chainScopeId });
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
		// `JR-4-06a`: start `accept()` now, before `354` -- the envelope is already frozen (no further
		// `MAIL`/`RCPT` is reachable once `state` leaves `'rcpt'`). A failed assertion here (see
		// `tryBeginAcceptance`'s doc comment) means this transaction must never be told to send a body
		// at all, so `354`/`state = 'data'` are skipped entirely on that path.
		if (this.journalAcceptance && !this.tryBeginAcceptance()) {
			return;
		}
		this.writePlain(354, 'Start mail input; end with <CRLF>.<CRLF>');
		this.state = 'data';
		this.dataScanner = new DataScanner(
			this.smtp.sizeLimitBytes,
			this.journalAcceptance ? (chunk) => this.spoolBridge!.push(chunk) : undefined
		);
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
	 * End of `DATA`. Delegates the actual response/reset logic to {@link completeTransfer} via
	 * {@link runCompleteTransfer} -- see that method's doc comment for why the call is fired off
	 * rather than awaited here, and {@link finalizeAcceptance} for what the response actually is now
	 * that `JR-4-06a` has wired `accept()` in.
	 */
	private finishData(oversize: boolean): void {
		this.disarmProtocolTimer();
		this.runCompleteTransfer(oversize, this.dataScanner?.contentByteLength ?? 0, 'DATA');
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
			// `JR-4-06a`: the first `BDAT` of a transaction is the `BDAT` equivalent of `DATA`'s own
			// `tryBeginAcceptance()` call site above -- same reasoning, same envelope-frozen guarantee.
			if (this.journalAcceptance && !this.tryBeginAcceptance()) {
				return;
			}
			this.bdatTracker = new BdatContentTracker(
				this.smtp.sizeLimitBytes,
				this.journalAcceptance ? (chunk) => this.spoolBridge!.push(chunk) : undefined
			);
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
		this.runCompleteTransfer(oversize, this.bdatTracker?.contentByteLength ?? 0, 'BDAT');
	}

	/**
	 * Fire-and-forget wrapper around {@link completeTransfer} (`JR-4-06a`). `completeTransfer` is now
	 * genuinely asynchronous -- it awaits `journalAcceptance.accept()` when one is configured -- but
	 * both call sites ({@link finishData}, {@link finishBdatTransaction}) are themselves synchronous
	 * socket-event handlers with nothing useful to do with a returned promise. This method is what
	 * makes that safe rather than merely convenient:
	 *
	 *  - **Suspends command processing for the duration**, reusing {@link commandProcessingSuspended}
	 *    -- the exact mechanism {@link verifyCredentials} already established for its own asynchronous
	 *    step (bcrypt). This closes a race `JR-4-06a` would otherwise introduce:
	 *    {@link handleBdatChunkBytes} can hand a pipelined remainder (the start of the next command, or
	 *    even the next transaction) to {@link drainCommandCarry} in the very same synchronous stack
	 *    frame a `BDAT ... LAST` chunk finishes in. Without suspending, that remainder would be parsed
	 *    against `state`/the envelope *before* `completeTransfer` has written this transaction's own
	 *    reply and reset them -- out-of-order replies, or a command misrouted against stale state.
	 *    {@link onData} now checks the same flag before routing raw bytes at all (not only before
	 *    parsing a command line), so bytes arriving mid-`accept()` are parked in `commandCarry`
	 *    regardless of what phase they would otherwise be read as.
	 *  - **Never lets a genuine bug in `completeTransfer` become an unhandled rejection.**
	 *    `completeTransfer` is not expected to reject in normal operation (every `JournalAcceptance`
	 *    result is a plain value, never a thrown one, once past `accept()`'s own non-`DurableWriteError`
	 *    rethrow for a true programming error -- see `acceptance.ts`). If it ever does, this connection
	 *    cannot know what reply (if any) has already reached the wire, so the only safe action is to
	 *    log loudly and drop the connection -- never leave the sender waiting forever for a reply that
	 *    will never come.
	 */
	private runCompleteTransfer(
		oversize: boolean,
		contentByteLength: number,
		transferMode: 'DATA' | 'BDAT'
	): void {
		this.commandProcessingSuspended = true;
		this.completeTransfer(oversize, contentByteLength, transferMode)
			.catch((err: unknown) => {
				this.logger.error(
					{ err, transferMode, remoteAddress: this.socket.remoteAddress },
					'smtp-ingress: completeTransfer failed unexpectedly; closing the connection ' +
						'rather than leaving the sender waiting for a reply that was never sent'
				);
				if (!this.socket.destroyed) {
					this.socket.destroy();
				}
			})
			.finally(() => {
				this.commandProcessingSuspended = false;
				if (!this.socket.destroyed) {
					this.drainCommandCarry();
				}
			});
	}

	/**
	 * Shared end of a mail transaction's body transfer, reached either from `DATA`'s terminator
	 * ({@link finishData}) or from `BDAT ... LAST` ({@link finishBdatTransaction}) -- kept as one
	 * method precisely so `JR-4-06a` has a single call site to change, not two.
	 *
	 * Oversize is logged the same way regardless of whether `journalAcceptance` is wired -- it is a
	 * protocol-layer fact (`DataScanner`/`BdatContentTracker`'s own `SIZE` accounting), not something
	 * `accept()` ever sees or decides. What differs is the reply: with no `journalAcceptance`
	 * configured, this keeps the exact pre-`JR-4-06a` behaviour (`552` for oversize, `451` for
	 * everything else, unconditionally -- see the module doc comment's "`JournalAcceptance.accept()`
	 * is wired in" section for why that default is preserved rather than removed). With one
	 * configured, {@link finalizeAcceptance} decides the reply instead.
	 */
	private async completeTransfer(
		oversize: boolean,
		contentByteLength: number,
		transferMode: 'DATA' | 'BDAT'
	): Promise<void> {
		if (oversize) {
			this.logger.error(
				{
					remoteAddress: this.socket.remoteAddress,
					sizeLimitBytes: this.smtp.sizeLimitBytes,
					transferMode,
				},
				'smtp-ingress: rejecting message, exceeds configured SIZE limit'
			);
		}

		if (this.journalAcceptance) {
			await this.finalizeAcceptance(oversize, transferMode);
		} else if (oversize) {
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

	/**
	 * Start `journalAcceptance.accept()` for the transaction that is beginning right now -- called
	 * from `handleDataCommand`/`handleBdatCommand`, before `354`/the tracker that will feed it, so a
	 * failed assertion below can refuse the transaction outright rather than accept a body it cannot
	 * durably store. Returns `false` (having already written a `451` and re-armed the command timer)
	 * when it refuses; the caller must not proceed to `354`/`state = 'data'`/`'bdat'` in that case.
	 *
	 * `singleMatchedChainScopeId()`'s assertion is the one `ADR-027`/`JR-4-17` promises structurally
	 * (a second `RCPT TO` for a different chain is rejected with `452 4.5.3` before it ever reaches
	 * `matchedChainScopeIds`) -- asserted here rather than assumed, per the Product Owner's
	 * instruction, because a caller that constructs `EsmtpServer` with `journalAcceptance` set but
	 * `recipientAclEvaluator` left `undefined` (a misconfiguration this class cannot rule out on its
	 * own: the two are independent constructor parameters) would otherwise reach `accept()` with an
	 * empty `matchedRecipients` and no chain to write into at all.
	 */
	private tryBeginAcceptance(): boolean {
		let chainScopeId: string;
		try {
			chainScopeId = this.singleMatchedChainScopeId();
		} catch (err) {
			this.logger.error(
				{ err, remoteAddress: this.socket.remoteAddress },
				'smtp-ingress: refusing to start acceptance -- the envelope did not resolve to ' +
					'exactly one journal chain (ADR-027 invariant violated; is recipientAclEvaluator ' +
					'configured alongside journalAcceptance?)'
			);
			this.writeResponse(451, '4.3.0', 'Requested action aborted: local error in processing');
			this.armCommandTimer();
			return false;
		}

		this.spoolBridge = new SpoolWriteBridge({
			onPause: () => this.socket.pause(),
			onResume: () => {
				if (!this.socket.destroyed) {
					this.socket.resume();
				}
			},
		});
		this.acceptPromise = this.journalAcceptance!.accept({
			chainScopeId,
			// ADR-006 section 3.1: microseconds, and a whole millisecond -- `Date.now()` is already
			// millisecond-granular, so multiplying by 1000 can never produce anything else. Captured
			// once, here, at the moment the body transfer begins -- not re-read later, and not
			// deferred to whenever `accept()` happens to run.
			receivedAtMicros: BigInt(Date.now()) * 1000n,
			remoteIp: this.socket.remoteAddress ?? null,
			ehloName: this.ehloName,
			tlsVersion: this.tlsVersion,
			tlsCipher: this.tlsCipher,
			envelopeFrom: this.mailFrom,
			// Arrival order, never sorted (ADR-006) -- `this.rcptTo` is already in that order.
			envelopeRcpt: [...this.rcptTo],
			// The transaction's first matched recipient's source -- ADR-027 guarantees every matched
			// recipient shares one chainScopeId, but does not promise they all share one sourceId; the
			// first is "the" source this receipt is attributed to (architecture doc section on
			// "the recipient determines the chain").
			journalingSourceId: this.matchedRecipients[0]?.sourceId ?? null,
			chunks: this.spoolBridge.chunks,
		});
		return true;
	}

	/** The one chain every recipient matched so far this transaction must resolve to (ADR-027) --
	 * throws if that invariant does not hold. See {@link tryBeginAcceptance}'s doc comment for why
	 * this is asserted rather than assumed. */
	private singleMatchedChainScopeId(): string {
		if (this.matchedChainScopeIds.size !== 1) {
			throw new Error(
				`expected exactly one matched chain per transaction (ADR-027), got ` +
					`${this.matchedChainScopeIds.size}`
			);
		}
		return this.matchedRecipients[0]!.chainScopeId;
	}

	/**
	 * Decide the reply once `journalAcceptance` is configured (`JR-4-06a`) -- the second half of
	 * {@link completeTransfer}, called only when `this.journalAcceptance` is set. Ends or aborts the
	 * bridge {@link tryBeginAcceptance} started, awaits the `accept()` call it began, and writes the
	 * reply the skill `journal-ledger` section 2 table asks for.
	 *
	 * ---------------------------------------------------------------------------------------------
	 * Oversize: the one place in the whole system that overrides `accept()`'s own result
	 * ---------------------------------------------------------------------------------------------
	 * By the time oversize is known, `writeDurableSpoolFile()` is very likely already mid-write --
	 * `accept()` created the spool file (`mkdir`+`createFile`) before it ever pulled a single chunk out
	 * of the bridge (see `durable-write.ts`), so "wait until we know the message is not oversize
	 * before starting the write" is not actually available without buffering the whole message first
	 * to find out, which is exactly what streaming exists to avoid (skill section 1's streaming
	 * requirement, `JR-3-02`'s acceptance criterion). So instead the bridge is **aborted**, not ended:
	 * {@link SpoolWriteBridge.abort} makes `writeDurableSpoolFile()`'s `for await` reject, which --
	 * `durable-write.ts`'s `F45` fix -- surfaces as a typed `DurableWriteError('write', ...)` rather
	 * than an uncaught `Error`. `JournalAcceptance.accept()`'s own `DurableWriteError` handling then
	 * quarantines whatever partial write this left in `incoming/` under reason `'write-failed'`
	 * (`JR-3-09`) exactly as it already does for a genuine write failure, and settles to
	 * `'spool-write-failed'` (which maps to `451` in the table below).
	 *
	 * That `451` mapping is *wrong* for this case -- skill section 2 is unconditional that an oversize
	 * message is `552 5.3.4`, never a retry code -- and `accept()` itself has no way to know the write
	 * it was asked to perform was actually rejected by the protocol layer for an unrelated reason (it
	 * has no `SIZE` concept at all). So this method overrides whatever `accept()` settled to with `552`
	 * whenever the SMTP layer's own oversize flag is set, regardless of the typed result underneath.
	 * **This is the only place in the system allowed to do that** -- everywhere else, `accept()`'s
	 * result is authoritative (`acceptance.ts`'s own doc comment argues at length why nothing may run
	 * after a successful append, and the same discipline applies to trusting a *rejection* verbatim).
	 * Nothing is lost by overriding here: the debris is already quarantined by `accept()` itself, so a
	 * later `runCrashRecoveryScan()` finds nothing left in `incoming/` to misdiagnose as a crash (F40) --
	 * proven directly in `smtp-acceptance-wiring.test.ts`.
	 *
	 * A transaction that reaches here abandoned rather than genuinely finished (see
	 * {@link abandonInFlightAcceptance}) never calls this method at all -- `abandonInFlightAcceptance`
	 * aborts and forgets the promise itself, from {@link resetEnvelope}, without ever writing a reply
	 * for it (there is no command awaiting one: `RSET`/`EHLO`/`STARTTLS` already get their own reply
	 * from their own handler).
	 */
	private async finalizeAcceptance(
		oversize: boolean,
		transferMode: 'DATA' | 'BDAT'
	): Promise<void> {
		const bridge = this.spoolBridge;
		const acceptPromise = this.acceptPromise;
		this.spoolBridge = null;
		this.acceptPromise = null;
		// Defensive only: the two fields are only ever both-null or both-set (see their doc comments),
		// so this branch should be unreachable in practice.
		if (!bridge || !acceptPromise) {
			this.logger.error(
				{ remoteAddress: this.socket.remoteAddress, transferMode },
				'smtp-ingress: finalizeAcceptance called with no in-flight acceptance (unreachable in ' +
					'normal operation)'
			);
			this.writeResponse(451, '4.3.0', 'Requested action aborted: local error in processing');
			return;
		}

		if (oversize) {
			bridge.abort(
				new Error('oversize: SIZE limit exceeded, aborting in-flight spool write')
			);
		} else {
			bridge.end();
		}

		const result = await acceptPromise;

		if (oversize) {
			// See this method's doc comment's "Oversize" section for why this overrides `result`
			// unconditionally rather than mapping it through the table below.
			this.logger.error(
				{
					remoteAddress: this.socket.remoteAddress,
					transferMode,
					acceptResultKind: result.kind,
				},
				"smtp-ingress: oversize message rejected with 552; the aborted spool write's own " +
					'result is overridden (see SmtpConnection.finalizeAcceptance)'
			);
			this.writeResponse(552, '5.3.4', 'Message size exceeds fixed maximum message size');
			return;
		}

		if (isAccepted(result)) {
			this.logger.info(
				{
					remoteAddress: this.socket.remoteAddress,
					transferMode,
					seq: result.seq.toString(),
				},
				'smtp-ingress: message durably accepted'
			);
			this.writeResponse(250, '2.0.0', `Ok: queued as ${result.seq}`);
			return;
		}

		// The rest of skill `journal-ledger` section 2's table -- every local-failure kind
		// `JournalAcceptance.accept()` can return once `oversize` is ruled out above.
		switch (result.kind) {
			case 'high-water-mark-exceeded':
			case 'spool-capacity-exceeded':
				this.logger.error(
					{
						remoteAddress: this.socket.remoteAddress,
						transferMode,
						resultKind: result.kind,
					},
					'smtp-ingress: rejecting message, spool capacity exceeded'
				);
				this.writeResponse(452, '4.3.1', 'Insufficient system storage');
				return;
			case 'spool-write-failed':
			case 'ledger-append-failed':
				this.logger.error(
					{
						remoteAddress: this.socket.remoteAddress,
						transferMode,
						resultKind: result.kind,
					},
					'smtp-ingress: rejecting message, local failure -- sender should retry'
				);
				this.writeResponse(
					451,
					'4.3.0',
					'Requested action aborted: local error in processing'
				);
				return;
			default: {
				// Exhaustiveness guard: a new JournalAcceptanceResult kind must update this switch,
				// not silently fall through with no reply ever written.
				const _exhaustive: never = result;
				throw new Error(
					`unhandled JournalAcceptanceResult kind: ${JSON.stringify(_exhaustive)}`
				);
			}
		}
	}

	/** Clears the envelope **and** any in-progress chunking state -- RFC 3030's requirement that
	 * `RSET` mid-`BDAT` "clears all segments sent during that transaction" falls out of this being
	 * the one reset path every command that starts a fresh envelope (`EHLO`/`HELO`/`RSET`) already
	 * called, plus the two body-transfer completions above. */
	private resetEnvelope(): void {
		this.mailFrom = null;
		this.rcptTo = [];
		this.matchedRecipients = [];
		this.matchedChainScopeIds = new Set();
		this.dataScanner = null;
		this.bdatTracker = null;
		this.bdatChunkRemaining = null;
		this.bdatChunkIsLast = false;
		this.abandonInFlightAcceptance();
	}

	/**
	 * Abort an `accept()` call that {@link tryBeginAcceptance} started but that will now never reach
	 * {@link finalizeAcceptance} (`JR-4-06a`) -- reachable whenever `RSET`, a fresh `EHLO`/`HELO`, or a
	 * `STARTTLS` handshake ({@link onTlsHandshakeComplete}) fires {@link resetEnvelope} in the middle
	 * of a `BDAT` transaction, i.e. after the first `BDAT` already opened a bridge but before
	 * `BDAT ... LAST` ever ran (`DATA` has no equivalent window: nothing can interrupt it between
	 * `354` and the terminator except a timeout, which closes the connection outright).
	 *
	 * Left unhandled, the bridge's underlying stream would simply wait forever for chunks that will
	 * never arrive, and the `writeDurableSpoolFile()` call already in flight for it would never
	 * resolve -- an open file descriptor under `incoming/`, leaked for the rest of the connection's
	 * lifetime. Aborting it the same way an oversize rejection does lets `accept()`'s own
	 * `DurableWriteError` handling quarantine whatever partial write this left behind (`JR-3-09`,
	 * reason `'write-failed'`), so nothing here needs to await the settling promise or decide the
	 * debris's fate itself -- only log the (expected) outcome for anyone reading the log later.
	 *
	 * A no-op when no acceptance is in flight, which is by far the common case: every `EHLO`/`HELO`/
	 * `RSET` outside of a `BDAT` transaction, and every ordinary `completeTransfer` (which already
	 * cleared both fields via {@link finalizeAcceptance} before calling {@link resetEnvelope} itself).
	 */
	private abandonInFlightAcceptance(): void {
		if (!this.spoolBridge) {
			return;
		}
		const bridge = this.spoolBridge;
		const acceptPromise = this.acceptPromise;
		this.spoolBridge = null;
		this.acceptPromise = null;
		bridge.abort(
			new Error('smtp-ingress: transaction abandoned (RSET/EHLO/STARTTLS) before BDAT LAST')
		);
		acceptPromise?.then(
			(result) =>
				this.logger.warn(
					{ resultKind: result.kind },
					'smtp-ingress: an abandoned in-flight acceptance settled without throwing'
				),
			(err: unknown) =>
				this.logger.warn(
					{ err },
					'smtp-ingress: an abandoned in-flight acceptance rejected (expected)'
				)
		);
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
	/**
	 * TLS configuration (`JR-4-04`). Omitted entirely, or `{}`/all-fields-unset, means this
	 * deployment has no certificate: `STARTTLS` is never advertised or accepted, and `requireTls`
	 * behaves as `false` regardless of what was configured (the `IngressTlsConfig` schema already
	 * refuses to validate `requireTls: true` with no certificate -- see `tls-config.ts` -- so reaching
	 * this constructor with that combination should not be possible from `apps/smtp-ingress`, but this
	 * class does not trust that and falls back safely regardless).
	 */
	readonly tls?: IngressTlsConfig;
	/** Structured-logging port. Defaults to {@link noopIngressLogger} -- see this module's
	 * "Where `logLevel` actually gets used" section for why a caller that cares passes a real one. */
	readonly logger?: IngressLogger;
	/**
	 * Override for {@link RequireTlsResolver}. `apps/smtp-ingress/src/index.ts` passes
	 * `createSourceAclRequireTlsResolver()`'s result (`./source-acl-cache.ts`, `JR-4-05a`) here in
	 * production. Exposed here (rather than only internally) so a test can exercise the
	 * tighten-never-loosen contract without needing a real source lookup.
	 */
	readonly requireTlsResolver?: RequireTlsResolver;
	/**
	 * Source ACL gate (`JR-4-05a`), checked once per accepted TCP connection, before anything else
	 * -- including the `220` greeting. `undefined` (the default) disables the gate entirely: every
	 * connection is accepted, exactly this class's behaviour before this task, which is what lets
	 * every pre-existing test that does not care about the ACL keep constructing a bare
	 * `EsmtpServer`. Production always supplies a `SourceAclCache`.
	 */
	readonly sourceAclEvaluator?: SourceAclEvaluator;
	/**
	 * Recipient ACL gate (`JR-4-05b`), checked on every `RCPT TO`. `undefined` (the default) disables
	 * the gate entirely -- every syntactically valid recipient is accepted, exactly this class's
	 * behaviour before this task, the same convention `sourceAclEvaluator` already established.
	 * Production always supplies the same `SourceAclCache` instance passed as `sourceAclEvaluator`
	 * (see `./source-acl-cache.ts`'s doc comment for why this is the same cache, not a second one).
	 */
	readonly recipientAclEvaluator?: RecipientAclEvaluator;
	/**
	 * `AUTH` credential lookup (`JR-4-05c`). `undefined` (the default, together with
	 * `passwordVerifier` left `undefined` too) disables `AUTH` entirely -- never advertised in
	 * `EHLO`, and a bare `AUTH` command falls through to the ordinary `500`, the same convention
	 * `sourceAclEvaluator`/`recipientAclEvaluator` already established. Production always supplies
	 * the same `SourceAclCache` instance passed as those two (one refresh cycle, three ACLs -- see
	 * `./source-acl-cache.ts`'s doc comment).
	 */
	readonly authCredentialEvaluator?: AuthCredentialEvaluator;
	/**
	 * Bcrypt comparison port for `AUTH` (`JR-4-05c`). `apps/smtp-ingress/src/index.ts` passes
	 * `createBcryptPasswordVerifier()`'s result here in production -- see {@link PasswordVerifier}'s
	 * doc comment for why this package cannot depend on bcrypt itself.
	 */
	readonly passwordVerifier?: PasswordVerifier;
	/**
	 * Durable acceptance (`JR-4-06a`). `undefined` (the default) preserves the exact pre-`JR-4-06a`
	 * behaviour -- end of `DATA`/`BDAT ... LAST` always answers `451 4.3.0`, unconditionally -- the
	 * same convention every other optional dependency above already established, which is what keeps
	 * every earlier task's protocol tests passing unchanged. `apps/smtp-ingress/src/index.ts` passes a
	 * real `JournalAcceptance` (`../spool/acceptance.ts`) here once a ledger database is configured.
	 */
	readonly journalAcceptance?: JournalAcceptancePort;
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
	/** `null` when no certificate/key is configured -- see {@link EsmtpServerOptions.tls}. Built once
	 * here, not per connection; see {@link SmtpConnection}'s constructor parameter of the same name
	 * for why that matters. */
	private readonly tlsSecureContext: tls.SecureContext | null;
	private readonly requireTlsResolver: RequireTlsResolver;
	private readonly sourceAclEvaluator: SourceAclEvaluator | undefined;
	private readonly recipientAclEvaluator: RecipientAclEvaluator | undefined;
	private readonly authCredentialEvaluator: AuthCredentialEvaluator | undefined;
	private readonly passwordVerifier: PasswordVerifier | undefined;
	private readonly journalAcceptance: JournalAcceptancePort | undefined;

	constructor(options: EsmtpServerOptions) {
		this.smtp = options.smtp;
		this.logger = options.logger ?? noopIngressLogger;
		const cert = options.tls?.cert;
		const key = options.tls?.key;
		this.tlsSecureContext =
			cert !== undefined && key !== undefined ? tls.createSecureContext({ cert, key }) : null;
		const processRequireTls = options.tls?.requireTls ?? false;
		this.requireTlsResolver = options.requireTlsResolver ?? (() => processRequireTls);
		this.sourceAclEvaluator = options.sourceAclEvaluator;
		this.recipientAclEvaluator = options.recipientAclEvaluator;
		this.authCredentialEvaluator = options.authCredentialEvaluator;
		this.passwordVerifier = options.passwordVerifier;
		this.journalAcceptance = options.journalAcceptance;
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
	 * `421 4.3.2` to in-flight sessions (skill section 2, "Shutdown in progress") is `JR-4-06b`'s job,
	 * not this one's (`JR-4-06a` only wires `accept()` into `completeTransfer()` -- see this file's
	 * module doc comment).
	 */
	close(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server.close((err) => (err ? reject(err) : resolve()));
		});
	}

	/**
	 * The source ACL gate (`JR-4-05a`) runs here, before anything else -- including the `220`
	 * greeting {@link SmtpConnection}'s constructor writes immediately. A denied or
	 * ACL-not-yet-known connection is answered and closed without ever constructing a
	 * `SmtpConnection`, so no greeting, no `EHLO`, nothing is ever offered to an IP this gate
	 * refuses. `socket.remoteAddress` can be `undefined` on a socket that is already
	 * closing -- treated the same as `'unavailable'` (fail closed on "we don't even know who this
	 * is"), never as an implicit allow.
	 */
	private handleConnection(socket: net.Socket): void {
		if (this.sourceAclEvaluator) {
			const remoteIp = socket.remoteAddress;
			const decision: SourceAclDecision =
				remoteIp !== undefined
					? this.sourceAclEvaluator.evaluate(remoteIp)
					: { kind: 'unavailable' };
			if (decision.kind === 'denied') {
				this.logger.warn(
					{ remoteAddress: remoteIp },
					'smtp-ingress: rejecting connection, source IP not in any active journaling source ACL'
				);
				socket.end('554 5.7.1 Access denied\r\n');
				return;
			}
			if (decision.kind === 'unavailable') {
				this.logger.error(
					{ remoteAddress: remoteIp },
					'smtp-ingress: rejecting connection, source ACL is not currently known ' +
						'(no recent successful refresh) -- failing closed, not open'
				);
				socket.end(`421 4.3.2 ${this.smtp.hostname} Service temporarily unavailable\r\n`);
				return;
			}
		}

		this.sockets.add(socket);
		socket.on('close', () => this.sockets.delete(socket));
		new SmtpConnection(
			socket,
			this.smtp,
			this.logger,
			this.tlsSecureContext,
			this.requireTlsResolver,
			this.recipientAclEvaluator,
			this.authCredentialEvaluator,
			this.passwordVerifier,
			this.journalAcceptance
		);
	}
}
