import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	PerSourceConnectionLimiter,
	PerSourceTransactionRateLimiter,
} from './connection-rate-limiter';

/**
 * `JR-4-08` -- the two per-source limiters in isolation, against fakes/a controlled clock. The
 * proof that `EsmtpServer` actually gates a connection/transaction with these -- and that an
 * unauthorized IP can never reach them at all -- lives in
 * `../../tests/unit/smtp-rate-limit-protocol.test.ts`, a real loopback socket.
 */
suite('ci', 'PerSourceConnectionLimiter (JR-4-08)', () => {
	it('admits up to the configured maximum, then refuses the next', () => {
		const limiter = new PerSourceConnectionLimiter(2);
		expect(limiter.tryAcquire('source-a')).toBe(true);
		expect(limiter.tryAcquire('source-a')).toBe(true);
		expect(limiter.tryAcquire('source-a')).toBe(false);
	});

	it('tracks each source independently -- one source at its limit does not affect another', () => {
		const limiter = new PerSourceConnectionLimiter(1);
		expect(limiter.tryAcquire('source-a')).toBe(true);
		expect(limiter.tryAcquire('source-a')).toBe(false);
		expect(limiter.tryAcquire('source-b')).toBe(true);
	});

	it('release() frees exactly one slot, letting a subsequent acquire succeed', () => {
		const limiter = new PerSourceConnectionLimiter(1);
		expect(limiter.tryAcquire('source-a')).toBe(true);
		expect(limiter.tryAcquire('source-a')).toBe(false);
		limiter.release('source-a');
		expect(limiter.tryAcquire('source-a')).toBe(true);
	});

	it('a refused tryAcquire does not itself consume a slot', () => {
		const limiter = new PerSourceConnectionLimiter(1);
		limiter.tryAcquire('source-a');
		limiter.tryAcquire('source-a'); // refused
		expect(limiter.currentCount('source-a')).toBe(1);
	});

	it('removes a source entirely from its internal map once its count returns to zero -- memory is bounded by currently-open sources, not by history', () => {
		const limiter = new PerSourceConnectionLimiter(5);
		limiter.tryAcquire('source-a');
		limiter.release('source-a');
		expect(limiter.currentCount('source-a')).toBe(0);
	});

	it('release() on a source with no acquired slot is a no-op, never negative', () => {
		const limiter = new PerSourceConnectionLimiter(5);
		limiter.release('never-acquired');
		expect(limiter.currentCount('never-acquired')).toBe(0);
	});
});

suite('ci', 'PerSourceTransactionRateLimiter (JR-4-08)', () => {
	it('admits up to the configured maximum within one window, then refuses the next', () => {
		let now = 0;
		const limiter = new PerSourceTransactionRateLimiter(2, 60_000, () => now);
		expect(limiter.tryConsume('source-a')).toBe(true);
		expect(limiter.tryConsume('source-a')).toBe(true);
		expect(limiter.tryConsume('source-a')).toBe(false);
	});

	it('tracks each source independently', () => {
		let now = 0;
		const limiter = new PerSourceTransactionRateLimiter(1, 60_000, () => now);
		expect(limiter.tryConsume('source-a')).toBe(true);
		expect(limiter.tryConsume('source-a')).toBe(false);
		expect(limiter.tryConsume('source-b')).toBe(true);
	});

	it('resets the count once the window has elapsed', () => {
		let now = 0;
		const limiter = new PerSourceTransactionRateLimiter(1, 60_000, () => now);
		expect(limiter.tryConsume('source-a')).toBe(true);
		expect(limiter.tryConsume('source-a')).toBe(false);
		now = 60_000; // exactly one window later
		expect(limiter.tryConsume('source-a')).toBe(true);
	});

	it('does not reset one instant before the window has elapsed', () => {
		let now = 0;
		const limiter = new PerSourceTransactionRateLimiter(1, 60_000, () => now);
		expect(limiter.tryConsume('source-a')).toBe(true);
		now = 59_999;
		expect(limiter.tryConsume('source-a')).toBe(false);
	});

	it('currentWindowCount reports 0 once the window has expired without a new attempt', () => {
		let now = 0;
		const limiter = new PerSourceTransactionRateLimiter(5, 60_000, () => now);
		limiter.tryConsume('source-a');
		now = 120_000;
		expect(limiter.currentWindowCount('source-a')).toBe(0);
	});

	it('pruneExpired() leaves a still-active window untouched (does not reset it early)', () => {
		let now = 0;
		const limiter = new PerSourceTransactionRateLimiter(2, 60_000, () => now);
		expect(limiter.tryConsume('source-a')).toBe(true);
		expect(limiter.tryConsume('source-a')).toBe(true); // now at its limit within this window
		now = 30_000; // still inside the same 60s window
		limiter.pruneExpired();
		// If pruning had erroneously dropped a still-valid window, this would start a fresh one and
		// return true instead of correctly staying refused.
		expect(limiter.tryConsume('source-a')).toBe(false);
	});

	it('defaults to Date.now when no clock is injected', () => {
		const limiter = new PerSourceTransactionRateLimiter(1, 60_000);
		expect(limiter.tryConsume('source-a')).toBe(true);
		expect(limiter.tryConsume('source-a')).toBe(false);
	});
});
