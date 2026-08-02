import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	KNOWN_ENVELOPE_FIELD_NAMES,
	parseEnvelope,
	reportTextBeginsWithFieldLine,
} from './envelope';

/**
 * The journal-report envelope field parser (`JR-5-02`, RFC section 6.1). Classification: `ci`.
 *
 * Covers the acceptance criterion word for word: `Sender`, `Subject`, `Message-Id`, `To`, `Cc`,
 * `Bcc`, multiple `Recipient:` lines (including indented distribution-list expansion),
 * `On-Behalf-Of`, and "undisclosed recipients" -- plus the rule that an unrecognised field is
 * preserved, never dropped, and (PO review R2) that `To`/`Cc`/`Bcc` parse the full RFC 5322
 * address-list grammar rather than shredding a quoted display name on a bare comma split.
 */

suite('ci', 'parseEnvelope() -- known fields', () => {
	it('parses Sender, Subject, Message-Id, To and Cc', async () => {
		const envelope = await parseEnvelope(
			[
				'Sender: alice@contoso.com',
				'Subject: Quarterly numbers',
				'Message-Id: <inner-1@contoso.com>',
				'To: bob@contoso.com, carol@contoso.com',
				'Cc: dave@contoso.com',
			].join('\r\n')
		);
		expect(envelope.sender).toBe('alice@contoso.com');
		expect(envelope.subject).toBe('Quarterly numbers');
		expect(envelope.messageId).toBe('<inner-1@contoso.com>');
		expect(envelope.to).toEqual(['bob@contoso.com', 'carol@contoso.com']);
		expect(envelope.cc).toEqual(['dave@contoso.com']);
	});

	it('parses Bcc as its own field, distinct from To/Cc', async () => {
		const envelope = await parseEnvelope(
			[
				'Sender: alice@contoso.com',
				'To: bob@contoso.com',
				'Bcc: secretwatcher@contoso.com',
			].join('\r\n')
		);
		expect(envelope.bcc).toEqual(['secretwatcher@contoso.com']);
		expect(envelope.to).toEqual(['bob@contoso.com']);
	});

	it('parses multiple Recipient: lines, in order, without deduplicating', async () => {
		const envelope = await parseEnvelope(
			[
				'Sender: alice@contoso.com',
				'Recipient: bob@contoso.com',
				'Recipient: carol@contoso.com',
				'Recipient: bob@contoso.com',
			].join('\r\n')
		);
		expect(envelope.recipients).toEqual([
			'bob@contoso.com',
			'carol@contoso.com',
			'bob@contoso.com',
		]);
	});

	it('parses On-Behalf-Of', async () => {
		const envelope = await parseEnvelope(
			['Sender: manager@contoso.com', 'On-Behalf-Of: assistant@contoso.com'].join('\r\n')
		);
		expect(envelope.onBehalfOf).toBe('assistant@contoso.com');
	});

	it('is case-insensitive on field names (Message-ID vs Message-Id)', async () => {
		const envelope = await parseEnvelope('Message-ID: <a@b.com>');
		expect(envelope.messageId).toBe('<a@b.com>');
	});
});

suite(
	'ci',
	'parseEnvelope() -- distribution-list expansion via indented continuation lines',
	() => {
		it('folds indented continuation lines into the preceding Recipient: entry', async () => {
			const envelope = await parseEnvelope(
				[
					'Sender: manager@contoso.com',
					'Recipient: dl-member-one@contoso.com',
					'    dl-member-two@contoso.com',
					'    dl-member-three@contoso.com',
					'Recipient: secretwatcher@contoso.com',
				].join('\r\n')
			);
			expect(envelope.recipients).toEqual([
				'dl-member-one@contoso.com',
				'dl-member-two@contoso.com',
				'dl-member-three@contoso.com',
				'secretwatcher@contoso.com',
			]);
		});

		it('folds a tab-indented continuation line the same way as a space-indented one', async () => {
			const envelope = await parseEnvelope(
				['Recipient: dl-member-one@contoso.com', '\tdl-member-two@contoso.com'].join('\r\n')
			);
			expect(envelope.recipients).toEqual([
				'dl-member-one@contoso.com',
				'dl-member-two@contoso.com',
			]);
		});
	}
);

