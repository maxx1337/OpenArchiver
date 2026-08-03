import { createHash } from 'node:crypto';
import { connect as connectTcp, type Socket } from 'node:net';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import postgres from 'postgres';
import {
	EsmtpServer,
	JournalAcceptance,
	NodeSpoolFileSystem,
	PostgresLedgerWriter,
	incomingFilePath,
	smtpServerConfigSchema,
	type EsmtpServerOptions,
	type RecipientAclEvaluator,
} from '@open-archiver/journaling';
import { acquireTestDatabase } from '../support/pg-harness';
import { seedIngestionSource } from '../support/iam-seed';
// eslint-disable-next-line import/no-relative-packages -- deliberate: see the module doc comment.
import { postgresTransactor } from '../../../../apps/smtp-ingress/src/postgres-transactor';

/**
 * The `250` proof (`JR-4-06a`): a real SMTP client, over a real TCP socket, talking to a real
 * `EsmtpServer` wired to a real `JournalAcceptance` -- `NodeSpoolFileSystem` against a real temp
 * file, `PostgresLedgerWriter` against real Postgres through `apps/smtp-ingress`'s own production
 * bare-client transactor. Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is the most important test in this slice
 * ---------------------------------------------------------------------------------------------
 * Every other test in this task's slice (`packages/journaling/tests/unit/smtp-acceptance-wiring.test.ts`)
 * proves the *wiring* -- the response-code mapping, the oversize override, the abandoned-transaction
 * cleanup, the streaming-memory property -- against fakes or a real disk with an in-memory ledger.
 * None of them prove the one claim this whole project exists to make good on: that a real sender,
 * talking real SMTP, gets a `250` **only when** the bytes it sent are durably on disk *and* durably
 * in the ledger, and that those two things actually agree byte-for-byte with what was sent. A `250`
 * without that check is exactly the unverified claim skill `journal-ledger` section 1 forbids --
 * this file is the check.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the transactor import reaches into `apps/smtp-ingress/src/`
 * ---------------------------------------------------------------------------------------------
 * F38 (`docs/dev/journaling/09-befunde-bestandscode.md`) requires at least one test to write through
 * a bare (non-`drizzle`-patched) `postgres-js` client for anything in `packages/journaling` that gets
 * its connection injected. `packages/backend/tests/support/postgres-transactor.ts` already satisfies
 * that requirement in general (`journal-acceptance-bare-client.int.test.ts` uses it) -- this file
 * goes one step further and exercises `apps/smtp-ingress`'s own **production** transactor
 * (`./postgres-transactor.ts`, `JR-4-06a`), the literal code that ships in that process, rather than
 * a structurally-identical copy that merely proves the same thing about the *port*. Reaching across
 * from `packages/backend/tests/` to `apps/smtp-ingress/src/` is a relative filesystem import, not a
 * package dependency -- `packages/backend/package.json` gains no dependency on `smtp-ingress-app`,
 * and `packages/journaling/tests/unit/ingress-import-graph.test.ts`'s static walk (the guard against
 * the *reverse* direction: `apps/smtp-ingress` depending on `packages/backend`) is unaffected, since
 * that check walks `apps/smtp-ingress`'s own imports, not what imports it.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('smtp-accept-e2e') : undefined;

const bareClient = harness
	? postgres(harness.url, { max: 2, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} })
	: undefined;

afterAll(async () => {
	await bareClient?.end({ timeout: 10 }).catch(() => undefined);
});

async function deploymentId(): Promise<string> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

/** Minimal SMTP client -- send a line, read one (possibly multiline) reply, write raw bytes. */
class TestSmtpClient {
	private raw = '';
	private currentReplyLines: string[] = [];
	private readonly readyReplies: string[][] = [];
	private readonly waiters: Array<{ resolve: (lines: string[]) => void; timer: NodeJS.Timeout }> =
		[];

	constructor(private readonly socket: Socket) {
		socket.on('data', (chunk: Buffer) => this.onData(chunk));
	}

	private onData(chunk: Buffer): void {
		this.raw += chunk.toString('utf8');
		for (;;) {
			const idx = this.raw.indexOf('\r\n');
			if (idx === -1) return;
			const line = this.raw.slice(0, idx);
			this.raw = this.raw.slice(idx + 2);
			this.currentReplyLines.push(line);
			if (/^\d{3} /.test(line)) {
				const reply = this.currentReplyLines;
				this.currentReplyLines = [];
				const waiter = this.waiters.shift();
				if (waiter) {
					clearTimeout(waiter.timer);
					waiter.resolve(reply);
				} else {
					this.readyReplies.push(reply);
				}
			}
		}
	}

	send(line: string): void {
		this.socket.write(`${line}\r\n`);
	}

