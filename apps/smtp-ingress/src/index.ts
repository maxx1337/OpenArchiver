import * as dotenv from 'dotenv';
import pino from 'pino';
import postgres from 'postgres';
import {
	createSourceAclRequireTlsResolver,
	ensureSpoolLayout,
	EsmtpServer,
	formatIngressConfigError,
	NodeSpoolFileSystem,
	parseIngressConfig,
	PostgresSourceAclLookup,
	SourceAclCache,
} from '@open-archiver/journaling';
import { readIngressConfigInput } from './config-from-env';
import { createLedgerQuery } from './postgres-query';

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
 */

dotenv.config();

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

	const server = new EsmtpServer({
		smtp: config.smtp,
		tls: config.tls,
		logger,
		sourceAclEvaluator: sourceAclCache,
		requireTlsResolver: createSourceAclRequireTlsResolver(
			sourceAclCache,
			config.tls.requireTls
		),
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
		server.close().then(
			() => sourceAclSql.end({ timeout: 5 }).finally(() => process.exit(0)),
			() => sourceAclSql.end({ timeout: 5 }).finally(() => process.exit(0))
		);
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
	console.error(formatIngressConfigError(error));
	process.exit(1);
});
