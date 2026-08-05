import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_CLASSES, type TestClass } from './test-classes';

/**
 * Suite inventory (JR-1-05b).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------------------------
 * The CI job introduced by `JR-1-05` asserted that the `integration` suite had run by grepping the
 * test log for the *absence* of a skip notice. The `JR-1-06` acceptance broke that check twice:
 *
 *   (a) Renaming `packages/backend/tests/integration` made the suite **absent** rather than
 *       skipped. No skip notice is printed for a suite that does not exist, so the check reported
 *       "No integration-suite skip notice found." and the run was green with the entire integration
 *       suite gone (`149 passed | 2 skipped`, exit 0).
 *
 *   (b) A file in `tests/integration/` named `*.test.ts` instead of `*.int.test.ts` matches **no**
 *       project include glob. With `expect(1).toBe(2)` inside it, `pnpm test` stayed green and the
 *       file name appeared nowhere in the output.
 *
 * A check that watches for a missing log line is exactly the construction that let (a) through. So
 * this module states **positive** expectations instead, and states them where they cannot be
 * bypassed by an environment: in `globalSetup`, before a single test runs. `pnpm test` goes red on
 * the developer's machine, not only in CI.
 *
 * ---------------------------------------------------------------------------------------------
 * The two expectations
 * ---------------------------------------------------------------------------------------------
 *   1. **Exact file count per suite.** Each suite declares how many files it must match. Zero files
 *      is therefore a failure, which is what closes (a) -- and it closes it for a *deleted* directory
 *      just as much as for a renamed one.
 *
 *   2. **No unclassified test file.** Every file in the repository whose name looks like a test
 *      (`*.test.ts`, `*.spec.ts`, and the `.js`/`.mjs`/`.tsx`/... variants) must be matched by at
 *      least one project's include globs. That closes (b) at the root: a misnamed or misplaced test
 *      file fails the whole run instead of being silently collected by nobody.
 *
 * The include globs live here rather than in `vitest.config.ts` so that the config and the guard
 * cannot drift apart -- the config imports them from this module.
 *
 * Both numbers are reported on **every** run, green or red (Testplan rule 6: no silent caps). A
 * green run says how many files each suite matched, so "covered" can be read off the output rather
 * than assumed.
 *
 * ---------------------------------------------------------------------------------------------
 * What this file cannot see, and who does (JR-1-05c)
 * ---------------------------------------------------------------------------------------------
 * Everything here is decided before a single test runs, by looking at the filesystem. Three ways of
 * removing coverage leave the filesystem intact and were therefore green until JR-1-05c: relabelling a
 * suite's class, filling a file with `it.skip`, and deleting one file while adding another. Those are
 * findings F14 and F15, and they are watched by `./executed-tests.ts`, which counts tests that
 * actually **executed**, per suite and per class, and asserts the counts declared in
 * `SUITES[].expectedTests` below. The two guards sit in the same table on purpose: a maintainer who
 * adds or removes a test file has one place to update.
 */

/** Repository root -- this file lives at `<root>/tests/support/suite-inventory.ts`. */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

export type SuiteName = 'unit' | 'integration' | 'adversarial';

export interface SuiteSpec {
	readonly name: SuiteName;
	/** Include globs, handed to vitest verbatim. Repository-root relative, `/` separated. */
	readonly include: readonly string[];
	/**
	 * How many files must match -- **exactly**, not at minimum.
	 *
	 * It was a lower bound until JR-1-05c. A lower bound is slack, and a deletion the size of the
	 * slack goes through unnoticed: that is finding F15, reproduced by adding one integration file
	 * and deleting `pg-harness.int.test.ts`, which carries the entire JR-1-04 isolation contract.
	 * Equality costs one number per commit that adds or removes a test file, and the failure message
	 * says which number to write.
	 */
	readonly expectedFiles: number;
	/**
	 * How many tests must actually **execute**, per class, when that class is selected. Asserted
	 * after the run by `./executed-tests.ts`; see that module for why files alone are not enough
	 * (F14) and why this is equality rather than a lower bound (F15).
	 *
	 * A class that is not selected contributes 0 -- so the default `ci` run expects 0 `nightly`
	 * tests, and a suite relabelled from `ci` to `nightly` is caught by its `ci` number falling.
	 */
	readonly expectedTests: Readonly<Record<TestClass, number>>;
}

