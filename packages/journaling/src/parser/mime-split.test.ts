import { simpleParser } from 'mailparser';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { loadFixture } from '../../tests/support/fixtures';
import {
	isSmimeWrappedContentType,
	isSmimeWrappedMessage,
	locateJournalParts,
	parseContentType,
	splitHeaderAndBody,
	splitJournalReportMime,
	splitMultipartBody,
} from './mime-split';

/**
 * The hand-rolled, top-level-only MIME splitter (`JR-5-01`). Classification: `ci`.
 *
 * See the module doc comment in `mime-split.ts` for why this exists instead of handing the whole
 * outer message straight to `mailparser`: under one specific condition (`message/rfc822` part
 * encoded `7bit`/`8bit`/`binary` **and** `Content-Disposition: inline`), `mailparser` descends across
 * the `message/rfc822` boundary and can merge the inner message's own `text/plain` body into the same
 * `.text` as the report part. The suite below pins that condition down with a measurement, not a
 * citation of the module comment's prose -- so that a future change to `mailparser`'s behaviour, or a
 * future reader deciding this module is unnecessary complexity, has to reckon with a failing test
 * rather than an assertion nobody re-checked.
 */

suite('ci', 'splitHeaderAndBody()', () => {
	it('splits at the first CRLF blank line and lowercases header names', () => {
		const buf = Buffer.from('Content-Type: text/plain\r\nX-Foo: bar\r\n\r\nhello body', 'utf8');
		const { headers, body } = splitHeaderAndBody(buf);
		expect(headers.get('content-type')).toBe('text/plain');
		expect(headers.get('x-foo')).toBe('bar');
		expect(body.toString('utf8')).toBe('hello body');
	});

	it('splits at a bare LF blank line too', () => {
		const buf = Buffer.from('Content-Type: text/plain\n\nhello body', 'utf8');
		const { headers, body } = splitHeaderAndBody(buf);
		expect(headers.get('content-type')).toBe('text/plain');
		expect(body.toString('utf8')).toBe('hello body');
	});

	it('unfolds a continuation header line', () => {
		const buf = Buffer.from(
			'Content-Type: multipart/mixed;\r\n boundary="abc"\r\n\r\nbody',
			'utf8'
		);
		const { headers } = splitHeaderAndBody(buf);
		expect(headers.get('content-type')).toBe('multipart/mixed; boundary="abc"');
	});

	it('treats a header block with no blank line as headers-only, empty body', () => {
		const buf = Buffer.from('Content-Type: text/plain', 'utf8');
		const { headers, body } = splitHeaderAndBody(buf);
		expect(headers.get('content-type')).toBe('text/plain');
		expect(body.length).toBe(0);
	});

	it('returns a body that is a view over the original bytes, not a copy that could silently diverge', () => {
		const buf = Buffer.from('Content-Type: text/plain\r\n\r\nABC', 'utf8');
		const { body } = splitHeaderAndBody(buf);
		expect(body.toString('utf8')).toBe('ABC');
		// Subarray semantics: mutating the source is visible in the view. This is documentation of
		// the contract (never write into a split part), not something callers should rely on.
		buf[buf.length - 1] = 0x5a; // 'Z'
		expect(body.toString('utf8')).toBe('ABZ');
	});
});

suite('ci', 'parseContentType()', () => {
	it('defaults to text/plain when the header is absent', () => {
		expect(parseContentType(undefined)).toEqual({ type: 'text/plain', params: {} });
	});

	it('parses type and a quoted boundary parameter', () => {
		expect(parseContentType('multipart/mixed; boundary="AbC-123"')).toEqual({
			type: 'multipart/mixed',
			params: { boundary: 'AbC-123' },
		});
	});

	it('parses an unquoted parameter and lowercases the type but not the boundary value', () => {
		expect(parseContentType('Multipart/Mixed; boundary=MixedCaseBoundary')).toEqual({
			type: 'multipart/mixed',
			params: { boundary: 'MixedCaseBoundary' },
		});
	});

	it('keeps a semicolon inside a quoted parameter value intact', () => {
		expect(parseContentType('text/plain; charset="us-ascii; extra"')).toEqual({
			type: 'text/plain',
			params: { charset: 'us-ascii; extra' },
		});
	});
});