	writeRaw(text: string): void {
		this.socket.write(text);
	}

	nextReply(timeoutMs = 5_000): Promise<string[]> {
		const ready = this.readyReplies.shift();
		if (ready) return Promise.resolve(ready);
		return new Promise<string[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.waiters.findIndex((w) => w.resolve === resolve);
				if (idx !== -1) this.waiters.splice(idx, 1);
				reject(new Error(`no SMTP reply within ${timeoutMs}ms`));
			}, timeoutMs);
			this.waiters.push({ resolve, timer });
		});
	}
}

const openServers: EsmtpServer[] = [];
const openSockets: Socket[] = [];
let spoolDir: string | undefined;

afterEach(async () => {
	for (const socket of openSockets.splice(0)) {
		if (!socket.destroyed) socket.destroy();
	}
	for (const server of openServers.splice(0)) {
		await server.close().catch(() => {});
	}
	if (spoolDir) {
		await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
		spoolDir = undefined;
	}
});

suiteRequiring(
	'ci',
	'the 250 proof: a real SMTP client, a real EsmtpServer, real disk, real Postgres (JR-4-06a)',
	postgresProbe,
	() => {
		it('250 with a seq is issued only once the message is durable in the spool AND the ledger, and both agree with what was sent', async () => {
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db);
			const chainScopeId = source.id;
			const routingAddress = `journal-${source.id}@example.com`;

			spoolDir = await mkdtemp(path.join(tmpdir(), 'oa-smtp-accept-e2e-'));
			const fs = new NodeSpoolFileSystem();
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(bareClient!),
			});
			const acceptance = new JournalAcceptance({
				fs,
				backend: writer,
				spoolConfig: { rootPath: spoolDir, highWaterBytes: 100_000_000n },
				alertSink: { alert: () => {} },
			});

			const recipientAclEvaluator: RecipientAclEvaluator = {
				evaluate: (address) =>
					address.toLowerCase() === routingAddress.toLowerCase()
						? { kind: 'allowed', sourceId: source.id, chainScopeId }
						: { kind: 'denied' },
			};

			const options: EsmtpServerOptions = {
				smtp: smtpServerConfigSchema.parse({
					hostname: 'smtp-ingress-test',
					sizeLimitBytes: 10 * 1024 * 1024,
				}),
				recipientAclEvaluator,
				journalAcceptance: acceptance,
			};
			const server = new EsmtpServer(options);
			openServers.push(server);
			await server.listen(0, '127.0.0.1');
			const address = server.address;
			if (address === null) {
				throw new Error('server did not bind');
			}

			const socket = connectTcp(address.port, '127.0.0.1');
			openSockets.push(socket);
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', () => resolve());
				socket.once('error', reject);
			});
			const client = new TestSmtpClient(socket);

			await client.nextReply(); // 220
			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('MAIL FROM:<sender@example.com>');
			await client.nextReply();
			client.send(`RCPT TO:<${routingAddress}>`);
			await client.nextReply();
			client.send('DATA');
			await client.nextReply(); // 354

			const sentBody = 'Subject: e2e 250 proof\r\n\r\nhello from a real socket.\r\n';
			client.writeRaw(`${sentBody}.\r\n`);
			const reply = await client.nextReply(10_000);

			if (process.platform === 'win32') {
				// Directory-fsync is a POSIX operation and fails with EPERM on Windows (`fs-port.ts`'s
				// own documented limitation) -- accept() maps that DurableWriteError to
				// 'spool-write-failed' (451), and never reaches backend.append() at all, so no ledger
				// row exists for this chain. This is a real, current platform gap in the *test host*,
				// not in the wiring: the deployment target is Linux (architecture doc section 7), where
				// the assertions below this branch are what actually runs. Asserted explicitly, the
				// same way `durable-write.test.ts`'s own real-disk suite special-cases it, rather than
				// silently skipped.
				expect(reply[0]).toMatch(/^451 4\.3\.0/);
				const rows = await bareClient!`
					select 1 from journal_ledger where chain_scope_id = ${chainScopeId}
				`;
				expect(rows).toHaveLength(0);
				client.send('QUIT');
				await client.nextReply();
				return;
			}

			expect(reply[0]).toMatch(/^250 2\.0\.0/);
			const seqMatch = /queued as (\d+)/.exec(reply[0]!);
			expect(seqMatch).not.toBeNull();
			const seq = BigInt(seqMatch![1]!);

			// --- The counter-proof: look at the spool file, independent of anything accept() told us. ---
			// spool_txid is not surfaced in the SMTP reply -- read it back from the ledger row instead,
			// keyed by chain + seq, exactly what an auditor (or crash-recovery scan) would do.
			const ledgerRows = await bareClient!<
				{
					spool_txid: string;
					content_sha256: Uint8Array;
					size_bytes: string;
					seq: string;
				}[]
			>`
				select spool_txid, content_sha256, size_bytes::text as size_bytes, seq::text as seq
				from journal_ledger
				where chain_scope_id = ${chainScopeId} and seq = ${seq.toString()}
			`;
			expect(ledgerRows).toHaveLength(1);
			const row = ledgerRows[0]!;

			const expectedHash = createHash('sha256').update(Buffer.from(sentBody)).digest();
			expect(Buffer.from(row.content_sha256).equals(expectedHash)).toBe(true);
			expect(BigInt(row.size_bytes)).toBe(BigInt(Buffer.byteLength(sentBody)));

			// The spool file on disk: same bytes, same hash, found via the ledger's own spool_txid --
			// not assumed, read back and compared.
			const filePath = incomingFilePath(spoolDir, row.spool_txid);
			const onDisk = await readFile(filePath);
			expect(onDisk.equals(Buffer.from(sentBody))).toBe(true);
			expect(createHash('sha256').update(onDisk).digest().equals(expectedHash)).toBe(true);

			client.send('QUIT');
			expect((await client.nextReply())[0]).toMatch(/^221/);
		});

		it('a second transaction on the same chain gets seq + 1, and a rejected recipient never reaches accept() at all', async () => {
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db);
			const chainScopeId = source.id;
			const routingAddress = `journal-${source.id}@example.com`;

			spoolDir = await mkdtemp(path.join(tmpdir(), 'oa-smtp-accept-e2e-'));
			const fs = new NodeSpoolFileSystem();
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(bareClient!),
			});
			let acceptCalls = 0;
			const acceptance = new JournalAcceptance({
				fs,
				backend: writer,
				spoolConfig: { rootPath: spoolDir, highWaterBytes: 100_000_000n },
				alertSink: { alert: () => {} },
			});
			const countingAcceptance = {
				accept: (input: Parameters<typeof acceptance.accept>[0]) => {
					acceptCalls += 1;
					return acceptance.accept(input);
				},
			};

			const recipientAclEvaluator: RecipientAclEvaluator = {
				evaluate: (address) =>
					address.toLowerCase() === routingAddress.toLowerCase()
						? { kind: 'allowed', sourceId: source.id, chainScopeId }
						: { kind: 'denied' },
			};

			const server = new EsmtpServer({
				smtp: smtpServerConfigSchema.parse({ hostname: 'smtp-ingress-test' }),
				recipientAclEvaluator,
				journalAcceptance: countingAcceptance,
			});
			openServers.push(server);
			await server.listen(0, '127.0.0.1');
			const address = server.address!;

			const socket = connectTcp(address.port, '127.0.0.1');
			openSockets.push(socket);
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', () => resolve());
				socket.once('error', reject);
			});
			const client = new TestSmtpClient(socket);
			await client.nextReply();

			// See the previous test's own comment: directory-fsync fails with EPERM on Windows
			// (`fs-port.ts`'s documented limitation), so every accept() on this host settles to
			// 'spool-write-failed' (451) rather than 'accepted' -- a real platform gap in the test
			// host, not the wiring (the deployment target is Linux). `sendOne()` asserts whichever
			// reply this platform actually produces and returns the seq only when there is one.
			async function sendOne(): Promise<bigint | null> {
				client.send('EHLO client.example.com');
				await client.nextReply();
				client.send('MAIL FROM:<sender@example.com>');
				await client.nextReply();
				client.send(`RCPT TO:<${routingAddress}>`);
				await client.nextReply();
				client.send('DATA');
				await client.nextReply();
				client.writeRaw('hello\r\n.\r\n');
				const reply = await client.nextReply(10_000);
				if (process.platform === 'win32') {
					expect(reply[0]).toMatch(/^451 4\.3\.0/);
					return null;
				}
				expect(reply[0]).toMatch(/^250 2\.0\.0/);
				return BigInt(/queued as (\d+)/.exec(reply[0]!)![1]!);
			}

			const firstSeq = await sendOne();
			const secondSeq = await sendOne();
			if (process.platform !== 'win32') {
				expect(secondSeq).toBe(firstSeq! + 1n);
			}
			expect(acceptCalls).toBe(2);

			// A recipient the ACL denies never reaches accept() -- 550, no third call.
			client.send('MAIL FROM:<sender@example.com>');
			await client.nextReply();
			client.send('RCPT TO:<nobody@example.com>');
			const denied = await client.nextReply();
			expect(denied[0]).toMatch(/^550 5\.1\.1/);
			expect(acceptCalls).toBe(2);
		});
	}
);