export const SUITES: readonly SuiteSpec[] = [
	{
		name: 'unit',
		// Units live next to the code they test; `tests/unit/` is for units of the harness itself,
		// which has no `src`.
		include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/unit/**/*.test.ts'],
		// 5 after JR-1-05b; 7 after JR-13-01 added the F1 regression at the validator boundary
		// (src/iam-policy/policy-validator.f1-conditions.test.ts) and the ADR-017 call-site
		// inventory (tests/unit/filter-builder-call-sites.test.ts); 8 after JR-13-13 added the
		// cross-gate check (tests/unit/condition-key-gates.test.ts); 10 after JR-1-05c added
		// tests/unit/executed-tests.test.ts and tests/unit/harness-ledger.test.ts; 13 after JR-2-02
		// added the canonical encoding of packages/journaling (canonical-encoding, merkle and the
		// ADR-006 golden vectors, all under src/ledger/); 14 after JR-2-06 added ledger-writer.test.ts;
		// 15 after JR-2-07 added tests/unit/ledger-backend-contract.test.ts -- the shared LedgerBackend
		// contract against a backend with no database, plus the counter-check that its concurrency case
		// fails without a lock. 16 after JR-3-03 added packages/journaling/src/spool/fs-port.test.ts --
		// the fault-injectable filesystem seam (real implementation plus the independent-failure fake).
		// 19 after JR-3-01 added spool/{txid,layout,config}.test.ts -- transaction IDs, sharded
		// incoming/quarantine layout, the high-water-mark check, and its zod config validation.
		// 20 after JR-3-02 added spool/durable-write.test.ts -- the streaming, dual-fsync durable
		// write, plus its 150 MB heap-growth case (nightly). 21 after JR-3-04 added
		// spool/acceptance.test.ts -- the two-phase acceptance wiring (high-water-mark -> durable write
		// -> ledger append -> typed result) against fakes. 23 after JR-3-05 added
		// ledger/ledger-lookup.test.ts (the batched spool_txid -> ledger read port, against a recording
		// fake) and spool/crash-recovery.test.ts (the crash-recovery scan: requeue vs. quarantine,
		// batching, quarantine/ observability, no-delete, and tolerance of a racing second scan).
		//
		// From here the history forks: E5 (journal-report parser) and E4 (SMTP ingress) were built on
		// two branches in parallel, each counting up from the 25 files they shared. E4's back-merge
		// (2026-08-04) keeps both histories and the count is the sum of both deltas against that
		// common base: 23 + 5 (E5) + 39 (E4) = 67. Each branch's own numbering below therefore stops
		// short of the total -- that is expected, not a stale comment.
		//
		// E5's five:
		// 26 after JR-5-01/JR-5-02 added packages/journaling/src/parser/{mime-split,envelope,
		// journal-report}.test.ts -- the hand-rolled top-level MIME splitter that keeps mailparser
		// from recursing across the message/rfc822 boundary, the envelope field-line parser
		// (Sender/Subject/Message-Id/To/Cc/Bcc/Recipient/On-Behalf-Of/undisclosed-recipients/
		// unknown-field preservation), and the end-to-end parseJournalReport() orchestration
		// against fixture .eml files.
		// 27 after JR-5-07 added packages/journaling/src/parser/owner-resolution.test.ts.
		// 28 after JR-5-08 added packages/journaling/src/parser/journal-report-corpus.test.ts (the
		// parser test corpus: everyday non-journal mail forms not otherwise in the corpus, plus two
		// measured misclassifications left RED on purpose -- see that file's module doc comment and
		// 06-status.md's E5 test-corpus section for detail).
		//
		// E4's thirty-nine:
		// 26 after JR-4-01 added ingress/config.test.ts (the apps/smtp-ingress zod configuration
		// schema), tests/unit/ingress-import-graph.test.ts (a static walk proving apps/smtp-ingress
		// never resolves anything under packages/backend/, in particular not
		// packages/backend/src/config/* or src/database/index.ts) and
		// tests/unit/ingress-process-boot.test.ts (the compiled process spawned for real: exits 1
		// with a readable message and no configuration, starts and accepts a connection on its
		// configured port with one).
		// 29 after JR-4-02 added ingress/smtp-config.test.ts (the ESMTP engine's own config schema),
		// ingress/smtp-server.test.ts (pure EHLO/multiline/MAIL-RCPT-parsing/DataScanner logic), and
		// tests/unit/smtp-server-protocol.test.ts (the protocol proven over a real loopback socket --
		// same "unit despite a real socket" classification `ingress-process-boot.test.ts` established
		// one task earlier, see that file's own doc comment for the precedent this one follows).
		// 31 after JR-4-04 added ingress/tls-config.test.ts (the TLS configuration zod schema) and
		// tests/unit/smtp-starttls-protocol.test.ts (STARTTLS/require_tls/session-reset proven over a
		// real TCP+TLS loopback connection).
		// 36 after JR-4-05a (source ACL): ingress/cidr.test.ts (CIDR parsing/matching),
		// ingress/source-acl.test.ts (PostgresSourceAclLookup against a recording fake),
		// ingress/source-acl-cache.test.ts (compileSourceAcl's fail-closed-per-source handling of an
		// invalid CIDR, SourceAclCache's availability-then-fail-closed staleness contract, and the
		// tighten-never-loosen createSourceAclRequireTlsResolver), ingress/source-acl-config.test.ts
		// (the zod schema for the ACL's own database connection/refresh/staleness config), and
		// tests/unit/smtp-source-acl-protocol.test.ts (the connect-time gate proven over a real
		// loopback socket: 554 5.7.1 denied with no 220 ever sent, 421 4.3.2 when the ACL is not
		// currently known, the ordinary 220 unaffected when allowed or when no evaluator is wired).
		// 38 after JR-4-05b (recipient ACL): ingress/recipient-address.test.ts
		// (normalizeJournalRecipient's case-folding/trim rules, including postmaster and the
		// angle-bracket-comment edge case) and tests/unit/smtp-recipient-acl-protocol.test.ts (the
		// RCPT TO gate proven over a real loopback socket: 550 5.1.1 denied, 451 4.3.0 unavailable
		// with the connection kept open, the ordinary 250 when allowed or when no evaluator is
		// wired, and the cross-chain ambiguity logged exactly once for two recipients of different
		// sources but never for a duplicate or same-source recipient).
		// 39 after JR-4-05c (AUTH) added tests/unit/smtp-auth-protocol.test.ts (the AUTH dialogue
		// proven over a real loopback TCP+TLS socket).
		// 41 after JR-4-06a added ingress/spool-write-bridge.test.ts (the push-to-pull backpressure
		// bridge between a socket's `data` events and `writeDurableSpoolFile()`'s `for await`) and
		// tests/unit/smtp-acceptance-wiring.test.ts (`JournalAcceptance.accept()` wired into
		// `completeTransfer()`: the response-code mapping, the oversize-abort override to `552` with
		// nothing left in `incoming/`, an abandoned mid-`BDAT` transaction on `RSET`, and the
		// calibrated streaming-memory proof). 42 after JR-4-18 added
		// spool/crash-recovery-lock.test.ts (runExclusiveCrashRecoveryScan(): the cross-process
		// exclusivity runCrashRecoveryScan() itself does not provide, wiring the previously uncalled
		// JR-3-05 scan's lock into the caller). 44 after JR-4-20 added
		// tests/unit/acl-evaluator-port-shapes.test.ts and tests/unit/source-acl-cache-wiring.test.ts
		// (F46 -- see expectedTests below for what each proves). 49 after JR-4-07 added
		// tests/unit/no-outbound-mail-path.test.ts (the structural "no outbound mail path" scan) and
		// tests/unit/byte-fidelity-roundtrip.test.ts (the DATA/BDAT byte-fidelity roundtrip corpus) --
		// see expectedTests below for what each proves.
		// 52 after JR-4-08 added ingress/rate-limit-config.test.ts, ingress/connection-rate-limiter.test.ts
		// and tests/unit/smtp-rate-limit-protocol.test.ts -- see expectedTests below for what each proves.
		// 53 after JR-4-09 added ingress/m365-ip-ranges.test.ts (the range refresh helper's diff logic,
		// against a fixture of the endpoint feed -- no network access anywhere in it).
		// 55 after JR-4-19 added ingress/journal-acceptance-bootstrap.test.ts (the retry-until-wired
		// bootstrap, driven through tryNow() rather than a slept-out timer) and
		// tests/unit/smtp-acceptance-promotion.test.ts (the same open connection going 451 -> 250 at the
		// wire, plus the mid-transaction stability of the per-transaction resolution).
		// 56 after JR-4-10 added tests/unit/kill-during-data-invariant.test.ts -- calibration of
		// checkNeverPartial(), the pure checker the real kill-during-DATA adversarial test uses.
		// 57 after JR-4-11 added tests/unit/bdat-data-byte-fidelity.test.ts.
		// 58 after JR-4-12 added tests/unit/smtp-oversize-boundary.test.ts.
		// 59 after JR-4-14 added tests/unit/smtp-tls11-clienthello-rejection.test.ts -- the hand-built,
		// byte-level TLS 1.1 ClientHello proof JR-4-04 handed forward, see that file's own doc comment.
		// (A second JR-4-14 file, tests/unit/smtp-adversarial-protocol.test.ts, was found mid-session
		// as a parallel, uncommitted attempt at the same backlog slice by another session on this same
		// checkout -- see 09-befunde-bestandscode.md's coordination note for why it is deliberately
		// left out of this count rather than committed: it currently fails 4 of its own cases.)
		// 60 after JR-4-21a added tests/unit/smtp-tls-cipher-filter.test.ts (F56).
		// 61 after JR-4-21a also added tests/unit/spool-write-bridge-throughput.test.ts (F50).
		// 62 after JR-4-13's acceptance review (Auflage 1) added
		// tests/unit/smtp-tls-fields-reach-acceptance.test.ts -- closes the gap the review found: no
		// existing test compared the *negotiated* TLS version/cipher of a real STARTTLS handshake
		// against the fields JournalAcceptancePort.accept() actually receives (see that file's own
		// doc comment for the three near-misses it replaces).
		//
		// 67 = 23 (shared base) + 5 (E5) + 39 (E4), see the fork note above.
		//
		// 69 after JR-6-01 (E6) added two: packages/journaling/src/phase-b/queue-contract.test.ts (the
		// Phase-B queue contract -- names, payload width, deterministic job id) and
		// packages/backend/src/workers/journal-inbound.options.test.ts (the worker's queue parameters,
		// including that maxStalledCount stays 0). The worker entry point itself has no unit test on
		// purpose: importing it constructs a BullMQ Worker and opens a Redis connection, so it is
		// measured by spawning the compiled process in the integration suite instead.
		//
		// 72 after JR-6-02a added three under packages/journaling/src/phase-b/: spool-entry-gate.test.ts
		// (the decision whether a spool entry may be archived at all), alerts.test.ts (the severity split
		// E5 deliberately left to E6) and spool-entry-reader.test.ts (streaming hash against a one-shot
		// hash, across several read chunks).
		//
		// 73 after the F59 fix added packages/journaling/src/ingress/graceful-exit.test.ts. The helper it
		// tests lives in this package rather than in apps/smtp-ingress for a harness reason worth knowing:
		// no project glob reaches apps/, so a test file placed there would be collected by nobody -- the
		// unclassified-file check would fail the run, which is the correct outcome and the reason the
		// testable part of the fix went where tests can see it.
		//
		// 74 after F61 added tests/unit/smtp-connection-reset-crash.test.ts -- the actual cause of the red
		// CI runs that F59 had been blamed for twice. EsmtpServer.handleConnection()'s rejection paths
		// returned without ever attaching a socket 'error' listener, so a client that reset while being
		// refused crashed the whole receiver with an uncaught ECONNRESET.
		//
		// 75 after JR-6-02b added packages/journaling/src/phase-b/owner-envelope.test.ts (ADR-033: owner
		// resolution for the three parse results that carry no journal-report envelope).
		expectedFiles: 75,
		// 216 before JR-2-02; 266 with the 50 tests of the canonical encoding and the Merkle encoding;
		// 280 with the 14 statement-order tests of the ledger writer (JR-2-06).
		// 288 after JR-2-07: the 5 shared contract cases, plus 3 that show the contract's concurrency
		// case has teeth (unlocked backend forks, locked one does not, a failed append does not wedge
		// the chain). 299 after JR-3-03: 11 tests proving write/file-fsync/directory-fsync fail
		// independently against the fake, plus the real NodeSpoolFileSystem exercised on disk. 335
		// after JR-3-01: 9 (txid: shape, uniqueness, time-ordering) + 19 (layout: sharding, paths,
		// ensureSpoolLayout, high-water-mark) + 8 (zod config validation) = 36 new tests.
		// 347 ci / 1 nightly after JR-3-02: 11 tests against FakeSpoolFileSystem (path, size, hash,
		// empty message, byte-verbatim, fsync/close ordering, the shard directory fsync'd, the three
		// stage-typed failures, the buffer-reuse streaming proof) + 1 against real disk
		// (NodeSpoolFileSystem, platform-aware directory-fsync outcome) = 12 new `ci` tests, plus the
		// 150 MB heap-growth acceptance case classified `nightly`. 361 ci after JR-3-04: 14 tests
		// wiring high-water-mark -> durable write -> ledger append -> typed result against fakes --
		// order (2 cases, one of them the fix for the getter-destructuring trap described in
		// acceptance.test.ts's fakeBackend() doc comment), high-water mark, the three spool-failure
		// classifications, ledger-append failure leaving the spool file in place, and the five success
		// cases (seq/hash passthrough, generated txid, size/hash from the durable write, IP
		// normalisation x2, receipt event shape). 371 after JR-3-05: 3 tests for
		// PostgresLedgerLookup.findBySpoolTxIds() against a fake (empty batch skips I/O, one batched
		// ANY($1) call with correct row mapping, a string-encoded received_at converted to Date) + 7 for
		// the crash-recovery scan (requeue leaves the file in place, quarantine moves it and alerts, a
		// mixed multi-shard batch resolved in exactly one ledger call, pre-existing quarantine/ files
		// counted but never queried or moved, a fresh/empty spool scans cleanly, content preserved
		// byte-for-byte across a run that both requeues and quarantines, and a racing second scan's
		//
		// Same fork as `expectedFiles` above: E5 and E4 counted up independently from the 371 ci tests
		// they shared. Merged total is 371 + 141 (E5) + 479 (E4) = 991 ci; nightly 1 + 2 (E4) = 3.
		//
		// E5's hundred-and-forty-one:
		// already-moved source is tolerated rather than thrown). 410 after JR-5-01/JR-5-02: 17
		// tests for the top-level MIME splitter, 14 for the envelope field-line parser, 8 for the
		// end-to-end parseJournalReport() orchestration -- 39 new tests.
		// 425 after PO review R1-R5 on JR-5-01/JR-5-02: 15 more tests than the initial 39 -- the
		// R1 Content-Disposition: inline regression suite (measurement + counter-proof), R2's
		// mailparser-backed To/Cc/Bcc address-list parsing tests, R3's dispatch-table/known-names
		// equality test, R4's undisclosedRecipientFields granularity tests, and R5's boundary-line
		// validation tests.
		// 447 after JR-5-03/JR-5-04: 22 new tests in the same three parser files (no new files) --
		// 11 in mime-split.test.ts (locateJournalParts() reporting the report part independently of
		// the inner part, and isSmimeWrappedContentType()/isSmimeWrappedMessage() classifying
		// application/pkcs7-mime, the deprecated application/x-pkcs7-mime alias, and multipart/signed
		// as NOT wrapped) and 11 in journal-report.test.ts (the missing-inner-part case now asserting
		// extractableHeaders sourced from the still-parsed envelope rather than only `reason`; the
		// not-multipart/empty-buffer fallback-header-extraction cases; the S/MIME-encrypted and
		// clear-signed inner-part fixtures end to end; and the JR-5-03 "never throws" loop over
		// seven deliberately broken shapes -- truncated, wrong boundary, nested multipart, 8-bit
		// garbage, empty buffer, headers-only, unterminated boundary).
		// 448 after PO review R1-R3 on JR-5-03/JR-5-04: a missing inner part no longer collapses the
		// already-parsed envelope into a three-field `parse_failed` -- it stays `kind:
		// 'journal_report'` with `innerMessage: { present: false }` and the full envelope intact,
		// which replaced 2 parse_failed-shaped tests with 2 tests proving that (including a
		// dedicated Bcc/DL-expansion-survives-a-missing-inner-part fixture, R1's sharpest form), and
		// R3 added one more test for the deprecated application/x-pkcs7-mime alias -- net +1.
		// 456 after JR-5-05/JR-5-06 (no new file -- journal-report.test.ts gained 8 tests): the
		// `not-multipart.eml` fixture's expectation flipped from `parse_failed` to `plain_bcc` (it
		// was always a well-formed ordinary message, just classified into the only bucket that
		// existed before this slice) -- same test count there, reworded; 3 new tests for the
		// plain-BCC/routing-rule fallback (Postfix `always_bcc`, Google Workspace routing, and the
		// "no SMTP envelope supplied" default); 5 new tests for NDR detection (the canonical RFC 3464
		// shape with all three signals at once, the null-envelope-sender signal alone, the
		// Auto-Submitted signal alone, `Auto-Submitted: no` correctly NOT firing it, and the
		// classification-order proof that an NDR Exchange itself journalled stays `'journal_report'`).
		// 459 after PO review R1/R2 on JR-5-05/JR-5-06 (still no new file): R1 found that
		// `JR-5-03`'s "report found, inner missing ⇒ journal_report" rule wrongly classified an
		// ordinary attachment-bearing email delivered via plain BCC as a journal report (same
		// multipart/mixed-with-no-message/rfc822-child shape as a genuinely incomplete journal
		// report) -- 2 new tests prove the fix side by side: the attachment-bearing fixture now
		// classifies `plain_bcc`, and the pre-existing `missing-inner-part-bcc-and-dl.eml` fixture
		// still classifies `journal_report` (the discriminator's full contrast). R2 added 1 test
		// proving a multi-entry, duplicate-containing `envelopeRcpt` survives a `plain_bcc` result
		// unreordered and undeduplicated, alongside `reducedEnvelopeFidelity` -- the earlier
		// plain-BCC tests only ever used a single-recipient envelope, which could not have caught a
		// `Set`-based dedup or a sort. Net +3.
		// 467 after PO review R3 on JR-5-05/JR-5-06 (still no new file): R1's discriminator accepted
		// Sender/Subject/Message-Id/On-Behalf-Of/To/Cc/Bcc as proof of a journal report, but a quoted
		// forwarded-message header block satisfies exactly those fields too -- measured by the PO, R1's
		// version fabricated envelope.to/envelope.cc recipients out of quoted body text for an ordinary
		// forwarded email with an attachment delivered via plain BCC. The fix requires two independent
		// signals (a `Recipient:` line -- the one field a quoted forward never reproduces -- and the
		// report text beginning with a field line, not prose/a separator). journal-report.test.ts
		// gained 2 tests: the forwarded-with-attachment fixture now classifies `plain_bcc` (the
		// sharper regression case), and a complete journal report (inner message present) is asserted
		// unaffected, since the discriminator never runs on that path at all. envelope.test.ts gained
		// 6 tests for the new exported `reportTextBeginsWithFieldLine()` (recognised field line first,
		// unrecognised-but-field-shaped first, a quoted-forward separator first, prose first, an empty
		// report, and leading blank lines not causing a false negative). The "never throws" broken-input
		// loop's assertion widened from two `kind`s to all four the union now has (that loop was always
		// about "does it throw", never "which kind"); one of its fixtures ("truncated mid-inner-part")
		// now correctly lands on `plain_bcc` rather than `journal_report` under the stricter check,
		// since its report part has no `Recipient:` line -- noted in that test's own comment, not a
		// silent behaviour change. Net +8.
		// 468 after PO review R4 on JR-5-05/JR-5-06 (still no new file): R3's two-signal discriminator
		// was only ever consulted on the `located.innerMessage === null` branch, on the assumption that
		// a present `message/rfc822` inner part was proof enough by itself -- it is not.
		// "Forward as Attachment" (Outlook's own menu item; Thunderbird's default forward style)
		// produces multipart/mixed + text/plain + message/rfc822 for ordinary mail, structurally
		// identical to a genuine journal report inner part and all. Measured by the PO: that shape came
		// back `journal_report` with an empty-but-authoritative envelope (`sender: null`,
		// `recipients: []`) for a message that had real recipients, which were never attached because
		// the SMTP-envelope-carrying path never ran. The fix moves `looksLikeGenuineJournalReport()`
		// before the inner-part-present/absent branch so it runs unconditionally; the branch on
		// `located.innerMessage` now only decides what `innerMessage` looks like, never `kind`. 1 new
		// test proves the fix (the forward-as-attachment fixture now classifies `plain_bcc`); the
		// pre-existing "complete journal report" test was strengthened (not counted as new -- same
		// test, an added assertion) to confirm a genuine full report still passes the now-unconditional
		// check, per the PO's explicit request that it becomes the test keeping the discriminator from
		// tightening further. Net +1.
		// JR-5-07 added packages/journaling/src/parser/owner-resolution.test.ts (27th unit file) --
		// resolveOwner() against the guide's four documented example-table rows, the priority order
		// between To/Cc/Bcc/sender, the no-groups heuristic tail, the address-comparison edge cases
		// (case-insensitive domain, no "@", more than one "@", empty local part, a domain configured
		// as an alias of two groups), and the additionalMatches/warning transparency fields.
		// 502 after JR-5-08 added packages/journaling/src/parser/journal-report-corpus.test.ts (28th
		// unit file), 11 new tests: a Bcc-only journal report (no To/Cc at all, distinct from the
		// existing DL-expansion fixture which always also carries a To); five everyday non-journal
		// mail forms not otherwise in the corpus, each asserting full SMTP-envelope pass-through and
		// `reducedEnvelopeFidelity` rather than only "classification succeeds" (a calendar invite,
		// text/calendar method=REQUEST, x2 incl. never-mutates-buffer; a bulk newsletter with
		// List-Unsubscribe, x2; a vacation autoresponder, which measures the EXISTING NdrSignal
		// trade-off of labelling an out-of-office notice `kind: 'ndr'` -- not a new finding, just
		// measured against the built parser; and a single-part message whose body happens to quote
		// report-shaped field lines, which brackets the scope of finding (b) below by showing it is
		// safe on this path); and 4 tests split across two NEW, MEASURED misclassifications, both left
		// intentionally RED per the task's explicit exception for a finding a corpus must not build
		// itself around:
		//  (a) a message whose text/plain part is nested one level inside a child
		//      multipart/alternative (the single most common real-world "HTML mail with an
		//      attachment" shape) is misclassified `parse_failed` instead of `plain_bcc`, because
		//      locateJournalParts() only inspects the outer multipart/mixed's immediate children;
		//  (b) the content-based discriminator introduced by PO reviews R1/R3/R4
		//      (looksLikeGenuineJournalReport(): a Recipient: line + a field-line-first report part)
		//      is exactly as forgeable as the MIME-structure signals it replaced -- any sender able to
		//      submit a message to the journal mailbox can author a text/plain part (optionally with a
		//      wholesale-fabricated message/rfc822 "original message" alongside it) that satisfies both
		//      signals and is accepted as an authoritative journal_report, with no check tying the
		//      classification to any actual Exchange transport property.
		// See that file's module doc comment and the JR-5-08 test report for full detail.
		// 504 after the DEV fixing pass on top of the same file closed all three findings above (by
		// changing the parser, per the PO's brief -- never by softening the corpus's claims):
		//  - the autoresponder test's expectation flipped from the pre-fix `kind: 'ndr'` (Auto-Submitted
		//    alone was sufficient) to the corrected `kind: 'plain_bcc'` (Auto-Submitted is now
		//    corroboration only -- RFC 3834 permits the identical `auto-replied` token on both a DSN and
		//    a vacation autoresponder, so the header cannot decide this alone); same test count (1).
		//  - the nested-multipart/alternative suite's expectation flipped from the pre-fix `parse_failed`
		//    to the corrected `plain_bcc` (`locateJournalParts()`'s search stays shallow; "no report-part
		//    candidate found" is now "not a journal report", not "a broken attempt at one"); same test
		//    count (2).
		//  - the forgery suite (finding (b)) is NOT fully closed by this pass, and is not reported as if
		//    it were: ADR-028 adds `parseJournalReport()`'s third, optional `sourceMode` parameter
		//    (`'exchange-journal' | 'plain-bcc' | 'infer'`, default `'infer'`). Each of the two forged
		//    fixtures is now asserted TWICE instead of once -- under `sourceMode: 'infer'` (the default)
		//    both still measurably classify as `journal_report`, the documented limit of `'infer'`, left
		//    exactly as demonstrated rather than softened; under `sourceMode: 'plain-bcc'` both correctly
		//    reclassify as `plain_bcc`, proving the fix for the one operating mode (plain-BCC/routing)
		//    where the forgery is actually exploitable (a genuine Exchange journal-report wrapper is
		//    never displaced by forged inner content). Net +2 (2 tests -> 4 tests).
		// Net change to this file: 11 -> 13 tests, so unit ci 502 -> 504.
		//
		// 512 after `JR-5-09`'s independent acceptance found F43 and the fix landed with its
		// regression cover, all eight in the existing `owner-resolution.test.ts` (no new file, so
		// `expectedFiles` is unchanged): matching trimmed a configured domain while the emitted
		// address did not, so a stray space in `organizationDomains` matched and then leaked into
		// `ownerEmail` -- and a *leading* space put whitespace in the middle of the address
		// (`alice@ company.com`), which is never deliverable and never compares equal downstream.
		// Four whitespace shapes, the alias path, the fallback path, and casing-preserved-while-
		// trimmed are +7; the eighth asserts the limit that is deliberately NOT repaired, a `main`
		// that is a full address rather than a bare domain, because guessing which half the operator
		// meant would invent a value out of a broken input. Net +8 (504 -> 512).
		//
		// E4's four-hundred-and-seventy-nine:
		// 393 ci after JR-4-01: 15 in ingress/config.test.ts (parseIngressConfig: valid input, the
		// logLevel default and an explicit override, missing/out-of-range smtpPort x3,
		// missing/empty/invalid spool fields x4, an entirely empty input; formatIngressConfigError:
		// every invalid field named on one line each, no stack frame, the non-Zod fallback, the
		// non-Error fallback) + 5 in tests/unit/ingress-import-graph.test.ts (the walker reaches the
		// entry point and its known imports, no unresolved specifier, no @open-archiver/backend
		// anywhere in the graph, nothing under packages/backend/ at all, and specifically neither
		// packages/backend/src/config/* nor src/database/index.ts) + 2 in
		// tests/unit/ingress-process-boot.test.ts (the compiled process exits 1 with a readable
		// message and never binds a port without configuration; with valid configuration it creates
		// the spool layout, accepts a connection on its configured port, and stays up until stopped).
		// 452 ci after JR-4-02: +3 in ingress/config.test.ts (the smtp key now embeds
		// smtp-config.ts's schema: defaults every field when smtp is {}, an explicit override is
		// embedded rather than replacing every field's default, and the smtp key missing entirely is
		// rejected -- 15 -> 18) + 13 in ingress/smtp-config.test.ts (the three named-constant checks,
		// defaults on an empty object, a fully overridden configuration, env-var-shaped string
		// coercion, and one rejection per non-positive/non-integer numeric field plus the empty
		// hostname) + 28 in ingress/smtp-server.test.ts (buildEhloResponseLines x4,
		// formatMultilineResponse x3, parseMailFromArguments x7, parseRcptToArguments x3, DataScanner
		// x11: empty message, single line, dot-unstuffing, terminator-vs-dot-stuffed-line
		// disambiguation, the terminator split across chunks, content split mid-line across chunks,
		// exactly-at-limit, one-byte-over, a CRLF-less pathological line, and chunks arriving after
		// the scanner already finished) + 16 in tests/unit/smtp-server-protocol.test.ts (the 220
		// greeting, EHLO's default SIZE, EHLO's non-default configured SIZE, HELO's single-line
		// extension-free reply, PIPELINING proven with two commands in one packet, an 8BITMIME/SMTPUTF8
		// UTF-8 address, MAIL/RCPT/DATA out-of-sequence x3, an unrecognized command, MAIL FROM's SIZE=
		// parameter rejected before DATA, QUIT, end-of-DATA always 451 4.3.0 never 250, and the three
		// timeouts -- connection/command/data -- each observed as a 421 4.4.2 plus a closed socket).
		// 488 ci / 2 nightly after JR-4-03 (CHUNKING/BDAT): +18 in ingress/smtp-server.test.ts
		// (buildEhloResponseLines' CHUNKING assertion updated in place, not counted again;
		// parseBdatArguments x9: bare size, size+LAST case-insensitively, zero with/without LAST,
		// leading zeros, missing, non-numeric, negative, decimal, unsafe-integer-sized, a non-LAST
		// second token; BdatContentTracker x7: single push, multi-push accumulation, onContent
		// forwarding verbatim, exactly-at-limit, one-byte-over, oversize stays sticky, a zero-length
		// push is a no-op; the DATA/BDAT byte-identical acceptance proof x2: a body with a bare-dot
		// line, a leading-dot line and a chunk boundary between '\r' and '\n', plus the same proof
		// again over maximally fragmented one-byte chunk boundaries) + 18 in
		// tests/unit/smtp-server-protocol.test.ts (EHLO announces CHUNKING x1; the BDAT/CHUNKING wire
		// suite x16: single chunk never 250, multi-chunk 250-then-451, BDAT 0 LAST alone, BDAT 0 LAST
		// completing prior chunks, a zero-length non-LAST no-op, a chunk boundary mid-line, a chunk
		// boundary between '\r' and '\n' with a follow-up command proving alignment survived, a
		// pipelined BDAT command plus its full content, non-numeric/negative/missing chunk-size x3,
		// BDAT before MAIL/RCPT, a chunk sum over SIZE, a stalled sender timing out, DATA after a
		// non-LAST BDAT (RFC 3030 mixing), and a BDAT sent after BDAT...LAST already closed the
		// transaction; classified `nightly` x1: streaming 150 MB over 150 BDAT chunks with bounded
		// `arrayBuffers` growth -- see that test's own doc comment for why `heapUsed`, the metric
		// JR-3-02's durable-write proof samples, turned out blind to a deliberately reintroduced
		// full-buffering regression here, and had to be replaced with `arrayBuffers`, verified in
		// both directions before being kept).
		// 494 ci after JR-4-16 (F44 -- a DATA transfer over the SIZE limit no longer desyncs the
		// connection): +3 in ingress/smtp-server.test.ts (DataScanner's oversize cases updated for the
		// new "oversize does not imply done" contract: the pathological-line trip now reports
		// `done: false` until a terminator arrives, waiting continues across further CRLF-less chunks,
		// and the terminator is recognised whenever it eventually shows up after each of the two abort
		// points -- the line-count trip and the CRLF-less-line trip) + 3 in
		// tests/unit/smtp-server-protocol.test.ts (the F44 regression, reproduced exactly as measured:
		// message-body bytes shaped like SMTP commands in a later TCP segment get no response at all;
		// an oversize body read through to the real terminator gets exactly one 552 and the connection
		// is realigned afterward; an oversize sender that never sends a terminator still times out via
		// the pre-existing data timeout, proving discarding opened no new exhaustion gap).
		// 538 ci after JR-4-04 (STARTTLS/require_tls/TLS >= 1.2 floor): +8 in ingress/smtp-server.test.ts
		// (buildEhloResponseLines' five STARTTLS-advertisement cases -- omitted, unavailable,
		// available-and-inactive, active-already, plus the renamed "includes CHUNKING" case -- and
		// buildTlsSocketOptions x3: the fixed TLS_MIN_VERSION floor, isServer/secureContext forwarded
		// unchanged, maxVersion left unset) +
		// 10 in the new ingress/tls-config.test.ts (the fixed-floor constant, defaults on an empty
		// object and an explicit requireTls: false, string "true" coercion, cert/key must both be set
		// or both unset x4, requireTls: true rejected with no certificate and accepted with one) + 21
		// in the new tests/unit/smtp-starttls-protocol.test.ts, a real loopback TCP+TLS suite gated by
		// `suiteRequiring` on a working `openssl` CLI (see that file's own doc comment for why TLS 1.1
		// rejection is proven at the `minVersion` option level in smtp-server.test.ts instead of
		// end-to-end -- this environment's client tooling cannot construct a TLS 1.1 ClientHello at
		// all, the F43 lesson applied rather than a test that would be green for the wrong reason):
		// STARTTLS not advertised with no certificate, bare STARTTLS 454 4.7.0 with none configured,
		// STARTTLS advertised then withheld post-handshake, STARTTLS-with-parameters 501 5.5.4, a
		// second STARTTLS after a completed handshake 503, the negotiated version/cipher read from the
		// real socket and logged; the require_tls gate x11 (MAIL 530 alone, RCPT/DATA/BDAT/RSET/AUTH
		// 530 x5 via it.each, EHLO/HELO/NOOP/STARTTLS still work x4 via it.each, QUIT still works, TLS
		// active lets MAIL/RCPT/DATA through to the usual 451, a JR-4-05-shaped tightening resolver
		// requires TLS even with the process default false); the session reset x1 (MAIL right after the
		// handshake with no fresh EHLO is 503, proving state did not survive); the STARTTLS
		// command-injection companion to F44 x1 (bytes pipelined in the same segment as STARTTLS are
		// discarded, never answered, before or after the handshake).
		// 597 ci after JR-4-05a (source ACL): +18 in the new ingress/cidr.test.ts (parseCidr: bare
		// IPv4/IPv6 address as implicit /32//128, explicit CIDR blocks, /0 flagged isCatchAll for both
		// families, invalid IPv4/IPv6 prefix length, negative/non-numeric/missing prefix, unparseable
		// address; matchesCidr: inside/outside an IPv4 block, exact-match /32, inside/outside an IPv6
		// block, /0 matches everything of its family, never matches across families even a /0, an
		// IPv4-mapped IPv6 remote normalised then matched against an IPv4 CIDR, a partial-byte /25
		// prefix boundary) + 6 in the new ingress/source-acl.test.ts (PostgresSourceAclLookup against
		// a recording fake: maps rows, decodes allowed_ips from either a decoded array or JSON text,
		// throws rather than defaulting to [] for a non-array/non-string value, asserts status =
		// 'active' is in the query text, empty result) + 16 in the new
		// ingress/source-acl-cache.test.ts (compileSourceAcl: compiles every valid entry, excludes a
		// whole source and logs an error on any invalid CIDR, logs a warning but still compiles a /0
		// entry; SourceAclCache.evaluate: 'unavailable' before the first refresh, 'allowed' with the
		// matched source's identity/requireTls, 'denied' for a non-matching IP, a source excluded for
		// one bad entry matches nothing at all, a failed refresh keeps serving the previous snapshot
		// (availability) until staleAfterMs elapses then fails closed to 'unavailable' (security),
		// concurrent refreshNow() calls coalesce into one lookup, start() resolves even when the
		// first load fails, stop() halts the timer; createSourceAclRequireTlsResolver: process
		// default true always wins, a matched source's requireTls tightens the default, an
		// unmatched/null remoteIp never loosens it) + 9 in the new ingress/source-acl-config.test.ts
		// (the zod schema: accepts/rejects databaseUrl, refreshIntervalMs/staleAfterMs default and
		// coerce from strings, reject zero/negative values and staleAfterMs below refreshIntervalMs,
		// accept them equal) + 4 in the new tests/unit/smtp-source-acl-protocol.test.ts (the
		// connect-time gate over a real loopback socket: 554 5.7.1 denied with no 220 ever sent, 421
		// 4.3.2 when the ACL is not currently known, the ordinary 220 unaffected when allowed or when
		// no evaluator is wired) + 6 added directly to the pre-existing ingress/config.test.ts
		// (sourceAcl is a required key like smtp/tls but, unlike them, {} does not satisfy it; rejects
		// an empty databaseUrl; refreshIntervalMs/staleAfterMs default; an explicit override embeds
		// rather than replacing; staleAfterMs below refreshIntervalMs is rejected).
		// 618 ci after JR-4-05b (recipient ACL): +7 in the new ingress/recipient-address.test.ts
		// (normalizeJournalRecipient: lower-cases the domain, lower-cases the local part too (the
		// deliberate RFC 5321 section 2.4 deviation), trims whitespace, an empty/blank address
		// normalises to the empty string never a wildcard, postmaster is not special-cased, a
		// parenthesised comment is compared verbatim, idempotent) + 7 added to the pre-existing
		// ingress/source-acl-cache.test.ts (buildRecipientIndex x3: indexes by normalised address,
		// keeps the first of two sources sharing a routing_address and logs the conflict naming both
		// ids, excludes a source whose routing address is empty after normalisation and logs it
		// without affecting other sources; SourceAclCache.evaluateRecipient x4: 'unavailable' before
		// the first refresh, 'allowed' with a case-folded/trimmed match, 'denied' for a known-but-
		// non-matching address, the same first-wins dedup reflected end to end) + 1 added to the
		// pre-existing ingress/source-acl.test.ts (routing_address read and ORDER BY id asserted in
		// the query text) + 6 in the new tests/unit/smtp-recipient-acl-protocol.test.ts (550 5.1.1
		// denied, 451 4.3.0 unavailable with the connection kept open and retryable, the ordinary 250
		// when allowed or when no evaluator is wired, two recipients resolving to different chains
		// both get their 250 with the ambiguity logged exactly once, and a duplicate/same-source
		// recipient never logs it).
		// 669 ci after JR-4-05c (AUTH): +1 added to the pre-existing ingress/source-acl.test.ts
		// (smtp_username/smtp_password_hash mapped through as null when AUTH is not configured) + 10
		// in the pre-existing ingress/source-acl-cache.test.ts (buildAuthIndex x4: indexes by
		// smtp_username, excludes a source with no AUTH configured without logging, excludes a source
		// with only smtp_username set, keeps the first of two sources sharing an smtp_username and
		// logs the conflict naming both ids; SourceAclCache.lookupCredential x6: 'unavailable' before
		// the first refresh, 'found' with the matched source's identity and stored hash, 'not_found'
		// for an unknown username, 'not_found' -- never 'found' -- for a real source with no AUTH
		// configured, case-sensitive comparison unlike the recipient ACL, fails closed to
		// 'unavailable' once stale rather than 'not_found') + 19 in the pre-existing
		// ingress/smtp-server.test.ts (buildEhloResponseLines' AUTH-advertisement x4: omitted by
		// default, withheld pre-handshake even when configured, withheld when TLS is active but AUTH
		// is not configured, advertised as "AUTH PLAIN LOGIN" once both are true; parseAuthArguments
		// x5: bare mechanism, mechanism plus initial response, case-insensitive mechanism parsing, a
		// bare AUTH with no mechanism at all rejected, surrounding whitespace tolerated; decodeSaslBase64
		// x5: ordinary base64, the literal "=" empty-response marker, invalid-alphabet input rejected,
		// wrong-length input rejected, an empty string decodes to an empty buffer; decodeSaslPlain x5:
		// authzid/authcid/password split correctly, a non-empty authzid, too few fields rejected, too
		// many fields rejected, an empty password allowed) + 21 in the new
		// tests/unit/smtp-auth-protocol.test.ts (the AUTH dialogue proven over a real loopback TCP+TLS
		// socket: AUTH withheld from EHLO pre-handshake even when configured and advertised once TLS is
		// active, a bare AUTH over plaintext refused 538 5.7.11 unconditionally, AUTH not configured
		// falls through to the ordinary 500, PLAIN with an initial response and PLAIN with an empty
		// challenge both succeed 235 2.7.0, LOGIN's two-step Username:/Password: dialogue succeeds, a
		// wrong password and an unknown username both answer the exact same 535 5.7.8 -- the unknown-
		// username case additionally asserts the dummy-hash comparison actually ran, an unrecognised
		// mechanism is 504 5.5.4, malformed base64 in an initial response and in a continuation are both
		// 501 5.5.2, a malformed SASL-PLAIN field count is 501 5.5.2, client cancellation with "*" is
		// 501, a second AUTH once authenticated is 503 5.5.1, AUTH after MAIL FROM is 503 5.5.1, an
		// 'unavailable' credential store answers 454 4.7.0 never 535, exceeding
		// MAX_AUTH_ATTEMPTS_PER_CONNECTION closes the connection with 421 never a 5xx, an authenticated
		// source addressing its own recipient is unaffected, an authenticated source addressing a
		// different source's recipient is refused 550 5.7.1, and an unauthenticated connection is
		// unaffected by the source-conflict check).
		// 670 ci after JR-4-17 (ADR-030 -- a second RCPT TO for a different chain is rejected, not
		// merely logged): the pre-existing "two recipients resolving to different chains" case in
		// tests/unit/smtp-recipient-acl-protocol.test.ts was rewritten in place (not counted again) to
		// assert the new 452 4.5.3 for the second recipient, the first recipient's 250 unaffected, and
		// the rejection log naming the rejected recipient while `matchedRecipients` holds only the
		// transaction's one committed chain -- plus a further recipient of that same chain still
		// succeeding, unlogged. Net +2 new tests: RSET after a 452 rejection frees the connection so the
		// previously rejected chain is accepted in the next transaction, and an explicit check that two
		// recipients of the same source and the same recipient twice both stay 250 with no rejection log
		// (the pre-existing "does not log" case, made to assert response codes too, not counted again).
		// 690 ci after JR-4-06a added 20: spool-write-bridge.test.ts (5, the push-to-pull backpressure
		// bridge), durable-write.test.ts's F45 regression case (1), config.test.ts's four new ledger
		// cases (4), and smtp-acceptance-wiring.test.ts's ci-classified cases (10: the response-code
		// mapping table, the oversize override with the crash-recovery-clean proof, and the
		// RSET-mid-BDAT abandon proof). 3 nightly after JR-4-06a added
		// smtp-acceptance-wiring.test.ts's calibrated 150 MB streaming-memory proof.
		// 695 ci after JR-4-18 added spool/crash-recovery-lock.test.ts (5: crashRecoveryScanLockKey's
		// determinism and its reuse of advisoryLockKey, the lock acquired strictly before the scan's
		// own ledger lookup, the requeue/quarantine result passed through unchanged, a scan failure
		// propagated -- not swallowed -- only after the lock was taken, and a fake modelling real
		// pg_advisory_xact_lock semantics proving two scans on the same spoolRoot serialise while two
		// on different spoolRoots do not).
		// 698 ci after JR-4-20 (F46 -- SourceAclEvaluator/RecipientAclEvaluator's shared `evaluate`
		// method name let SourceAclCache's IP matcher silently stand in for the recipient ACL) added
		// tests/unit/acl-evaluator-port-shapes.test.ts (2: the type-level proof that swapping either
		// evaluator for the other no longer compiles, checked by tsc -p tsconfig.test.json, plus the
		// runtime check that SourceAclCache still satisfies all three roles at once) and
		// tests/unit/source-acl-cache-wiring.test.ts (1: bindSourceAclCache() -- the same function
		// apps/smtp-ingress/src/index.ts calls in production -- wired into a real EsmtpServer over a
		// real loopback socket, RCPT TO a seeded routing address reaching 250 and an unknown one 550).
		// 703 ci after JR-4-06b added tests/unit/smtp-5xx-inventory.test.ts (5: the reasoned inventory
		// of every 5xx smtp-server.ts can write, matched exactly against the source by a static scan --
		// no uninventoried/stale pair in either direction; the one connect-time 554 5.7.1 socket.end()
		// literal; source-acl-cache.ts writes no response code of its own; the scan finds a non-trivial
		// count equal to the inventory's own total; every entry's reason is one of the fixed
		// sender-fault vocabulary). 708 ci after JR-4-06b also added
		// tests/unit/smtp-graceful-shutdown.test.ts (5: an idle connection is proactively told 421
		// 4.3.2 and closes without needing to send another command; a connection idle between MAIL/RCPT
		// is drained the same way; a new connection attempt is refused once close() has begun; a
		// transaction mid-DATA with accept() still pending earns its own real 250 before the shutdown
		// notice, proven with a deterministic drained-but-unsettled fake rather than a timing guess; a
		// rejected (non-accepted) in-flight transaction keeps its own real 451 ahead of the shutdown
		// notice too). 719 ci after JR-4-06b also added tests/unit/smtp-response-code-table.test.ts (11:
		// one per row of skill journal-ledger section 2's table, in the table's own order -- accepted,
		// spool-write-failed, ledger-append-failed, high-water-mark-exceeded, the structural
		// object-store-unreachable proof (a scoped re-run of ingress-import-graph.test.ts's own walk),
		// metadata-DB-unreachable resolved to the same ledger-append-failed row with a
		// connection-loss-shaped cause, recipient denied, source denied, STARTTLS required but
		// refused, oversize with the loud oversize-rejected alert reconfirmed end to end, and the
		// shutdown drain's row-level check). 742 ci after JR-4-07 added tests/unit/no-outbound-mail-path.test.ts
		// (5: every forbidden outbound-network pattern's own fixture sample is caught, the legitimate
		// Postgres-client/inbound-listener sample trips nothing, the file walker reaches a non-trivial
		// count including the known entry points, no file under packages/journaling/src or
		// apps/smtp-ingress/src contains an outbound-capable call, and neither package.json declares an
		// outbound-mail/HTTP-client dependency) and tests/unit/byte-fidelity-roundtrip.test.ts (18: the
		// 5-entry CRLF-line-oriented corpus sent over both DATA and BDAT -- plain body, a leading-dot
		// line, a bare "." content line, consecutive blank lines, UTF-8 multibyte content -- 10 tests,
		// the 7-entry BDAT-only corpus that DATA's line framing cannot carry at all -- bare LF only,
		// bare CR only, mixed CRLF/LF/CR with no final terminator, a very long line with no line ending,
		// non-UTF-8 Latin-1 bytes, embedded NUL bytes, arbitrary binary content -- 7 tests, plus one
		// corpus-not-empty sanity check).
		// 779 ci after JR-4-08 (per-source connection/transaction-rate limits) added: 10 in the new
		// ingress/rate-limit-config.test.ts (the zod schema: defaults all three fields on an empty
		// object, string coercion, a fully overridden configuration, reject zero/negative/non-integer
		// maxConnectionsPerSource, reject zero/negative maxTransactionsPerSourcePerWindow, reject
		// zero/negative rateLimitWindowMs) + 13 in the new ingress/connection-rate-limiter.test.ts
		// (PerSourceConnectionLimiter x6: admits up to the max then refuses, tracks sources
		// independently, release() frees exactly one slot, a refused tryAcquire does not itself
		// consume a slot, a source is removed from the map once its count returns to zero -- the
		// bounded-memory argument -- release() on a never-acquired source is a no-op; +
		// PerSourceTransactionRateLimiter x7: admits up to the max within one window then refuses,
		// tracks sources independently, resets once the window elapses, does not reset one instant
		// early, currentWindowCount reports 0 once expired, pruneExpired() leaves a still-active
		// window untouched, defaults to Date.now with no injected clock) + 8 in the new
		// tests/unit/smtp-rate-limit-protocol.test.ts (the connection-limit gate over a real loopback
		// socket x4: 421 4.7.0 with the full line delivered before the socket closes and the first
		// connection unaffected, release() on close freeing the slot for a subsequent connection,
		// two different sources never sharing a budget, a connect-time-denied source hammering the
		// gate never occupies a slot a real source could otherwise use; the transaction-rate gate x4:
		// 450 4.7.1 at MAIL FROM with the connection kept open and a further command still answered,
		// two different sources tracked independently, a transaction already past MAIL FROM running
		// to its ordinary 451 unaffected by its own now-exhausted budget, no sourceAclEvaluator
		// configured leaving the rate limiter inert) + 6 added to the pre-existing ingress/config.test.ts
		// (rateLimit is a required key like smtp/tls/ledger but, like them, {} satisfies it and every
		// field defaults on its own; an explicit override embeds rather than replacing; the missing-key
		// case and one rejection per non-positive numeric field).
		// 797 after JR-4-09 added 18 in ingress/m365-ip-ranges.test.ts: 7 on reading the official feed
		// (the port-25 filter keeping the Exchange *web* front end out of the ACL is the
		// security-relevant one, plus a port range, unknown fields, deduplication, and a malformed
		// feed throwing rather than looking empty), 8 on the diff (network-not-string comparison, a
		// wider ACL entry covering an official range, an unmatched entry never becoming a removal
		// recommendation, `containedIn` for a narrower one, family confusion, unparseable entries on
		// either side, and the documented union-coverage over-report), 3 on the operator report
		// (every rendering says nothing was changed).
		// 811 after JR-4-19: 7 in journal-acceptance-bootstrap.test.ts (wired on the first attempt with
		// exactly one state line; a failed start resolving anyway and leaving the provider undefined;
		// promotion on a later attempt logged once; no further build() once wired; concurrent attempts
		// coalesced; the retry timer armed only on failure and cleared idempotently; the timer cleared
		// before the promotion is claimed) and 7 in smtp-acceptance-promotion.test.ts (451 -> 250 on
		// one unbroken connection; never 250 while unwired; a promotion mid-transfer not changing the
		// running transaction, and the reverse direction; BDAT 0 LAST; a throwing provider degrading to
		// 451; the plain value form still working through the constructor's lift).
		// 818 after JR-4-10 added tests/unit/kill-during-data-invariant.test.ts (7): calibration of
		// checkNeverPartial() (tests/support/kill-during-data-invariant.ts) against seven hand-built
		// observations, independently of the real kill test -- three that must stay clean (250 seen
		// with a fully matching row, no 250 and no row, no 250 but a fully correct row -- the
		// response-lost-in-the-kill race, not a defect) and four that must be reported (250 seen with
		// no row at all, a row with no spool file, a row whose spool file is truncated, a row that
		// belongs to a different payload entirely). This is the calibration
		// `smtp-ingress-kill-during-data.adv.test.ts` itself cannot provide on this host: F48 means
		// every real iteration there resolves to 451, so no real iteration can ever produce a
		// violation for the checker to catch.
		// 826 after JR-4-11 added tests/unit/bdat-data-byte-fidelity.test.ts (8): 4 real cases --
		// single-chunk, multi-chunk, BDAT 0 LAST, and a chunk boundary landing mid-line, each proven by
		// comparing the BDAT-stored spool object directly against the DATA-stored one (not against a
		// hand-built expectation) -- plus 4 calibration cases for expectStoredBytesIdentical() itself
		// (an untouched copy stays clean; a flipped byte, a truncated byte, and an extra trailing byte
		// must each be caught).
		// 833 after JR-4-12 added tests/unit/smtp-oversize-boundary.test.ts (7): 3 real cases -- exactly
		// at the SIZE limit (accepted, byte-identical, zero alerts of either kind), one byte over
		// (552, both detection paths: MAIL FROM SIZE= declared -- a structured warn log -- and the
		// actual-transfer overrun -- the mandatory QuarantineAlertSink, reason 'oversize-rejected',
		// file moved to quarantine/), and far over (552, both paths again, plus the connection staying
		// aligned afterward: a further QUIT on the same connection still gets exactly one clean reply)
		// -- plus 4 calibration cases for the alert-shape assertion itself (an exactly-one-correct-
		// reason alert passes; zero alerts, two alerts, and one alert with the wrong reason must each
		// be caught).
		// 835 after JR-4-14 added tests/unit/smtp-tls11-clienthello-rejection.test.ts (2): the
		// hand-built TLS 1.1 ClientHello is answered with a fatal protocol_version alert, never a
		// ServerHello, and the same process still completes a normal TLS 1.2 handshake afterward. (See
		// this suite's `expectedFiles` comment above for the second, uncommitted JR-4-14 file found on
		// this checkout and why its 16 cases are deliberately not counted here.)
		// 840 after JR-4-21a (F56 -- no cipher-suite filter, AES128-SHA negotiable with no forward
		// secrecy): +2 in ingress/smtp-server.test.ts (buildTlsSocketOptions no longer sets
		// ciphers/honorCipherOrder at all -- see that function's own doc comment for why the fix moved
		// to EsmtpServer's tls.createSecureContext() call instead -- and TLS_CIPHERS itself never
		// lists a CBC/SHA-1 or plain-RSA-key-exchange suite) + 3 in the new
		// tests/unit/smtp-tls-cipher-filter.test.ts (a client offering only AES128-SHA is refused the
		// handshake, an ordinary client still negotiates a forward-secret AEAD cipher under TLS 1.2,
		// and a TLS 1.3 handshake is unaffected).
		// 844 after JR-4-21a also added 4 to ingress/smtp-config.test.ts (F55 -- no limit on RCPT TO
		// count per transaction): DEFAULT_MAX_RECIPIENTS_PER_TRANSACTION is at least the RFC 5321
		// section 4.5.3.1.8 floor of 100, a value below that floor is rejected, exactly 100 (the
		// floor itself) is accepted, and a non-integer value is rejected.
		// 847 after JR-4-21a also added 3 to ingress/spool-write-bridge.test.ts (F50 -- the DATA path
		// wrote once per SMTP line instead of batched by byte threshold): batches pushes under the
		// flush threshold into fewer, larger chunks without losing or reordering a byte, end()
		// flushes whatever is still buffered below the threshold, and abort() discards it rather than
		// delivering it. Two pre-existing cases in the same file were changed in place, not counted
		// again, to pass an explicit flushThresholdBytes of 1 so they keep isolating the chunk-count
		// high-water-mark from the new byte-threshold batching.
		// 848 after JR-4-21a also added the new tests/unit/spool-write-bridge-throughput.test.ts (1):
		// F50's measurement, not an assertion test -- writes 50 MB as 60-byte lines and the same
		// 50 MB as 998-byte lines through the real SpoolWriteBridge/writeDurableSpoolFile() pair and
		// logs both throughputs via coverageNotice() every run, the same mechanism JR-2-08/JR-4-10
		// already use.
		// 850 after JR-4-13's acceptance review (Auflage 1) added
		// tests/unit/smtp-tls-fields-reach-acceptance.test.ts (2): a real TLS 1.3 handshake and a
		// real TLS 1.2 handshake with an explicit non-default cipher, each driven through a full
		// EHLO/MAIL/RCPT/DATA transaction and compared field-for-field against the fake
		// JournalAcceptancePort.accept() actually received.
		//
		// 991 ci = 371 (shared base) + 141 (E5) + 479 (E4), see the fork note above.
		//
		// 1019 after JR-6-01 (E6) added 28: 13 in queue-contract.test.ts (the two pinned wire names, the
		// one-field payload width, and 10 on journalInboundJobId() -- determinism, no collision over
		// 2000 ULIDs, and 7 malformed inputs each rejected rather than encoded, because a colliding job
		// id makes BullMQ *drop* an enqueue silently); 15 in journal-inbound.options.test.ts (13 on the
		// concurrency override -- 6 of them malformed forms a real shell or compose file can produce,
		// none of which may fall back to the default -- and 2 that pin maxStalledCount to 0 and
		// lockDuration to ten minutes, the two parameters whose values JR-6-03's dedup correctness and
		// long synchronous MIME parsing respectively depend on).
		//
		// 1054 after JR-6-02a added 35: 20 in spool-entry-gate.test.ts, 9 in alerts.test.ts, 8 in
		// spool-entry-reader.test.ts. The gate's 20 are the shape that matters -- every case asserts
		// `mayArchive()` explicitly, including the five that must refuse, and two of them are a
		// counter-check against a plausible wrong gate ("a ledger row exists, so archive it") which passes
		// every positive assertion in the file and fails exactly the three that decide integrity. Without
		// that pair, the suite would be satisfiable by a function that archives unconditionally.
		//
		// 1056 after JR-6-02a also added 2 to ledger-lookup.test.ts: absent-vs-SQL-NULL for the two new
		// nullable columns. That pair is a regression test for a defect this slice introduced and its own
		// test caught -- `row.size_bytes === null` does not match `undefined`, and the gate branches on
		// `contentSha256 === null`, so an `undefined` would have reported a hashless receipt as tampering.
		//
		// 1065 after the F59 fix added 9 in graceful-exit.test.ts. Note what those 9 do *not* do: they do
		// not re-assert that a spawned ingress prints "shutting down". That assertion is the one that
		// flapped (1 of 3 CI runs), so repeating it would measure the runner's mood. They pin the
		// **mechanism** instead -- the promise does not resolve before the stream reports the write, and it
		// resolves anyway when the stream never does -- against a stream whose callback the test fires
		// itself. One of the 9 is a counter-check that reproduces the unfixed shape (write, then "exit"
		// without waiting) and shows the write still in flight at the moment the process would have died.
		//
		// 1070 after F61 added 5 in smtp-connection-reset-crash.test.ts. They are calibrated, and the
		// calibration is the point: with the fix reverted the run reports `Unhandled Errors: Error: read
		// ECONNRESET` -- on Windows too. The *symptom* that exposed F61 was Linux-only (a lost shutdown
		// line, blamed on F59 for two rounds); the *cause* is not, so this suite measures it on every host.
		// `socket.resetAndDestroy()` sends a real RST, which is what makes the peer's next read fail every
		// time instead of sometimes.
		//
		// 1081 after JR-6-02b added 11 in owner-envelope.test.ts (ADR-033). Four of them are the ones that
		// matter: a journal_report result is handed misleading raw bytes and must ignore them, and three
		// build the ADR's central trap -- an `envelopeRcpt` of `archive@ourcompany.com`, whose domain IS
		// configured, so a resolver that reached for it would report a confident `primary-domain-match` on
		// the archive mailbox instead of the real recipient. A wrong owner that presents itself as right is
		// worse than an admittedly unknown one, and that is what those cases hold in place.
		expectedTests: { ci: 1081, nightly: 3, manual: 0 },
	},
	{
		name: 'integration',
		include: ['packages/*/tests/integration/**/*.int.test.ts'],
		// 4 after JR-1-04; 8 after JR-13-01 split the F1/F3/F7/F8 regressions out of
		// filter-builder.int.test.ts and added predefined-roles.int.test.ts; 9 after JR-2-04 added
		// journal-ledger-schema.int.test.ts (the CHECK constraints and keys of the ledger table);
		// 10 after JR-2-05 added journal-ledger-append-only.int.test.ts (the trigger); 11 after JR-2-06
		// added journal-ledger-writer.int.test.ts (append() against a real database); 12 after JR-2-07
		// added ledger-backend-contract.int.test.ts -- the same contract against PostgresLedgerWriter.
		// One suite, two implementations: that pair is what makes "the backend is pluggable" a
		// measurement rather than a claim. 13 after JR-3-04 added
		// journal-acceptance-bare-client.int.test.ts -- JournalAcceptance.accept() through a client
		// that is never given to drizzle() (F38's rule: anything in packages/journaling that gets its
		// connection injected needs at least one test writing through a bare client). 14 after JR-3-05
		// added journal-ledger-lookup.int.test.ts -- PostgresLedgerLookup.findBySpoolTxIds() against a
		// real database. 15 after JR-4-05a added source-acl-lookup.int.test.ts --
		// PostgresSourceAclLookup.listActiveSources() against a real database, read through a client
		// this file constructs itself and never hands to drizzle() (F38's rule). 16 after JR-4-06a
		// added journal-smtp-accept-e2e.int.test.ts -- the 250 proof: a real SMTP client over a real
		// socket, a real EsmtpServer wired to a real JournalAcceptance (real disk, real Postgres
		// through apps/smtp-ingress's own production bare-client transactor). 18 after JR-4-18 added
		// journal-crash-recovery-lock.int.test.ts (runExclusiveCrashRecoveryScan() against real
		// Postgres and real disk: requeue/quarantine against a real ledger row, a second connection
		// genuinely blocking on pg_advisory_xact_lock and proceeding once released, two different
		// spoolRoots not serialising against each other) and
		// smtp-ingress-crash-recovery-boot.int.test.ts (the same scan wired into the actual compiled
		// process: the port refuses connections while the scan is held on its advisory lock and
		// answers 220 once it is released (reworked in F49 -- it used to compare two stdout log
		// lines' byte offsets, which was flaky), two processes started at once
		// against the same spool/ledger quarantine the same orphan file exactly once and both still
		// bind their ports, and a scan that itself fails -- journal_ledger dropped, deployment_identity
		// still readable -- leaves the process bound but answering never-250 to DATA).
		// 19 after JR-4-09 added m365-range-refresh-cli.int.test.ts (the compiled range refresh helper
		// against a real database and a local fixture feed -- no internet access).
		// 20 after JR-4-19 added smtp-ingress-ledger-recovery.int.test.ts (the real process starting
		// with an unusable ledger database and promoting itself without a restart).
		// 21 after JR-4-15 added smtp-ingress-envelope-hostile-values.int.test.ts (a NUL byte in the
		// attacker-controlled ehloName cannot be represented in Postgres text -- 3 cases: the direct
		// PostgresLedgerWriter.append() rejection, that the chain still accepts a normal append
		// afterward, and the real wire protocol producing 451, never a crash or a silent 250).
		// 22 after JR-6-01 (E6) added journal-inbound-worker.int.test.ts: the compiled worker spawned
		// as its own process, proven to bind the queue and to *fail* a Phase-B job rather than report an
		// unarchived message as completed. First suite in the repository that needs Redis rather than
		// Postgres -- see probeRedis() in tests/support/infra.ts.
		expectedFiles: 22,
		// 55 before JR-2-04; 71 with the 16 schema tests of journal_ledger/deployment_identity;
		// 79 with the 8 append-only tests of JR-2-05; 87 with the 8 writer tests of JR-2-06.
		// 92 after JR-2-07: the same 5 contract cases, against PostgresLedgerWriter this time. 94 after
		// JR-3-04: the bare-client round trip through JournalAcceptance.accept() (re-verifies the chain
		// hash after storage) and the direct F38 regression case (a non-null event_payload with keys out
		// of order, through PostgresLedgerWriter.append() on the same bare client). 97 after JR-3-05: a
		// mixed batch of known/unknown spool_txids resolved correctly against the real schema and index,
		// an all-unknown batch coming back empty without error, and an empty batch never reaching the
		// database at all. 101 after JR-4-05a added source-acl-lookup.int.test.ts (4 tests, read
		// through a client this file constructs itself and never hands to drizzle() -- F38's rule):
		// an active source's CIDR list/require_tls round-trip correctly, a paused source is excluded,
		// an empty allowed_ips array round-trips, and require_tls: false is read correctly rather than
		// merely "not true".
		// 103 after JR-4-05c added 2 more to source-acl-lookup.int.test.ts: smtp_username/
		// smtp_password_hash round-trip when AUTH is configured for a source, and read back as null
		// for the ordinary source with no AUTH configured. 105 after JR-4-06a added 2 tests to
		// journal-smtp-accept-e2e.int.test.ts: the 250-with-seq round trip (spool file and ledger row
		// re-verified independently, byte-for-byte) and a second transaction on the same chain getting
		// seq + 1 while a denied recipient never reaches accept() at all.
		// 111 after JR-4-18 added 3 to journal-crash-recovery-lock.int.test.ts (requeue/quarantine
		// against a real ledger row and real disk, a second connection blocking on the real advisory
		// lock and proceeding once released, two spoolRoots not serialising against each other) and 3
		// to smtp-ingress-crash-recovery-boot.int.test.ts (scan-before-listen ordering with
		// requeue/quarantine observed at real process boot, two concurrently-starting processes not
		// racing each other's scan, a failed scan leaving the process bound but accepting nothing).
		// 116 after JR-4-09 added 5 to m365-range-refresh-cli.int.test.ts -- the compiled helper run
		// against a real database and a local fixture feed: the missing range reported and
		// allowed_ips byte-identical afterwards (the security claim of RFC section 4.3), the feed
		// asked with a clientRequestId, exit 0 when everything is covered, exit 1 (never 0) when the
		// feed cannot be read, exit 1 without a database URL.
		// 118 after JR-4-19 added 2 to smtp-ingress-ledger-recovery.int.test.ts: the process starting
		// unusable (451, untouched spool), promoting once deployment_identity is restored and accepting
		// on the same open connection; and the counter-direction, a database that stays broken never
		// producing a promotion however many retries elapse.
		// 121 after JR-4-15 added 3 to smtp-ingress-envelope-hostile-values.int.test.ts (see the
		// expectedFiles comment above for what each proves).
		// 126 after JR-6-01 added 5 in journal-inbound-worker.int.test.ts, each spawning the compiled
		// worker: it comes up and logs the parameters it chose; it picks a job off the queue and *fails*
		// it (the load-bearing one -- a completed Phase-B job claims a message is archived); an unknown
		// job name fails too rather than completing; a malformed concurrency override aborts startup
		// before the "started" line (which is what proves the entry point calls the validator its own
		// unit test covers -- F46 was two things verified separately and never together); and SIGTERM.
		// The last one always executes but branches on the platform: Windows has no POSIX signals, so
		// the graceful path is verified on the Linux CI runner only and a coverageNotice says so on
		// Windows. Deliberately not a skipIf -- these numbers are exact and must not differ per platform.
		expectedTests: { ci: 126, nightly: 0, manual: 0 },
	},
	{
		name: 'adversarial',
		include: ['packages/*/tests/adversarial/**/*.adv.test.ts'],
		// 1 until JR-2-08/JR-2-09; 3 with journal-ledger-concurrency.adv.test.ts (the 20x500 load case)
		// and journal-ledger-tamper.adv.test.ts (Testplan 12.5 cases (a) to (h)). 5 after JR-3-06/JR-3-07
		// added packages/journaling/tests/adversarial/spool-fsync-fault-injection.adv.test.ts and
		// spool-disk-full.adv.test.ts. 6 after JR-4-10 added smtp-ingress-kill-during-data.adv.test.ts.
		// 7 after JR-4-14 added smtp-protocol-robustness.adv.test.ts.
		expectedFiles: 7,
		// The one `nightly` and one `manual` suite in the repository are both in
		// mongo-to-drizzle.adv.test.ts. They are the two skips a default `pnpm test` reports.
		// ci: 3 before E2; 7 with the 4 concurrency cases of JR-2-08 (load, rollback-under-load,
		// the no-lock counter-check, and the F38 regression); 18 with the 11 tamper cases of JR-2-09.
		// 33 after JR-3-06: 15 in spool-fsync-fault-injection.adv.test.ts (3 write-stage sub-operations x
		// non-capacity cause, 2 file-fsync/directory-fsync cases driven through accept() for the first
		// time, 5 x ENOSPC-flavoured across all five sub-operations, 2 "state after a failure" cases
		// proving mkdir/createFile are clean while write()/file-fsync/directory-fsync leave a spool
		// artifact behind, 1 end-to-end case chaining a failed accept() into runCrashRecoveryScan() to
		// show the artifact gets spuriously quarantined and alerted, 1 case proving a failure does not
		// wedge the next transaction, 1 case proving the leftover debris erodes the high-water-mark
		// budget against an unrelated later transaction). 37 after JR-3-07 added 4 more in
		// spool-disk-full.adv.test.ts (2 recovery-after-clearing cases, 1 quarantine-only high-water-mark
		// case, 1 repeated-failure case). spool-disk-full.adv.test.ts also declares a `manual` suite (2
		// cases) gated on a real size-limited volume via OA_TEST_SPOOL_DISKFULL_ROOT -- it is
		// environment-gated rather than class-gated, so it contributes 0 executed tests on this host
		// under every class selection, including `OA_TEST_CLASSES=manual`; manual stays 1.
		// 38 ci / 2 nightly after JR-4-10 added smtp-ingress-kill-during-data.adv.test.ts: one `ci` test
		// (20 real SIGKILLs during a 50 MB DATA transfer, judged from the client) and one `nightly` test
		// (the same, 500 iterations) -- see that file's own doc comment for F48: on this Windows host
		// every iteration in both variants resolves to 451, never 250, so the client-saw-250-implies-
		// durable half of the invariant is unverified locally by construction; only Linux CI exercises
		// it. The checker itself (checkNeverPartial(), tests/support/kill-during-data-invariant.ts) is
		// calibrated independently in the `unit` suite's kill-during-data-invariant.test.ts.
		// 57 ci after JR-4-14 added 19 cases in smtp-protocol-robustness.adv.test.ts (ADR-029
		// Auflage 1 -- adversarial protocol robustness; see that file's own doc comment).
		// 63 ci after the same file absorbed 6 more cases from a second, independently-built JR-4-14
		// file found on this checkout mid-session (packages/journaling/tests/unit/smtp-adversarial-
		// protocol.test.ts, since deleted): a merely-long-but-under-cap address, a command-timeout
		// variant of the truncated-command case, a representative case against real spool/ledger
		// acceptance instead of the fake port, the F53 flood-during-suspended-AUTH proof (real TLS +
		// AUTH + PasswordVerifier), the calibration of the real-acceptance health check against a
		// closed port, and the F54 (proposed) fragmented-overlong-line race case.
		// 66 ci after JR-4-21 landed the fix (F52/F53/F54) and the F54 case became a Nacharbeit item
		// for JR-4-14: the single ~200 KB case became 4 (one per size in the finding's own matrix --
		// ~2000 B, 100 KB, ~200 KB, 2 MB), each repeating 10x internally rather than running once, so
		// a race this size-dependent and this non-deterministic cannot pass by luck the way CI run
		// 30900280611 did before the fix landed. Net +3 over the previous count.
		// 69 ci after JR-4-21a (F55 -- no limit on the number of RCPT TO commands per transaction)
		// added 3 cases to the same file: accepts recipients up to a configured limit and rejects one
		// over it with a distinguishable 452 4.5.3 (never ADR-030's own "different journal chain"
		// text) while the transaction still completes DATA for the recipients already accepted,
		// every further RCPT TO past the limit is rejected rather than just the first one, and the
		// unmodified default configuration accepts at least the RFC 5321 section 4.5.3.1.8 floor of
		// 100 recipients.
		expectedTests: { ci: 69, nightly: 2, manual: 1 },
	},
];

