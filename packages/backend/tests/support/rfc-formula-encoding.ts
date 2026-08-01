import { createHash } from 'node:crypto';
import type { JournalLedgerRecord } from '@open-archiver/types';

/**
 * The chain hash **as RFC section 5.2 specifies it** — the eight-field formula ADR-006 rejected.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a rejected specification is implemented here
 * ---------------------------------------------------------------------------------------------
 * Testplan section 12.5 requires cases (f) and (g) — `tls_version` moved from `NULL` to `TLSv1.3`,
 * `remote_ip` rewritten — to "have been seen red against an implementation following the RFC
 * formula" before they count for anything. The reason is blunt: those two tests pass trivially if
 * the verifier simply looks at the fields, and a green run says nothing about *why* it is green. The
 * question they answer is whether the encoding covers sixteen fields or eight, and that question
 * needs the eight-field version present to be answerable.
 *
 * Rather than doing that once by hand and writing "we checked", the rejected formula lives here and
 * the counter-check runs on **every** CI run:
 *
 *   - under this formula, (f) and (g) are undetectable — the chain still verifies after the edit;
 *   - under `chainHash()` from `@open-archiver/journaling`, both are caught at the right `seq`.
 *
 * That pair is the actual assertion of `JR-209`'s ADR-006 half. If somebody ever narrows the
 * production encoding back towards the RFC's field list, the first half of the pair keeps passing
 * and the second fails — which is the direction a regression has to be caught from.
 *
 * ---------------------------------------------------------------------------------------------
 * What "the RFC formula" means exactly
 * ---------------------------------------------------------------------------------------------
 * `docs/dev/journaling/00-rfc.md` lines 183-188:
 *
 * ```
 * chain_hash(n) = SHA256(
 *     canonical_encode(seq, received_at, content_sha256, event_type,
 *                      event_payload, envelope_from, envelope_rcpt, size_bytes)
 *   || prev_chain_hash(n-1)
 * )
 * ```
 *
 * Eight fields. Not hashed, and therefore editable afterwards without breaking the chain:
 * `chain_scope_id`, `remote_ip`, `ehlo_name`, `tls_version`, `tls_cipher`, `duplicate_of`,
 * `journaling_source_id`, `spool_txid`.
 *
 * The RFC says "deterministic canonical encoding (length-prefixed fields)" and leaves the details
 * open, so the framing below is borrowed from ADR-006 — same tags, same length prefixes, same
 * `SHA256(record || prev)` shape. The **only** difference to production is which fields go in, and
 * that is deliberate: if the two encodings differed in framing as well, a failure would not tell you
 * which difference caused it.
 */

/** Field tags, matching `canonical-encoding.ts` so that only the field *list* differs. */
const TAG = {
	NULL: 0x00,
	UINT64: 0x01,
	TIMESTAMP_US: 0x02,
	STRING: 0x03,
	BYTES: 0x04,
	ARRAY_STR: 0x06,
	JSON: 0x07,
} as const;

const RFC_FIELD_COUNT = 8;

function uint32be(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32BE(value);
	return buffer;
}

function field(tag: number, value: Buffer): Buffer {
	return Buffer.concat([Buffer.from([tag]), uint32be(value.length), value]);
}

const nullField = (): Buffer => field(TAG.NULL, Buffer.alloc(0));

function uint64Field(value: bigint | null): Buffer {
	if (value === null) {
		return nullField();
	}
	const buffer = Buffer.alloc(8);
	buffer.writeBigUInt64BE(value);
	return field(TAG.UINT64, buffer);
}

function timestampField(micros: bigint): Buffer {
	const buffer = Buffer.alloc(8);
	buffer.writeBigInt64BE(micros);
	return field(TAG.TIMESTAMP_US, buffer);
}

function stringField(value: string | null): Buffer {
	return value === null ? nullField() : field(TAG.STRING, Buffer.from(value, 'utf8'));
}

function arrayField(values: readonly string[] | null): Buffer {
	if (values === null) {
		return nullField();
	}
	const parts: Buffer[] = [uint32be(values.length)];
	for (const value of values) {
		const bytes = Buffer.from(value, 'utf8');
		parts.push(uint32be(bytes.length), bytes);
	}
	return field(TAG.ARRAY_STR, Buffer.concat(parts));
}

function jsonField(value: unknown): Buffer {
	if (value === null || value === undefined) {
		return nullField();
	}
	// Sorted keys, as the RFC's "not JSON key ordering luck" demands.
	const canonical = (input: unknown): string => {
		if (input === null || typeof input !== 'object') {
			return JSON.stringify(input) ?? 'null';
		}
		if (Array.isArray(input)) {
			return `[${input.map(canonical).join(',')}]`;
		}
		const record = input as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
	};
	return field(TAG.JSON, Buffer.from(canonical(value), 'utf8'));
}

/** The eight fields of RFC section 5.2, in the order the RFC lists them. */
export function encodeRfcFormulaRecord(record: JournalLedgerRecord): Buffer {
	const fields = [
		uint64Field(record.seq),
		timestampField(record.receivedAtMicros),
		record.contentSha256 === null
			? nullField()
			: field(TAG.BYTES, Buffer.from(record.contentSha256)),
		stringField(record.eventType),
		jsonField(record.eventPayload),
		stringField(record.envelopeFrom),
		arrayField(record.envelopeRcpt),
		uint64Field(record.sizeBytes),
	];
	return Buffer.concat([Buffer.from([0x01]), uint32be(RFC_FIELD_COUNT), ...fields]);
}

/** `SHA256( encode8(record) || prev )` — the RFC's shape over the RFC's field list. */
export function rfcFormulaChainHash(record: JournalLedgerRecord, prev: Uint8Array): Buffer {
	return createHash('sha256')
		.update(encodeRfcFormulaRecord(record))
		.update(Buffer.from(prev))
		.digest();
}

/**
 * The eight columns the RFC leaves out of the hash, by their record field names.
 *
 * Used by the counter-check to state what it is checking rather than hard-coding two field names in
 * a test body: every one of these is editable after the fact under the RFC formula.
 */
export const FIELDS_UNHASHED_BY_RFC_FORMULA = [
	'chainScopeId',
	'remoteIp',
	'ehloName',
	'tlsVersion',
	'tlsCipher',
	'duplicateOf',
	'journalingSourceId',
	'spoolTxId',
] as const satisfies readonly (keyof JournalLedgerRecord)[];