suite('ci', 'parseEnvelope() -- undisclosed recipients (R4: which field is tracked)', () => {
	it('records which field carried the placeholder, not just a boolean', async () => {
		const envelope = await parseEnvelope(
			[
				'Sender: sender@contoso.com',
				'To: undisclosed-recipients:;',
				'Recipient: hidden@contoso.com',
			].join('\r\n')
		);
		expect(envelope.undisclosedRecipientFields).toEqual(['to']);
		expect(envelope.to).toEqual([]);
		expect(envelope.recipients).toEqual(['hidden@contoso.com']);
	});

	it('is empty when To/Cc/Bcc all carry normal address lists', async () => {
		const envelope = await parseEnvelope('To: bob@contoso.com');
		expect(envelope.undisclosedRecipientFields).toEqual([]);
	});

	it('records more than one field when both To and Bcc carry the placeholder', async () => {
		const envelope = await parseEnvelope(
			['To: undisclosed-recipients:;', 'Bcc: undisclosed-recipients:;'].join('\r\n')
		);
		expect(envelope.undisclosedRecipientFields).toEqual(['to', 'bcc']);
	});
});

suite('ci', 'parseEnvelope() -- To/Cc/Bcc parse full RFC 5322 address-list syntax (R2)', () => {
	it('does not shred a quoted display name containing a comma', async () => {
		const envelope = await parseEnvelope(
			'To: "Doe, John" <john@contoso.com>, Bob Smith <bob@contoso.com>'
		);
		expect(envelope.to).toEqual(['john@contoso.com', 'bob@contoso.com']);
	});

	it('extracts the address out of angle-address syntax without a quoted name', async () => {
		const envelope = await parseEnvelope('Cc: Ann Example <ann@contoso.com>');
		expect(envelope.cc).toEqual(['ann@contoso.com']);
	});

	it('parses multiple plain addresses on one line', async () => {
		const envelope = await parseEnvelope(
			'To: bob@contoso.com, carol@contoso.com, dave@contoso.com'
		);
		expect(envelope.to).toEqual(['bob@contoso.com', 'carol@contoso.com', 'dave@contoso.com']);
	});

	it('parses a quoted display name on Bcc the same way as on To', async () => {
		const envelope = await parseEnvelope('Bcc: "Watcher, Secret" <secretwatcher@contoso.com>');
		expect(envelope.bcc).toEqual(['secretwatcher@contoso.com']);
	});
});

suite('ci', 'parseEnvelope() -- unknown fields are preserved, not dropped', () => {
	it('captures a field-shaped line it does not model', async () => {
		const envelope = await parseEnvelope(
			['Sender: alice@contoso.com', 'X-MS-Journal-Report-Version: 1.0'].join('\r\n')
		);
		expect(envelope.unknownFields).toEqual([
			{ name: 'x-ms-journal-report-version', value: '1.0' },
		]);
	});

	it('captures a line that is neither a field nor a continuation, under `_unparsed`', async () => {
		const envelope = await parseEnvelope(
			['Sender: alice@contoso.com', 'this is not a field line'].join('\r\n')
		);
		expect(envelope.unknownFields).toEqual([
			{ name: '_unparsed', value: 'this is not a field line' },
		]);
	});

	it('preserves multiple unknown fields in order', async () => {
		const envelope = await parseEnvelope(['X-One: 1', 'X-Two: 2'].join('\r\n'));
		expect(envelope.unknownFields).toEqual([
			{ name: 'x-one', value: '1' },
			{ name: 'x-two', value: '2' },
		]);
	});
});

