import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { ingressTlsConfigSchema, TLS_MIN_VERSION } from './tls-config';

/**
 * `JR-4-04` -- the TLS configuration schema's pure validation logic. The wire-level proof that
 * `STARTTLS`/`require_tls` actually behave as this schema promises lives in
 * `packages/journaling/tests/unit/smtp-starttls-protocol.test.ts`; this file covers only
 * `ingressTlsConfigSchema` in isolation.
 */
suite('ci', 'ingressTlsConfigSchema (JR-4-04)', () => {
	it('TLS_MIN_VERSION is the fixed floor, not a configurable field', () => {
		expect(TLS_MIN_VERSION).toBe('TLSv1.2');
	});

	describe('defaults', () => {
		it('accepts an empty object: no certificate, requireTls defaults to false', () => {
			const config = ingressTlsConfigSchema.parse({});
			expect(config.cert).toBeUndefined();
			expect(config.key).toBeUndefined();
			expect(config.requireTls).toBe(false);
		});

		it('accepts an explicit requireTls: false with no certificate', () => {
			const config = ingressTlsConfigSchema.parse({ requireTls: false });
			expect(config.requireTls).toBe(false);
		});

		it('coerces a string "true" the same way smtp-config.ts coerces numeric strings', () => {
			const config = ingressTlsConfigSchema.parse({
				cert: 'CERT',
				key: 'KEY',
				requireTls: 'true',
			});
			expect(config.requireTls).toBe(true);
		});
	});

	describe('cert/key must both be set or both be unset', () => {
		it('accepts both cert and key together', () => {
			const config = ingressTlsConfigSchema.parse({ cert: 'CERT', key: 'KEY' });
			expect(config.cert).toBe('CERT');
			expect(config.key).toBe('KEY');
		});

		it('rejects cert without key', () => {
			expect(() => ingressTlsConfigSchema.parse({ cert: 'CERT' })).toThrow();
		});

		it('rejects key without cert', () => {
			expect(() => ingressTlsConfigSchema.parse({ key: 'KEY' })).toThrow();
		});

		it('rejects an empty-string cert (must be non-empty PEM content, not a path)', () => {
			expect(() => ingressTlsConfigSchema.parse({ cert: '', key: 'KEY' })).toThrow();
		});
	});

	describe('requireTls: true requires a certificate', () => {
		it('rejects requireTls: true with no certificate configured at all', () => {
			expect(() => ingressTlsConfigSchema.parse({ requireTls: true })).toThrow();
		});

		it('accepts requireTls: true when cert and key are both configured', () => {
			const config = ingressTlsConfigSchema.parse({
				cert: 'CERT',
				key: 'KEY',
				requireTls: true,
			});
			expect(config.requireTls).toBe(true);
		});
	});
});
