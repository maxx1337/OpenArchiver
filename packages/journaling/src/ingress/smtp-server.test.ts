import * as tls from 'node:tls';
import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	BdatContentTracker,
	buildEhloResponseLines,
	buildTlsSocketOptions,
	DataScanner,
	decodeSaslBase64,
	decodeSaslPlain,
	formatMultilineResponse,
	parseAuthArguments,
	parseBdatArguments,
	parseMailFromArguments,
	parseRcptToArguments,
} from './smtp-server';
import { TLS_CIPHERS, TLS_MIN_VERSION } from './tls-config';

/**
 * `JR-4-02`/`JR-4-03` -- the ESMTP protocol engine's pure, socket-free logic: `EHLO` line
 * construction, multiline reply formatting, `MAIL FROM`/`RCPT TO`/`BDAT` argument parsing, and the
 * `DATA`-phase and `BDAT`-phase content trackers.
 *
 * The wire-level proof that a real client sees exactly what {@link buildEhloResponseLines} and
 * {@link formatMultilineResponse} produce -- the Product Owner's explicit instruction that the
 * `EHLO` acceptance criterion is proven over a real connection, not against an options object --
 * lives in `packages/journaling/tests/unit/smtp-server-protocol.test.ts`. This file covers the
 * functions these wire-level tests rely on in isolation, including edge cases a socket-level test
 * would be a slow and awkward way to exercise (e.g. every rejected `MAIL FROM` syntax variant),
 * plus `JR-4-03`'s core acceptance proof -- that `DATA` (dot-stuffed wire bytes, unstuffed by
 * {@link DataScanner}) and `BDAT` (raw wire bytes, untouched by {@link BdatContentTracker})
 * reconstruct byte-identical content for the same logical message, including the two hardest
 * cases: a content line that is itself a bare `.` (an embedded terminator look-alike) and a chunk
 * boundary that falls between the `\r` and `\n` of a CRLF.
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

		it('includes CHUNKING (JR-4-03)', () => {
			const lines = buildEhloResponseLines('host', 1000);
			expect(lines).toContain('CHUNKING');
		});

		it('does not advertise STARTTLS when the tls argument is omitted (every pre-JR-4-04 call site)', () => {
			const lines = buildEhloResponseLines('host', 1000);
			expect(lines.join(' ')).not.toContain('STARTTLS');
		});

		it('does not advertise STARTTLS when unavailable, even if marked active (a contradictory input)', () => {
			const lines = buildEhloResponseLines('host', 1000, { available: false, active: true });
			expect(lines.join(' ')).not.toContain('STARTTLS');
		});

		it('does not advertise STARTTLS when explicitly marked unavailable and inactive', () => {
			const lines = buildEhloResponseLines('host', 1000, { available: false, active: false });
			expect(lines.join(' ')).not.toContain('STARTTLS');
		});

		it('advertises STARTTLS (JR-4-04) when available and not yet active', () => {
			const lines = buildEhloResponseLines('host', 1000, { available: true, active: false });
			expect(lines).toContain('STARTTLS');
		});

		it('does not advertise STARTTLS once already active, even though a certificate is configured', () => {
			const lines = buildEhloResponseLines('host', 1000, { available: true, active: true });
			expect(lines.join(' ')).not.toContain('STARTTLS');
		});
	});

	describe('buildTlsSocketOptions (JR-4-04)', () => {
		it('always passes the fixed TLS_MIN_VERSION floor, never a lower or configurable value', () => {
			const fakeSecureContext = {} as tls.SecureContext;
			const options = buildTlsSocketOptions(fakeSecureContext);
			expect(options.minVersion).toBe(TLS_MIN_VERSION);
			expect(options.minVersion).toBe('TLSv1.2');
		});

		it('marks the socket as a server and forwards the given secureContext unchanged', () => {
			const fakeSecureContext = {} as tls.SecureContext;
			const options = buildTlsSocketOptions(fakeSecureContext);
			expect(options.isServer).toBe(true);
			expect(options.secureContext).toBe(fakeSecureContext);
		});

		it('never sets maxVersion -- the default ceiling is inherited from Node, not pinned', () => {
			const options = buildTlsSocketOptions({} as tls.SecureContext);
			expect(options.maxVersion).toBeUndefined();
		});

		it('sets neither ciphers nor honorCipherOrder -- deliberately (JR-4-21a, F56): a per-socket cipher option is silently ignored once secureContext is already supplied, so TLS_CIPHERS is set at tls.createSecureContext() time instead, in the EsmtpServer constructor, never here', () => {
			const options = buildTlsSocketOptions({} as tls.SecureContext);
			expect(options.ciphers).toBeUndefined();
			expect(options.honorCipherOrder).toBeUndefined();
		});

		it('TLS_CIPHERS itself never lists a CBC/SHA-1 suite or a plain-RSA-key-exchange suite', () => {
			// Every listed suite must be forward-secret (ECDHE/DHE key exchange) and AEAD (GCM/
			// CHACHA20-POLY1305). The wire-level proof that this list actually reaches the TLS engine
			// (smtp-tls-cipher-filter.test.ts) lives in tests/unit, not here -- this file only checks
			// the shape of the constant itself.
			expect(TLS_CIPHERS).not.toContain('SHA-1');
			for (const suiteName of TLS_CIPHERS.split(':')) {
				expect(suiteName).toMatch(/^(?:ECDHE|DHE)-/);
				expect(suiteName).toMatch(/GCM|CHACHA20-POLY1305/);
			}
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

		it('flags a pathological line with no CRLF at all as oversize immediately, but does not finish until the terminator arrives (F44)', () => {
			// Before JR-4-16's fix this reported `done: true` right here -- the bug: the scanner
			// stopped reading mid-stream, and whatever the sender transmitted next (still believing
			// this was ordinary message content) was left for `SmtpConnection` to misread as SMTP
			// commands. `oversize` must flip immediately (the limit really was exceeded), but `done`
			// must not, until the real terminator has actually been seen.
			const scanner = new DataScanner(10);
			const result = feed(scanner, 'x'.repeat(50));
			expect(result).toEqual({ done: false, oversize: true });
		});

		it('keeps waiting across further CRLF-less chunks while oversize (F44)', () => {
			const scanner = new DataScanner(10);
			feed(scanner, 'x'.repeat(50)); // trips the pathological-line abort point
			const stillWaiting = feed(scanner, 'y'.repeat(50)); // more garbage, still no CRLF anywhere
			expect(stillWaiting).toEqual({ done: false, oversize: true });
		});

		it('recognises the terminator that eventually arrives after a CRLF-less oversize line (F44, the pathological-line abort point)', () => {
			const scanner = new DataScanner(10);
			feed(scanner, 'x'.repeat(50)); // trips oversize with no CRLF in sight
			feed(scanner, 'more garbage, still not the terminator\r\n'); // first CRLF since the trip
			const result = feed(scanner, '.\r\n');
			expect(result).toEqual({ done: true, oversize: true });
		});

		it('recognises the terminator that eventually arrives after the byte-count oversize trip (F44, the line-counting abort point)', () => {
			const scanner = new DataScanner(6); // "hello\r\n" (7 bytes) trips this on the very first line
			const tripped = feed(scanner, 'hello\r\n');
			expect(tripped).toEqual({ done: false, oversize: true });
			const midway = scanner.push(Buffer.from('more content\r\n'));
			expect(midway).toEqual({ done: false, oversize: true });
			const result = scanner.push(Buffer.from('.\r\n'));
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

	describe('parseBdatArguments (JR-4-03)', () => {
		it('parses a bare chunk-size with no LAST marker', () => {
			expect(parseBdatArguments('500')).toEqual({ chunkSize: 500, last: false });
		});

		it('parses a chunk-size with LAST, case-insensitively', () => {
			expect(parseBdatArguments('500 LAST')).toEqual({ chunkSize: 500, last: true });
			expect(parseBdatArguments('500 last')).toEqual({ chunkSize: 500, last: true });
		});

		it('accepts a zero chunk-size', () => {
			expect(parseBdatArguments('0')).toEqual({ chunkSize: 0, last: false });
			expect(parseBdatArguments('0 LAST')).toEqual({ chunkSize: 0, last: true });
		});

		it('accepts leading zeros in the chunk-size', () => {
			expect(parseBdatArguments('007')).toEqual({ chunkSize: 7, last: false });
		});

		it('rejects a missing chunk-size', () => {
			expect(parseBdatArguments('')).toBeNull();
			expect(parseBdatArguments('   ')).toBeNull();
		});

		it('rejects a non-numeric chunk-size', () => {
			expect(parseBdatArguments('abc')).toBeNull();
		});

		it('rejects a negative chunk-size (a leading "-" is not a digit)', () => {
			expect(parseBdatArguments('-5')).toBeNull();
		});

		it('rejects a decimal chunk-size', () => {
			expect(parseBdatArguments('5.5')).toBeNull();
		});

		it('rejects a chunk-size too large to represent as a safe integer', () => {
			expect(parseBdatArguments('99999999999999999999')).toBeNull();
		});

		it('rejects a second token that is not literally LAST', () => {
			expect(parseBdatArguments('500 NOW')).toBeNull();
		});
	});

	describe('BdatContentTracker (JR-4-03)', () => {
		it('counts a single pushed chunk', () => {
			const tracker = new BdatContentTracker(1000);
			const result = tracker.push(Buffer.from('hello'));
			expect(result.oversize).toBe(false);
			expect(tracker.contentByteLength).toBe(5);
		});

		it('accumulates length across multiple pushes, across multiple BDAT chunks', () => {
			const tracker = new BdatContentTracker(1000);
			tracker.push(Buffer.from('hello'));
			tracker.push(Buffer.from(' world'));
			expect(tracker.contentByteLength).toBe(11);
		});

		it('forwards each pushed slice to onContent verbatim, in order, with no transformation', () => {
			const received: Buffer[] = [];
			const tracker = new BdatContentTracker(1000, (chunk) =>
				received.push(Buffer.from(chunk))
			);
			tracker.push(Buffer.from('.leading dot, untouched'));
			tracker.push(Buffer.from('\r\n.\r\n')); // an embedded terminator look-alike -- BDAT is raw
			expect(Buffer.concat(received).toString('utf8')).toBe(
				'.leading dot, untouched\r\n.\r\n'
			);
		});

		it('accepts content exactly at the byte limit', () => {
			const tracker = new BdatContentTracker(5);
			const result = tracker.push(Buffer.from('hello'));
			expect(result.oversize).toBe(false);
		});

		it('flags content one byte over the limit as oversize', () => {
			const tracker = new BdatContentTracker(4);
			const result = tracker.push(Buffer.from('hello'));
			expect(result.oversize).toBe(true);
		});

		it('stays oversize once tripped, even for a subsequent push that would not itself exceed', () => {
			const tracker = new BdatContentTracker(4);
			tracker.push(Buffer.from('hello')); // trips oversize
			const result = tracker.push(Buffer.from('x'));
			expect(result.oversize).toBe(true);
		});

		it('treats a zero-length push as a no-op', () => {
			const received: Buffer[] = [];
			const tracker = new BdatContentTracker(1000, (chunk) =>
				received.push(Buffer.from(chunk))
			);
			const result = tracker.push(Buffer.alloc(0));
			expect(result.oversize).toBe(false);
			expect(tracker.contentByteLength).toBe(0);
			expect(received).toHaveLength(0);
		});
	});

	describe('DATA/BDAT byte-identical acceptance proof (JR-4-03)', () => {
		const DOT = 0x2e;
		const CRLFBuf = Buffer.from('\r\n');

		/**
		 * Dot-stuff a logical message body per RFC 5321 section 4.5.2 ("if the first character is a
		 * period, one additional period is inserted") to derive the wire bytes a real `DATA` sender
		 * would transmit -- the reverse of what {@link DataScanner} undoes. Test-local and simple on
		 * purpose (a straight CRLF split and a per-line check) so it can be verified by inspection
		 * rather than trusted as production logic.
		 */
		function dotStuffForWire(logicalBody: Buffer): Buffer {
			const lines: Buffer[] = [];
			let start = 0;
			for (let i = 0; i + 1 < logicalBody.length; i += 1) {
				if (logicalBody[i] === 0x0d && logicalBody[i + 1] === 0x0a) {
					lines.push(logicalBody.subarray(start, i));
					start = i + 2;
					i += 1;
				}
			}
			if (start !== logicalBody.length) {
				throw new Error('test fixture must end with CRLF');
			}
			return Buffer.concat(
				lines.map((line) =>
					Buffer.concat([
						line.length > 0 && line[0] === DOT ? Buffer.from('.') : Buffer.alloc(0),
						line,
						CRLFBuf,
					])
				)
			);
		}

		function reconstructViaData(
			wireBytesWithoutTerminator: Buffer,
			limitBytes: number
		): Buffer {
			const received: Buffer[] = [];
			const scanner = new DataScanner(limitBytes, (chunk) =>
				received.push(Buffer.from(chunk))
			);
			scanner.push(Buffer.concat([wireBytesWithoutTerminator, Buffer.from('.\r\n')]));
			return Buffer.concat(received);
		}

		function reconstructViaBdat(
			logicalBody: Buffer,
			splitPoints: number[],
			limitBytes: number
		): Buffer {
			const received: Buffer[] = [];
			const tracker = new BdatContentTracker(limitBytes, (chunk) =>
				received.push(Buffer.from(chunk))
			);
			let offset = 0;
			for (const point of [...splitPoints, logicalBody.length]) {
				tracker.push(logicalBody.subarray(offset, point));
				offset = point;
			}
			return Buffer.concat(received);
		}

		it('reconstructs identical bytes for a body with a bare-dot line, a leading-dot line, and a chunk boundary between \\r and \\n', () => {
			const logicalBody = Buffer.from(
				'Subject: test\r\n' +
					'\r\n' +
					'Hello world.\r\n' +
					'.\r\n' + // bare dot -- an embedded end-of-DATA terminator look-alike
					'.Leading dot content\r\n' + // a content line that itself starts with a dot
					'Trailing text\r\n'
			);

			const dataResult = reconstructViaData(dotStuffForWire(logicalBody), 1_000_000);

			// Split BDAT's raw feed mid-line, again precisely between the '\r' and '\n' of the first
			// CRLF after "Hello" (the hardest case the acceptance criterion names), and once more
			// exactly on the leading '.' of the second dot-prefixed line -- so a chunk begins with a
			// literal '.' byte, the one alignment a spurious-unstuffing bug would need to fire on.
			const midLine = logicalBody.indexOf('Hello') + 3;
			const crlfIdx = logicalBody.indexOf('\r\n', logicalBody.indexOf('Hello'));
			const midCrlf = crlfIdx + 1; // splits after '\r', before '\n'
			const atLeadingDot = logicalBody.indexOf('.Leading dot content');
			const bdatResult = reconstructViaBdat(
				logicalBody,
				[midLine, midCrlf, atLeadingDot].sort((a, b) => a - b),
				1_000_000
			);

			expect(dataResult.equals(logicalBody)).toBe(true);
			expect(bdatResult.equals(logicalBody)).toBe(true);
			expect(dataResult.equals(bdatResult)).toBe(true);
		});

		it('reconstructs identical bytes across many small, arbitrary BDAT chunk boundaries', () => {
			const logicalBody = Buffer.from(
				'From: a@example.com\r\n' +
					'To: b@example.com\r\n' +
					'\r\n' +
					'line one\r\n' +
					'.\r\n' +
					'..already-doubled-looking line\r\n' +
					'.last line starts with a dot\r\n'
			);

			const dataResult = reconstructViaData(dotStuffForWire(logicalBody), 1_000_000);

			// One-byte BDAT "chunks" -- the most fragmented split possible, guaranteeing some split
			// falls between every '\r' and '\n' in the body.
			const splitPoints = Array.from({ length: logicalBody.length - 1 }, (_, i) => i + 1);
			const bdatResult = reconstructViaBdat(logicalBody, splitPoints, 1_000_000);

			expect(dataResult.equals(logicalBody)).toBe(true);
			expect(bdatResult.equals(logicalBody)).toBe(true);
			expect(dataResult.equals(bdatResult)).toBe(true);
		});
	});

	describe('buildEhloResponseLines AUTH advertisement (JR-4-05c)', () => {
		it('does not advertise AUTH when authAvailable is omitted (every pre-JR-4-05c call site)', () => {
			const lines = buildEhloResponseLines('host', 1000, { available: true, active: true });
			expect(lines.join(' ')).not.toContain('AUTH');
		});

		it('does not advertise AUTH when authAvailable is true but TLS is not yet active', () => {
			const lines = buildEhloResponseLines(
				'host',
				1000,
				{ available: true, active: false },
				true
			);
			expect(lines.join(' ')).not.toContain('AUTH');
		});

		it('does not advertise AUTH when TLS is active but authAvailable is false', () => {
			const lines = buildEhloResponseLines(
				'host',
				1000,
				{ available: true, active: true },
				false
			);
			expect(lines.join(' ')).not.toContain('AUTH');
		});

		it('advertises "AUTH PLAIN LOGIN" once TLS is active and authAvailable is true', () => {
			const lines = buildEhloResponseLines(
				'host',
				1000,
				{ available: true, active: true },
				true
			);
			expect(lines).toContain('AUTH PLAIN LOGIN');
		});
	});

	describe('parseAuthArguments (JR-4-05c)', () => {
		it('parses a bare mechanism with no initial response', () => {
			expect(parseAuthArguments('PLAIN')).toEqual({
				mechanism: 'PLAIN',
				initialResponse: null,
			});
		});

		it('parses a mechanism plus an initial response', () => {
			expect(parseAuthArguments('PLAIN AGpvaG4AcGFzcw==')).toEqual({
				mechanism: 'PLAIN',
				initialResponse: 'AGpvaG4AcGFzcw==',
			});
		});

		it('upper-cases the mechanism regardless of how the client sent it', () => {
			expect(parseAuthArguments('login')?.mechanism).toBe('LOGIN');
			expect(parseAuthArguments('Login')?.mechanism).toBe('LOGIN');
		});

		it('returns null for a bare AUTH with no mechanism at all', () => {
			expect(parseAuthArguments('')).toBeNull();
			expect(parseAuthArguments('   ')).toBeNull();
		});

		it('tolerates surrounding whitespace', () => {
			expect(parseAuthArguments('  PLAIN   AGpvaG4AcGFzcw==  ')).toEqual({
				mechanism: 'PLAIN',
				initialResponse: 'AGpvaG4AcGFzcw==',
			});
		});
	});

	describe('decodeSaslBase64 (JR-4-05c)', () => {
		it('decodes ordinary valid base64', () => {
			const decoded = decodeSaslBase64(Buffer.from('hello').toString('base64'));
			expect(decoded?.toString('utf8')).toBe('hello');
		});

		it('decodes the literal "=" token to an empty buffer (RFC 4954 empty-response marker)', () => {
			const decoded = decodeSaslBase64('=');
			expect(decoded).not.toBeNull();
			expect(decoded!.length).toBe(0);
		});

		it('returns null for a string containing characters outside the base64 alphabet', () => {
			expect(decodeSaslBase64('not valid base64!!')).toBeNull();
		});

		it('returns null for a length that is not a multiple of 4', () => {
			expect(decodeSaslBase64('QQ')).toBeNull();
		});

		it('decodes an empty string to an empty buffer', () => {
			const decoded = decodeSaslBase64('');
			expect(decoded).not.toBeNull();
			expect(decoded!.length).toBe(0);
		});
	});

	describe('decodeSaslPlain (JR-4-05c)', () => {
		function saslPlainPayload(authzid: string, authcid: string, password: string): Buffer {
			return Buffer.concat([
				Buffer.from(authzid, 'utf8'),
				Buffer.from([0]),
				Buffer.from(authcid, 'utf8'),
				Buffer.from([0]),
				Buffer.from(password, 'utf8'),
			]);
		}

		it('decodes authzid/authcid/password from a well-formed payload', () => {
			const payload = saslPlainPayload('', 'john', 'secret');
			expect(decodeSaslPlain(payload)).toEqual({
				authzid: '',
				authcid: 'john',
				password: 'secret',
			});
		});

		it('decodes a non-empty authzid too', () => {
			const payload = saslPlainPayload('admin', 'john', 'secret');
			expect(decodeSaslPlain(payload)).toEqual({
				authzid: 'admin',
				authcid: 'john',
				password: 'secret',
			});
		});

		it('returns null for a payload with fewer than three NUL-separated fields', () => {
			expect(decodeSaslPlain(Buffer.from('john\x00secret'))).toBeNull();
		});

		it('returns null for a payload with more than three NUL-separated fields', () => {
			expect(decodeSaslPlain(Buffer.from('a\x00b\x00c\x00d'))).toBeNull();
		});

		it('allows an empty password (three fields, last one empty)', () => {
			const payload = saslPlainPayload('', 'john', '');
			expect(decodeSaslPlain(payload)).toEqual({
				authzid: '',
				authcid: 'john',
				password: '',
			});
		});
	});
});