suite('ci', 'splitMultipartBody()', () => {
	it('splits two parts delimited by a boundary, stripping the CRLF that belongs to the delimiter', () => {
		const body = Buffer.from(
			'--B\r\n' + 'part one content\r\n' + '--B\r\n' + 'part two content\r\n' + '--B--\r\n',
			'utf8'
		);
		const parts = splitMultipartBody(body, 'B');
		expect(parts.map((p) => p.toString('utf8'))).toEqual([
			'part one content',
			'part two content',
		]);
	});

	it('excludes preamble before the first delimiter and epilogue after the closing one', () => {
		const body = Buffer.from(
			'this is preamble, not a part\r\n' +
				'--B\r\n' +
				'only part\r\n' +
				'--B--\r\n' +
				'this is epilogue, not a part\r\n',
			'utf8'
		);
		const parts = splitMultipartBody(body, 'B');
		expect(parts.map((p) => p.toString('utf8'))).toEqual(['only part']);
	});

	it('returns an empty array when fewer than two delimiter lines are found', () => {
		const body = Buffer.from('--B\r\nonly an opening delimiter\r\n', 'utf8');
		expect(splitMultipartBody(body, 'B')).toEqual([]);
	});

	it('does not match a boundary-like string that is not at the start of a line', () => {
		const body = Buffer.from(
			'--B\r\n' + 'a part that mentions --B mid-line, not as a delimiter\r\n' + '--B--\r\n',
			'utf8'
		);
		const parts = splitMultipartBody(body, 'B');
		expect(parts).toHaveLength(1);
		expect(parts[0]!.toString('utf8')).toBe(
			'a part that mentions --B mid-line, not as a delimiter'
		);
	});

	it('does not treat a line starting with the boundary text as a delimiter when it has trailing content other than whitespace (R5)', () => {
		// Boundary is "B1"; a body line "--B1EXTRA" starts with "--B1" but is not a delimiter line --
		// RFC 2046 requires the delimiter text to be followed only by optional linear whitespace (or,
		// for the close delimiter, "--" then optional whitespace) and the line terminator.
		const body = Buffer.from(
			'--B1\r\n' + '--B1EXTRA is body content, not a delimiter\r\n' + '--B1--\r\n',
			'utf8'
		);
		const parts = splitMultipartBody(body, 'B1');
		expect(parts).toHaveLength(1);
		expect(parts[0]!.toString('utf8')).toBe('--B1EXTRA is body content, not a delimiter');
	});

	it('still recognises a delimiter line padded with trailing linear whitespace', () => {
		const body = Buffer.from('--B  \r\n' + 'part content\r\n' + '--B--   \r\n', 'utf8');
		const parts = splitMultipartBody(body, 'B');
		expect(parts.map((p) => p.toString('utf8'))).toEqual(['part content']);
	});
});

suite('ci', 'splitJournalReportMime()', () => {
	it('splits the basic fixture into a text/plain report part and a message/rfc822 inner part', () => {
		const raw = loadFixture('basic-journal-report.eml');
		const split = splitJournalReportMime(raw);
		expect(split).not.toBeNull();
		const { headers: reportHeaders } = splitHeaderAndBody(split!.reportPart);
		expect(reportHeaders.get('content-type')).toContain('text/plain');
		expect(split!.innerMessage.toString('utf8')).toContain('Please find the quarterly numbers');
		expect(split!.innerMessage.toString('utf8')).toContain('Message-ID: <inner-1@contoso.com>');
	});

	it('returns null when the outer message has no message/rfc822 part', () => {
		const raw = loadFixture('missing-inner-part.eml');
		expect(splitJournalReportMime(raw)).toBeNull();
	});

	it('returns null when the outer message is not multipart/mixed at all', () => {
		const raw = loadFixture('not-multipart.eml');
		expect(splitJournalReportMime(raw)).toBeNull();
	});

	it('never mutates the buffer it was given', () => {
		const raw = loadFixture('basic-journal-report.eml');
		const copy = Buffer.from(raw);
		splitJournalReportMime(raw);
		expect(Buffer.compare(raw, copy)).toBe(0);
	});
});

