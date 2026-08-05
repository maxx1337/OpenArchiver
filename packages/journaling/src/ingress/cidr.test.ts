import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { normalizeRemoteIp } from '../ledger/canonical-encoding';
import { matchesCidr, parseCidr } from './cidr';

/**
 * `JR-4-05a` -- CIDR parsing and matching for the source ACL.
 *
 * Every case here is the pure logic only; the wire-level proof that a real client is actually
 * rejected/admitted at connect time lives in
 * `packages/journaling/tests/unit/smtp-source-acl-protocol.test.ts` -- the Product Owner's task
 * note is explicit that a test of the comparison function alone does not prove the acceptance
 * criterion, both are required.
 */
suite('ci', 'CIDR parsing and matching (JR-4-05a)', () => {
	describe('parseCidr', () => {
		it('parses a bare IPv4 address as an implicit /32', () => {
			const cidr = parseCidr('192.0.2.25');
			expect(cidr.family).toBe(4);
			expect(cidr.prefixLength).toBe(32);
			expect(cidr.isCatchAll).toBe(false);
		});

		it('parses an IPv4 CIDR block', () => {
			const cidr = parseCidr('192.0.2.0/24');
			expect(cidr.family).toBe(4);
			expect(cidr.prefixLength).toBe(24);
		});

		it('parses a bare IPv6 address as an implicit /128', () => {
			const cidr = parseCidr('2001:db8::1');
			expect(cidr.family).toBe(6);
			expect(cidr.prefixLength).toBe(128);
		});

		it('parses an IPv6 CIDR block', () => {
			const cidr = parseCidr('2001:db8::/32');
			expect(cidr.family).toBe(6);
			expect(cidr.prefixLength).toBe(32);
		});

		it('flags prefix length 0 as a catch-all, for both families', () => {
			expect(parseCidr('0.0.0.0/0').isCatchAll).toBe(true);
			expect(parseCidr('::/0').isCatchAll).toBe(true);
			expect(parseCidr('192.0.2.0/24').isCatchAll).toBe(false);
		});

		it('rejects an IPv4 prefix length over 32', () => {
			expect(() => parseCidr('192.0.2.0/33')).toThrow(/invalid IPv4 prefix length/);
		});

		it('rejects an IPv6 prefix length over 128', () => {
			expect(() => parseCidr('2001:db8::/129')).toThrow(/invalid IPv6 prefix length/);
		});

		it('rejects a negative prefix length', () => {
			expect(() => parseCidr('192.0.2.0/-1')).toThrow(/not a parseable/);
		});

		it('rejects a non-numeric prefix length', () => {
			expect(() => parseCidr('192.0.2.0/abc')).toThrow(/not a parseable/);
		});

		it('rejects an address in neither family', () => {
			expect(() => parseCidr('not-an-address')).toThrow(/not a parseable/);
			expect(() => parseCidr('999.999.999.999')).toThrow(/not a parseable/);
		});

		it('rejects a missing prefix after a trailing slash', () => {
			expect(() => parseCidr('192.0.2.0/')).toThrow();
		});
	});

	describe('matchesCidr', () => {
		it('matches an address inside an IPv4 block and rejects one outside it', () => {
			const cidr = parseCidr('192.0.2.0/24');
			expect(matchesCidr('192.0.2.200', cidr)).toBe(true);
			expect(matchesCidr('192.0.3.1', cidr)).toBe(false);
		});

		it('matches only the exact address for a bare-address (/32) entry', () => {
			const cidr = parseCidr('192.0.2.25');
			expect(matchesCidr('192.0.2.25', cidr)).toBe(true);
			expect(matchesCidr('192.0.2.26', cidr)).toBe(false);
		});

		it('matches an address inside an IPv6 block and rejects one outside it', () => {
			const cidr = parseCidr('2001:db8::/32');
			expect(matchesCidr('2001:db8::1', cidr)).toBe(true);
			expect(matchesCidr('2001:db9::1', cidr)).toBe(false);
		});

		it('a /0 entry matches every address of its family', () => {
			const v4 = parseCidr('0.0.0.0/0');
			expect(matchesCidr('203.0.113.1', v4)).toBe(true);
			expect(matchesCidr('1.2.3.4', v4)).toBe(true);

			const v6 = parseCidr('::/0');
			expect(matchesCidr('2001:db8::1', v6)).toBe(true);
		});

		it('never matches across families, even a /0 of the other family', () => {
			expect(matchesCidr('192.0.2.1', parseCidr('::/0'))).toBe(false);
			expect(matchesCidr('2001:db8::1', parseCidr('0.0.0.0/0'))).toBe(false);
			expect(matchesCidr('192.0.2.1', parseCidr('2001:db8::/32'))).toBe(false);
		});

		it('matches an IPv4-mapped IPv6 remote address once normalised, against an IPv4 CIDR', () => {
			// Node reports ::ffff:a.b.c.d for an IPv4 peer on a dual-stack socket (ADR-006 section 3,
			// smtp-server.ts reads socket.remoteAddress directly). SourceAclCache.evaluate() is the
			// caller responsible for normalising before matching -- this proves the two functions
			// compose correctly end to end.
			const normalized = normalizeRemoteIp('::ffff:192.0.2.25');
			expect(matchesCidr(normalized, parseCidr('192.0.2.0/24'))).toBe(true);
		});

		it('respects a partial-byte prefix boundary (not just whole-byte boundaries)', () => {
			// 192.0.2.128/25 covers .128-.255 only.
			const cidr = parseCidr('192.0.2.128/25');
			expect(matchesCidr('192.0.2.128', cidr)).toBe(true);
			expect(matchesCidr('192.0.2.255', cidr)).toBe(true);
			expect(matchesCidr('192.0.2.127', cidr)).toBe(false);
		});
	});
});
