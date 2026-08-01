import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../../tests/support/fake-spool-fs';
import { NodeSpoolFileSystem } from './fs-port';

/**
 * The fault-injectable filesystem seam (`JR-3-03`). Classification: `ci`.
 *
 * Two things are asserted here, matching the acceptance criterion word for word:
 *
 *  1. **"The production path uses the real implementation."** `NodeSpoolFileSystem` is exercised
 *     against a real temporary directory: create-and-stream-write a file, fsync it, close it,
 *     `readdir`/`stat`/`rename`. Directory `fsync()` is asserted conditionally -- see the note below
 *     and the doc comment on `NodeSpoolFileSystem.fsyncDirectory()` in `fs-port.ts`.
 *
 *  2. **"Tests can make file-write, file-fsync and directory-fsync fail independently."** Against
 *     `FakeSpoolFileSystem`, each of the three is failed on its own and the other two are shown to
 *     keep working in the same test -- that is what "independently" means, not just that each *can*
 *     fail in isolation.
 *
 * `JR-3-06` (a later slice) is where these failures get wired to the `451` response; this file only
 * proves the seam itself, against no SMTP code at all.
 */

suite('ci', 'NodeSpoolFileSystem (production implementation)', () => {
	let dir: string;
	let fs: NodeSpoolFileSystem;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'oa-spool-fsport-'));
		fs = new NodeSpoolFileSystem();
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('creates a directory, recursively', async () => {
		const nested = path.join(dir, 'incoming', 'ab');
		await fs.mkdir(nested, { recursive: true });
		const entries = await fs.readdir(path.join(dir, 'incoming'));
		expect(entries).toEqual([{ name: 'ab', isDirectory: true }]);
	});

	it('streams writes to a new file, fsyncs it, and the bytes land on disk in order', async () => {
		const file = path.join(dir, 'msg.eml');
		const handle = await fs.createFile(file);
		await handle.write(Buffer.from('Hello, '));
		await handle.write(Buffer.from('journal.'));
		await handle.fsync();
		await handle.close();

		const content = await readFile(file, 'utf8');
		expect(content).toBe('Hello, journal.');
	});

	it('refuses to create a file that already exists (exclusive create)', async () => {
		const file = path.join(dir, 'msg.eml');
		const first = await fs.createFile(file);
		await first.close();
		await expect(fs.createFile(file)).rejects.toThrow(/EEXIST/);
	});

	it('stats a file and a directory', async () => {
		const file = path.join(dir, 'msg.eml');
		const handle = await fs.createFile(file);
		await handle.write(Buffer.from('abcde'));
		await handle.close();

		const fileStat = await fs.stat(file);
		expect(fileStat).toEqual({ size: 5, isDirectory: false });

		const dirStat = await fs.stat(dir);
		expect(dirStat.isDirectory).toBe(true);
	});

	it('renames (moves) a file', async () => {
		const from = path.join(dir, 'incoming.eml');
		const to = path.join(dir, 'quarantine.eml');
		const handle = await fs.createFile(from);
		await handle.write(Buffer.from('payload'));
		await handle.close();

		await fs.rename(from, to);

		await expect(fs.stat(from)).rejects.toThrow(/ENOENT/);
		expect((await fs.stat(to)).size).toBe(7);
	});

	it('fsyncs a directory on a platform that supports it -- and reports the known gap honestly otherwise', async () => {
		// Directory fsync is a POSIX operation. On Windows, opening a directory for fsync fails with
		// EPERM -- measured during JR-3-03, not assumed. This test states that fact instead of hiding
		// it behind a platform-conditional skip: on POSIX it asserts success, on win32 it asserts the
		// specific, known failure mode, so a change in behaviour on either platform is caught. See the
		// doc comment on NodeSpoolFileSystem.fsyncDirectory() in fs-port.ts.
		if (process.platform === 'win32') {
			await expect(fs.fsyncDirectory(dir)).rejects.toMatchObject({ code: 'EPERM' });
			return;
		}
		await expect(fs.fsyncDirectory(dir)).resolves.toBeUndefined();
	});
});

