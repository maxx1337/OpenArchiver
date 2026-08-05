import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { NodeSpoolEntryReleaser } from './spool-entry-releaser';

/**
 * `NodeSpoolEntryReleaser` (`JR-6-02b`). Classification: `ci`.
 *
 * Deliberately against the real filesystem, not a fake -- `release()`'s entire job is one `fs`
 * syscall, and a fake would just be a second copy of `unlink`'s name with nothing left to prove. The
 * behaviour worth pinning is what happens to the file (gone) and what happens when it cannot be
 * (throws, does not swallow) -- see `spool-entry-releaser.ts`'s doc comment for why swallowing here
 * would erase the reconciler's only signal that a release failed.
 */

const cleanupDirs: string[] = [];

afterEach(async () => {
	// No recursive rmdir here on purpose: each test creates its own directory and asserts the file's
	// fate directly. Leftover empty temp directories are harmless and not this suite's concern.
	cleanupDirs.length = 0;
});

async function tempSpoolFile(content = 'raw wire bytes'): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), 'oa-spool-releaser-'));
	cleanupDirs.push(dir);
	const filePath = path.join(dir, 'entry.eml');
	await writeFile(filePath, content, 'utf8');
	return filePath;
}

suite('ci', 'NodeSpoolEntryReleaser.release()', () => {
	it('deletes the file', async () => {
		const filePath = await tempSpoolFile();
		const releaser = new NodeSpoolEntryReleaser();

		await releaser.release(filePath);

		await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('does not touch any other file in the same shard directory', async () => {
		const filePath = await tempSpoolFile('the one to release');
		const sibling = path.join(path.dirname(filePath), 'sibling.eml');
		await writeFile(sibling, 'must survive', 'utf8');
		const releaser = new NodeSpoolEntryReleaser();

		await releaser.release(filePath);

		await expect(readFile(sibling, 'utf8')).resolves.toBe('must survive');
	});

	it('throws rather than swallowing when the file is already gone', async () => {
		const filePath = await tempSpoolFile();
		const releaser = new NodeSpoolEntryReleaser();
		await releaser.release(filePath);

		// A caller that ignored this would report a spool entry released when nothing happened --
		// exactly the "absence of work prints like success" shape F48/JR-4-10 already cost this
		// project twice.
		await expect(releaser.release(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
	});
});
