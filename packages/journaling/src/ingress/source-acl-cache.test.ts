import { describe, expect, it, vi } from 'vitest';
import { suite } from '@oa-test/classification';
import type { JournalingSourceAclEntry, SourceAclLookup } from './source-acl-port';
import type { IngressLogger } from './smtp-server';
import {
	buildAuthIndex,
	buildRecipientIndex,
	compileSourceAcl,
	createSourceAclRequireTlsResolver,
	SourceAclCache,
} from './source-acl-cache';

/**
 * `JR-4-05a` -- `compileSourceAcl` and `SourceAclCache` against fakes: no database, no real
 * timers (the refresh loop is driven exclusively through `refreshNow()`/an injected clock).
 *
 * The wire-level proof that a real client is actually rejected/admitted/told to retry at connect
 * time lives in `packages/journaling/tests/unit/smtp-source-acl-protocol.test.ts` -- this file
 * proves the cache's decision logic in isolation, that file proves the decision reaches the wire.
 */

function recordingLogger(): { logger: IngressLogger; warnings: unknown[][]; errors: unknown[][] } {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	return {
		warnings,
		errors,
		logger: {
			debug: () => {},
			info: () => {},
			warn: (...args) => warnings.push(args),
			error: (...args) => errors.push(args),
		},
	};
}

function entry(overrides: Partial<JournalingSourceAclEntry> = {}): JournalingSourceAclEntry {
	return {
		id: 'source-1',
		chainScopeId: 'archive-1',
		allowedIps: ['192.0.2.0/24'],
		requireTls: false,
		routingAddress: 'journal-1@journaling.test.invalid',
		smtpUsername: null,
		smtpPasswordHash: null,
		...overrides,
	};
}

class FakeLookup implements SourceAclLookup {
	public rows: readonly JournalingSourceAclEntry[] = [];
	public failNext = false;
	public calls = 0;

	async listActiveSources(): Promise<readonly JournalingSourceAclEntry[]> {
		this.calls += 1;
		if (this.failNext) {
			this.failNext = false;
			throw new Error('simulated database outage');
		}
		return this.rows;
	}
}

