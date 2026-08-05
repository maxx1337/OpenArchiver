import * as dotenv from 'dotenv';
import pino from 'pino';
import postgres from 'postgres';
import {
	bindSourceAclCache,
	createSourceAclRequireTlsResolver,
	ensureSpoolLayout,
	EsmtpServer,
	formatIngressConfigError,
	JournalAcceptance,
	JournalAcceptanceBootstrap,
	NodeSpoolFileSystem,
	parseIngressConfig,
	PerSourceConnectionLimiter,
	PerSourceTransactionRateLimiter,
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	PostgresSourceAclLookup,
	runExclusiveCrashRecoveryScan,
	SourceAclCache,
	writeLineThenFlush,
	type JournalAcceptancePort,
	type QuarantineAlertSink,
} from '@open-archiver/journaling';
import { createBcryptPasswordVerifier } from './bcrypt-password-verifier';
import { readIngressConfigInput } from './config-from-env';
import { createLedgerQuery } from './postgres-query';
import { postgresTransactor } from './postgres-transactor';

/**
 * `apps/smtp-ingress` -- entry point (`JR-4-01`, ESMTP listener wired in `JR-4-02`).
 *
 * Deliberately thin: every non-trivial decision (configuration validation, spool layout, the ESMTP
 * protocol engine itself) is a call into `@open-archiver/journaling`. This file only reads the
 * environment, constructs the one thing that is legitimately this process's own concern (the
 * `pino` logger -- see below), wires the objects together, handles process signals, and starts the
 * process -- exactly the split `docs/dev/journaling/02-architektur.md` section 2 calls for.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this imports neither `packages/backend/src/config/*` nor `src/database/index.ts`
 * ---------------------------------------------------------------------------------------------
 * Both would be inherited crashes and inherited credentials for subsystems this process does not
 * use (ADR-002). The only workspace dependency here is `@open-archiver/journaling`; there is no
 * dependency on `@open-archiver/backend` at all, checked transitively (not by convention) in
 * `packages/journaling/tests/unit/ingress-import-graph.test.ts`, which walks this file's actual
 * import graph and fails if anything under `packages/backend` shows up in it.
 *
 * ---------------------------------------------------------------------------------------------
 * `logLevel` gets a real reader here (`JR-4-02`)
 * ---------------------------------------------------------------------------------------------
 * `packages/journaling/src/ingress/smtp-server.ts` declares the `IngressLogger` port but never
 * constructs a logger itself -- consistent with configuration and loggers being injected, never
 * imported, by that package. This file is where `config.logLevel` (validated but unread since
 * `JR-4-01`) becomes a real `pino` instance's `level`, passed in as `EsmtpServer`'s `logger` option.
 * `pino` is a dependency of this app, not of `packages/journaling` -- adding it there would have
 * repeated the same "third-party library in the pure-logic package" question `EsmtpServer`'s own
 * doc comment resolves for the SMTP engine itself; a logger is exactly the kind of capability this
 * project already injects rather than imports (`SpoolFileSystem`, `LedgerBackend`,
 * `QuarantineAlertSink` are the same pattern).
 *
 * ---------------------------------------------------------------------------------------------
 * The first database connection this process has ever needed (`JR-4-05a`)
 * ---------------------------------------------------------------------------------------------
 * `JR-4-01`-`JR-4-04` never touched the database at all. The source ACL does: ADR-002's
 * privilege-separation table grants this process its **own** role with `SELECT` on
 * `journaling_sources` and the ledger head, nothing else -- a deliberately different credential
 * (`SMTP_INGRESS_DATABASE_URL`) than `packages/backend`'s `DATABASE_URL`. The connection is a bare
 * `postgres()` client, never routed through `drizzle()` (there is no reason to import `drizzle`
 * here at all, and `./postgres-query.ts`'s doc comment explains why that matters: F38's
 * double-encoding defect was specifically about the patch `drizzle()` applies to a client it is
 * given). `SourceAclCache` polls this connection on a timer rather than once per accepted
 * connection -- see `@open-archiver/journaling`'s `source-acl-cache.ts` for why a query-per-connect
 * would make Postgres a hard dependency of the receive path's availability.
 *
 * ---------------------------------------------------------------------------------------------
 * `250` becomes possible (`JR-4-06a`)
 * ---------------------------------------------------------------------------------------------
 * A second, again deliberately separate, connection (`SMTP_INGRESS_LEDGER_DATABASE_URL`,
 * `ledger-config.ts`) backs `PostgresLedgerWriter` via `./postgres-transactor.ts`'s bare-client
 * transactor (F38, same reasoning as `sourceAclSql` above). `JournalAcceptance` is constructed from
 * that writer plus the same spool configuration `ensureSpoolLayout()` already used, and handed to
 * `EsmtpServer` as `journalAcceptance` -- the one thing that turns `completeTransfer()`'s reply from
 * `451` (acceptance not wired) into a real durability decision. See
 * `@open-archiver/journaling`'s `smtp-server.ts` module doc comment, "`JournalAcceptance.accept()` is
 * wired in", for what that changes.
 *
 * **Unconfigured or unreachable at boot is not fatal to the process.** `ledger.databaseUrl` is
 * optional (`ledger-config.ts`'s own doc comment argues why that is safe, unlike `sourceAcl`'s
 * required one): with it unset, no acceptance is ever wired and this process behaves exactly as it
 * did before `JR-4-06a`. With it set but the database unreachable (or `deployment_identity`
 * unexpectedly empty) at the query this needs (`PostgresLedgerWriter`'s own doc comment: the
 * deployment id is read once, not per append), this process logs the failure loudly and binds the
 * SMTP port anyway, answering every transaction `451` -- rather than refusing to start.
 *
 * ---------------------------------------------------------------------------------------------
 * That start-time failure is no longer permanent (`JR-4-19`)
 * ---------------------------------------------------------------------------------------------
 * Until `JR-4-19` it was: the acceptance port was built once, and a database that was down for those
 * few seconds left this process answering `451` **forever**, looking healthy the whole time, until an
 * operator noticed and restarted it -- long after Exchange Online had given up retrying and started
 * generating NDRs. `JournalAcceptanceBootstrap` (`@open-archiver/journaling`) closes that: it keeps
 * retrying `buildJournalAcceptance()` on a timer (`ledger.retryIntervalMs`, 30 s by default) until it
 * succeeds, logs the transition exactly once, and then stops -- and `EsmtpServer` takes a
 * **provider** rather than a value, so the promotion reaches connections that are already open,
 * without a restart and without dropping anyone. What has *not* changed, deliberately: until that
 * first success every `DATA`/`BDAT ... LAST` answers `451 4.3.0` and never `250`, so nothing is ever
 * acknowledged without a ledger entry. See that class's doc comment for why the retry loop stops after
 * the first success (a later outage is already handled by `accept()` mapping a failing append to
 * `451`) and why re-running the crash-recovery scan on each attempt is safe.
 *
 * ---------------------------------------------------------------------------------------------
 * The crash-recovery scan runs here, before the port ever binds (`JR-4-18`)
 * ---------------------------------------------------------------------------------------------
 * `runCrashRecoveryScan()` (`JR-3-05`) was built, tested, and accepted with E3 -- and had no caller
 * anywhere in this repository until now (found by the Product Owner, not by any E4 task naming it).
 * `buildJournalAcceptance()` below calls `runExclusiveCrashRecoveryScan()`
 * (`@open-archiver/journaling`'s `crash-recovery-lock.ts`) immediately after the `deployment_identity`
 * read succeeds and before `PostgresLedgerWriter`/`JournalAcceptance` are constructed -- still inside
 * `main()`'s straight-line `async` sequence, so it always completes before `server.listen()` a few
 * lines down. See that module's doc comment for why the lock is transaction-scoped
 * (`pg_advisory_xact_lock`, matching `ledger-writer.ts`'s own reasoning for the per-chain append lock)
 * and for the binding rule it leaves the not-yet-built `journal-inbound` worker (E6): call the same
 * exclusive function, against the same database and `spoolRoot`, or its scan can race this process's
 * live acceptance.
 *
 * **A scan failure is not fatal either, and folds into the same fallback as an unreachable ledger
 * database.** It runs inside the same `try` block as the `deployment_identity` read, so a scan that
 * throws (a spool the process cannot read, a database that becomes unreachable between the identity
 * read and the scan's own queries) is caught by the same `catch` and produces the same outcome:
 * `journalAcceptance` stays `undefined`, the failure is logged loudly, and the process still binds the
 * port but -- per `smtp-server.ts`'s own "`JournalAcceptance.accept()` is wired in" section --
 * `journalAcceptance === undefined` means *every* `DATA`/`BDAT ... LAST` unconditionally answers
 * `451 4.3.0`, forever, until the next restart. That is what "a failed scan does not silently let the
 * process start" means here: not a crash loop, but a process that binds the port and demonstrably
 * accepts nothing, which `ingress-crash-recovery-boot.int.test.ts` measures directly rather than
 * inferring from the code.
 *
 * ---------------------------------------------------------------------------------------------
 * Per-source connection/transaction-rate limits (`JR-4-08`)
 * ---------------------------------------------------------------------------------------------
 * `journaling_sources` has no connection- or rate-limit column -- `rate-limit-config.ts`'s doc
 * comment explains why this is process configuration instead, with a seam a later per-source
 * override could tighten. `PerSourceConnectionLimiter`/`PerSourceTransactionRateLimiter` are built
 * once here, for the whole process lifetime, and passed into `EsmtpServer` as
 * `connectionLimiter`/`transactionRateLimiter` -- both keyed by the same `sourceId` the source ACL
 * (`sourceAclEvaluator` above) resolves at connect time, which is also why an IP the ACL itself
 * rejects can never occupy a slot in either limiter (`connection-rate-limiter.ts`'s doc comment).
 * Both are unconditional here (no `undefined` fallback the way `journalAcceptance` has one) --
 * unlike the ledger, a missing rate-limit configuration is not a reason to run unbounded; the zod
 * schema's own defaults (`rate-limit-config.ts`) are what an operator gets for free.
 */