suite('ci', 'FakeSpoolFileSystem: independent fault injection (JR-3-03 acceptance)', () => {
	it('fails a write without affecting fsync or directory-fsync', async () => {
		const fake = new FakeSpoolFileSystem();
		await fake.mkdir('/spool/incoming/ab', { recursive: true });
		fake.failNextWrite('/spool/incoming/ab/msg.eml');

		const handle = await fake.createFile('/spool/incoming/ab/msg.eml');
		await expect(handle.write(Buffer.from('x'))).rejects.toMatchObject({ code: 'ENOSPC' });

		// The failure was scoped to the write. The same handle's fsync, and the directory's fsync,
		// both still work -- proving the three are independent, not "one flag fails everything".
		await expect(handle.fsync()).resolves.toBeUndefined();
		await expect(fake.fsyncDirectory('/spool/incoming/ab')).resolves.toBeUndefined();

		// And nothing was queued: the file has zero bytes, no half-write happened.
		expect(fake.fileContent('/spool/incoming/ab/msg.eml')?.length).toBe(0);
	});

	it('fails a file fsync without affecting write or directory-fsync', async () => {
		const fake = new FakeSpoolFileSystem();
		await fake.mkdir('/spool/incoming/cd', { recursive: true });
		const handle = await fake.createFile('/spool/incoming/cd/msg.eml');
		await handle.write(Buffer.from('payload'));

		fake.failNextFileFsync('/spool/incoming/cd/msg.eml');
		await expect(handle.fsync()).rejects.toMatchObject({ code: 'EIO' });

		// The write that already happened is unaffected -- the bytes are there, just not yet durable.
		expect(fake.fileContent('/spool/incoming/cd/msg.eml')?.toString()).toBe('payload');
		await expect(fake.fsyncDirectory('/spool/incoming/cd')).resolves.toBeUndefined();

		// A retried fsync (the one-shot failure having fired) succeeds, as a real retry-after-451 would.
		await expect(handle.fsync()).resolves.toBeUndefined();
	});

	it('fails a directory fsync without affecting write or file fsync -- the case that is easy to forget', async () => {
		const fake = new FakeSpoolFileSystem();
		await fake.mkdir('/spool/incoming/ef', { recursive: true });
		const handle = await fake.createFile('/spool/incoming/ef/msg.eml');
		await handle.write(Buffer.from('payload'));
		await expect(handle.fsync()).resolves.toBeUndefined();

		fake.failNextDirectoryFsync('/spool/incoming/ef');
		await expect(fake.fsyncDirectory('/spool/incoming/ef')).rejects.toMatchObject({
			code: 'EIO',
		});

		// The file itself is fully written and file-synced; only the directory entry's durability is
		// in question, which is exactly the gap the skill's "both, never one" rule exists to close.
		expect(fake.fileContent('/spool/incoming/ef/msg.eml')?.toString()).toBe('payload');
	});

	it('the un-failed path succeeds end to end, so the fake is not just a failure machine', async () => {
		const fake = new FakeSpoolFileSystem();
		await fake.mkdir('/spool/incoming/00', { recursive: true });
		const handle = await fake.createFile('/spool/incoming/00/msg.eml');
		await handle.write(Buffer.from('a'));
		await handle.write(Buffer.from('b'));
		await handle.fsync();
		await handle.close();
		await fake.fsyncDirectory('/spool/incoming/00');

		expect(fake.fileContent('/spool/incoming/00/msg.eml')?.toString()).toBe('ab');
		expect(fake.writeLog).toEqual(['/spool/incoming/00/msg.eml', '/spool/incoming/00/msg.eml']);
		expect(fake.fileFsyncLog).toEqual(['/spool/incoming/00/msg.eml']);
		expect(fake.directoryFsyncLog).toEqual(['/spool/incoming/00']);
	});

	it('createFile() can itself be failed independently of write and fsync', async () => {
		const fake = new FakeSpoolFileSystem();
		await fake.mkdir('/spool/incoming/gh', { recursive: true });
		fake.failNextCreateFile('/spool/incoming/gh/msg.eml');

		await expect(fake.createFile('/spool/incoming/gh/msg.eml')).rejects.toThrow();
		expect(fake.hasFile('/spool/incoming/gh/msg.eml')).toBe(false);

		// The one-shot has fired; a retry succeeds.
		const handle = await fake.createFile('/spool/incoming/gh/msg.eml');
		await handle.close();
		expect(fake.hasFile('/spool/incoming/gh/msg.eml')).toBe(true);
	});
});
