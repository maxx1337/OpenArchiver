import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { JournalReportParseResult, ParsedEnvelope } from '@open-archiver/types';
import { resolveOwner } from '../parser/owner-resolution';
import { ownerEnvelopeFor } from './owner-envelope';

/**
 * `ownerEnvelopeFor()` -- **ADR-033** (`JR-6-02b`). Classification: `ci`.
 *
 * Three claims are worth asserting, and the third is the one with teeth:
 *
 *  1. A `journal_report` result is passed through untouched, at full fidelity. Anything else would mean
 *     the weaker path had started to affect the strong one.
 *  2. `plain_bcc`, `ndr` and `parse_failed` get a **real** envelope out of the outer message's own
 *     `To`/`Cc`/`Bcc`/`From` headers -- and then resolve to the same owner the report path would have.
 *  3. **`envelopeRcpt` never becomes the owner.** For a plain-BCC copy that is the archive mailbox
 *     itself, so using it would attribute every such message to one pseudo-mailbox *while looking like a
 *     successful resolution*. The case below builds exactly that trap: an `envelopeRcpt` of
 *     `archive@ourcompany.com` -- an address whose domain **is** configured, so a resolver that reached
 *     for it would report a confident `primary-domain-match` -- next to headers naming the real
 *     recipient. If the wrong source were used, the result would be plausible and wrong.
 */

const DOMAIN_GROUPS = [{ main: 'ourcompany.com', aliases: [] }];

function outerBytes(headers: string): Buffer {
	return Buffer.from(`${headers}\r\n\r\nbody\r\n`, 'utf8');
}

function transactionEnvelope(rcpt: string[] | null, from: string | null = 'sender@example.net') {
	return { envelopeFrom: from, envelopeRcpt: rcpt };
}

const EXTRACTABLE = { subject: 'Quarterly report', from: 'sender@example.net', messageId: null };

suite('ci', 'ownerEnvelopeFor(): a journal report is passed through unchanged', () => {
	it('returns the report envelope itself, at journal-report fidelity', async () => {
		const envelope: ParsedEnvelope = {
			sender: 'sender@example.net',
			subject: 'Quarterly report',
			messageId: null,
			to: ['alice@ourcompany.com'],
			cc: [],
			bcc: [],
			recipients: ['alice@ourcompany.com'],
			onBehalfOf: null,
			undisclosedRecipientFields: [],
			unknownFields: [],
		};
		const result: JournalReportParseResult = {
			kind: 'journal_report',
			envelope,
			reportText: 'Sender: sender@example.net\r\n',
			innerMessage: { present: false, reason: 'no message/rfc822 part' } as never,
		};

		// The raw bytes are deliberately misleading here: a different recipient in the headers. A
		// journal-report result must not consult them at all.
		const source = await ownerEnvelopeFor(
			result,
			outerBytes('To: someone-else@ourcompany.com')
		);

		expect(source.fidelity).toBe('journal-report');
		expect(source.envelope).toBe(envelope);
		expect(resolveOwner(source.envelope, DOMAIN_GROUPS).ownerEmail).toBe(
			'alice@ourcompany.com'
		);
	});
});

