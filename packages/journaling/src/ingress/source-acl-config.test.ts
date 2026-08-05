import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	DEFAULT_SOURCE_ACL_REFRESH_INTERVAL_MS,
	DEFAULT_SOURCE_ACL_STALE_AFTER_MS,
	sourceAclConfigSchema,
} from './source-acl-config';

/** `JR-4-05a` -- the source ACL's own zod schema (database connection, cache refresh/staleness). */
suite('ci', 'sourceAclConfigSchema (JR-4-05a)', () => {
	describe('databaseUrl', () => {
		it('accepts a non-empty connection string', () => {
			const config = sourceAclConfigSchema.parse({
				databaseUrl: 'postgresql://ro:pw@localhost:5432/open_archive',
			});
			expect(config.databaseUrl).toBe('postgresql://ro:pw@localhost:5432/open_archive');
		});

		it('rejects a missing databaseUrl -- there is no fallback that admits every connection', () => {
			expect(() => sourceAclConfigSchema.parse({})).toThrow();
		});

		it('rejects an empty databaseUrl', () => {
			expect(() => sourceAclConfigSchema.parse({ databaseUrl: '' })).toThrow();
		});
	});

	describe('refreshIntervalMs / staleAfterMs defaults', () => {
		it('defaults both when only databaseUrl is given', () => {
			const config = sourceAclConfigSchema.parse({ databaseUrl: 'postgresql://x/y' });
			expect(config.refreshIntervalMs).toBe(DEFAULT_SOURCE_ACL_REFRESH_INTERVAL_MS);
			expect(config.staleAfterMs).toBe(DEFAULT_SOURCE_ACL_STALE_AFTER_MS);
		});

		it('coerces string values (the shape env vars arrive in)', () => {
			const config = sourceAclConfigSchema.parse({
				databaseUrl: 'postgresql://x/y',
				refreshIntervalMs: '5000',
				staleAfterMs: '60000',
			});
			expect(config.refreshIntervalMs).toBe(5000);
			expect(config.staleAfterMs).toBe(60000);
		});
	});

	describe('refreshIntervalMs / staleAfterMs validation', () => {
		it('rejects a zero or negative refreshIntervalMs', () => {
			expect(() =>
				sourceAclConfigSchema.parse({
					databaseUrl: 'postgresql://x/y',
					refreshIntervalMs: 0,
				})
			).toThrow();
		});

		it('rejects a zero or negative staleAfterMs', () => {
			expect(() =>
				sourceAclConfigSchema.parse({ databaseUrl: 'postgresql://x/y', staleAfterMs: -1 })
			).toThrow();
		});

		it('rejects staleAfterMs below refreshIntervalMs', () => {
			expect(() =>
				sourceAclConfigSchema.parse({
					databaseUrl: 'postgresql://x/y',
					refreshIntervalMs: 60_000,
					staleAfterMs: 1_000,
				})
			).toThrow();
		});

		it('accepts staleAfterMs exactly equal to refreshIntervalMs', () => {
			const config = sourceAclConfigSchema.parse({
				databaseUrl: 'postgresql://x/y',
				refreshIntervalMs: 10_000,
				staleAfterMs: 10_000,
			});
			expect(config.staleAfterMs).toBe(10_000);
		});
	});
});