export function suiteInclude(name: SuiteName): string[] {
	const spec = SUITES.find((candidate) => candidate.name === name);
	if (!spec) {
		throw new Error(`Unknown suite "${name}". Known: ${SUITES.map((s) => s.name).join(', ')}.`);
	}
	return [...spec.include];
}

/**
 * Anything named like a test. Deliberately wider than the include globs -- the point is to catch
 * files the globs do *not* reach. `.json` is excluded on purpose so that
 * `packages/backend/tsconfig.test.json` is not mistaken for a test.
 */
const TEST_FILE_NAME = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Directories never worth walking. `dist` and `node_modules` are also excluded by vitest itself. */
const SKIPPED_DIRECTORIES = new Set([
	'node_modules',
	'dist',
	'build',
	'coverage',
	'.git',
	'.svelte-kit',
	'.vitepress',
	'.turbo',
	'.pnpm-store',
]);

/**
 * Translate one include glob into a regular expression.
 *
 * Supports exactly the syntax the globs above use, and nothing more: `*` for "anything within one
 * path segment", `**` + `/` for "zero or more path segments", a trailing `**` for "anything".
 * Written out rather than pulled from a dependency because neither `picomatch` nor `tinyglobby`
 * resolves at this workspace root, and a new dependency for twenty lines is a bad trade. Its own
 * unit tests are in `packages/backend/tests/unit/suite-inventory.test.ts`.
 */
