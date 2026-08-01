import { createHash } from 'node:crypto';
import type { CanonicalJsonValue, JournalLedgerRecord } from '@open-archiver/types';

/**
 * Canonical encoding of a ledger record (`JR-2-02`, specified by **ADR-006**).
 *
 * ---------------------------------------------------------------------------------------------
 * Read this before changing a single byte
 * ---------------------------------------------------------------------------------------------
 * Changing this encoding invalidates **every existing chain**. That is a migration, not a
 * refactoring, and `FORMAT_VERSION` exists precisely so that such a change is describable. The
 * authoritative specification is ADR-006 in `docs/dev/journaling/05-entscheidungen.md`, together
 * with reproducible test vectors in its section 6 — `adr-006-vectors.test.ts` holds them against
 * this code, so a byte-level change to this file shows up there as a failure rather than as a
 * silently different chain.
 *
 * ---------------------------------------------------------------------------------------------
 * Why sixteen fields and not the eight from the RFC
 * ---------------------------------------------------------------------------------------------
 * RFC section 5.2 creates the table with fourteen columns and hashes eight of them. `remote_ip`,
 * `ehlo_name`, `tls_version`, `tls_cipher` and `duplicate_of` are left out — so each of them could
 * be edited afterwards **without breaking the chain**. Concretely: setting `tls_version` from `NULL`
 * to `TLSv1.3` presents a message received in the clear as encrypted, and verification still passes.
 * A column carried in the receipt but not hashed claims evidential weight it does not have, which is
 * worse than not recording it at all.
 *
 * So the encoding covers all sixteen value-bearing columns (ADR-006 section 1). Only two are absent,
 * both structurally: `chain_hash` is the result, and `prev_chain_hash` is appended to the encoded
 * record rather than encoded as a field, keeping the RFC's `SHA256(record || prev)` shape intact.
 *
 * ---------------------------------------------------------------------------------------------
 * The frame
 * ---------------------------------------------------------------------------------------------
 * ```
 * record := 0x01 || uint32be(field_count) || field_1 || ... || field_n
 * field  := tag(1) || uint32be(len) || value_bytes
 * ```
 *
 * `field_count` is hashed on purpose: without it, a field dropped from the end of the list would not
 * necessarily change the bytes. `len` is always the length of `value_bytes`, including for composite
 * types, so every field can be skipped without understanding its contents.
 */

/** Format version of the field encoding. Increment on **any** change to the frame or the fields. */
export const FORMAT_VERSION = 0x01;

/** How many fields a v1 ledger record has. Hashed as part of the frame. */
export const LEDGER_FIELD_COUNT = 16;

/**
 * Type tags.
 *
 * `NULL` is a tag of its own rather than a zero-length value: `NULL` and the empty string must hash
 * differently, otherwise "no EHLO was sent" is indistinguishable from "EHLO with an empty name".
 */
export const TAG = {
	NULL: 0x00,
	UINT64: 0x01,
	TIMESTAMP_US: 0x02,
	STRING: 0x03,
	BYTES: 0x04,
	UUID: 0x05,
	ARRAY_STR: 0x06,
	JSON: 0x07,
} as const;

/** Domain prefix of the genesis string. Part of the format; changing it re-roots every chain. */
export const GENESIS_PREFIX = 'open-archiver:journal-ledger:v1:';

const MAX_FIELD_LENGTH = 0xffffffff;

function uint32be(value: number): Buffer {
	if (!Number.isInteger(value) || value < 0 || value > MAX_FIELD_LENGTH) {
		throw new RangeError(`Length ${value} does not fit an unsigned 32-bit big-endian integer.`);
	}
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32BE(value);
	return buffer;
}

function field(tag: number, value: Buffer): Buffer {
	return Buffer.concat([Buffer.from([tag]), uint32be(value.length), value]);
}

const nullField = (): Buffer => field(TAG.NULL, Buffer.alloc(0));

function uint64Field(value: bigint | null, name: string): Buffer {
	if (value === null) {
		return nullField();
	}
	if (value < 0n || value > 0xffffffffffffffffn) {
		throw new RangeError(`${name} = ${value} does not fit an unsigned 64-bit integer.`);
	}
	const buffer = Buffer.alloc(8);
	buffer.writeBigUInt64BE(value);
	return field(TAG.UINT64, buffer);
}

