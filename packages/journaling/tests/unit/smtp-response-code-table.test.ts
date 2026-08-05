import { connect as connectTcp, type Socket } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type JournalAcceptancePort,
	type RecipientAclEvaluator,
	type SourceAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import {
	JournalAcceptance,
	type JournalAcceptanceResult,
	type JournalTransactionInput,
} from '../../src/spool/acceptance';
import { NodeSpoolFileSystem } from '../../src/spool/fs-port';
import type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
} from '../../src/ledger/ledger-port';
import type { QuarantineAlert } from '../../src/spool/quarantine';

/**
 * `JR-4-06b` -- one test per row of skill `journal-ledger` section 2's response-code table, in the
 * table's own order, so a reviewer can hold the skill's markdown table next to this file and check
 * each row off directly. Every non-`accepted` row that maps to a `JournalAcceptanceResult` kind, the
 * two ACL rows, `STARTTLS`, oversize, and the shutdown drain are each proven over a real loopback
 * socket -- the same "a code assigned to a variable does not prove a client sees it" instruction the
 * Product Owner gave for `JR-4-05a` (see `smtp-source-acl-protocol.test.ts`'s doc comment), applied to
 * the whole table at once rather than one feature at a time.
 *
 * This file does not re-derive logic already proven elsewhere in depth -- `smtp-acceptance-wiring.test.ts`
 * (`JR-4-06a`) already proves the full accept()-result mapping including the oversize override and the
 * streaming memory bound; `smtp-source-acl-protocol.test.ts`/`smtp-recipient-acl-protocol.test.ts`/
 * `smtp-starttls-protocol.test.ts` already prove their own gates in depth (staleness, case-folding,
 * TLS-version floor, ...). What this file adds is the **one place** that visibly walks the *whole*
 * table, row by row, so a missing or wrong row shows up as a missing or wrong `it()` here rather than
 * needing to be pieced together by reading five files. `smtp-graceful-shutdown.test.ts` is the deep
 * proof for the shutdown row; this file's own shutdown case is the table-row-level check.
 */

const openServers: EsmtpServer[] = [];
const openSockets: Socket[] = [];

afterEach(async () => {
	for (const socket of openSockets.splice(0)) {
		if (!socket.destroyed) {
			socket.destroy();
		}
	}
	for (const server of openServers.splice(0)) {
		await server.close().catch(() => {});
	}
});

const silentLogger: IngressLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const CHAIN_SCOPE_ID = '77777777-7777-4777-8777-777777777777';
const SOURCE_ID = '88888888-8888-4888-8888-888888888888';
const RCPT_ADDRESS = 'journal@example.com';

const fixedRecipientAcl: RecipientAclEvaluator = {
	evaluateRecipient: () => ({
		kind: 'allowed',
		sourceId: SOURCE_ID,
		chainScopeId: CHAIN_SCOPE_ID,
	}),
};

function fakeAcceptance(
	result: JournalAcceptanceResult
): JournalAcceptancePort & { readonly calls: JournalTransactionInput[] } {
	const calls: JournalTransactionInput[] = [];
	return {
		calls,
		async accept(input: JournalTransactionInput): Promise<JournalAcceptanceResult> {
			calls.push(input);
			for await (const _chunk of input.chunks) {
				// discarded -- see smtp-acceptance-wiring.test.ts's fakeAcceptance for why this is
				// required (drains the bridge so finalizeAcceptance's bridge.end() does not hang).
			}
			return result;
		},
	};
}

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
}

async function startServer(
	options: Partial<Omit<EsmtpServerOptions, 'smtp'>> & {
		smtpOverrides?: Record<string, unknown>;
	} = {}
): Promise<StartedServer> {
	const { smtpOverrides, ...rest } = options;
	const smtp = smtpServerConfigSchema.parse(smtpOverrides ?? {});
	const server = new EsmtpServer({ smtp, logger: silentLogger, ...rest });
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) {
		throw new Error('server did not bind');
	}
	return { server, port: address.port };
}

class TestSmtpClient {
	private raw = '';
	private readonly readyLines: string[] = [];
	private readonly waiters: Array<{ resolve: (line: string) => void; timer: NodeJS.Timeout }> =
		[];
	public closed = false;

	constructor(private readonly socket: Socket) {
		socket.on('data', (chunk: Buffer) => this.onData(chunk));
		socket.on('close', () => {
			this.closed = true;
		});
	}

