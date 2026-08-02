import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { formatIngressConfigError, parseIngressConfig } from './config';
import { DEFAULT_SMTP_SIZE_LIMIT_BYTES } from './smtp-config';

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
