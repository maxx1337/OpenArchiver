import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { JournalLedgerRecord } from '@open-archiver/types';
import { DEPLOYMENT_ID, RECEIPT_V1, SCOPE_A, SCOPE_B } from '../../tests/support/adr-006-vectors';
import {
	canonicalJson,
	chainHash,
	encodeLedgerRecord,
	genesisChainHash,
	normalizeRemoteIp,
} from './canonical-encoding';

/**
 * Properties of the canonical encoding (`JR-2-02`, specified by **ADR-006**).
 *
 * Classification: `ci`. Pure computation, no socket, no database.
 *
 * The golden vectors live in `adr-006-vectors.test.ts`; this file asserts the properties that make
 * the encoding fit for a hash chain at all — determinism, sensitivity to every hashed field, and
 * insensitivity to the things that are allowed to vary. The most important test here is
 * "every one of the sixteen fields changes the hash": that is the direct counter-check on the RFC's
 * eight-field formula, which would leave five of them editable without breaking the chain.
 */

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');
const genesis = genesisChainHash(DEPLOYMENT_ID, SCOPE_A);
const baseline = hex(chainHash(RECEIPT_V1, genesis));

/** One mutation per hashed field, each of which must change the chain hash. */
const MUTATIONS: ReadonlyArray<{
	readonly field: keyof JournalLedgerRecord;
	readonly why?: string;
	readonly mutate: (record: JournalLedgerRecord) => JournalLedgerRecord;
}> = [
	{
		field: 'chainScopeId',
		why: 'ADR-007 consequence 3: an entry must not be movable between tenants',
		mutate: (r) => ({ ...r, chainScopeId: SCOPE_B }),
	},
	{ field: 'seq', mutate: (r) => ({ ...r, seq: r.seq + 1n }) },
	{
		field: 'receivedAtMicros',
		mutate: (r) => ({ ...r, receivedAtMicros: r.receivedAtMicros + 1000n }),
	},
	{ field: 'eventType', mutate: (r) => ({ ...r, eventType: 'parse_failed' }) },
	{
		field: 'remoteIp',
		why: 'left out of the RFC formula: the sender could be rewritten',
		mutate: (r) => ({ ...r, remoteIp: '198.51.100.9' }),
	},
	{
		field: 'ehloName',
		why: 'left out of the RFC formula',
		mutate: (r) => ({ ...r, ehloName: 'evil.example.net' }),
	},
	{
		field: 'tlsVersion',
		why: 'left out of the RFC formula: a cleartext session could be presented as TLS',
		mutate: (r) => ({ ...r, tlsVersion: null }),
	},
	{
		field: 'tlsCipher',
		why: 'left out of the RFC formula',
		mutate: (r) => ({ ...r, tlsCipher: 'TLS_AES_128_GCM_SHA256' }),
	},
	{ field: 'envelopeFrom', mutate: (r) => ({ ...r, envelopeFrom: 'someone@else.example' }) },
	{
		field: 'envelopeRcpt',
		why: 'a recipient must not be removable from the receipt',
		mutate: (r) => ({ ...r, envelopeRcpt: ['a@example.com'] }),
	},
	{ field: 'sizeBytes', mutate: (r) => ({ ...r, sizeBytes: 4097n }) },
	{
		field: 'contentSha256',
		mutate: (r) => ({ ...r, contentSha256: createHash('sha256').update('other').digest() }),
	},
	{
		field: 'duplicateOf',
		why: 'left out of the RFC formula: a receipt could be relabelled as a duplicate',
		mutate: (r) => ({ ...r, duplicateOf: 1n }),
	},
	{
		field: 'journalingSourceId',
		why: 'ADR-007: "who sent it" is an attribute of the receipt, so it must be attested',
		mutate: (r) => ({ ...r, journalingSourceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
	},
	{
		field: 'spoolTxId',
		why: 'crash recovery matches spool files against the ledger through this',
		mutate: (r) => ({ ...r, spoolTxId: '01JZZ0000000000000000000BB' }),
	},
	{
		field: 'eventPayload',
		mutate: (r) => ({ ...r, eventPayload: { parse_failed: true, phase: 'A' } }),
	},
];

suite('ci', 'canonical encoding: determinism and coverage', () => {
	it('produces identical bytes for identical input', () => {
		const first = encodeLedgerRecord(RECEIPT_V1);
		const second = encodeLedgerRecord({ ...RECEIPT_V1 });
		expect(hex(first)).toBe(hex(second));
	});

	it('covers all sixteen fields: changing any one changes the chain hash', () => {
		// The counter-check on ADR-006 section 1. Under the RFC's eight-field formula, five of these
		// mutations would leave the chain hash untouched -- remote_ip, ehlo_name, tls_version,
		// tls_cipher, duplicate_of -- and the tamper would verify clean.
		expect(MUTATIONS).toHaveLength(16);
		const fields = new Set(MUTATIONS.map((mutation) => mutation.field));
		expect(fields.size).toBe(16);

		const unchanged: string[] = [];
		for (const mutation of MUTATIONS) {
			const mutated = hex(chainHash(mutation.mutate(RECEIPT_V1), genesis));
			if (mutated === baseline) {
				unchanged.push(`${mutation.field}${mutation.why ? ` (${mutation.why})` : ''}`);
			}
		}
		expect(unchanged).toEqual([]);
	});

	it('binds the record to its predecessor', () => {
		const other = genesisChainHash(DEPLOYMENT_ID, SCOPE_B);
		expect(hex(chainHash(RECEIPT_V1, other))).not.toBe(baseline);
	});

	it('refuses a previous hash that is not 32 bytes', () => {
		expect(() => chainHash(RECEIPT_V1, Buffer.alloc(31))).toThrow(/32 bytes/);
	});
});

suite('ci', 'canonical encoding: what must and must not vary', () => {
	it('changes the bytes when recipients are reordered', () => {
		// Arrival order is part of the receipt. Sorting would destroy what makes a distribution-list
		// expansion traceable, so a different order is a different record.
		const swapped: JournalLedgerRecord = {
			...RECEIPT_V1,
			envelopeRcpt: ['b@example.com', 'a@example.com'],
		};
		expect(hex(chainHash(swapped, genesis))).not.toBe(baseline);
	});

	it('keeps the bytes when event_payload keys are reordered', () => {
		const reordered: JournalLedgerRecord = {
			...RECEIPT_V1,
			eventPayload: { phase: 'A', parse_failed: false },
		};
		expect(hex(chainHash(reordered, genesis))).toBe(baseline);
	});

	it('distinguishes null from the empty string', () => {
		const nulled: JournalLedgerRecord = { ...RECEIPT_V1, ehloName: null };
		const empty: JournalLedgerRecord = { ...RECEIPT_V1, ehloName: '' };
		// Otherwise "no EHLO was sent" and "EHLO with an empty name" are the same receipt.
		expect(hex(chainHash(nulled, genesis))).not.toBe(hex(chainHash(empty, genesis)));
	});

	it('distinguishes an empty recipient list from no recipient list', () => {
		const emptyList: JournalLedgerRecord = { ...RECEIPT_V1, envelopeRcpt: [] };
		const noList: JournalLedgerRecord = { ...RECEIPT_V1, envelopeRcpt: null };
		expect(hex(chainHash(emptyList, genesis))).not.toBe(hex(chainHash(noList, genesis)));
	});

	it('is length-prefixed, so field boundaries cannot be shifted', () => {
		// Without length prefixes, moving a character across a field boundary would leave the
		// concatenation unchanged. This is the classic canonicalisation hole.
		const left: JournalLedgerRecord = {
			...RECEIPT_V1,
			ehloName: 'ab',
			tlsVersion: 'cd',
		};
		const right: JournalLedgerRecord = {
			...RECEIPT_V1,
			ehloName: 'a',
			tlsVersion: 'bcd',
		};
		expect(hex(chainHash(left, genesis))).not.toBe(hex(chainHash(right, genesis)));
	});
});

suite('ci', 'canonical encoding: the three traps of ADR-006 section 3', () => {
	it('rejects a timestamp that is not a whole millisecond', () => {
		// ADR-006 section 3.1. timestamptz resolves to microseconds, JavaScript's Date to
		// milliseconds; a sub-millisecond value cannot survive the round trip, so the writer would
		// hash bytes that verify can never reproduce -- in about one row in a thousand.
		const record: JournalLedgerRecord = {
			...RECEIPT_V1,
			receivedAtMicros: RECEIPT_V1.receivedAtMicros + 1n,
		};
		expect(() => encodeLedgerRecord(record)).toThrow(/whole millisecond/);
	});

	it('accepts the whole-millisecond boundary values around it', () => {
		for (const delta of [-1000n, 0n, 1000n]) {
			const record: JournalLedgerRecord = {
				...RECEIPT_V1,
				receivedAtMicros: RECEIPT_V1.receivedAtMicros + delta,
			};
			expect(() => encodeLedgerRecord(record)).not.toThrow();
		}
	});

	it('folds an IPv4-mapped IPv6 address back to IPv4', () => {
		// The concrete trap: Node reports `::ffff:192.0.2.25` on a dual-stack socket and
		// `192.0.2.25` on an IPv4 listener, for the same peer. Whether a chain verifies must not
		// depend on how the listener was configured.
		expect(normalizeRemoteIp('::ffff:192.0.2.25')).toBe('192.0.2.25');
		expect(normalizeRemoteIp('::FFFF:192.0.2.25')).toBe('192.0.2.25');
		expect(normalizeRemoteIp('192.0.2.25')).toBe('192.0.2.25');
	});

	it('normalises IPv6 to RFC 5952 rather than trusting the input', () => {
		expect(normalizeRemoteIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
		expect(normalizeRemoteIp('2001:db8::1')).toBe('2001:db8::1');
		expect(normalizeRemoteIp('::1')).toBe('::1');
		// Longest zero run wins; on a tie the leftmost one.
		expect(normalizeRemoteIp('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1');
	});

	it('strips a zone index, which describes the receiving host and not the peer', () => {
		expect(normalizeRemoteIp('fe80::1%eth0')).toBe('fe80::1');
	});

	it('throws on an address it cannot parse instead of hashing it as-is', () => {
		for (const bad of ['', 'not-an-ip', '192.0.2.256', '010.0.0.1', '::ffff:1.2.3']) {
			expect(() => normalizeRemoteIp(bad)).toThrow(/not a parseable IP address/);
		}
	});

	it('serialises canonical JSON with sorted keys and no whitespace', () => {
		expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
		expect(canonicalJson({ a: { d: true, c: null }, b: [1, 'x'] })).toBe(
			'{"a":{"c":null,"d":true},"b":[1,"x"]}'
		);
	});

	it('treats an undefined value as an absent key', () => {
		// Whether a key was absent or set to undefined is not a stable distinction in JavaScript, so
		// the hash must not depend on it.
		expect(canonicalJson({ a: 1, b: undefined } as never)).toBe('{"a":1}');
	});

	it('refuses non-integer and unsafe numbers', () => {
		// ADR-006 section 3.3: forbidding them removes the only hard part of RFC 8785.
		expect(() => canonicalJson({ a: 1.5 })).toThrow(/only integers/);
		expect(() => canonicalJson({ a: Number.NaN })).toThrow(/only integers/);
		expect(() => canonicalJson({ a: 2 ** 53 })).toThrow(/only integers/);
		expect(canonicalJson({ a: Number.MAX_SAFE_INTEGER })).toBe('{"a":9007199254740991}');
	});
});

suite('ci', 'canonical encoding: input hygiene', () => {
	it('requires lowercase canonical UUIDs', () => {
		// Written out rather than derived with toUpperCase() from the vector scopes: those consist of
		// digits only, so uppercasing them is a no-op and the test would pass while asserting
		// nothing. It did, on the first run.
		const UPPER = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
		const lower = UPPER.toLowerCase();
		expect(UPPER).not.toBe(lower);

		expect(() => encodeLedgerRecord({ ...RECEIPT_V1, chainScopeId: UPPER })).toThrow(
			/canonical UUID/
		);
		expect(() => encodeLedgerRecord({ ...RECEIPT_V1, journalingSourceId: UPPER })).toThrow(
			/canonical UUID/
		);
		expect(() => genesisChainHash(UPPER, SCOPE_A)).toThrow(/canonical UUID/);
		expect(() => genesisChainHash(DEPLOYMENT_ID, UPPER)).toThrow(/canonical UUID/);
		// And the lowercase form of the same value is accepted, so the refusal is about the case and
		// not about the value.
		expect(() => genesisChainHash(lower, SCOPE_A)).not.toThrow();
	});

	it('rejects malformed identifiers outright', () => {
		for (const bad of ['', 'not-a-uuid', '11111111111141118111111111111111']) {
			expect(() => encodeLedgerRecord({ ...RECEIPT_V1, chainScopeId: bad })).toThrow(
				/canonical UUID/
			);
		}
	});

	it('rejects an unpaired surrogate rather than substituting U+FFFD', () => {
		// Buffer.from would silently write U+FFFD, i.e. hash bytes that were never received.
		const record: JournalLedgerRecord = { ...RECEIPT_V1, ehloName: 'a\ud800b' };
		expect(() => encodeLedgerRecord(record)).toThrow(/unpaired surrogate/);
	});

	it('accepts a valid surrogate pair', () => {
		const record: JournalLedgerRecord = { ...RECEIPT_V1, ehloName: 'mail\u{1f600}.example' };
		expect(() => encodeLedgerRecord(record)).not.toThrow();
	});

	it('does not normalise Unicode, because the receipt is about received bytes', () => {
		// U+00E9 against "e" + U+0301: the same grapheme, different bytes. NFC would make them equal
		// and would hash something other than what arrived. The two literals below are
		// indistinguishable when read, so the first assertion guards the test itself -- normalising
		// them by accident turns this into a test that passes for the wrong reason.
		const composed: JournalLedgerRecord = { ...RECEIPT_V1, ehloName: 'é' };
		const decomposed: JournalLedgerRecord = { ...RECEIPT_V1, ehloName: 'é' };
		expect(composed.ehloName).not.toBe(decomposed.ehloName);
		expect(hex(chainHash(composed, genesis))).not.toBe(hex(chainHash(decomposed, genesis)));
	});
});