	private onData(chunk: Buffer): void {
		this.raw += chunk.toString('utf8');
		for (;;) {
			const idx = this.raw.indexOf('\r\n');
			if (idx === -1) return;
			const line = this.raw.slice(0, idx);
			this.raw = this.raw.slice(idx + 2);
			const waiter = this.waiters.shift();
			if (waiter) {
				clearTimeout(waiter.timer);
				waiter.resolve(line);
			} else {
				this.readyLines.push(line);
			}
		}
	}

	send(line: string): void {
		this.socket.write(`${line}\r\n`);
	}

	writeRaw(text: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket.write(text, (err) => (err ? reject(err) : resolve()));
		});
	}

	nextLine(timeoutMs = 2_000): Promise<string> {
		const ready = this.readyLines.shift();
		if (ready !== undefined) return Promise.resolve(ready);
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.waiters.findIndex((w) => w.resolve === resolve);
				if (idx !== -1) this.waiters.splice(idx, 1);
				reject(new Error(`no SMTP reply line within ${timeoutMs}ms`));
			}, timeoutMs);
			this.waiters.push({ resolve, timer });
		});
	}
}

async function readFullReply(client: TestSmtpClient): Promise<string> {
	for (;;) {
		const line = await client.nextLine();
		if (!/^\d{3}-/.test(line)) {
			return line;
		}
	}
}

async function connectClient(port: number): Promise<TestSmtpClient> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', () => resolve());
		socket.once('error', reject);
	});
	return new TestSmtpClient(socket);
}

/** Drive a connection through `EHLO`/`MAIL`/`RCPT`, positioned right before `DATA`. */
async function establishTransaction(port: number): Promise<TestSmtpClient> {
	const client = await connectClient(port);
	await client.nextLine();
	client.send('EHLO client.example.com');
	await readFullReply(client);
	client.send('MAIL FROM:<a@example.com>');
	await client.nextLine();
	client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
	await client.nextLine();
	return client;
}

async function sendAndGetDataReply(client: TestSmtpClient, body: string): Promise<string> {
	client.send('DATA');
	await client.nextLine(); // 354
	await client.writeRaw(body);
	return client.nextLine();
}