export function globToRegExp(glob: string): RegExp {
	let pattern = '';
	let index = 0;
	while (index < glob.length) {
		const char = glob[index]!;
		if (char === '*') {
			if (glob[index + 1] === '*') {
				if (glob[index + 2] === '/') {
					// `**/` -- zero or more complete segments, so `a/**/b.ts` also matches `a/b.ts`.
					pattern += '(?:[^/]+/)*';
					index += 3;
					continue;
				}
				pattern += '.*';
				index += 2;
				continue;
			}
			pattern += '[^/]*';
			index += 1;
			continue;
		}
		pattern += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
		index += 1;
	}
	return new RegExp(`^${pattern}$`);
}

const compiled = new Map<string, RegExp>();

function matches(glob: string, relativePath: string): boolean {
	let regex = compiled.get(glob);
	if (!regex) {
		regex = globToRegExp(glob);
		compiled.set(glob, regex);
	}
	return regex.test(relativePath);
}

/** Which suites would collect this file? Empty means: nobody runs it. */
export function suitesMatching(relativePath: string): SuiteName[] {
	return SUITES.filter((spec) => spec.include.some((glob) => matches(glob, relativePath))).map(
		(spec) => spec.name
	);
}

/** Every test-looking file in the repository, as `/`-separated repository-relative paths. */
export function listTestLikeFiles(root: string = REPO_ROOT): string[] {
	const found: string[] = [];
	const walk = (absolute: string, relative: string): void => {
		for (const entry of readdirSync(absolute, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (SKIPPED_DIRECTORIES.has(entry.name)) {
					continue;
				}
				walk(
					path.join(absolute, entry.name),
					relative ? `${relative}/${entry.name}` : entry.name
				);
				continue;
			}
			if (!entry.isFile() || !TEST_FILE_NAME.test(entry.name)) {
				continue;
			}
			found.push(relative ? `${relative}/${entry.name}` : entry.name);
		}
	};
	walk(root, '');
	return found.sort();
}

