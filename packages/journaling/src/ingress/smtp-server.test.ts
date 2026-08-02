import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	buildEhloResponseLines,
	DataScanner,
	formatMultilineResponse,
	parseMailFromArguments,
	parseRcptToArguments,
} from './smtp-server';

/**
 * `JR-4-02` -- the ESMTP protocol engine's pure, socket-free logic: `EHLO` line construction,
 * multiline reply formatting, `MAIL FROM`/`RCPT TO` argument parsing, and the `DATA`-phase
 * terminator/dot-unstuffing scanner.
 *
 * The wire-level proof that a real client sees exactly what {@link buildEhloResponseLines} and
 * {@link formatMultilineResponse} produce -- the Product Owner's explicit instruction that the
 * `EHLO` acceptance criterion is proven over a real connection, not against an options object --
 * lives in `packages/journaling/tests/unit/smtp-server-protocol.test.ts`. This file covers the
 * functions these wire-level tests rely on in isolation, including edge cases a socket-level test
 * would be a slow and awkward way to exercise (e.g. every rejected `MAIL FROM` syntax variant).
 */
suite('ci', 'EsmtpServer pure logic (JR-4-02)', () => {
	describe('buildEhloResponseLines', () => {
		it('includes the hostname greeting first', () => {
			const lines = buildEhloResponseLines('mail.example.com', 1000);
			expect(lines[0]).toBe('mail.example.com greets you');
		});

		it('names PIPELINING, 8BITMIME, and SMTPUTF8 verbatim', () => {
			const lines = buildEhloResponseLines('host', 1000);
			expect(lines).toContain('PIPELINING');
			expect(lines).toContain('8BITMIME');
			expect(lines).toContain('SMTPUTF8');
		});

		it('renders SIZE with the exact configured value, not the default', () => {
			const lines = buildEhloResponseLines('host', 42);
			expect(lines).toContain('SIZE 42');
			expect(lines.some((l) => l.startsWith('SIZE ') && l !== 'SIZE 42')).toBe(false);
		});

		it('never includes CHUNKING (JR-4-03) or STARTTLS (JR-4-04) -- not yet implemented', () => {
			const lines = buildEhloResponseLines('host', 1000);
			expect(lines.join(' ')).not.toContain('CHUNKING');
			expect(lines.join(' ')).not.toContain('STARTTLS');
		});
	});

	describe('formatMultilineResponse', () => {
		it('uses a dash on every line but the last, a space on the last', () => {
			const formatted = formatMultilineResponse(250, ['a', 'b', 'c']);
			expect(formatted).toBe('250-a\r\n250-b\r\n250 c\r\n');
		});

		it('handles a single line with a space, not a dash', () => {
			expect(formatMultilineResponse(250, ['only'])).toBe('250 only\r\n');
		});

		it('throws on an empty line list rather than emitting a malformed reply', () => {
			expect(() => formatMultilineResponse(250, [])).toThrow();
		});
	});

	describe('parseMailFromArguments', () => {
		it('parses a bare address with no parameters', () => {
			expect(parseMailFromArguments('FROM:<a@example.com>')).toEqual({
				address: 'a@example.com',
				sizeParam: null,
			});
		});

		it('parses the null sender <>', () => {
			expect(parseMailFromArguments('FROM:<>')).toEqual({ address: '', sizeParam: null });
		});

		it('parses a SIZE= parameter', () => {
			expect(parseMailFromArguments('FROM:<a@example.com> SIZE=12345')).toEqual({
				address: 'a@example.com',
				sizeParam: 12345,
			});
		});

		it('parses SIZE= case-insensitively among other parameters', () => {
			expect(parseMailFromArguments('FROM:<a@example.com> BODY=8BITMIME size=99')).toEqual({
				address: 'a@example.com',
				sizeParam: 99,
			});
		});

		it('is case-insensitive on the FROM: keyword', () => {
			expect(parseMailFromArguments('from:<a@example.com>')).toEqual({
				address: 'a@example.com',
				sizeParam: null,
			});
		});

		it('rejects a missing FROM: keyword', () => {
			expect(parseMailFromArguments('<a@example.com>')).toBeNull();
		});

		it('rejects an address with no angle brackets', () => {
			expect(parseMailFromArguments('FROM:a@example.com')).toBeNull();
		});
	});

	describe('parseRcptToArguments', () => {
		it('parses a bare address', () => {
			expect(parseRcptToArguments('TO:<b@example.com>')).toEqual({
				address: 'b@example.com',
			});
		});

		it('is case-insensitive on the TO: keyword', () => {
			expect(parseRcptToArguments('to:<b@example.com>')).toEqual({
				address: 'b@example.com',
			});
		});

		it('rejects a missing TO: keyword', () => {
			expect(parseRcptToArguments('<b@example.com>')).toBeNull();
		});
	});

	describe('DataScanner', () => {
		function feed(scanner: DataScanner, text: string): { done: boolean; oversize: boolean } {
			return scanner.push(Buffer.from(text, 'utf8'));
		}

		it('recognises the terminator immediately for an empty message', () => {
			const scanner = new DataScanner(1000);
			const result = feed(scanner, '.\r\n');
			expect(result).toEqual({ done: true, oversize: false });
			expect(scanner.contentByteLength).toBe(0);
		});

		it('counts a single content line including its CRLF', () => {
			const scanner = new DataScanner(1000);
			const result = feed(scanner, 'hello\r\n.\r\n');
			expect(result.done).toBe(true);
			expect(scanner.contentByteLength).toBe('hello'.length + 2);
		});

		it('un-stuffs a leading dot on a content line', () => {
			const scanner = new DataScanner(1000);
			feed(scanner, '..leading dot\r\n.\r\n');
			// ".leading dot" (one dot removed) + CRLF
			expect(scanner.contentByteLength).toBe('.leading dot'.length + 2);
		});

		it('does not treat a dot-stuffed line as the terminator', () => {
			const scanner = new DataScanner(1000);
			const result = feed(scanner, '..\r\n.\r\n');
			// First line is "." after un-stuffing (i.e. two dots stuffed down to one) plus CRLF, then
			// the real terminator ends the message.
			expect(result.done).toBe(true);
			expect(scanner.contentByteLength).toBe(1 + 2);
		});

		it('handles the terminator split across two chunks', () => {
			const scanner = new DataScanner(1000);
			const first = scanner.push(Buffer.from('hello\r\n.\r'));
			expect(first.done).toBe(false);
			const second = scanner.push(Buffer.from('\n'));
			expect(second.done).toBe(true);
			expect(scanner.contentByteLength).toBe('hello'.length + 2);
		});

		it('handles content split mid-line across chunks', () => {
			const scanner = new DataScanner(1000);
			scanner.push(Buffer.from('hel'));
			const result = feed(scanner, 'lo\r\n.\r\n');
			expect(result.done).toBe(true);
			expect(scanner.contentByteLength).toBe('hello'.length + 2);
		});

		it('accepts content exactly at the byte limit', () => {
			const scanner = new DataScanner(7); // "hello\r\n" is exactly 7 bytes
			const result = feed(scanner, 'hello\r\n.\r\n');
			expect(result).toEqual({ done: true, oversize: false });
		});

		it('flags content one byte over the limit as oversize', () => {
			const scanner = new DataScanner(6); // "hello\r\n" is 7 bytes, one over a limit of 6
			const result = feed(scanner, 'hello\r\n.\r\n');
			expect(result.oversize).toBe(true);
			expect(result.done).toBe(true);
		});

		it('flags a pathological line with no CRLF at all as oversize once it exceeds the limit', () => {
			const scanner = new DataScanner(10);
			const result = feed(scanner, 'x'.repeat(50));
			expect(result).toEqual({ done: true, oversize: true });
		});

		it('ignores further chunks once finished', () => {
			const scanner = new DataScanner(1000);
			feed(scanner, 'hello\r\n.\r\n');
			const before = scanner.contentByteLength;
			const result = scanner.push(Buffer.from('more\r\n.\r\n'));
			expect(result).toEqual({ done: true, oversize: false });
			expect(scanner.contentByteLength).toBe(before);
		});
	});
});
