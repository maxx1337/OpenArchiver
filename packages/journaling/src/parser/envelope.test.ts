import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { parseEnvelope } from './envelope';

/**
 * The journal-report envelope field parser (`JR-5-02`, RFC section 6.1). Classification: `ci`.
 *
 * Covers the acceptance criterion word for word: `Sender`, `Subject`, `Message-Id`, `To`, `Cc`,
 * `Bcc`, multiple `Recipient:` lines (including indented distribution-list expansion),
 * `On-Behalf-Of`, and "undisclosed recipients" -- plus the rule that an unrecognised field is
 * preserved, never dropped.
 */

suite('ci', 'parseEnvelope() -- known fields', () => {
	it('parses Sender, Subject, Message-Id, To and Cc', () => {
		const envelope = parseEnvelope(
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

	it('parses Bcc as its own field, distinct from To/Cc', () => {
		const envelope = parseEnvelope(
			[
				'Sender: alice@contoso.com',
				'To: bob@contoso.com',
				'Bcc: secretwatcher@contoso.com',
			].join('\r\n')
		);
		expect(envelope.bcc).toEqual(['secretwatcher@contoso.com']);
		expect(envelope.to).toEqual(['bob@contoso.com']);
	});

	it('parses multiple Recipient: lines, in order, without deduplicating', () => {
		const envelope = parseEnvelope(
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

	it('parses On-Behalf-Of', () => {
		const envelope = parseEnvelope(
			['Sender: manager@contoso.com', 'On-Behalf-Of: assistant@contoso.com'].join('\r\n')
		);
		expect(envelope.onBehalfOf).toBe('assistant@contoso.com');
	});

	it('is case-insensitive on field names (Message-ID vs Message-Id)', () => {
		const envelope = parseEnvelope('Message-ID: <a@b.com>');
		expect(envelope.messageId).toBe('<a@b.com>');
	});
});

suite(
	'ci',
	'parseEnvelope() -- distribution-list expansion via indented continuation lines',
	() => {
		it('folds indented continuation lines into the preceding Recipient: entry', () => {
			const envelope = parseEnvelope(
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

		it('folds a tab-indented continuation line the same way as a space-indented one', () => {
			const envelope = parseEnvelope(
				['Recipient: dl-member-one@contoso.com', '\tdl-member-two@contoso.com'].join('\r\n')
			);
			expect(envelope.recipients).toEqual([
				'dl-member-one@contoso.com',
				'dl-member-two@contoso.com',
			]);
		});
	}
);

suite('ci', 'parseEnvelope() -- undisclosed recipients', () => {
	it('flags undisclosedRecipients and does not add a literal address for the placeholder', () => {
		const envelope = parseEnvelope(
			[
				'Sender: sender@contoso.com',
				'To: undisclosed-recipients:;',
				'Recipient: hidden@contoso.com',
			].join('\r\n')
		);
		expect(envelope.undisclosedRecipients).toBe(true);
		expect(envelope.to).toEqual([]);
		expect(envelope.recipients).toEqual(['hidden@contoso.com']);
	});

	it('is false when To carries a normal address list', () => {
		const envelope = parseEnvelope('To: bob@contoso.com');
		expect(envelope.undisclosedRecipients).toBe(false);
	});
});

suite('ci', 'parseEnvelope() -- unknown fields are preserved, not dropped', () => {
	it('captures a field-shaped line it does not model', () => {
		const envelope = parseEnvelope(
			['Sender: alice@contoso.com', 'X-MS-Journal-Report-Version: 1.0'].join('\r\n')
		);
		expect(envelope.unknownFields).toEqual([
			{ name: 'x-ms-journal-report-version', value: '1.0' },
		]);
	});

	it('captures a line that is neither a field nor a continuation, under `_unparsed`', () => {
		const envelope = parseEnvelope(
			['Sender: alice@contoso.com', 'this is not a field line'].join('\r\n')
		);
		expect(envelope.unknownFields).toEqual([
			{ name: '_unparsed', value: 'this is not a field line' },
		]);
	});

	it('preserves multiple unknown fields in order', () => {
		const envelope = parseEnvelope(['X-One: 1', 'X-Two: 2'].join('\r\n'));
		expect(envelope.unknownFields).toEqual([
			{ name: 'x-one', value: '1' },
			{ name: 'x-two', value: '2' },
		]);
	});
});

suite('ci', 'parseEnvelope() -- defaults and edge cases', () => {
	it('returns null fields and empty lists for an empty report body', () => {
		const envelope = parseEnvelope('');
		expect(envelope).toEqual({
			sender: null,
			subject: null,
			messageId: null,
			to: [],
			cc: [],
			bcc: [],
			recipients: [],
			onBehalfOf: null,
			undisclosedRecipients: false,
			unknownFields: [],
		});
	});

	it('ignores blank lines between fields', () => {
		const envelope = parseEnvelope(
			['Sender: alice@contoso.com', '', 'Subject: hi'].join('\r\n')
		);
		expect(envelope.sender).toBe('alice@contoso.com');
		expect(envelope.subject).toBe('hi');
	});
});