suite('ci', 'compileSourceAcl / SourceAclCache (JR-4-05a)', () => {
	describe('compileSourceAcl', () => {
		it('compiles every valid entry into a ParsedCidr', () => {
			const { logger } = recordingLogger();
			const compiled = compileSourceAcl(
				entry({ allowedIps: ['192.0.2.0/24', '2001:db8::/32'] }),
				logger
			);
			expect(compiled).not.toBeNull();
			expect(compiled!.cidrs).toHaveLength(2);
			expect(compiled!.sourceId).toBe('source-1');
			expect(compiled!.chainScopeId).toBe('archive-1');
		});

		it('returns null and logs an error for a source with any invalid CIDR entry', () => {
			const { logger, errors } = recordingLogger();
			const compiled = compileSourceAcl(
				entry({ allowedIps: ['192.0.2.0/24', 'not-an-address'] }),
				logger
			);
			expect(compiled).toBeNull();
			expect(errors).toHaveLength(1);
			expect(errors[0]![1]).toMatch(/unusable/);
		});

		it('logs a warning, but still compiles, for a /0 catch-all entry', () => {
			const { logger, warnings } = recordingLogger();
			const compiled = compileSourceAcl(entry({ allowedIps: ['0.0.0.0/0'] }), logger);
			expect(compiled).not.toBeNull();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]![1]).toMatch(/catch-all|prefix length 0/);
		});
	});

	describe('buildRecipientIndex (JR-4-05b)', () => {
		it('indexes each compiled source by its normalised routing address', () => {
			const { logger } = recordingLogger();
			const a = compileSourceAcl(
				entry({ id: 's-a', routingAddress: 'Journal-A@Journaling.Example.Com' }),
				logger
			)!;
			const index = buildRecipientIndex([a], logger);
			expect(index.get('journal-a@journaling.example.com')).toBe(a);
			expect(index.size).toBe(1);
		});

		it('keeps the first source and logs an error naming both ids when two active sources share a routing address', () => {
			const { logger, errors } = recordingLogger();
			const first = compileSourceAcl(
				entry({ id: 's-first', routingAddress: 'shared@journaling.example.com' }),
				logger
			)!;
			const second = compileSourceAcl(
				entry({ id: 's-second', routingAddress: 'shared@journaling.example.com' }),
				logger
			)!;
			const index = buildRecipientIndex([first, second], logger);

			expect(index.get('shared@journaling.example.com')).toBe(first);
			expect(index.size).toBe(1);
			expect(errors).toHaveLength(1);
			expect(errors[0]![1]).toMatch(/share the same routing_address/);
			expect(errors[0]![0]).toMatchObject({
				keptSourceId: 's-first',
				ignoredSourceId: 's-second',
			});
		});

		it('excludes a source whose routing address is empty after normalisation, logs an error, and leaves other sources unaffected', () => {
			const { logger, errors } = recordingLogger();
			const empty = compileSourceAcl(
				entry({ id: 's-empty', routingAddress: '   ' }),
				logger
			)!;
			const ok = compileSourceAcl(
				entry({ id: 's-ok', routingAddress: 'journal-ok@journaling.example.com' }),
				logger
			)!;
			const index = buildRecipientIndex([empty, ok], logger);

			expect(index.has('')).toBe(false);
			expect(index.get('journal-ok@journaling.example.com')).toBe(ok);
			expect(index.size).toBe(1);
			expect(errors).toHaveLength(1);
			expect(errors[0]![1]).toMatch(/empty after/);
		});
	});

	describe('buildAuthIndex (JR-4-05c)', () => {
		it('indexes each compiled source with AUTH credentials configured by its smtp_username', () => {
			const { logger } = recordingLogger();
			const a = compileSourceAcl(
				entry({ id: 's-a', smtpUsername: 'journal-a', smtpPasswordHash: '$2b$10$hash-a' }),
				logger
			)!;
			const index = buildAuthIndex([a], logger);
			expect(index.get('journal-a')).toBe(a);
			expect(index.size).toBe(1);
		});

		it('excludes a source with no AUTH credentials configured -- the ordinary case, not an error', () => {
			const { logger, errors, warnings } = recordingLogger();
			const noAuth = compileSourceAcl(entry({ id: 's-no-auth' }), logger)!;
			const index = buildAuthIndex([noAuth], logger);
			expect(index.size).toBe(0);
			expect(errors).toHaveLength(0);
			expect(warnings).toHaveLength(0);
		});

		it('excludes a source with only smtp_username set (smtp_password_hash still null)', () => {
			const { logger } = recordingLogger();
			const half = compileSourceAcl(
				entry({ id: 's-half', smtpUsername: 'journal-half', smtpPasswordHash: null }),
				logger
			)!;
			const index = buildAuthIndex([half], logger);
			expect(index.size).toBe(0);
		});

		it('keeps the first source and logs an error naming both ids when two active sources share an smtp_username', () => {
			const { logger, errors } = recordingLogger();
			const first = compileSourceAcl(
				entry({ id: 's-first', smtpUsername: 'shared-user', smtpPasswordHash: '$2b$10$a' }),
				logger
			)!;
			const second = compileSourceAcl(
				entry({
					id: 's-second',
					smtpUsername: 'shared-user',
					smtpPasswordHash: '$2b$10$b',
				}),
				logger
			)!;
			const index = buildAuthIndex([first, second], logger);

			expect(index.get('shared-user')).toBe(first);
			expect(index.size).toBe(1);
			expect(errors).toHaveLength(1);
			expect(errors[0]![1]).toMatch(/share the same smtp_username/);
			expect(errors[0]![0]).toMatchObject({
				keptSourceId: 's-first',
				ignoredSourceId: 's-second',
			});
		});
	});

	describe('SourceAclCache.evaluate', () => {
		it("reports 'unavailable' before the first successful refresh", () => {
			const lookup = new FakeLookup();
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			expect(cache.evaluate('192.0.2.1')).toEqual({ kind: 'unavailable' });
		});

		it("reports 'allowed' with the matched source's identity and requireTls after a refresh", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry({ id: 's-a', chainScopeId: 'arch-a', requireTls: true })];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();

			expect(cache.evaluate('192.0.2.200')).toEqual({
				kind: 'allowed',
				sourceId: 's-a',
				chainScopeId: 'arch-a',
				requireTls: true,
			});
		});

		it("reports 'denied' for an IP matching no active source once the ACL is known", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry()];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();

			expect(cache.evaluate('198.51.100.1')).toEqual({ kind: 'denied' });
		});

		it('excludes a source with any invalid CIDR entirely -- its other, valid entries do not match either', async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry({ allowedIps: ['192.0.2.0/24', 'garbage'] })];
			const { logger } = recordingLogger();
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
				logger,
			});
			await cache.refreshNow();

			expect(cache.evaluate('192.0.2.5')).toEqual({ kind: 'denied' });
		});

		it('keeps serving the previous snapshot when a refresh fails (availability)', async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry()];
			let clock = 0;
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 60_000,
				now: () => clock,
			});
			await cache.refreshNow();
			expect(cache.evaluate('192.0.2.5').kind).toBe('allowed');

			clock += 10_000;
			lookup.failNext = true;
			await cache.refreshNow();

			// Still within staleAfterMs of the *last successful* refresh -- old snapshot still serves.
			expect(cache.evaluate('192.0.2.5').kind).toBe('allowed');
		});

		it("fails closed to 'unavailable' once a stalled refresh exceeds staleAfterMs (security)", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry()];
			let clock = 0;
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5_000,
				now: () => clock,
			});
			await cache.refreshNow();
			expect(cache.evaluate('192.0.2.5').kind).toBe('allowed');

			// Every subsequent refresh keeps failing (simulating an extended outage).
			clock += 10_000;
			expect(cache.evaluate('192.0.2.5')).toEqual({ kind: 'unavailable' });
		});

		it('coalesces concurrent refreshNow() calls into a single lookup', async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry()];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await Promise.all([cache.refreshNow(), cache.refreshNow(), cache.refreshNow()]);
			expect(lookup.calls).toBe(1);
		});

		it('start() resolves even when the first load fails, leaving the cache unavailable', async () => {
			const lookup = new FakeLookup();
			lookup.failNext = true;
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1_000_000,
				staleAfterMs: 5000,
			});
			await expect(cache.start()).resolves.toBeUndefined();
			expect(cache.evaluate('192.0.2.5')).toEqual({ kind: 'unavailable' });
			cache.stop();
		});

		it('stop() clears the timer so no further refresh fires', async () => {
			vi.useFakeTimers();
			try {
				const lookup = new FakeLookup();
				lookup.rows = [entry()];
				const cache = new SourceAclCache({
					lookup,
					refreshIntervalMs: 100,
					staleAfterMs: 5000,
				});
				await cache.start();
				const callsAfterStart = lookup.calls;
				cache.stop();
				await vi.advanceTimersByTimeAsync(1000);
				expect(lookup.calls).toBe(callsAfterStart);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('SourceAclCache.evaluateRecipient (JR-4-05b)', () => {
		it("reports 'unavailable' before the first successful refresh", () => {
			const lookup = new FakeLookup();
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			expect(cache.evaluateRecipient('journal-1@journaling.test.invalid')).toEqual({
				kind: 'unavailable',
			});
		});

		it("reports 'allowed' with the matched source's identity and chainScopeId, case-folded and trimmed the same way as recipient-address.ts", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [
				entry({
					id: 's-a',
					chainScopeId: 'arch-a',
					routingAddress: 'journal-a@journaling.example.com',
				}),
			];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();

			expect(cache.evaluateRecipient('  Journal-A@Journaling.Example.Com  ')).toEqual({
				kind: 'allowed',
				sourceId: 's-a',
				chainScopeId: 'arch-a',
			});
		});

		it("reports 'denied' for an address matching no active source's routing_address once the ACL is known", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry()];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();

			expect(cache.evaluateRecipient('unknown@journaling.example.com')).toEqual({
				kind: 'denied',
			});
		});

		it('resolves a shared routing address to the first (lowest-id) source, the same dedup buildRecipientIndex performs, and logs the conflict', async () => {
			const lookup = new FakeLookup();
			lookup.rows = [
				entry({
					id: 's-first',
					chainScopeId: 'arch-first',
					routingAddress: 'shared@journaling.example.com',
				}),
				entry({
					id: 's-second',
					chainScopeId: 'arch-second',
					routingAddress: 'shared@journaling.example.com',
				}),
			];
			const { logger, errors } = recordingLogger();
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
				logger,
			});
			await cache.refreshNow();

			expect(cache.evaluateRecipient('shared@journaling.example.com')).toEqual({
				kind: 'allowed',
				sourceId: 's-first',
				chainScopeId: 'arch-first',
			});
			expect(
				errors.some((call) => String(call[1]).includes('share the same routing_address'))
			).toBe(true);
		});
	});

	describe('SourceAclCache.lookupCredential (JR-4-05c)', () => {
		it("reports 'unavailable' before the first successful refresh", () => {
			const lookup = new FakeLookup();
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			expect(cache.lookupCredential('journal-a')).toEqual({ kind: 'unavailable' });
		});

		it("reports 'found' with the matched source's identity and stored hash once the ACL is known", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [
				entry({
					id: 's-a',
					chainScopeId: 'arch-a',
					smtpUsername: 'journal-a',
					smtpPasswordHash: '$2b$10$stored-hash',
				}),
			];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();

			expect(cache.lookupCredential('journal-a')).toEqual({
				kind: 'found',
				sourceId: 's-a',
				chainScopeId: 'arch-a',
				passwordHash: '$2b$10$stored-hash',
			});
		});

		it("reports 'not_found' for an unknown username once the ACL is known", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry({ smtpUsername: 'journal-a', smtpPasswordHash: '$2b$10$x' })];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();

			expect(cache.lookupCredential('no-such-user')).toEqual({ kind: 'not_found' });
		});

		it("reports 'not_found', never 'found', for a real source that has no AUTH credentials configured", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry({ id: 's-no-auth' })];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();

			expect(cache.lookupCredential('s-no-auth')).toEqual({ kind: 'not_found' });
		});

		it('is case-sensitive, unlike the recipient ACL -- AUTH usernames are compared byte-for-byte', async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry({ smtpUsername: 'Journal-A', smtpPasswordHash: '$2b$10$x' })];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();

			expect(cache.lookupCredential('journal-a')).toEqual({ kind: 'not_found' });
			expect(cache.lookupCredential('Journal-A').kind).toBe('found');
		});

		it("fails closed to 'unavailable' once a stalled refresh exceeds staleAfterMs, never 'not_found'", async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry({ smtpUsername: 'journal-a', smtpPasswordHash: '$2b$10$x' })];
			let clock = 0;
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5_000,
				now: () => clock,
			});
			await cache.refreshNow();
			expect(cache.lookupCredential('journal-a').kind).toBe('found');

			clock += 10_000;
			expect(cache.lookupCredential('journal-a')).toEqual({ kind: 'unavailable' });
		});
	});

	describe('createSourceAclRequireTlsResolver', () => {
		it('always requires TLS when the process default is true, regardless of the ACL', () => {
			const lookup = new FakeLookup();
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			const resolver = createSourceAclRequireTlsResolver(cache, true);
			expect(resolver({ remoteIp: null, ehloName: null, rcptTo: [] })).toBe(true);
		});

		it('tightens to true when the matched source requires TLS and the process default does not', async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry({ requireTls: true })];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();
			const resolver = createSourceAclRequireTlsResolver(cache, false);
			expect(resolver({ remoteIp: '192.0.2.5', ehloName: null, rcptTo: [] })).toBe(true);
		});

		it('stays false when the matched source does not require TLS and neither does the process', async () => {
			const lookup = new FakeLookup();
			lookup.rows = [entry({ requireTls: false })];
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			await cache.refreshNow();
			const resolver = createSourceAclRequireTlsResolver(cache, false);
			expect(resolver({ remoteIp: '192.0.2.5', ehloName: null, rcptTo: [] })).toBe(false);
		});

		it('never loosens: an unmatched or null remoteIp contributes false, never blocking the process default', () => {
			const lookup = new FakeLookup();
			const cache = new SourceAclCache({
				lookup,
				refreshIntervalMs: 1000,
				staleAfterMs: 5000,
			});
			const resolver = createSourceAclRequireTlsResolver(cache, false);
			expect(resolver({ remoteIp: null, ehloName: null, rcptTo: [] })).toBe(false);
			expect(resolver({ remoteIp: '198.51.100.1', ehloName: null, rcptTo: [] })).toBe(false);
		});
	});
});
