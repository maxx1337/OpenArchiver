import * as dotenv from 'dotenv';
import pino from 'pino';
import postgres from 'postgres';
import {
	createSourceAclRequireTlsResolver,
	ensureSpoolLayout,
	EsmtpServer,
	formatIngressConfigError,
	JournalAcceptance,
	NodeSpoolFileSystem,
	parseIngressConfig,
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	PostgresSourceAclLookup,
	runExclusiveCrashRecoveryScan,
	SourceAclCache,
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
 * required one): with it unset, `journalAcceptance` stays `undefined` and this process behaves
 * exactly as it did before this task. With it set but the database unreachable (or
 * `deployment_identity` unexpectedly empty) at the one startup-time query this needs
 * (`PostgresLedgerWriter`'s own doc comment: the deployment id is read once, not per append), this
 * process logs the failure loudly and falls back to the same `undefined` rather than refusing to
 * bind the SMTP port at all -- deliberately narrower tolerance than `SourceAclCache`'s
 * available-first-then-fail-closed design (which keeps *retrying* in the background), because
 * building an equivalent retry/promotion path for the ledger is more than this task's "wire
 * `accept()` in" scope. Flagged for the Product Owner: a deployment that means to accept mail
 * durably but has a typo'd or briefly-down ledger database at the moment this process starts will
 * not crash-loop -- it will bind the port and answer every transaction `451` until the *next*
 * restart, which is a real, current limitation rather than an oversight.
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
 * Build the durable-acceptance dependency `EsmtpServer` needs (`JR-4-06a`). Returns `undefined`
 * whenever `journalAcceptance` should stay unwired -- either `ledger.databaseUrl` was never
 * configured, or it was configured but the one startup-time query this needs failed. See this
 * file's module doc comment, "`250` becomes possible", for why the second case is a logged failure
 * rather than a startup crash.
 *
 * The returned `ledgerSql`, when non-`null`, is this function's caller's responsibility to close on
 * shutdown -- this function only opens it, it never closes anything itself, so a caller that decides
 * not to use the connection (the failure path below) still owns cleanup.
 */
async function buildJournalAcceptance(
	config: ReturnType<typeof parseIngressConfig>,
	logger: import('pino').Logger
): Promise<{
	journalAcceptance: JournalAcceptancePort | undefined;
	ledgerSql: postgres.Sql | null;
}> {
	if (config.ledger.databaseUrl === undefined) {
		return { journalAcceptance: undefined, ledgerSql: null };
	}

	const ledgerSql = postgres(config.ledger.databaseUrl, { onnotice: () => {} });
	try {
		// Read once, at startup, never per append -- PostgresLedgerWriterOptions.deploymentId's own
		// doc comment. A bare, unpatched client (F38) -- see ./postgres-transactor.ts's doc comment.
		const rows = await ledgerSql<{ deployment_id: string }[]>`
			select deployment_id from deployment_identity
		`;
		const deploymentId = rows[0]?.deployment_id;
		if (deploymentId === undefined) {
			throw new Error('deployment_identity has no row -- has this database been migrated?');
		}

		const transactor = postgresTransactor(ledgerSql);

		// JR-4-18: reconcile the spool against the ledger before this process ever binds its port --
		// see this file's module doc comment, "The crash-recovery scan runs here", for why this sits
		// inside the same try/catch as the deployment-identity read above, and
		// crash-recovery-lock.ts's own doc comment for the exclusivity this holds across processes.
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
		const journalAcceptance = new JournalAcceptance({
			fs: new NodeSpoolFileSystem(),
			backend,
			spoolConfig: config.spool,
			alertSink: pinoAlertSink(logger),
		});
		return { journalAcceptance, ledgerSql };
	} catch (err) {
		logger.error(
			{ err },
			'smtp-ingress: could not initialize the ledger database connection, or the crash-recovery ' +
				'scan failed, at startup -- accepting connections, but every transaction will answer ' +
				'451 (acceptance not wired) until this is fixed and the process is restarted'
		);
		return { journalAcceptance: undefined, ledgerSql };
	}
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

	// JR-4-06a: see this file's module doc comment, "`250` becomes possible", for what an
	// `undefined` result here means and why it is not a startup failure.
	const { journalAcceptance, ledgerSql } = await buildJournalAcceptance(config, logger);

	const server = new EsmtpServer({
		smtp: config.smtp,
		tls: config.tls,
		logger,
		sourceAclEvaluator: sourceAclCache,
		// JR-4-05b/JR-4-05c: the same SourceAclCache instance for both the recipient ACL and the AUTH
		// credential lookup -- one refresh cycle serves all three ACLs, see that class's doc comment
		// for why this is deliberately not a second (or third) cache.
		recipientAclEvaluator: sourceAclCache,
		authCredentialEvaluator: sourceAclCache,
		// JR-4-05c: bcrypt lives here, not in packages/journaling -- see PasswordVerifier's doc
		// comment.
		passwordVerifier: createBcryptPasswordVerifier(),
		requireTlsResolver: createSourceAclRequireTlsResolver(
			sourceAclCache,
			config.tls.requireTls
		),
		journalAcceptance,
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
		console.log(`smtp-ingress: received ${signal}, shutting down`);
		sourceAclCache.stop();
		const closeConnections = (): Promise<void> =>
			Promise.all([
				sourceAclSql.end({ timeout: 5 }),
				ledgerSql ? ledgerSql.end({ timeout: 5 }) : Promise.resolve(),
			]).then(() => undefined);
		server.close().then(
			() => closeConnections().finally(() => process.exit(0)),
			() => closeConnections().finally(() => process.exit(0))
		);
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
	console.error(formatIngressConfigError(error));
	process.exit(1);
});