export interface InventoryReport {
	/** Files matched, per suite. */
	readonly counts: Record<SuiteName, number>;
	/** Test-looking files no suite collects. */
	readonly unclassified: string[];
	/** Human-readable problems. Empty means the inventory holds. */
	readonly violations: string[];
	/** One line, printed on every run. */
	readonly summary: string;
}

export function collectSuiteInventory(root: string = REPO_ROOT): InventoryReport {
	const files = listTestLikeFiles(root);
	const counts = { unit: 0, integration: 0, adversarial: 0 } as Record<SuiteName, number>;
	const unclassified: string[] = [];

	for (const file of files) {
		const owners = suitesMatching(file);
		if (owners.length === 0) {
			unclassified.push(file);
			continue;
		}
		for (const owner of owners) {
			counts[owner] += 1;
		}
	}

	const violations: string[] = [];
	for (const spec of SUITES) {
		if (counts[spec.name] !== spec.expectedFiles) {
			const direction = counts[spec.name] < spec.expectedFiles ? 'fewer' : 'more';
			violations.push(
				`Suite "${spec.name}" matched ${counts[spec.name]} file(s), but exactly ` +
					`${spec.expectedFiles} are expected -- ${direction} than declared.\n` +
					`    include: ${spec.include.join(', ')}\n` +
					`    A suite that matches nothing is reported as green by vitest. The count is ` +
					`checked for equality rather than as a lower bound (F15): slack lets a deletion the ` +
					`size of the slack pass unnoticed. If this change is intended, set expectedFiles to ` +
					`${counts[spec.name]} for suite "${spec.name}" in tests/support/suite-inventory.ts ` +
					`in the same commit -- and expectedTests with it.`
			);
		}
	}
	if (unclassified.length > 0) {
		violations.push(
			`${unclassified.length} file(s) are named like tests but are collected by no project, so ` +
				`they never run and a failing assertion inside them cannot be seen:\n` +
				unclassified.map((file) => `      ${file}`).join('\n') +
				`\n    Naming rules: units are \`*.test.ts\` under \`src/\` or \`tests/unit/\`, ` +
				`integration tests are \`*.int.test.ts\` under \`tests/integration/\`, adversarial ` +
				`tests are \`*.adv.test.ts\` under \`tests/adversarial/\`.`
		);
	}

	const summary =
		`[TEST-INVENTORY] ` +
		SUITES.map(
			(spec) => `${spec.name}: ${counts[spec.name]} file(s) (expected ${spec.expectedFiles})`
		).join(' · ') +
		` · unclassified: ${unclassified.length}`;

	return { counts, unclassified, violations, summary };
}

