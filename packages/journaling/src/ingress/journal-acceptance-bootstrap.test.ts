import { expect, it, vi } from 'vitest';
import { suite } from '@oa-test/classification';
import { JournalAcceptanceBootstrap } from './journal-acceptance-bootstrap';
import type { IngressLogger, JournalAcceptancePort } from './smtp-server';

/**
 * `JR-4-19` -- the retry-until-wired bootstrap for the durable-acceptance port. Classification: `ci`.
 *
 * No timers are waited on: every case drives {@link JournalAcceptanceBootstrap.tryNow} directly, which
 * exists for exactly that reason (the same argument `SourceAclCache.refreshNow()` makes). A test that
 * slept for a retry interval would be slow and, worse, would be the kind of timing-dependent proof F49
 * was about.
 */

const acceptance: JournalAcceptancePort = {
	accept: async () => ({ kind: 'accepted', seq: 1n, duplicateOf: null }) as never,
};

interface CapturedLog {
	readonly level: 'debug' | 'info' | 'warn' | 'error';
	readonly fields: Record<string, unknown>;
	readonly message: string;
}

function capturingLogger(): { logger: IngressLogger; lines: CapturedLog[] } {
	const lines: CapturedLog[] = [];
	const push =
		(level: CapturedLog['level']) => (fields: Record<string, unknown>, message: string) =>
			void lines.push({ level, fields, message });
	return {
		logger: {
			debug: push('debug'),
			info: push('info'),
			warn: push('warn'),
			error: push('error'),
		},
		lines,
	};
}

suite('ci', 'JR-4-19 JournalAcceptanceBootstrap', () => {
	it('wires acceptance on the first attempt and logs the state once', async () => {
		const { logger, lines } = capturingLogger();
		const build = vi.fn(async () => acceptance);
		const bootstrap = new JournalAcceptanceBootstrap({
			build,
			retryIntervalMs: 10_000,
			logger,
		});

		await bootstrap.start();

		expect(bootstrap.isWired()).toBe(true);
		expect(bootstrap.provider()()).toBe(acceptance);
		expect(build).toHaveBeenCalledTimes(1);
		const info = lines.filter((l) => l.level === 'info');
		expect(info).toHaveLength(1);
		expect(info[0]!.message).toContain('journal acceptance wired at startup');
		bootstrap.stop();
	});

	it('a failed start leaves the provider undefined -- which is what makes every transaction 451', async () => {
		const { logger, lines } = capturingLogger();
		const build = vi.fn(async () => {
			throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
		});
		const bootstrap = new JournalAcceptanceBootstrap({
			build,
			retryIntervalMs: 10_000,
			logger,
		});

		// Resolves rather than rejecting: a database outage at boot must not stop the process from
		// binding its port.
		await expect(bootstrap.start()).resolves.toBeUndefined();

		expect(bootstrap.isWired()).toBe(false);
		expect(bootstrap.provider()()).toBeUndefined();
		const errors = lines.filter((l) => l.level === 'error');
		expect(errors).toHaveLength(1);
		expect(errors[0]!.message).toContain('every transaction answers 451');
		expect(errors[0]!.fields.attempt).toBe(1);
		bootstrap.stop();
	});

	it('promotes on a later attempt, without a restart, and says so exactly once', async () => {
		const { logger, lines } = capturingLogger();
		let attempts = 0;
		const build = vi.fn(async () => {
			attempts++;
			if (attempts < 3) throw new Error('database still down');
			return acceptance;
		});
		const bootstrap = new JournalAcceptanceBootstrap({
			build,
			retryIntervalMs: 10_000,
			logger,
		});

		await bootstrap.start();
		expect(bootstrap.provider()()).toBeUndefined();
		await bootstrap.tryNow();
		expect(bootstrap.provider()()).toBeUndefined();
		await bootstrap.tryNow();

		// The same provider instance handed to EsmtpServer at startup now returns the port -- that is
		// the whole mechanism: no rebuild, no new server, no reconnect by the client.
		expect(bootstrap.provider()()).toBe(acceptance);
		expect(build).toHaveBeenCalledTimes(3);
		const info = lines.filter((l) => l.level === 'info');
		expect(info).toHaveLength(1);
		expect(info[0]!.message).toContain('without a restart');
		expect(info[0]!.fields.attempt).toBe(3);
		expect(lines.filter((l) => l.level === 'error')).toHaveLength(2);
		bootstrap.stop();
	});

	it('stops trying once wired -- a later outage is the accept path’s business, not this class’s', async () => {
		const build = vi.fn(async () => acceptance);
		const bootstrap = new JournalAcceptanceBootstrap({ build, retryIntervalMs: 10_000 });

		await bootstrap.start();
		await bootstrap.tryNow();
		await bootstrap.tryNow();

		// See the class doc comment: after the first success, postgres-js reconnects per append() and
		// JournalAcceptance maps a failing append to 451 on its own. Polling on would buy nothing.
		expect(build).toHaveBeenCalledTimes(1);
	});

	it('coalesces concurrent attempts instead of running build twice', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const build = vi.fn(async () => {
			await gate;
			return acceptance;
		});
		const bootstrap = new JournalAcceptanceBootstrap({ build, retryIntervalMs: 10_000 });

		const first = bootstrap.tryNow();
		const second = bootstrap.tryNow();
		release();
		await Promise.all([first, second]);

		// build takes the crash-recovery advisory lock; two overlapping attempts would serialise
		// against each other in Postgres for no gain.
		expect(build).toHaveBeenCalledTimes(1);
		expect(bootstrap.isWired()).toBe(true);
	});

	it('start() arms a retry timer only on failure, and stop() clears it', async () => {
		const setInterval = vi.spyOn(globalThis, 'setInterval');
		const clearInterval = vi.spyOn(globalThis, 'clearInterval');
		try {
			const wired = new JournalAcceptanceBootstrap({
				build: async () => acceptance,
				retryIntervalMs: 10_000,
			});
			await wired.start();
			expect(setInterval).not.toHaveBeenCalled();

			const failing = new JournalAcceptanceBootstrap({
				build: async () => {
					throw new Error('down');
				},
				retryIntervalMs: 10_000,
			});
			await failing.start();
			expect(setInterval).toHaveBeenCalledTimes(1);
			failing.stop();
			expect(clearInterval).toHaveBeenCalledTimes(1);
			// Idempotent: the shutdown path may call it after a promotion already did.
			failing.stop();
			expect(clearInterval).toHaveBeenCalledTimes(1);
		} finally {
			setInterval.mockRestore();
			clearInterval.mockRestore();
		}
	});

	it('clears its own retry timer when it promotes, before claiming so in the log', async () => {
		const clearInterval = vi.spyOn(globalThis, 'clearInterval');
		try {
			let ok = false;
			const bootstrap = new JournalAcceptanceBootstrap({
				build: async () => {
					if (!ok) throw new Error('down');
					return acceptance;
				},
				retryIntervalMs: 10_000,
			});
			await bootstrap.start();
			expect(clearInterval).not.toHaveBeenCalled();
			ok = true;
			await bootstrap.tryNow();
			expect(clearInterval).toHaveBeenCalledTimes(1);
		} finally {
			clearInterval.mockRestore();
		}
	});
});