suite(
	'ci',
	"mailparser's message/rfc822 boundary is conditional on Content-Disposition: inline (R1)",
	() => {
		/**
		 * Reproduces the module doc comment's measurement directly: three otherwise-identical
		 * messages, differing only in the inner `message/rfc822` part's `Content-Disposition`, fed
		 * straight to `mailparser.simpleParser()` with no splitting at all. Only `inline` causes the
		 * inner body to appear in `.text` -- this is the mechanism `mime-split.ts` exists to route
		 * around, and this test is what stops that reasoning from silently going stale.
		 */
		const INNER_MARKER = 'INNER-BODY-MARKER';

		function outerMessage(disposition: string | undefined): Buffer {
			const dispositionLine = disposition ? `Content-Disposition: ${disposition}\r\n` : '';
			return Buffer.from(
				[
					'From: journal@contoso.com',
					'To: archive@example.org',
					'Subject: probe',
					'MIME-Version: 1.0',
					'Content-Type: multipart/mixed; boundary="B"',
					'',
					'--B',
					'Content-Type: text/plain; charset="us-ascii"',
					'',
					'Sender: alice@contoso.com',
					'Recipient: bob@contoso.com',
					'',
					'--B',
					`Content-Type: message/rfc822\r\n${dispositionLine}`,
					'From: alice@contoso.com',
					'To: bob@contoso.com',
					'Subject: inner subject',
					'Content-Type: text/plain; charset="us-ascii"',
					'',
					`${INNER_MARKER} this is the inner text`,
					'',
					'--B--',
					'',
				].join('\r\n'),
				'utf8'
			);
		}

		it('does NOT merge the inner text/plain body into .text with no Content-Disposition', async () => {
			const parsed = await simpleParser(outerMessage(undefined), { skipHtmlToText: true });
			expect(parsed.text ?? '').not.toContain(INNER_MARKER);
			expect(parsed.attachments).toHaveLength(1);
		});

		it('DOES merge the inner text/plain body into .text when Content-Disposition: inline', async () => {
			const parsed = await simpleParser(outerMessage('inline'), { skipHtmlToText: true });
			expect(parsed.text ?? '').toContain(INNER_MARKER);
			expect(parsed.attachments).toHaveLength(0);
		});

		it('does NOT merge the inner text/plain body into .text with Content-Disposition: attachment', async () => {
			const parsed = await simpleParser(outerMessage('attachment'), { skipHtmlToText: true });
			expect(parsed.text ?? '').not.toContain(INNER_MARKER);
			expect(parsed.attachments).toHaveLength(1);
		});

		it('splitJournalReportMime() still separates the two parts correctly when the inner part is Content-Disposition: inline', () => {
			// The counter-proof that mime-split.ts's manual approach actually avoids the mixing shown
			// above: fed the same shape, it must isolate the report text from the inner body.
			const raw = loadFixture('inline-inner-message.eml');
			const split = splitJournalReportMime(raw);
			expect(split).not.toBeNull();
			expect(split!.innerMessage.toString('utf8')).toContain('INNER-BODY-MARKER');

			const { headers: reportHeaders, body: reportBody } = splitHeaderAndBody(
				split!.reportPart
			);
			expect(reportHeaders.get('content-type')).toContain('text/plain');
			// The isolated report part must not contain the inner message's body -- proving the split
			// happened before mailparser ever saw the combined buffer.
			expect(reportBody.toString('utf8')).not.toContain('INNER-BODY-MARKER');
		});
	}
);