/**
 * Write the inventory as JSON when `OA_TEST_INVENTORY_REPORT` names a path.
 *
 * This is how CI states its expectation **positively**: the job requires the file to exist and to
 * satisfy the counts it carries. A run in which `globalSetup` never executed -- because the entry
 * was removed from `vitest.config.ts`, say -- produces no file, and the job fails on its absence
 * rather than on the absence of a log line. The expectations travel inside the report, so the check
 * needs no copy of them.
 */
function writeInventoryReport(report: InventoryReport): void {
	const target = process.env.OA_TEST_INVENTORY_REPORT?.trim();
	if (!target) {
		return;
	}
	const payload = {
		generatedAt: new Date().toISOString(),
		summary: report.summary,
		suites: SUITES.map((spec) => ({
			name: spec.name,
			include: [...spec.include],
			expectedFiles: spec.expectedFiles,
			expectedTests: Object.fromEntries(
				TEST_CLASSES.map((cls) => [cls, spec.expectedTests[cls]])
			),
			files: report.counts[spec.name],
		})),
		unclassified: report.unclassified,
		violations: report.violations,
	};
	mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
	writeFileSync(path.resolve(target), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Report the inventory and fail the whole run if it does not hold.
 *
 * Called from `globalSetup`, so a violation aborts before any test executes and shows up in every
 * environment -- `pnpm test`, `pnpm test:integration`, CI alike.
 */
export function assertSuiteInventory(root: string = REPO_ROOT): void {
	const report = collectSuiteInventory(root);
	// Printed unconditionally, including on a green run: the counts are the evidence that the suites
	// were present, and evidence that is only printed on failure is evidence nobody reads.
	console.log(report.summary);
	writeInventoryReport(report);
	if (report.violations.length === 0) {
		return;
	}
	throw new Error(
		`Test suite inventory check failed (JR-1-05b).\n\n` +
			report.violations.map((violation) => `  - ${violation}`).join('\n\n') +
			`\n\n${report.summary}`
	);
}