/**
 * Microseconds since the Unix epoch, UTC, as a signed 64-bit big-endian integer.
 *
 * **Rejects anything that is not a whole millisecond**, and that refusal is the point (ADR-006
 * section 3.1). `timestamptz` resolves to microseconds, JavaScript's `Date` to milliseconds — a
 * value that passed through a `Date` loses its last three digits, so the writer would hash different
 * bytes than `verify` reads back, in roughly one of a thousand rows. Failing here turns that into an
 * error at write time instead of an unverifiable chain discovered months later. A `CHECK` constraint
 * on the column backs the same rule up in the database (`JR-2-04`).
 */
function timestampField(micros: bigint): Buffer {
	if (micros % 1000n !== 0n) {
		throw new RangeError(
			`receivedAtMicros = ${micros} is not a whole millisecond. ADR-006 section 3.1 allows only ` +
				`multiples of 1000: JavaScript's Date resolves to milliseconds, so a sub-millisecond ` +
				`value cannot survive a database round trip and would make the chain unverifiable.`
		);
	}
	const buffer = Buffer.alloc(8);
	buffer.writeBigInt64BE(micros);
	return field(TAG.TIMESTAMP_US, buffer);
}

/**
 * UTF-8 bytes, with **no** Unicode normalisation.
 *
 * Against the intuition, and deliberately: NFC would alter the bytes that were received, and the
 * ledger is a receipt about received bytes. Lone surrogates are refused — PostgreSQL rejects them
 * too, and `Buffer.from` would silently replace them with U+FFFD, which is exactly the kind of
 * quiet substitution that must never happen to a hash input.
 */
function stringField(value: string | null, name: string): Buffer {
	if (value === null) {
		return nullField();
	}
	if (/[\ud800-\udfff]/.test(value.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) {
		throw new RangeError(
			`${name} contains an unpaired surrogate. Encoding it would replace the code unit with ` +
				`U+FFFD and hash bytes that were never received.`
		);
	}
	return field(TAG.STRING, Buffer.from(value, 'utf8'));
}

function bytesField(value: Uint8Array | null): Buffer {
	return value === null ? nullField() : field(TAG.BYTES, Buffer.from(value));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A UUID as its 16 raw bytes.
 *
 * Lowercase canonical form is required rather than accepted-and-normalised: an uppercase UUID
 * reaching this function means it came from somewhere that does not agree with the rest of the
 * system about its own identifiers, and hashing it anyway would hide that.
 *
 * Note the deliberate asymmetry with {@link genesisChainHash}, which uses the **textual** form. That
 * is not an oversight — see the comment there.
 */
function uuidField(value: string | null, name: string): Buffer {
	if (value === null) {
		return nullField();
	}
	if (!UUID_PATTERN.test(value)) {
		throw new RangeError(
			`${name} = "${value}" is not a lowercase canonical UUID (RFC 4122 section 3).`
		);
	}
	return field(TAG.UUID, Buffer.from(value.replace(/-/g, ''), 'hex'));
}

/**
 * An array of strings: element count, then each element length-prefixed.
 *
 * In **arrival order**, never sorted. The order of the `RCPT TO` commands is part of the receipt;
 * sorting would destroy what makes a distribution-list expansion traceable.
 */
function arrayField(values: readonly string[] | null, name: string): Buffer {
	if (values === null) {
		return nullField();
	}
	const parts: Buffer[] = [uint32be(values.length)];
	for (const [index, value] of values.entries()) {
		const encoded = stringField(value, `${name}[${index}]`);
		// Re-use the string check above, but store only length + bytes: the tag is implied by the
		// array's own tag, and repeating it per element would be four bytes of noise per recipient.
		parts.push(encoded.subarray(1));
	}
	return field(TAG.ARRAY_STR, Buffer.concat(parts));
}

/* -------------------------------------------------------------------------------------------- */
/* Canonical JSON (ADR-006 section 3.3)                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * RFC 8785 (JCS), restricted to integers.
 *
 * The restriction is the substance of the decision, not a shortcut: number serialisation is the only
 * hard part of RFC 8785, and forbidding non-integers removes it — canonical JSON then reduces to
 * "sort the keys, then `JSON.stringify`", which is gettable right without a dependency.
 *
 * Keys sort by UTF-16 code unit, which is what JCS specifies and what `Array.prototype.sort()` does
 * by default, so there is no second implementation of the ordering to drift.
 */
export function canonicalJson(value: CanonicalJsonValue): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) {
			throw new RangeError(
				`event_payload contains ${value}. ADR-006 section 3.3 allows only integers within ` +
					`±(2^53-1); a larger integer belongs in a string, and a fractional number has no ` +
					`canonical serialisation this encoding is willing to guarantee.`
			);
		}
		// String(-0) is "0", which is what RFC 8785 requires anyway.
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
	}
	const record = value as { readonly [key: string]: CanonicalJsonValue };
	const keys = Object.keys(record)
		// An absent key and a key set to `undefined` are not a stable distinction in JavaScript, so
		// the hash must not depend on which of the two it was. `null` is a value and is kept.
		.filter((key) => record[key] !== undefined)
		.sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`).join(',')}}`;
}

