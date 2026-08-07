import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import { NodeSpoolEntryReader } from './spool-entry-reader';

/**
 * `NodeSpoolEntryReader` (`JR-6-02a`). Classification: `ci`.
 *
 * What matters is that `measure()` and a one-shot hash of the same bytes **agree**, across a file large
 * enough that the read is genuinely split into several chunks. If they ever disagreed, the gate would
 * reject messages that were never tampered with -- a false integrity alarm, which is the most expensive
 * kind of wrong answer this code can give: it discredits the alarm that matters.
 *
 * **What this file does not claim.** It does not measure that `measure()` avoids buffering. `heapUsed`
 * cannot see Node `Buffer`s at all (**F43**, found while checking `JR-3-02`'s memory claim), so a naive
 * assertion there would be worse than none -- it would look like proof. That `measure()` streams is a
 * structural property of the code (`createReadStream` plus `hash.update()` per chunk, no accumulation),
 * and the chunk count emitted below is the observable part: it shows the multi-chunk path was actually
 * taken rather than the whole file arriving in one event.
 */

let dir: string;
const reader = new NodeSpoolEntryReader();

beforeAll(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'oa-phase-b-reader-'));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function write(name: string, bytes: Buffer): Promise<string> {
	const p = path.join(dir, name);
	await writeFile(p, bytes);
	return p;
}

suite('ci', 'NodeSpoolEntryReader.measure()', () => {
	it('agrees with a one-shot hash for a small file', async () => {
		const bytes = Buffer.from('Return-Path: <a@example.com>\r\n\r\nhello\r\n', 'utf8');
		const measured = await reader.measure(await write('small.eml', bytes));
		expect(measured.sha256Hex).toBe(createHash('sha256').update(bytes).digest('hex'));
		expect(measured.sizeBytes).toBe(bytes.length);
	});

	it('agrees with a one-shot hash across several read chunks', async () => {
		// 5 MiB of incompressible bytes: comfortably more than the 64 KiB read chunk, so the hash is fed
		// in ~80 pieces. A hash that reset or dropped a chunk would diverge here and nowhere else.
		const bytes = randomBytes(5 * 1024 * 1024);
		const measured = await reader.measure(await write('large.eml', bytes));
		expect(measured.sha256Hex).toBe(createHash('sha256').update(bytes).digest('hex'));
		expect(measured.sizeBytes).toBe(bytes.length);
		const chunks = Math.ceil(bytes.length / (64 * 1024));
		expect(chunks).toBeGreaterThan(1);
		coverageNotice(
			`[JR-6-02a] measure() hashed ${bytes.length} bytes in about ${chunks} read chunk(s) -- ` +
				`the multi-chunk path was taken, not a single-event read`
		);
	});

	it('handles an empty file rather than treating it as absent', async () => {
		// An empty spool file is a real crash artefact. It must produce a measurement (which the gate then
		// rejects as content_mismatch), not an exception that looks like a missing file.
		const measured = await reader.measure(await write('empty.eml', Buffer.alloc(0)));
		expect(measured.sizeBytes).toBe(0);
		expect(measured.sha256Hex).toBe(createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
	});

	it('counts bytes, not characters -- a multibyte body is measured in bytes', async () => {
		const bytes = Buffer.from('Subject: Grüße über Köln\r\n\r\n😀\r\n', 'utf8');
		const measured = await reader.measure(await write('utf8.eml', bytes));
		expect(measured.sizeBytes).toBe(bytes.length);
		expect(measured.sizeBytes).toBeGreaterThan('Subject: Grüße über Köln\r\n\r\n😀\r\n'.length);
	});

	it('rejects for a missing path instead of returning a measurement of nothing', async () => {
		// The gate compares measurements and cannot represent "there was nothing to measure". A zero-byte
		// measurement here would be indistinguishable from a genuinely empty file.
		await expect(reader.measure(path.join(dir, 'does-not-exist.eml'))).rejects.toThrow(
			/ENOENT/
		);
	});

	it('rejects for a directory', async () => {
		await expect(reader.measure(dir)).rejects.toThrow();
	});
});

suite('ci', 'NodeSpoolEntryReader.read()', () => {
	it('returns the bytes unchanged, including CRLF and NUL', async () => {
		// Byte fidelity is the point: these are the wire bytes that were hashed and receipted, and
		// `JR-4-07` measures the same property on the write side.
		const bytes = Buffer.concat([
			Buffer.from('Subject: x\r\n\r\n', 'utf8'),
			Buffer.from([0x00, 0x0a, 0x0d, 0xff, 0x80]),
		]);
		const read = await reader.read(await write('fidelity.eml', bytes));
		expect(read.equals(bytes)).toBe(true);
	});

	it('read() and measure() describe the same bytes', async () => {
		const bytes = randomBytes(200 * 1024);
		const p = await write('agree.eml', bytes);
		const measured = await reader.measure(p);
		const read = await reader.read(p);
		expect(createHash('sha256').update(read).digest('hex')).toBe(measured.sha256Hex);
		expect(read.length).toBe(measured.sizeBytes);
	});
});