suite('ci', 'skill journal-ledger §2 response-code table, row by row (JR-4-06b)', () => {
	it('row 1 -- accepted and durably stored: 250 2.0.0, seq in the text', async () => {
		const acceptance = fakeAcceptance({
			kind: 'accepted',
			spoolTxId: 'row-1',
			seq: 99n,
			chainHash: Buffer.alloc(32, 1),
		});
		const { port } = await startServer({
			recipientAclEvaluator: fixedRecipientAcl,
			journalAcceptance: acceptance,
		});
		const client = await establishTransaction(port);
		const reply = await sendAndGetDataReply(client, 'hello\r\n.\r\n');
		expect(reply).toMatch(/^250 2\.0\.0/);
		expect(reply).toContain('99');
	});

	it('row 2 -- spool write/fsync failure: 451 4.3.0, retryable', async () => {
		const acceptance = fakeAcceptance({
			kind: 'spool-write-failed',
			spoolTxId: 'row-2',
			stage: 'write',
			cause: new Error('EIO'),
		});
		const { port } = await startServer({
			recipientAclEvaluator: fixedRecipientAcl,
			journalAcceptance: acceptance,
		});
		const client = await establishTransaction(port);
		const reply = await sendAndGetDataReply(client, 'hello\r\n.\r\n');
		expect(reply).toMatch(/^451 4\.3\.0/);
	});

	it('row 3 -- ledger append failure: 451 4.3.0, retryable -- never accepted without a ledger entry', async () => {
		const acceptance = fakeAcceptance({
			kind: 'ledger-append-failed',
			spoolTxId: 'row-3',
			filePath: '/spool/incoming/00/row-3.eml',
			cause: new Error('connection terminated unexpectedly'),
		});
		const { port } = await startServer({
			recipientAclEvaluator: fixedRecipientAcl,
			journalAcceptance: acceptance,
		});
		const client = await establishTransaction(port);
		const reply = await sendAndGetDataReply(client, 'hello\r\n.\r\n');
		expect(reply).toMatch(/^451 4\.3\.0/);
	});

	it('row 4 -- disk full / spool over the high-water mark: 452 4.3.1, retryable', async () => {
		const acceptance = fakeAcceptance({
			kind: 'high-water-mark-exceeded',
			spoolTxId: 'row-4',
			status: { exceeded: true, usageBytes: 2n, highWaterBytes: 1n },
		});
		const { port } = await startServer({
			recipientAclEvaluator: fixedRecipientAcl,
			journalAcceptance: acceptance,
		});
		const client = await establishTransaction(port);
		const reply = await sendAndGetDataReply(client, 'hello\r\n.\r\n');
		expect(reply).toMatch(/^452 4\.3\.1/);
	});

	it('row 5 -- object store unreachable: 250, structurally -- the ingress process has no object-store access at all to fail against (ADR-002)', () => {
		// Not a fault-injection test (there is nothing to inject a fault into): the claim is that no
		// code path in this receive path can even attempt to reach an object store, so "unreachable"
		// cannot arise here in the first place. Proven the same way ingress-import-graph.test.ts
		// (JR-4-01) already proves the *stronger*, more general claim this depends on: neither
		// smtp-server.ts nor anything it imports resolves anything under packages/backend/ (where
		// StorageService and every object-store provider live) at all, so it cannot resolve one
		// specifically either. Re-running that exact walk here (rather than asserting "trust me, see
		// that other file") is what keeps this row's proof self-contained.
		const here = path.dirname(fileURLToPath(import.meta.url));
		const repoRoot = path.resolve(here, '../../../..');
		const entry = path.resolve(repoRoot, 'apps/smtp-ingress/src/index.ts');
		const importPattern = /(?:from|require\()\s*['"]([^'"]+)['"]/g;
		const visited = new Set<string>();
		const queue = [entry];
		const forbidden: string[] = [];
		while (queue.length > 0) {
			const file = queue.shift()!;
			if (visited.has(file) || !existsSync(file)) continue;
			visited.add(file);
			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(importPattern)) {
				const specifier = match[1]!;
				if (specifier.startsWith('.')) {
					const base = path.resolve(path.dirname(file), specifier);
					const candidate = [base, `${base}.ts`, path.join(base, 'index.ts')].find(
						(c) => c.endsWith('.ts') && existsSync(c)
					);
					if (candidate) queue.push(candidate);
					continue;
				}
				if (specifier === '@open-archiver/backend') {
					forbidden.push(`${specifier} (from ${path.relative(repoRoot, file)})`);
					continue;
				}
				if (specifier === '@open-archiver/journaling') {
					queue.push(path.resolve(repoRoot, 'packages/journaling/src/index.ts'));
					continue;
				}
				if (specifier === '@open-archiver/types') {
					queue.push(path.resolve(repoRoot, 'packages/types/src/index.ts'));
				}
				// node builtins / npm deps: leaves, not walked into.
			}
		}
		expect(visited.size).toBeGreaterThan(5); // walker sanity: it actually resolved something
		expect(forbidden).toEqual([]);
	});

	it("row 6 -- metadata DB unreachable: this deployment's ledger lives in that same database, so it is 'ledger-append-failed' -> 451 4.3.0, not 250", async () => {
		// Skill section 2's row is conditional ("250 if the ledger is on separate durable storage,
		// else 451"). architecture.md/acceptance.ts both settle which half applies here:
		// PostgresLedgerWriter.append() *is* the metadata database call, so a database outage surfaces
		// as exactly the 'ledger-append-failed' JournalAcceptanceResult row 3 already proves --
		// this case exists to make that documented choice observable at the wire, not merely asserted
		// in a comment, with a cause shaped like the real failure (a lost connection), not a generic one.
		const acceptance = fakeAcceptance({
			kind: 'ledger-append-failed',
			spoolTxId: 'row-6',
			filePath: '/spool/incoming/00/row-6.eml',
			cause: Object.assign(new Error('Connection terminated unexpectedly'), {
				code: 'CONNECTION_ENDED',
			}),
		});
		const { port } = await startServer({
			recipientAclEvaluator: fixedRecipientAcl,
			journalAcceptance: acceptance,
		});
		const client = await establishTransaction(port);
		const reply = await sendAndGetDataReply(client, 'hello\r\n.\r\n');
		expect(reply).toMatch(/^451 4\.3\.0/);
	});

	it('row 7 -- recipient not a configured journal address: 550 5.1.1', async () => {
		const denyingAcl: RecipientAclEvaluator = { evaluateRecipient: () => ({ kind: 'denied' }) };
		const { port } = await startServer({ recipientAclEvaluator: denyingAcl });
		const client = await connectClient(port);
		await client.nextLine();
		client.send('EHLO client.example.com');
		await readFullReply(client);
		client.send('MAIL FROM:<a@example.com>');
		await client.nextLine();
		client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
		const reply = await client.nextLine();
		expect(reply).toMatch(/^550 5\.1\.1/);
	});

	it('row 8 -- source IP not in ACL: 554 5.7.1, at connect -- no 220 greeting is ever sent', async () => {
		const denyingSourceAcl: SourceAclEvaluator = { evaluate: () => ({ kind: 'denied' }) };
		const { port } = await startServer({ sourceAclEvaluator: denyingSourceAcl });
		const socket = connectTcp(port, '127.0.0.1');
		openSockets.push(socket);
		const line = await new Promise<string>((resolve, reject) => {
			let buffered = '';
			const timer = setTimeout(() => reject(new Error('timed out')), 2_000);
			socket.on('data', (chunk: Buffer) => {
				buffered += chunk.toString('utf8');
				const idx = buffered.indexOf('\r\n');
				if (idx !== -1) {
					clearTimeout(timer);
					resolve(buffered.slice(0, idx));
				}
			});
			socket.once('error', reject);
		});
		expect(line).toMatch(/^554 5\.7\.1/);
		expect(line).not.toContain('220');
	});

	it('row 9 -- STARTTLS required but refused: 530 5.7.0', async () => {
		const { port } = await startServer({ tls: { requireTls: true } });
		const client = await connectClient(port);
		await client.nextLine();
		client.send('EHLO client.example.com'); // EHLO is exempt (RFC 3207 section 4)
		await readFullReply(client);
		client.send('MAIL FROM:<a@example.com>');
		const reply = await client.nextLine();
		expect(reply).toMatch(/^530 5\.7\.0/);
	});

	it('row 10 -- message exceeds the SIZE limit: 552 5.3.4, and a loud alert (never a silent rejection)', async () => {
		// The alert path itself (QuarantineAlertSink, reason 'oversize-rejected') is proven in depth in
		// smtp-acceptance-wiring.test.ts's oversize suite; this row-level case reconfirms both halves
		// together -- the wire code, and that this is not merely a `logger.error` call with nothing
		// durable behind it.
		const dir = await mkdtemp(path.join(tmpdir(), 'oa-response-table-row10-'));
		try {
			const alerts: QuarantineAlert[] = [];
			const backend: LedgerBackend = {
				async append(_request: LedgerAppendRequest): Promise<LedgerAppendResult> {
					throw new Error('unused: oversize never reaches append()');
				},
			};
			const acceptance = new JournalAcceptance({
				fs: new NodeSpoolFileSystem(),
				backend,
				spoolConfig: { rootPath: dir, highWaterBytes: 100_000_000n },
				alertSink: { alert: (event) => void alerts.push(event) },
			});
			const { port } = await startServer({
				smtpOverrides: { sizeLimitBytes: 10 },
				recipientAclEvaluator: fixedRecipientAcl,
				journalAcceptance: acceptance,
			});
			const client = await establishTransaction(port);
			const reply = await sendAndGetDataReply(
				client,
				'this body is definitely over the ten byte limit\r\n.\r\n'
			);
			expect(reply).toMatch(/^552 5\.3\.4/);
			expect(alerts).toHaveLength(1);
			expect(alerts[0]!.reason).toBe('oversize-rejected');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('row 11 -- shutdown in progress: 421 4.3.2, graceful drain', async () => {
		// Deep proof (a transaction that already earned its 250 must not lose it) lives in
		// smtp-graceful-shutdown.test.ts; this is the row-level check that an idle connection sees
		// exactly this code and enhanced status when the process starts draining.
		const { server, port } = await startServer();
		const client = await connectClient(port);
		await client.nextLine();
		client.send('EHLO client.example.com');
		await readFullReply(client);

		const closePromise = server.close();
		const reply = await client.nextLine();
		expect(reply).toMatch(/^421 4\.3\.2/);
		await closePromise;
	});
});