function jsonField(value: CanonicalJsonValue | null): Buffer {
	return value === null
		? nullField()
		: field(TAG.JSON, Buffer.from(canonicalJson(value), 'utf8'));
}

/* -------------------------------------------------------------------------------------------- */
/* IP normalisation (ADR-006 section 3.2)                                                       */
/* -------------------------------------------------------------------------------------------- */

function parseIPv4(text: string): number[] | null {
	const parts = text.split('.');
	if (parts.length !== 4) {
		return null;
	}
	const bytes: number[] = [];
	for (const part of parts) {
		// No leading zeros: "010.0.0.1" is ambiguous (octal in some parsers) and is not canonical.
		if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) {
			return null;
		}
		const value = Number(part);
		if (value > 255) {
			return null;
		}
		bytes.push(value);
	}
	return bytes;
}

function parseIPv6(text: string): number[] | null {
	let head = text;
	let embeddedV4: number[] | null = null;
	const lastColon = head.lastIndexOf(':');
	if (head.includes('.')) {
		embeddedV4 = parseIPv4(head.slice(lastColon + 1));
		if (!embeddedV4) {
			return null;
		}
		head = head.slice(0, lastColon + 1) + '0:0';
	}

	const doubleColon = head.indexOf('::');
	let groups: string[];
	if (doubleColon >= 0) {
		if (head.indexOf('::', doubleColon + 1) >= 0) {
			return null;
		}
		const notEmpty = (segment: string): boolean => segment.length > 0;
		const before = head.slice(0, doubleColon).split(':').filter(notEmpty);
		const after = head
			.slice(doubleColon + 2)
			.split(':')
			.filter(notEmpty);
		const missing = 8 - before.length - after.length;
		if (missing < 1) {
			return null;
		}
		groups = [...before, ...Array.from({ length: missing }, () => '0'), ...after];
	} else {
		groups = head.split(':');
	}
	if (groups.length !== 8) {
		return null;
	}

	const bytes: number[] = [];
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(group)) {
			return null;
		}
		const value = Number.parseInt(group, 16);
		bytes.push(value >>> 8, value & 0xff);
	}
	if (embeddedV4) {
		bytes.splice(12, 4, ...embeddedV4);
	}
	return bytes;
}

function formatIPv6(bytes: readonly number[]): string {
	const groups: number[] = [];
	for (let index = 0; index < 16; index += 2) {
		groups.push((bytes[index]! << 8) | bytes[index + 1]!);
	}
	// RFC 5952: compress the longest run of two or more zero groups; on a tie, the leftmost one.
	let bestStart = -1;
	let bestLength = 0;
	let runStart = -1;
	for (let index = 0; index <= groups.length; index += 1) {
		if (index < groups.length && groups[index] === 0) {
			if (runStart < 0) {
				runStart = index;
			}
			continue;
		}
		if (runStart >= 0) {
			const length = index - runStart;
			if (length > bestLength) {
				bestStart = runStart;
				bestLength = length;
			}
			runStart = -1;
		}
	}
	const hex = groups.map((group) => group.toString(16));
	if (bestLength < 2) {
		return hex.join(':');
	}
	const head = hex.slice(0, bestStart).join(':');
	const tail = hex.slice(bestStart + bestLength).join(':');
	return `${head}::${tail}`;
}

/**
 * Canonical textual form of a peer address, to be applied **before** hashing and before the insert.
 *
 * This exists because of one concrete trap: Node reports `::ffff:192.0.2.25` for an IPv4 connection
 * on a dual-stack socket, and `192.0.2.25` for the same peer on an IPv4 listener. Both name the same
 * sender and hash differently, so whether a chain verifies would depend on how the listener was
 * configured. The IPv4-mapped form is therefore folded back to IPv4.
 *
 * The rest is full normalisation rather than a trust in the input being canonical already: parse to
 * 16 (or 4) bytes and re-emit per RFC 5952. "Probably already canonical" is not good enough for a
 * hash input, and an unparseable address throws rather than being hashed as-is.
 */
