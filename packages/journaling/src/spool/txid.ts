import { randomBytes } from 'node:crypto';

/**
 * Transaction ID generation (`JR-3-01`, `docs/dev/journaling/02-architektur.md` section 3 step 1).
 *
 * The transaction ID is assigned **before** the spool write, in-session, while `seq` is not yet
 * known — `seq` only exists once the ledger append (§4) has happened, so the spool filename cannot
 * carry it. `spool_txid` is the column that ties a ledger row back to the file that produced it
 * (crash recovery, `JR-3-05`, reads it the other way: file on disk -> ledger row, or its absence).
 *
 * ULID rather than a plain UUID: 26 Crockford-Base32 characters, lexically sortable by creation
 * time. That ordering is not decoration — the crash-recovery scan (`JR-3-05`) and any operator
 * listing the spool benefit from `ls` already being chronological, without parsing a timestamp out
 * of every filename. A v4 UUID would work for uniqueness alone; it would not sort.
 *
 * No dependency added for this: the encoding is under thirty lines, and the repository already
 * prefers writing a small format out (`tests/support/suite-inventory.ts`'s `globToRegExp`) over a
 * dependency for it.
 */

/** Crockford's Base32 alphabet: no `I`, `L`, `O`, `U`, so a transcribed ID cannot be misread as one. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 48-bit timestamp -> 10 characters (allows dates up to the year 10889, far beyond any deployment). */
const TIME_CHARS = 10;
const MAX_TIME_MS = 2 ** 48 - 1;

/** 80 bits of randomness -> 16 characters, evenly (80 / 5), so there is no partial final character. */
const RANDOM_BYTES = 10;

function encodeTimestamp(timestampMs: number): string {
	if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > MAX_TIME_MS) {
		throw new RangeError(
			`ULID timestamp must be an integer in [0, ${MAX_TIME_MS}] milliseconds, got ${timestampMs}.`
		);
	}
	let value = timestampMs;
	const chars = new Array<string>(TIME_CHARS);
	for (let index = TIME_CHARS - 1; index >= 0; index -= 1) {
		chars[index] = ENCODING[value % 32]!;
		value = Math.floor(value / 32);
	}
	return chars.join('');
}

/** Bit-slice `bytes` into 5-bit groups, MSB first. `bytes.length * 8` must be a multiple of 5. */
function encodeBits(bytes: Buffer): string {
	let buffer = 0;
	let bufferedBits = 0;
	let out = '';
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bufferedBits += 8;
		while (bufferedBits >= 5) {
			bufferedBits -= 5;
			out += ENCODING[(buffer >> bufferedBits) & 0x1f];
		}
	}
	return out;
}

/**
 * Generate one transaction ID: a 26-character ULID, time-prefixed then randomness-suffixed.
 *
 * `now` is injectable so tests can assert lexical ordering across controlled timestamps without
 * depending on wall-clock timing between two calls.
 */
export function generateTxId(now: () => number = Date.now): string {
	return encodeTimestamp(now()) + encodeBits(randomBytes(RANDOM_BYTES));
}

/** `true` for exactly the strings `generateTxId()` can produce. Used by validation, not by the hot path. */
export function isValidTxId(candidate: string): boolean {
	return new RegExp(`^[${ENCODING}]{26}$`).test(candidate);
}