suite(
	'ci',
	'locateJournalParts() -- reports the report part even when the inner part is missing (JR-5-03)',
	() => {
		it('splits the basic fixture the same way splitJournalReportMime() does', () => {
			const raw = loadFixture('basic-journal-report.eml');
			const located = locateJournalParts(raw);
			expect(located.outerIsMultipartMixed).toBe(true);
			expect(located.reportPart).not.toBeNull();
			expect(located.innerMessage).not.toBeNull();
		});

		it('still returns the report part when the message/rfc822 inner part is missing', () => {
			const raw = loadFixture('missing-inner-part.eml');
			const located = locateJournalParts(raw);
			expect(located.outerIsMultipartMixed).toBe(true);
			expect(located.reportPart).not.toBeNull();
			const { headers } = splitHeaderAndBody(located.reportPart!);
			expect(headers.get('content-type')).toContain('text/plain');
			expect(located.innerMessage).toBeNull();
		});

		it('reports outerIsMultipartMixed=false and no parts for a non-multipart/mixed message', () => {
			const raw = loadFixture('not-multipart.eml');
			const located = locateJournalParts(raw);
			expect(located.outerIsMultipartMixed).toBe(false);
			expect(located.reportPart).toBeNull();
			expect(located.innerMessage).toBeNull();
		});

		it('never mutates the buffer it was given', () => {
			const raw = loadFixture('missing-inner-part.eml');
			const copy = Buffer.from(raw);
			locateJournalParts(raw);
			expect(Buffer.compare(raw, copy)).toBe(0);
		});
	}
);

suite('ci', 'isSmimeWrappedContentType() / isSmimeWrappedMessage() (JR-5-03)', () => {
	it('recognises application/pkcs7-mime as S/MIME-wrapped', () => {
		expect(
			isSmimeWrappedContentType(
				parseContentType('application/pkcs7-mime; smime-type=enveloped-data')
			)
		).toBe(true);
	});

	it('recognises the deprecated application/x-pkcs7-mime alias as S/MIME-wrapped', () => {
		expect(
			isSmimeWrappedContentType(
				parseContentType('application/x-pkcs7-mime; smime-type=enveloped-data')
			)
		).toBe(true);
	});

	it('recognises application/pkcs7-mime as wrapped even without a smime-type parameter', () => {
		expect(isSmimeWrappedContentType(parseContentType('application/pkcs7-mime'))).toBe(true);
	});

	it('does NOT treat multipart/signed with the pkcs7-signature protocol as wrapped -- clear-signed, readable', () => {
		expect(
			isSmimeWrappedContentType(
				parseContentType(
					'multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256'
				)
			)
		).toBe(false);
	});

	it('does NOT treat an ordinary text/plain message as wrapped', () => {
		expect(isSmimeWrappedContentType(parseContentType('text/plain; charset="us-ascii"'))).toBe(
			false
		);
	});

	it('isSmimeWrappedMessage() reads only the top-level Content-Type header of a full message', () => {
		const encryptedLike = Buffer.from(
			[
				'From: alice@contoso.com',
				'To: bob@contoso.com',
				'Content-Type: application/pkcs7-mime; smime-type=enveloped-data',
				'',
				'not-real-base64-ciphertext',
				'',
			].join('\r\n'),
			'utf8'
		);
		expect(isSmimeWrappedMessage(encryptedLike)).toBe(true);

		const plainMessage = Buffer.from(
			[
				'From: alice@contoso.com',
				'To: bob@contoso.com',
				'Content-Type: text/plain',
				'',
				'hello',
				'',
			].join('\r\n'),
			'utf8'
		);
		expect(isSmimeWrappedMessage(plainMessage)).toBe(false);
	});

	it('isSmimeWrappedMessage() never throws on an empty buffer', () => {
		expect(() => isSmimeWrappedMessage(Buffer.alloc(0))).not.toThrow();
		expect(isSmimeWrappedMessage(Buffer.alloc(0))).toBe(false);
	});
});