export function normalizeRemoteIp(raw: string): string {
	// A zone index is a property of the receiving host, not of the peer, and it varies between
	// machines that are otherwise identical. It has no place in a receipt.
	const text = raw.trim().toLowerCase().split('%')[0]!;

	const v4 = parseIPv4(text);
	if (v4) {
		return v4.join('.');
	}
	const v6 = parseIPv6(text);
	if (!v6) {
		throw new RangeError(`remoteIp = "${raw}" is not a parseable IP address.`);
	}
	// IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) both denote an IPv4 peer.
	const mappedPrefix = v6.slice(0, 10).every((byte) => byte === 0);
	if (mappedPrefix && v6[10] === 0xff && v6[11] === 0xff) {
		return v6.slice(12).join('.');
	}
	return formatIPv6(v6);
}

/* -------------------------------------------------------------------------------------------- */
/* Records and chain hashes                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * Encode the sixteen hashed fields of a ledger record, in the order fixed by ADR-006 section 2.
 *
 * The order is part of the format: these fields are positional, identified by position rather than
 * by name.
 */
export function encodeLedgerRecord(record: JournalLedgerRecord): Buffer {
	const fields: Buffer[] = [
		uuidField(record.chainScopeId, 'chainScopeId'),
		uint64Field(record.seq, 'seq'),
		timestampField(record.receivedAtMicros),
		stringField(record.eventType, 'eventType'),
		stringField(record.remoteIp, 'remoteIp'),
		stringField(record.ehloName, 'ehloName'),
		stringField(record.tlsVersion, 'tlsVersion'),
		stringField(record.tlsCipher, 'tlsCipher'),
		stringField(record.envelopeFrom, 'envelopeFrom'),
		arrayField(record.envelopeRcpt, 'envelopeRcpt'),
		uint64Field(record.sizeBytes, 'sizeBytes'),
		bytesField(record.contentSha256),
		uint64Field(record.duplicateOf, 'duplicateOf'),
		uuidField(record.journalingSourceId, 'journalingSourceId'),
		stringField(record.spoolTxId, 'spoolTxId'),
		jsonField(record.eventPayload),
	];
	if (fields.length !== LEDGER_FIELD_COUNT) {
		// Unreachable by construction; asserted so that adding a field without bumping the version
		// and the count fails here rather than producing a quietly different chain.
		throw new Error(
			`Encoded ${fields.length} fields, expected ${LEDGER_FIELD_COUNT}. Changing the field list ` +
				`requires a new FORMAT_VERSION and a migration (ADR-006 section 8).`
		);
	}
	return Buffer.concat([Buffer.from([FORMAT_VERSION]), uint32be(fields.length), ...fields]);
}

/**
 * `chain_hash(n) = SHA256( canonical_encode(record) || prev_chain_hash(n-1) )`.
 *
 * The RFC's shape, unchanged. `prev_chain_hash` is appended rather than encoded as a field, and the
 * three hash preimages in the system stay mutually distinguishable by construction — see the
 * length argument in ADR-006 section 5.3 and `MERKLE_*` in `./merkle.ts`.
 */
export function chainHash(record: JournalLedgerRecord, prevChainHash: Uint8Array): Buffer {
	if (prevChainHash.length !== 32) {
		throw new RangeError(
			`prevChainHash must be 32 bytes (SHA-256), got ${prevChainHash.length}.`
		);
	}
	return createHash('sha256').update(encodeLedgerRecord(record)).update(prevChainHash).digest();
}

/**
 * `chain_hash(0) = SHA256( "open-archiver:journal-ledger:v1:" || deployment_id || ":" || chain_scope_id )`.
 *
 * Both identifiers go in as **lowercase canonical UUID text**, not as the 16 raw bytes the field
 * encoding uses. That asymmetry is deliberate and must not be "fixed": the genesis hash is the one
 * value in the entire chain that an auditor should be able to recompute without our code —
 *
 * ```
 * printf 'open-archiver:journal-ledger:v1:<deployment>:<scope>' | sha256sum
 * ```
 *
 * — and that beats formal uniformity. The `:` separator is required because without it two different
 * pairs of identifiers could form the same string as soon as either one loses its fixed length.
 *
 * `chainScopeId` is in here because there is one chain per tenant (ADR-007 consequence 3): without
 * it, two chains whose first event is identical would have identical hashes, and an entry could be
 * moved between tenants without breaking either chain.
 */
export function genesisChainHash(deploymentId: string, chainScopeId: string): Buffer {
	for (const [name, value] of [
		['deploymentId', deploymentId],
		['chainScopeId', chainScopeId],
	] as const) {
		if (!UUID_PATTERN.test(value)) {
			throw new RangeError(
				`${name} = "${value}" is not a lowercase canonical UUID (RFC 4122 section 3).`
			);
		}
	}
	return createHash('sha256')
		.update(`${GENESIS_PREFIX}${deploymentId}:${chainScopeId}`, 'ascii')
		.digest();
}
