import { coverageNotice } from './notice';

/**
 * Deterministic randomness for adversarial tests (JR-102, Testplan rule 3).
 *
 * Any randomised test must (a) derive every random choice from a single seed and (b) print that
 * seed, so a failure can be replayed exactly with `OA_TEST_SEED=<n>`. A flaky adversarial test is
 * worthless because nobody believes its failures.
 *
 * Deliberately dependency-free: no `Math.random()` anywhere in the generator path.
 */

const ENV_VAR = 'OA_TEST_SEED';

export interface Seeded {
	readonly seed: number;
	/** Uniform float in [0, 1). */
	next(): number;
	/** Integer in [0, maxExclusive). */
	int(maxExclusive: number): number;
	/** Uniformly picks one element. Throws on an empty list rather than returning undefined. */
	pick<T>(items: readonly T[]): T;
	/** Context string to attach to every assertion message so a failure is replayable. */
	context(extra?: Record<string, unknown>): string;
}

/**
 * Resolve the seed for a suite: `OA_TEST_SEED` if set, otherwise a fresh random one.
 * The chosen seed is always printed, including the exact command to replay it.
 */
export function resolveSeed(suiteName: string): number {
	const raw = process.env[ENV_VAR]?.trim();
	if (raw) {
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			throw new Error(`${ENV_VAR} must be a finite number, got "${raw}".`);
		}
		const seed = parsed >>> 0;
		coverageNotice(`SEED ${suiteName}: ${seed} (pinned via ${ENV_VAR})`);
		return seed;
	}
	// Reproducibility comes from printing the seed, not from where it was drawn.
	const seed = Number(process.hrtime.bigint() & 0xffffffffn) >>> 0;
	coverageNotice(`SEED ${suiteName}: ${seed} -- replay with ${ENV_VAR}=${seed} pnpm test`);
	return seed;
}

/** mulberry32 -- small, fast, fully determined by its 32-bit state. */
export function seededRng(seed: number, suiteName = 'unnamed'): Seeded {
	let state = seed >>> 0;
	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		seed,
		next,
		int(maxExclusive: number): number {
			if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
				throw new Error(`int() needs a positive integer bound, got ${maxExclusive}.`);
			}
			return Math.floor(next() * maxExclusive);
		},
		pick<T>(items: readonly T[]): T {
			if (items.length === 0) {
				throw new Error('pick() called with an empty list.');
			}
			return items[Math.floor(next() * items.length)]!;
		},
		context(extra?: Record<string, unknown>): string {
			const parts = [`suite=${suiteName}`, `${ENV_VAR}=${seed}`];
			for (const [key, value] of Object.entries(extra ?? {})) {
				parts.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
			}
			return parts.join(' ');
		},
	};
}
