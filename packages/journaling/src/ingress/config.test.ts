import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { formatIngressConfigError, parseIngressConfig } from './config';
import { DEFAULT_SMTP_SIZE_LIMIT_BYTES } from './smtp-config';
import {
	DEFAULT_MAX_CONNECTIONS_PER_SOURCE,
	DEFAULT_MAX_TRANSACTIONS_PER_SOURCE_PER_WINDOW,
	DEFAULT_RATE_LIMIT_WINDOW_MS,
} from './rate-limit-config';

/**
 * `JR-4-01` -- the `apps/smtp-ingress` process configuration schema.
 *
 * These are the tests behind the acceptance criterion "fehlende Konfiguration führt zu einer
 * klaren Startmeldung, nicht zu einem Import-Crash": every case below proves the *logic*
 * (`parseIngressConfig` / `formatIngressConfigError`) fails gracefully with a readable message
 * rather than throwing something unreadable. The companion proof that the real *process* behaves
 * the same way, and that it never imports `packages/backend/src/config/*` or
 * `src/database/index.ts` to get there, lives in
 * `packages/journaling/tests/unit/ingress-import-graph.test.ts` and
 * `packages/journaling/tests/unit/ingress-process-boot.test.ts`.
 */
suite('ci', 'IngressConfig (JR-4-01)', () => {
	describe('parseIngressConfig', () => {
		const validInput = {
			smtpPort: 2525,
			spool: {
				rootPath: '/var/lib/open-archiver/spool',
				highWaterBytes: '10000000000',
			},
			// JR-4-02: `smtp` is a required key (like `spool` above), but every field inside it is
			// itself optional and defaults on its own -- `{}` is exactly what
			// `config-from-env.ts` produces when none of the SMTP_INGRESS_* smtp env vars are set.
			smtp: {},
			// JR-4-04: `tls` is required the same way, and `{}` means "no certificate, TLS not
			// required" -- exactly what `config-from-env.ts` produces when no SMTP_INGRESS_TLS_*/
			// SMTP_INGRESS_REQUIRE_TLS env var is set.
			tls: {},
			// JR-4-05a: `sourceAcl` is required and, unlike `smtp`/`tls`, `{}` is *not* valid --
			// `databaseUrl` has no default (see source-acl-config.ts's doc comment for why).
			sourceAcl: {
				databaseUrl: 'postgresql://smtp_ingress_ro:pw@localhost:5432/open_archive',
			},
			// JR-4-06a: `ledger` is required as a key (like `smtp`/`tls`), but `{}` *is* valid --
			// unlike `sourceAcl.databaseUrl`, `ledger.databaseUrl` has no security consequence when
			// unset (see ledger-config.ts's doc comment for why).
			ledger: {},
			// JR-4-08: `rateLimit` is required as a key, same shape as `smtp`/`tls`/`ledger` -- `{}`
			// is valid, every field defaults on its own (rate-limit-config.ts's doc comment explains
			// why these defaults are safe to ship, unlike sourceAcl.databaseUrl).
			rateLimit: {},
		};

		it('accepts a fully specified, valid configuration', () => {
			const config = parseIngressConfig(validInput);
			expect(config.smtpPort).toBe(2525);
			expect(config.spool.rootPath).toBe('/var/lib/open-archiver/spool');
			expect(config.spool.highWaterBytes).toBe(10_000_000_000n);
		});

		it('defaults logLevel to "info" when not supplied', () => {
			const config = parseIngressConfig(validInput);
			expect(config.logLevel).toBe('info');
		});

		it('accepts an explicit logLevel', () => {
			const config = parseIngressConfig({ ...validInput, logLevel: 'debug' });
			expect(config.logLevel).toBe('debug');
		});

		it('defaults every field of smtp (JR-4-02) when smtp is an empty object', () => {
			const config = parseIngressConfig(validInput);
			expect(config.smtp.sizeLimitBytes).toBe(DEFAULT_SMTP_SIZE_LIMIT_BYTES);
		});

		it('embeds an explicit smtp override rather than replacing it with defaults', () => {
			const config = parseIngressConfig({
				...validInput,
				smtp: { sizeLimitBytes: 1_000_000 },
			});
			expect(config.smtp.sizeLimitBytes).toBe(1_000_000);
			// Fields not overridden inside `smtp` still default on their own -- the embedding does not
			// require the caller to specify every field once any one of them is given.
			expect(config.smtp.hostname).toBeTruthy();
		});

		it('rejects a configuration with the smtp key missing entirely', () => {
			const { smtp: _smtp, ...rest } = validInput;
			expect(() => parseIngressConfig(rest)).toThrow();
		});

		it('defaults every field of tls (JR-4-04) when tls is an empty object', () => {
			const config = parseIngressConfig(validInput);
			expect(config.tls.cert).toBeUndefined();
			expect(config.tls.key).toBeUndefined();
			expect(config.tls.requireTls).toBe(false);
		});

		it('embeds an explicit tls override rather than replacing it with defaults', () => {
			const config = parseIngressConfig({
				...validInput,
				tls: { cert: 'CERT', key: 'KEY', requireTls: true },
			});
			expect(config.tls.requireTls).toBe(true);
			expect(config.tls.cert).toBe('CERT');
		});

		it('rejects a configuration with the tls key missing entirely', () => {
			const { tls: _tls, ...rest } = validInput;
			expect(() => parseIngressConfig(rest)).toThrow();
		});

		it('rejects tls.requireTls: true with no certificate configured', () => {
			expect(() =>
				parseIngressConfig({ ...validInput, tls: { requireTls: true } })
			).toThrow();
		});

		it('rejects tls.cert without a matching tls.key', () => {
			expect(() => parseIngressConfig({ ...validInput, tls: { cert: 'CERT' } })).toThrow();
		});

		it('rejects a configuration with the sourceAcl key missing entirely', () => {
			const { sourceAcl: _sourceAcl, ...rest } = validInput;
			expect(() => parseIngressConfig(rest)).toThrow();
		});

		it('rejects sourceAcl: {} -- unlike smtp/tls, databaseUrl has no default', () => {
			expect(() => parseIngressConfig({ ...validInput, sourceAcl: {} })).toThrow();
		});

		it('rejects an empty sourceAcl.databaseUrl', () => {
			expect(() =>
				parseIngressConfig({ ...validInput, sourceAcl: { databaseUrl: '' } })
			).toThrow();
		});

		it('defaults sourceAcl.refreshIntervalMs/staleAfterMs when only databaseUrl is given', () => {
			const config = parseIngressConfig(validInput);
			expect(config.sourceAcl.refreshIntervalMs).toBe(30_000);
			expect(config.sourceAcl.staleAfterMs).toBe(300_000);
		});

		it('embeds an explicit sourceAcl override rather than replacing it with defaults', () => {
			const config = parseIngressConfig({
				...validInput,
				sourceAcl: { ...validInput.sourceAcl, refreshIntervalMs: 5_000 },
			});
			expect(config.sourceAcl.refreshIntervalMs).toBe(5_000);
			// staleAfterMs still defaults on its own.
			expect(config.sourceAcl.staleAfterMs).toBe(300_000);
		});

		it('rejects sourceAcl.staleAfterMs below sourceAcl.refreshIntervalMs', () => {
			expect(() =>
				parseIngressConfig({
					...validInput,
					sourceAcl: {
						...validInput.sourceAcl,
						refreshIntervalMs: 60_000,
						staleAfterMs: 1_000,
					},
				})
			).toThrow();
		});

		it('rejects a configuration with the ledger key missing entirely', () => {
			const { ledger: _ledger, ...rest } = validInput;
			expect(() => parseIngressConfig(rest)).toThrow();
		});

		it('accepts ledger: {} -- unlike sourceAcl, databaseUrl is optional (JR-4-06a)', () => {
			const config = parseIngressConfig({ ...validInput, ledger: {} });
			expect(config.ledger.databaseUrl).toBeUndefined();
		});

		it('accepts an explicit ledger.databaseUrl', () => {
			const config = parseIngressConfig({
				...validInput,
				ledger: {
					databaseUrl: 'postgresql://smtp_ingress_ledger:pw@localhost:5432/open_archive',
				},
			});
			expect(config.ledger.databaseUrl).toBe(
				'postgresql://smtp_ingress_ledger:pw@localhost:5432/open_archive'
			);
		});

		it('rejects an empty ledger.databaseUrl (distinct from leaving it unset)', () => {
			expect(() =>
				parseIngressConfig({ ...validInput, ledger: { databaseUrl: '' } })
			).toThrow();
		});

		it('rejects a configuration with the rateLimit key missing entirely', () => {
			const { rateLimit: _rateLimit, ...rest } = validInput;
			expect(() => parseIngressConfig(rest)).toThrow();
		});

		it('defaults every field of rateLimit (JR-4-08) when rateLimit is an empty object', () => {
			const config = parseIngressConfig(validInput);
			expect(config.rateLimit.maxConnectionsPerSource).toBe(
				DEFAULT_MAX_CONNECTIONS_PER_SOURCE
			);
			expect(config.rateLimit.maxTransactionsPerSourcePerWindow).toBe(
				DEFAULT_MAX_TRANSACTIONS_PER_SOURCE_PER_WINDOW
			);
			expect(config.rateLimit.rateLimitWindowMs).toBe(DEFAULT_RATE_LIMIT_WINDOW_MS);
		});

		it('embeds an explicit rateLimit override rather than replacing it with defaults', () => {
			const config = parseIngressConfig({
				...validInput,
				rateLimit: { maxConnectionsPerSource: 3 },
			});
			expect(config.rateLimit.maxConnectionsPerSource).toBe(3);
			// Fields not overridden inside `rateLimit` still default on their own.
			expect(config.rateLimit.maxTransactionsPerSourcePerWindow).toBe(
				DEFAULT_MAX_TRANSACTIONS_PER_SOURCE_PER_WINDOW
			);
		});

		it('rejects a zero or negative rateLimit.maxConnectionsPerSource', () => {
			expect(() =>
				parseIngressConfig({ ...validInput, rateLimit: { maxConnectionsPerSource: 0 } })
			).toThrow();
		});

		it('rejects a zero or negative rateLimit.maxTransactionsPerSourcePerWindow', () => {
			expect(() =>
				parseIngressConfig({
					...validInput,
					rateLimit: { maxTransactionsPerSourcePerWindow: -1 },
				})
			).toThrow();
		});

		it('rejects a zero or negative rateLimit.rateLimitWindowMs', () => {
			expect(() =>
				parseIngressConfig({ ...validInput, rateLimit: { rateLimitWindowMs: 0 } })
			).toThrow();
		});

		it('rejects a missing smtpPort', () => {
			const { smtpPort: _smtpPort, ...rest } = validInput;
			expect(() => parseIngressConfig(rest)).toThrow();
		});

		it('rejects smtpPort 0', () => {
			expect(() => parseIngressConfig({ ...validInput, smtpPort: 0 })).toThrow();
		});

		it('rejects smtpPort above 65535', () => {
			expect(() => parseIngressConfig({ ...validInput, smtpPort: 65536 })).toThrow();
		});

		it('rejects a missing spool.rootPath', () => {
			expect(() =>
				parseIngressConfig({ ...validInput, spool: { highWaterBytes: '1000' } })
			).toThrow();
		});

		it('rejects a missing spool.highWaterBytes', () => {
			expect(() =>
				parseIngressConfig({ ...validInput, spool: { rootPath: '/tmp/spool' } })
			).toThrow();
		});

		it('rejects an empty spool.rootPath', () => {
			expect(() =>
				parseIngressConfig({ ...validInput, spool: { ...validInput.spool, rootPath: '' } })
			).toThrow();
		});

		it('rejects a zero or negative spool.highWaterBytes', () => {
			expect(() =>
				parseIngressConfig({
					...validInput,
					spool: { ...validInput.spool, highWaterBytes: '0' },
				})
			).toThrow();
		});

		it('rejects an entirely missing configuration object the same way (no crash)', () => {
			expect(() => parseIngressConfig(undefined)).toThrow();
			expect(() => parseIngressConfig({})).toThrow();
		});
	});

	describe('formatIngressConfigError', () => {
		// `spool` present as an empty object, not omitted entirely: this is the shape
		// `apps/smtp-ingress/src/config-from-env.ts` actually produces (it always builds a `spool`
		// object, with `rootPath`/`highWaterBytes` possibly `undefined`) -- omitting the whole `spool`
		// key, as a truly empty `{}` input would, makes zod report one issue for the missing key
		// instead of descending into it, which is not the failure shape this process ever produces.
		const multiFieldInvalidInput = { spool: {} };

		it('names every invalid field on a multi-field failure, one per line', () => {
			let caught: unknown;
			try {
				parseIngressConfig(multiFieldInvalidInput);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeDefined();

			const message = formatIngressConfigError(caught);

			expect(message).toContain('configuration invalid');
			expect(message).toContain('smtpPort');
			expect(message).toContain('spool.rootPath');
			expect(message).toContain('spool.highWaterBytes');
		});

		it('never includes a JavaScript stack frame', () => {
			let caught: unknown;
			try {
				parseIngressConfig(multiFieldInvalidInput);
			} catch (error) {
				caught = error;
			}
			const message = formatIngressConfigError(caught);
			expect(message).not.toContain('    at ');
			expect(message).not.toContain('.ts:');
			expect(message).not.toContain('.js:');
		});

		it('falls back to the error message for a non-Zod error, without throwing', () => {
			const message = formatIngressConfigError(new Error('EADDRINUSE: port already in use'));
			expect(message).toBe('smtp-ingress: failed to start: EADDRINUSE: port already in use');
		});

		it('falls back gracefully for a thrown non-Error value', () => {
			expect(() => formatIngressConfigError('not an Error instance')).not.toThrow();
			expect(formatIngressConfigError('not an Error instance')).toContain(
				'not an Error instance'
			);
		});
	});
});
