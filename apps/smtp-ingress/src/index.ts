import { createServer, type Server } from 'node:net';
import * as dotenv from 'dotenv';
import {
	ensureSpoolLayout,
	formatIngressConfigError,
	NodeSpoolFileSystem,
	parseIngressConfig,
} from '@open-archiver/journaling';
import { readIngressConfigInput } from './config-from-env';

/**
 * `apps/smtp-ingress` -- entry point (`JR-4-01`).
 *
 * Deliberately thin: every non-trivial decision (configuration validation, spool layout) is a call
 * into `@open-archiver/journaling`. This file only reads the environment, wires the objects
 * together, handles process signals, and starts the process -- exactly the split
 * `docs/dev/journaling/02-architektur.md` section 2 calls for.
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
 * The placeholder listener
 * ---------------------------------------------------------------------------------------------
 * `JR-4-02` replaces the bare `net.createServer()` below with the real ESMTP server (EHLO,
 * PIPELINING, 8BITMIME, SMTPUTF8, SIZE, timeouts). Binding a real socket on the configured port
 * now -- rather than only parsing configuration and exiting -- is what makes "the process starts
 * independently" an observable fact: `ingress-process-boot.test.ts` connects to it.
 */

dotenv.config();

async function main(): Promise<void> {
	const config = parseIngressConfig(readIngressConfigInput(process.env));

	// The process owns the spool (privilege-separation table, architecture section 1). Creating
	// `incoming/`/`quarantine/` here, before anything binds, is the first step of the startup order
	// that architecture section 5 requires to later make room for the crash-recovery scan -- not
	// implemented yet (that is `JR-3-05`'s caller, still to be wired into this process), but nothing
	// here precludes inserting it between this line and the `listen()` call below.
	await ensureSpoolLayout(new NodeSpoolFileSystem(), config.spool.rootPath);

	const server: Server = createServer((socket) => {
		// No protocol yet -- JR-4-02. Closing immediately keeps this from ever being mistaken for a
		// working listener while still proving the port accepts connections.
		socket.destroy();
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(config.smtpPort, () => {
			server.off('error', reject);
			resolve();
		});
	});

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
		server.close(() => process.exit(0));
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
	console.error(formatIngressConfigError(error));
	process.exit(1);
});
