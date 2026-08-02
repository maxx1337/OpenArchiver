import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { loadFixture } from '../../tests/support/fixtures';
import {
	parseContentType,
	splitHeaderAndBody,
	splitJournalReportMime,
	splitMultipartBody,
} from './mime-split';

/**
 * The hand-rolled, top-level-only MIME splitter (`JR-5-01`). Classification: `ci`.
 *
 * See the module doc comment in `mime-split.ts` for why this exists instead of handing the whole
 * outer message straight to `mailparser`: `mailparser` recurses through a `message/rfc822` boundary
 * and can merge the inner message's own `text/plain` body into the same `.text` as the report part.
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
