import { parseIPv4, parseIPv6 } from '../ledger/canonical-encoding';

/**
 * CIDR parsing and matching for the SMTP ingress source ACL (`JR-4-05a`, RFC section 4.3, skill
 * `journal-ledger` section 2 -- "Source IP not in ACL" ⇒ `554 5.7.1` at connect).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this reuses `parseIPv4`/`parseIPv6` instead of a second address parser
 * ---------------------------------------------------------------------------------------------
 * `../ledger/canonical-encoding.ts` already has to parse IPv4/IPv6 text correctly (ADR-006 section
 * 3.2, `normalizeRemoteIp()`) -- rejecting ambiguous leading-zero octets, handling `::`
 * compression, IPv4-mapped/-compatible forms, all of it. A second, independent parser for
 * `journaling_sources.allowed_ips` CIDR literals would inevitably drift from that one in some
 * corner case, and the drift would show up exactly where it is least visible: an ACL entry that
 * looks like it should match a connecting IP but silently does not, or worse, an ACL entry more
 * permissive than the operator intended. Both functions are exported from that module for
 * precisely this reuse.
 *
 * ---------------------------------------------------------------------------------------------
 * The failure contract: throw loudly, never fall open
 * ---------------------------------------------------------------------------------------------
 * {@link parseCidr} throws `RangeError` on anything invalid -- an unparseable address, a
 * non-numeric or out-of-range prefix length, a negative prefix (never matched by the `\d+` prefix
 * pattern, so it falls through to "not a parseable address" instead of being read as a number).
 * The caller (`./source-acl-cache.ts`'s `compileSourceAcl`) must treat a throw as "this whole
 * source's ACL is unusable, fail closed and alert" -- never as "skip this one entry and keep
 * going", which would let a typo in one CIDR silently narrow an operator's intended allow-list
 * without anyone noticing the entry stopped applying.
 */

/** One parsed `allowed_ips` entry: a bare address (implicit `/32` or `/128`) or `address/prefix`. */
export interface ParsedCidr {
	readonly family: 4 | 6;
	/** Network address bytes as parsed from the literal -- 4 bytes for IPv4, 16 for IPv6. Bits
	 * beyond `prefixLength` are whatever the literal happened to contain, not masked to zero;
	 * {@link matchesCidr} only ever compares the significant leading bits. */
	readonly networkBytes: Uint8Array;
	readonly prefixLength: number;
	/** `true` when `prefixLength` is `0` -- matches every address of `family`. Surfaced so a
	 * caller can log it loudly: an accidental catch-all source ACL entry is the same class of
	 * misconfiguration the skill's "no catch-all recipient" prohibition (section 10) warns about,
	 * just one layer up the stack, and it must not pass unremarked. */
	readonly isCatchAll: boolean;
}

const CIDR_SUFFIX_PATTERN = /^(.*)\/(\d+)$/;

/**
 * Parse one `journaling_sources.allowed_ips` entry.
 *
 * Throws `RangeError` -- never returns a value claiming to represent an invalid entry -- for: an
 * address neither `parseIPv4` nor `parseIPv6` accepts; a prefix length that is not a non-negative
 * integer in range for the parsed family (0-32 for IPv4, 0-128 for IPv6); a `/` suffix that is not
 * purely digits (a negative or non-numeric prefix falls into "the whole string is not a parseable
 * address" rather than being read as a number, since the pattern only ever captures digits).
 */
export function parseCidr(raw: string): ParsedCidr {
	const trimmed = raw.trim();
	const match = CIDR_SUFFIX_PATTERN.exec(trimmed);
	const addressText = match ? match[1]! : trimmed;
	const prefixText = match ? match[2]! : null;

	const v4 = parseIPv4(addressText);
	if (v4) {
		const prefixLength = prefixText === null ? 32 : Number(prefixText);
		if (!Number.isInteger(prefixLength) || prefixLength > 32) {
			throw new RangeError(
				`CIDR "${raw}" has an invalid IPv4 prefix length (must be an integer between 0 and 32).`
			);
		}
		return {
			family: 4,
			networkBytes: Uint8Array.from(v4),
			prefixLength,
			isCatchAll: prefixLength === 0,
		};
	}

	const v6 = parseIPv6(addressText);
	if (v6) {
		const prefixLength = prefixText === null ? 128 : Number(prefixText);
		if (!Number.isInteger(prefixLength) || prefixLength > 128) {
			throw new RangeError(
				`CIDR "${raw}" has an invalid IPv6 prefix length (must be an integer between 0 and 128).`
			);
		}
		return {
			family: 6,
			networkBytes: Uint8Array.from(v6),
			prefixLength,
			isCatchAll: prefixLength === 0,
		};
	}

	throw new RangeError(`CIDR "${raw}" is not a parseable IPv4 or IPv6 address or CIDR block.`);
}

/**
 * Whether `normalizedRemoteIp` (the caller's job to have already run through `normalizeRemoteIp()`
 * -- see `./source-acl-cache.ts`'s `SourceAclCache.evaluate`) falls inside `cidr`.
 *
 * A family mismatch (an IPv4 peer against an IPv6 prefix, or vice versa) is simply "no match",
 * never an error -- the same way an ordinary `/24` simply does not match an address in a different
 * subnet. This is what lets a source mix IPv4 and IPv6 entries in one `allowed_ips` list and have
 * each entry only ever apply to the family it names.
 */
export function matchesCidr(normalizedRemoteIp: string, cidr: ParsedCidr): boolean {
	const bytes = cidr.family === 4 ? parseIPv4(normalizedRemoteIp) : parseIPv6(normalizedRemoteIp);
	if (!bytes) {
		return false;
	}
	return prefixMatches(bytes, cidr.networkBytes, cidr.prefixLength);
}

function prefixMatches(
	address: readonly number[],
	network: Uint8Array,
	prefixLength: number
): boolean {
	let remainingBits = prefixLength;
	for (let index = 0; index < network.length && remainingBits > 0; index += 1) {
		const bitsInThisByte = Math.min(8, remainingBits);
		const mask = bitsInThisByte === 8 ? 0xff : (0xff << (8 - bitsInThisByte)) & 0xff;
		if ((address[index]! & mask) !== (network[index]! & mask)) {
			return false;
		}
		remainingBits -= bitsInThisByte;
	}
	return true;
}
