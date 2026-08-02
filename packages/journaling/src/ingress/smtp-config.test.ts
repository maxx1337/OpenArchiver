import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	DEFAULT_COMMAND_TIMEOUT_MS,
	DEFAULT_CONNECTION_TIMEOUT_MS,
	DEFAULT_DATA_TIMEOUT_MS,
	DEFAULT_SMTP_HOSTNAME,
	DEFAULT_SMTP_SIZE_LIMIT_BYTES,
	smtpServerConfigSchema,
} from './smtp-config';

/**
 * `JR-4-02` -- the ESMTP protocol engine's own configuration schema. Complements `config.test.ts`
 * (which only proves this schema embeds correctly into `IngressConfig`) with the full validation
 * matrix: every field's default, every field's rejection of a non-positive value, and the named
 * constants this task's acceptance criterion cites directly ("SIZE default is 150 MB, as a named
 * constant").
 */
suite('ci', 'SmtpServerConfig (JR-4-02)', () => {
	describe('named constants', () => {
		it('DEFAULT_SMTP_SIZE_LIMIT_BYTES is exactly 150 MB', () => {
			expect(DEFAULT_SMTP_SIZE_LIMIT_BYTES).toBe(150 * 1024 * 1024);
			expect(DEFAULT_SMTP_SIZE_LIMIT_BYTES).toBe(157_286_400);
		});

		it('the three timeout constants are distinct and positive', () => {
			expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBeGreaterThan(0);
			expect(DEFAULT_COMMAND_TIMEOUT_MS).toBeGreaterThan(0);
			expect(DEFAULT_DATA_TIMEOUT_MS).toBeGreaterThan(0);
			expect(
				new Set([
					DEFAULT_CONNECTION_TIMEOUT_MS,
					DEFAULT_COMMAND_TIMEOUT_MS,
					DEFAULT_DATA_TIMEOUT_MS,
				]).size
			).toBe(3);
		});

		it('DEFAULT_SMTP_HOSTNAME is a non-empty static string', () => {
			expect(DEFAULT_SMTP_HOSTNAME.length).toBeGreaterThan(0);
		});
	});

	describe('defaults', () => {
		it('fills in every field when given an empty object', () => {
			const config = smtpServerConfigSchema.parse({});
			expect(config).toEqual({
				hostname: DEFAULT_SMTP_HOSTNAME,
				sizeLimitBytes: DEFAULT_SMTP_SIZE_LIMIT_BYTES,
				connectionTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS,
				commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
				dataTimeoutMs: DEFAULT_DATA_TIMEOUT_MS,
			});
		});

		it('accepts a fully overridden configuration', () => {
			const config = smtpServerConfigSchema.parse({
				hostname: 'mail.example.com',
				sizeLimitBytes: 1_000_000,
				connectionTimeoutMs: 1_000,
				commandTimeoutMs: 2_000,
				dataTimeoutMs: 3_000,
			});
			expect(config).toEqual({
				hostname: 'mail.example.com',
				sizeLimitBytes: 1_000_000,
				connectionTimeoutMs: 1_000,
				commandTimeoutMs: 2_000,
				dataTimeoutMs: 3_000,
			});
		});

		it('coerces string-typed numeric fields (the shape env-var mapping produces)', () => {
			const config = smtpServerConfigSchema.parse({
				sizeLimitBytes: '2000000',
				connectionTimeoutMs: '5000',
				commandTimeoutMs: '6000',
				dataTimeoutMs: '7000',
			});
			expect(config.sizeLimitBytes).toBe(2_000_000);
			expect(config.connectionTimeoutMs).toBe(5_000);
			expect(config.commandTimeoutMs).toBe(6_000);
			expect(config.dataTimeoutMs).toBe(7_000);
		});
	});

	describe('rejections', () => {
		it('rejects an empty hostname', () => {
			expect(() => smtpServerConfigSchema.parse({ hostname: '' })).toThrow();
		});

		it('rejects a zero sizeLimitBytes', () => {
			expect(() => smtpServerConfigSchema.parse({ sizeLimitBytes: 0 })).toThrow();
		});

		it('rejects a negative sizeLimitBytes', () => {
			expect(() => smtpServerConfigSchema.parse({ sizeLimitBytes: -1 })).toThrow();
		});

		it('rejects a zero connectionTimeoutMs', () => {
			expect(() => smtpServerConfigSchema.parse({ connectionTimeoutMs: 0 })).toThrow();
		});

		it('rejects a negative commandTimeoutMs', () => {
			expect(() => smtpServerConfigSchema.parse({ commandTimeoutMs: -100 })).toThrow();
		});

		it('rejects a zero dataTimeoutMs', () => {
			expect(() => smtpServerConfigSchema.parse({ dataTimeoutMs: 0 })).toThrow();
		});

		it('rejects a non-integer sizeLimitBytes', () => {
			expect(() => smtpServerConfigSchema.parse({ sizeLimitBytes: 100.5 })).toThrow();
		});
	});
});
