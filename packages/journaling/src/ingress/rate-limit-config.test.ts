import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	DEFAULT_MAX_CONNECTIONS_PER_SOURCE,
	DEFAULT_MAX_TRANSACTIONS_PER_SOURCE_PER_WINDOW,
	DEFAULT_RATE_LIMIT_WINDOW_MS,
	rateLimitConfigSchema,
} from './rate-limit-config';

/** `JR-4-08` -- the per-source connection/transaction-rate limit zod schema. */
suite('ci', 'rateLimitConfigSchema (JR-4-08)', () => {
	describe('defaults', () => {
		it('defaults every field on an empty object', () => {
			const config = rateLimitConfigSchema.parse({});
			expect(config.maxConnectionsPerSource).toBe(DEFAULT_MAX_CONNECTIONS_PER_SOURCE);
			expect(config.maxTransactionsPerSourcePerWindow).toBe(
				DEFAULT_MAX_TRANSACTIONS_PER_SOURCE_PER_WINDOW
			);
			expect(config.rateLimitWindowMs).toBe(DEFAULT_RATE_LIMIT_WINDOW_MS);
		});

		it('coerces string values (the shape env vars arrive in)', () => {
			const config = rateLimitConfigSchema.parse({
				maxConnectionsPerSource: '5',
				maxTransactionsPerSourcePerWindow: '120',
				rateLimitWindowMs: '30000',
			});
			expect(config.maxConnectionsPerSource).toBe(5);
			expect(config.maxTransactionsPerSourcePerWindow).toBe(120);
			expect(config.rateLimitWindowMs).toBe(30_000);
		});

		it('accepts a fully overridden configuration', () => {
			const config = rateLimitConfigSchema.parse({
				maxConnectionsPerSource: 1,
				maxTransactionsPerSourcePerWindow: 1,
				rateLimitWindowMs: 1_000,
			});
			expect(config).toEqual({
				maxConnectionsPerSource: 1,
				maxTransactionsPerSourcePerWindow: 1,
				rateLimitWindowMs: 1_000,
			});
		});
	});

	describe('validation', () => {
		it('rejects a zero maxConnectionsPerSource', () => {
			expect(() => rateLimitConfigSchema.parse({ maxConnectionsPerSource: 0 })).toThrow();
		});

		it('rejects a negative maxConnectionsPerSource', () => {
			expect(() => rateLimitConfigSchema.parse({ maxConnectionsPerSource: -1 })).toThrow();
		});

		it('rejects a non-integer maxConnectionsPerSource', () => {
			expect(() => rateLimitConfigSchema.parse({ maxConnectionsPerSource: 1.5 })).toThrow();
		});

		it('rejects a zero maxTransactionsPerSourcePerWindow', () => {
			expect(() =>
				rateLimitConfigSchema.parse({ maxTransactionsPerSourcePerWindow: 0 })
			).toThrow();
		});

		it('rejects a negative maxTransactionsPerSourcePerWindow', () => {
			expect(() =>
				rateLimitConfigSchema.parse({ maxTransactionsPerSourcePerWindow: -1 })
			).toThrow();
		});

		it('rejects a zero rateLimitWindowMs', () => {
			expect(() => rateLimitConfigSchema.parse({ rateLimitWindowMs: 0 })).toThrow();
		});

		it('rejects a negative rateLimitWindowMs', () => {
			expect(() => rateLimitConfigSchema.parse({ rateLimitWindowMs: -1 })).toThrow();
		});
	});
});