suite('ci', 'ownerEnvelopeFor(): the header-derived envelope for the weaker kinds', () => {
	it.each([['plain_bcc'], ['ndr'], ['parse_failed']] as const)(
		'reads To/Cc/Bcc/From off the outer bytes for a %s result',
		async (kind) => {
			const result = weakResult(kind);
			const source = await ownerEnvelopeFor(
				result,
				outerBytes(
					'From: "Ext, Sender" <sender@example.net>\r\n' +
						'To: Alice <alice@ourcompany.com>, bob@partner.example\r\n' +
						'Cc: carol@ourcompany.com'
				)
			);

			expect(source.fidelity).toBe('rfc5322-headers');
			expect(source.envelope.to).toEqual(['alice@ourcompany.com', 'bob@partner.example']);
			expect(source.envelope.cc).toEqual(['carol@ourcompany.com']);
			expect(source.envelope.sender).toBe('sender@example.net');
		}
	);

	it('resolves to the same owner the report path would have found', async () => {
		const source = await ownerEnvelopeFor(
			weakResult('plain_bcc'),
			outerBytes('To: Alice <alice@ourcompany.com>\r\nFrom: sender@example.net')
		);
		const resolved = resolveOwner(source.envelope, DOMAIN_GROUPS);
		expect(resolved.ownerEmail).toBe('alice@ourcompany.com');
		expect(resolved.method).toBe('primary-domain-match');
	});

	it('handles a display name containing a comma without splitting it into two addresses', async () => {
		// The reason `parseHeaderAddressList()` is reused rather than re-implemented: a naive split on
		// commas turns `"Doe, Jane" <jane@…>` into two bogus addresses.
		const source = await ownerEnvelopeFor(
			weakResult('ndr'),
			outerBytes('To: "Doe, Jane" <jane@ourcompany.com>')
		);
		expect(source.envelope.to).toEqual(['jane@ourcompany.com']);
	});

	it('takes the first address of a multi-address From as `sender`', async () => {
		const source = await ownerEnvelopeFor(
			weakResult('parse_failed'),
			outerBytes('From: first@example.net, second@example.net')
		);
		expect(source.envelope.sender).toBe('first@example.net');
	});

	it('reports `none` when the headers name nobody at all', async () => {
		// Distinct from an empty `rfc5322-headers` envelope on purpose: the two are the same input to
		// `resolveOwner()` but not the same statement to an operator.
		const source = await ownerEnvelopeFor(
			weakResult('plain_bcc'),
			outerBytes('Subject: nothing')
		);
		expect(source.fidelity).toBe('none');
		expect(source.envelope.to).toEqual([]);
		expect(source.envelope.sender).toBeNull();
	});

	it('does not throw on bytes with no header block at all', async () => {
		const source = await ownerEnvelopeFor(weakResult('parse_failed'), Buffer.from('garbage'));
		expect(source.fidelity).toBe('none');
	});
});

suite('ci', 'ownerEnvelopeFor(): envelopeRcpt must never become the owner (ADR-033)', () => {
	it('ignores an envelopeRcpt whose domain is configured, and uses the headers instead', async () => {
		// The trap: `archive@ourcompany.com` is the archive mailbox a Postfix `always_bcc` leg delivers
		// to, and its domain IS configured -- so a resolver reaching for `envelopeRcpt` would return a
		// confident `primary-domain-match` on the wrong mailbox. The headers name the real recipient.
		const result = weakResult('plain_bcc', ['archive@ourcompany.com']);
		const source = await ownerEnvelopeFor(
			result,
			outerBytes('To: Alice <alice@ourcompany.com>\r\nFrom: sender@example.net')
		);

		const resolved = resolveOwner(source.envelope, DOMAIN_GROUPS);
		expect(resolved.ownerEmail).toBe('alice@ourcompany.com');
		expect(resolved.ownerEmail).not.toBe('archive@ourcompany.com');
		// The address does not appear anywhere in the envelope -- not as a recipient, not as sender.
		expect(JSON.stringify(source.envelope)).not.toContain('archive@ourcompany.com');
	});

	it('still reports `none` when only envelopeRcpt is available -- an honest unknown', async () => {
		// A plain-BCC copy whose headers name nobody. `envelopeRcpt` is present and tempting; the answer
		// is nevertheless "we do not know", which routes to the fallback owner plus an alert rather than
		// to a fabricated attribution.
		const result = weakResult('plain_bcc', ['archive@ourcompany.com']);
		const source = await ownerEnvelopeFor(result, outerBytes('Subject: no recipient headers'));
		expect(source.fidelity).toBe('none');
		expect(resolveOwner(source.envelope, DOMAIN_GROUPS).method).not.toBe(
			'primary-domain-match'
		);
	});
});

function weakResult(
	kind: 'plain_bcc' | 'ndr' | 'parse_failed',
	rcpt: string[] | null = ['archive@ourcompany.com']
): JournalReportParseResult {
	if (kind === 'plain_bcc') {
		return {
			kind: 'plain_bcc',
			envelope: transactionEnvelope(rcpt),
			reducedEnvelopeFidelity: true,
			extractableHeaders: EXTRACTABLE,
		};
	}
	if (kind === 'ndr') {
		return {
			kind: 'ndr',
			signals: ['null-envelope-sender'],
			envelope: transactionEnvelope(rcpt, ''),
			extractableHeaders: EXTRACTABLE,
		};
	}
	return {
		kind: 'parse_failed',
		reason: 'not a journal report',
		detail: null,
		extractableHeaders: EXTRACTABLE,
	};
}