dotenv.config();

/** A quarantine alert (`JR-3-09`) reaches the operator through this process's own logger -- the
 * only place `apps/smtp-ingress` has to put one (`packages/journaling` has neither a logger nor an
 * opinion on where alerts go; see `QuarantineAlertSink`'s doc comment). */
function pinoAlertSink(logger: import('pino').Logger): QuarantineAlertSink {
	return {
		alert: (event) => {
			logger.error({ event }, 'smtp-ingress: spool file quarantined');
		},
	};
}

/**
 * Build the durable-acceptance dependency `EsmtpServer` needs (`JR-4-06a`), or **throw**
 * (`JR-4-19`).
 *
 * Throwing rather than returning `undefined` is the whole point of the `JR-4-19` change: this is now
 * `JournalAcceptanceBootstrap`'s `build` callback, and that class is what decides what a failure
 * means -- log it, keep answering `451`, and try again on a timer until it succeeds. Before
 * `JR-4-19` this function swallowed its own failure and returned `undefined`, which made the failure
 * permanent for the life of the process.
 *
 * `ledgerSql` is passed **in**, and deliberately reused across every attempt: `postgres-js`
 * reconnects on its own, so a retry needs no new client, and the caller keeps sole responsibility for
 * closing it on shutdown.
 */
async function buildJournalAcceptance(
	config: ReturnType<typeof parseIngressConfig>,
	logger: import('pino').Logger,
	ledgerSql: postgres.Sql
): Promise<JournalAcceptancePort> {
	// Read once per attempt, never per append -- PostgresLedgerWriterOptions.deploymentId's own doc
	// comment. A bare, unpatched client (F38) -- see ./postgres-transactor.ts's doc comment.
	const rows = await ledgerSql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	const deploymentId = rows[0]?.deployment_id;
	if (deploymentId === undefined) {
		throw new Error('deployment_identity has no row -- has this database been migrated?');
	}

	const transactor = postgresTransactor(ledgerSql);

	// JR-4-18: reconcile the spool against the ledger before this process ever binds its port --
	// see this file's module doc comment, "The crash-recovery scan runs here", and
	// crash-recovery-lock.ts's own doc comment for the exclusivity this holds across processes.
	// JR-4-19: this re-runs on every retry, which is safe for as long as acceptance is unwired --
	// see JournalAcceptanceBootstrap's doc comment, "The crash-recovery scan runs inside every
	// attempt".
	const scanResult = await runExclusiveCrashRecoveryScan({
		fs: new NodeSpoolFileSystem(),
		ledgerLookup: new PostgresLedgerLookup(createLedgerQuery(ledgerSql)),
		spoolRoot: config.spool.rootPath,
		alertSink: pinoAlertSink(logger),
		transactor,
	});
	logger.info(
		{
			incomingFilesScanned: scanResult.incomingFilesScanned,
			requeued: scanResult.requeue.length,
			quarantined: scanResult.quarantined.length,
			preexistingQuarantineFiles: scanResult.preexistingQuarantineFiles,
		},
		'smtp-ingress: crash-recovery scan complete'
	);

	const backend = new PostgresLedgerWriter({ deploymentId, transactor });
	return new JournalAcceptance({
		fs: new NodeSpoolFileSystem(),
		backend,
		spoolConfig: config.spool,
		alertSink: pinoAlertSink(logger),
	});
}