suite('ci', 'parseEnvelope() -- defaults and edge cases', () => {
	it('returns null fields and empty lists for an empty report body', async () => {
		const envelope = await parseEnvelope('');
		expect(envelope).toEqual({
			sender: null,
			subject: null,
			messageId: null,
			to: [],
			cc: [],
			bcc: [],
			recipients: [],
			onBehalfOf: null,
			undisclosedRecipientFields: [],
			unknownFields: [],
		});
	});

	it('ignores blank lines between fields', async () => {
		const envelope = await parseEnvelope(
			['Sender: alice@contoso.com', '', 'Subject: hi'].join('\r\n')
		);
		expect(envelope.sender).toBe('alice@contoso.com');
		expect(envelope.subject).toBe('hi');
	});
});

suite('ci', 'KNOWN_ENVELOPE_FIELD_NAMES cannot drift from the dispatch table (R3)', () => {
	it('recognises exactly the field names the acceptance criterion lists', () => {
		expect(KNOWN_ENVELOPE_FIELD_NAMES).toEqual(
			new Set([
				'sender',
				'subject',
				'message-id',
				'on-behalf-of',
				'recipient',
				'to',
				'cc',
				'bcc',
			])
		);
	});

	it('every known field name is actually handled -- an unknown one for each would fail otherwise', async () => {
		// This is the structural half of R3: KNOWN_ENVELOPE_FIELD_NAMES is derived from the same
		// object that dispatches parsing, so a name present in one and not the other cannot happen
		// without changing that object -- but this still exercises the observable behaviour: every
		// name in the set must be reachable as something other than an unknown field.
		for (const name of KNOWN_ENVELOPE_FIELD_NAMES) {
			const envelope = await parseEnvelope(`${name}: probe-value`);
			const unknownNames = envelope.unknownFields.map((field) => field.name);
			expect(unknownNames).not.toContain(name);
		}
	});
});

/**
 * `reportTextBeginsWithFieldLine()` -- one of the two independent signals `journal-report.ts`'s
 * `looksLikeGenuineJournalReport()` requires (PO review R3, `JR-5-05`/`JR-5-06`): a genuine journal
 * report's field-line block starts immediately, a forwarded message's quoted header block is preceded
 * by prose or a separator line.
 */
suite('ci', 'reportTextBeginsWithFieldLine() (PO review R3)', () => {
	it('is true when the first non-blank line is a recognised field line', () => {
		expect(reportTextBeginsWithFieldLine('Sender: alice@contoso.com\r\nSubject: hi')).toBe(
			true
		);
	});

	it('is true when the first non-blank line is field-shaped but unrecognised', () => {
		// Structural, not semantic: a future/unknown Exchange field at the very start still counts --
		// only entirely un-field-shaped text does not.
		expect(
			reportTextBeginsWithFieldLine('X-Future-Field: whatever\r\nSender: alice@contoso.com')
		).toBe(true);
	});

	it('is false when the text begins with a quoted-forward separator line', () => {
		expect(
			reportTextBeginsWithFieldLine(
				'---------- Forwarded message ---------\r\nFrom: alice@contoso.com\r\nTo: bob@contoso.com'
			)
		).toBe(false);
	});

	it('is false when the text begins with ordinary prose', () => {
		expect(
			reportTextBeginsWithFieldLine(
				'Hallo Bob, anbei die Rechnung.\r\nSender: alice@contoso.com'
			)
		).toBe(false);
	});

	it('is false for an entirely empty report text', () => {
		expect(reportTextBeginsWithFieldLine('')).toBe(false);
	});

	it('skips leading blank lines before judging the first real line', () => {
		// unfold() drops blank lines entirely (see envelope.ts), so leading blank lines must not by
		// themselves cause a false negative.
		expect(reportTextBeginsWithFieldLine('\r\n\r\nSender: alice@contoso.com')).toBe(true);
	});
});