async function main(): Promise<void> {
	const config = parseIngressConfig(readIngressConfigInput(process.env));

	const logger = pino({ level: config.logLevel });

	// The process owns the spool (privilege-separation table, architecture section 1). Creating
	// `incoming/`/`quarantine/` here, before anything binds, is the first step of the startup order
	// that architecture section 5 requires to later make room for the crash-recovery scan -- not
	// implemented yet (that is `JR-3-05`'s caller, still to be wired into this process), but nothing
	// here precludes inserting it between this line and the `listen()` call below.
	await ensureSpoolLayout(new NodeSpoolFileSystem(), config.spool.rootPath);

	// JR-4-05a: this process's own read-only-role connection (ADR-002). `onnotice` silenced the same
	// way the test harness already does for its own bare pools -- routine NOTICE-level chatter, not
	// an error.
	const sourceAclSql = postgres(config.sourceAcl.databaseUrl, { onnotice: () => {} });
	const sourceAclCache = new SourceAclCache({
		lookup: new PostgresSourceAclLookup(createLedgerQuery(sourceAclSql)),
		refreshIntervalMs: config.sourceAcl.refreshIntervalMs,
		staleAfterMs: config.sourceAcl.staleAfterMs,
		logger,
	});
	// Load the first snapshot before binding the listening port: an accepted connection must never
	// see an evaluator that has not tried to load anything yet (that would be indistinguishable from
	// "unavailable" anyway, but there is no reason to accept a connection just to reject it).
	await sourceAclCache.start();

	// JR-4-06a/JR-4-19: with no ledger database configured there is nothing to wait for, so no
	// bootstrap is started at all and the provider stays permanently `undefined` (every transaction
	// answers 451, exactly as before). With one configured, the bootstrap owns the retry loop -- see
	// this file's module doc comment, "`250` becomes possible", and
	// `JournalAcceptanceBootstrap`'s own.
	const ledgerSql =
		config.ledger.databaseUrl === undefined
			? null
			: postgres(config.ledger.databaseUrl, { onnotice: () => {} });
	const acceptanceBootstrap =
		ledgerSql === null
			? undefined
			: new JournalAcceptanceBootstrap({
					build: () => buildJournalAcceptance(config, logger, ledgerSql),
					retryIntervalMs: config.ledger.retryIntervalMs,
					logger,
				});
	// Awaited before `listen()` below, not alongside it: on the success path the crash-recovery scan
	// inside `build` has to finish before the port accepts anything (`JR-4-18`, and the ordering proof
	// F49 rebuilt measures exactly that). On the failure path this resolves too -- the process binds
	// and answers 451 while the bootstrap keeps trying in the background.
	await acceptanceBootstrap?.start();

	// JR-4-08: one limiter instance each, process-lifetime, shared by every connection --
	// per-source bookkeeping lives inside them (see @open-archiver/journaling's
	// connection-rate-limiter.ts for why that is safe: keyed by sourceId, which is itself bounded by
	// the number of active journaling_sources rows, and only ever reachable for a connection the
	// source ACL already resolved to 'allowed').
	const connectionLimiter = new PerSourceConnectionLimiter(
		config.rateLimit.maxConnectionsPerSource
	);
	const transactionRateLimiter = new PerSourceTransactionRateLimiter(
		config.rateLimit.maxTransactionsPerSourcePerWindow,
		config.rateLimit.rateLimitWindowMs
	);

	const server = new EsmtpServer({
		smtp: config.smtp,
		tls: config.tls,
		logger,
		// JR-4-05b/JR-4-05c: the same SourceAclCache instance for the source ACL, the recipient ACL,
		// and the AUTH credential lookup -- one refresh cycle serves all three ACLs, see that class's
		// doc comment for why this is deliberately not a second (or third) cache. `bindSourceAclCache`
		// (`JR-4-20`, closing F46) is the one function that maps the cache onto these three
		// `EsmtpServerOptions` slots -- the same function `source-acl-cache-wiring.test.ts` calls, so
		// a test proves the real binding rather than a hand-written copy of it.
		...bindSourceAclCache(sourceAclCache),
		// JR-4-05c: bcrypt lives here, not in packages/journaling -- see PasswordVerifier's doc
		// comment.
		passwordVerifier: createBcryptPasswordVerifier(),
		requireTlsResolver: createSourceAclRequireTlsResolver(
			sourceAclCache,
			config.tls.requireTls
		),
		// JR-4-19: a provider, not a value -- so acceptance that only becomes available after this
		// server is listening still takes effect, on connections that are already open, without a
		// restart. Resolved once per transaction at `MAIL FROM`; see `JournalAcceptanceProvider`'s doc
		// comment in @open-archiver/journaling's smtp-server.ts.
		journalAcceptanceProvider: acceptanceBootstrap?.provider(),
		// JR-4-08: both keyed by the same connect-time source ACL match `sourceAclEvaluator` above
		// already provides -- see connection-rate-limiter.ts's doc comment for why that makes both
		// gates unreachable for a source the ACL itself has not admitted.
		connectionLimiter,
		transactionRateLimiter,
	});
	await server.listen(config.smtpPort);

	console.log(
		`smtp-ingress: listening on port ${config.smtpPort}, spool at ${config.spool.rootPath}`
	);

	let shuttingDown = false;
	const shutdown = (signal: NodeJS.Signals): void => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		// F59: `console.log` here plus `process.exit(0)` below lost this line whenever the drain finished
		// before the pipe write did -- `process.exit()` does not flush pending async `stdout` writes, and
		// `stdout` is a pipe under every test harness and every process supervisor. It cost two red CI
		// runs in E6 on a process that had shut down perfectly. The write is now something the exit
		// **waits for**, with a bounded wait: a hung shutdown would be worse than a lost line, so
		// `writeLineThenFlush()` never rejects and gives up after two seconds.
		const shutdownLineFlushed = writeLineThenFlush(
			process.stdout,
			`smtp-ingress: received ${signal}, shutting down`
		);
		sourceAclCache.stop();
		// JR-4-19: stop the retry timer too. It is `unref()`'d, so it would not hold the loop open,
		// but a retry firing during the drain would open a database transaction and take the
		// crash-recovery advisory lock while connections are being closed.
		acceptanceBootstrap?.stop();
		const closeConnections = (): Promise<void> =>
			Promise.all([
				sourceAclSql.end({ timeout: 5 }),
				ledgerSql ? ledgerSql.end({ timeout: 5 }) : Promise.resolve(),
			]).then(() => undefined);
		// F59: the shutdown line is awaited **after** the drain, not before it. Putting the wait first
		// would delay closing connections for the sake of a log line; putting it last costs nothing in the
		// normal case (by then the write has long since flushed) and only matters in exactly the case that
		// broke -- a drain that finished faster than the pipe.
		const exit = (): Promise<void> =>
			closeConnections()
				.catch(() => undefined)
				.then(() => shutdownLineFlushed)
				.then(() => {
					process.exit(0);
				});
		// JR-4-06b: `server.close()` now performs the graceful drain itself (skill `journal-ledger`
		// section 2's "Shutdown in progress" row) -- an idle connection gets `421 4.3.2` immediately, a
		// connection mid-transaction is left alone until it earns its own real reply, and only then
		// closed. Nothing here changed to get that: `EsmtpServer.close()`'s contract is what grew: see
		// `@open-archiver/journaling`'s `smtp-server.ts`, `EsmtpServer.close()`'s doc comment, and
		// `packages/journaling/tests/unit/smtp-graceful-shutdown.test.ts` for the proof.
		void server.close().then(exit, exit);
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
	console.error(formatIngressConfigError(error));
	process.exit(1);
});
