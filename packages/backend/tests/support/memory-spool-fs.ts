import type {
	SpoolDirEntry,
	SpoolFileHandle,
	SpoolFileSystem,
	SpoolStat,
} from '@open-archiver/journaling';

/**
 * A minimal in-memory {@link SpoolFileSystem}, for integration tests whose subject is the *ledger*
 * side of `JournalAcceptance.accept()` rather than the spool side (`JR-3-04`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why not `NodeSpoolFileSystem` against a real temp directory
 * ---------------------------------------------------------------------------------------------
 * `NodeSpoolFileSystem.fsyncDirectory()` is a real POSIX operation and fails with `EPERM` on Windows
 * by design (`packages/journaling/src/spool/fs-port.ts`, `JR-3-03`). `writeDurableSpoolFile()`
 * propagates that failure rather than swallowing it, so on a Windows host `JournalAcceptance.accept()`
 * would return `'spool-write-failed'` before ever reaching the ledger -- which would make this file's
 * actual subject (a bare, non-drizzle Postgres client, `F38`) untestable from a Windows checkout. This
 * fake keeps the two concerns apart: the spool durability contract already has its own real-disk
 * coverage (`fs-port.test.ts`, `durable-write.test.ts`) and its own fault-injectable fake
 * (`FakeSpoolFileSystem`, package-local to `packages/journaling`); this one only has to let a durable
 * write "succeed" so the acceptance flow reaches `backend.append()`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why not `packages/journaling`'s own `FakeSpoolFileSystem`
 * ---------------------------------------------------------------------------------------------
 * That fake lives under `packages/journaling/tests/support/`, package-local test support rather than
 * a public export or the shared `@oa-test/*` harness -- reaching across the package boundary for it
 * would be a layering shortcut this repository does not otherwise take. This is a deliberately smaller
 * fake with no fault injection, built only against the public `SpoolFileSystem` contract exported from
 * `@open-archiver/journaling`.
 *
 * Every path is normalised to forward slashes at the boundary, the same trick
 * `packages/journaling/tests/support/fake-spool-fs.ts` documents: production code builds paths with
 * `node:path`, which joins with `\` on Windows, so without normalising once here a
 * `path.join('/spool', 'incoming')` and a literal `/spool/incoming` would be treated as different
 * directories.
 */
export class MemorySpoolFileSystem implements SpoolFileSystem {
	private readonly directories = new Set<string>();
	private readonly files = new Map<string, Buffer>();

	async mkdir(rawPath: string, options?: { recursive?: boolean }): Promise<void> {
		const path = norm(rawPath);
		if (!options?.recursive) {
			this.directories.add(path);
			return;
		}
		const rooted = path.startsWith('/');
		const segments = path.split('/').filter(Boolean);
		let built = rooted ? '' : '';
		for (const segment of segments) {
			built = `${built}/${segment}`;
			this.directories.add(built);
		}
	}

	async createFile(rawPath: string): Promise<SpoolFileHandle> {
		const path = norm(rawPath);
		if (this.files.has(path)) {
			throw Object.assign(new Error(`EEXIST: file already exists, open '${path}'`), {
				code: 'EEXIST',
			});
		}
		this.files.set(path, Buffer.alloc(0));
		this.directories.add(parentOf(path));
		const files = this.files;
		let closed = false;
		return {
			async write(chunk: Uint8Array): Promise<void> {
				if (closed) {
					throw new Error(`write() on a closed handle for '${path}'`);
				}
				const existing = files.get(path) ?? Buffer.alloc(0);
				files.set(path, Buffer.concat([existing, Buffer.from(chunk)]));
			},
			async fsync(): Promise<void> {
				// Nothing to durably flush -- this fake never touches a real disk. See the class doc
				// comment for why that is the point rather than a shortcut here.
			},
			async close(): Promise<void> {
				closed = true;
			},
		};
	}

	async fsyncDirectory(): Promise<void> {
		// Same as file fsync() above: intentionally a no-op.
	}

	async readdir(rawPath: string): Promise<SpoolDirEntry[]> {
		const path = norm(rawPath);
		if (!this.directories.has(path)) {
			throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), {
				code: 'ENOENT',
			});
		}
		const entries: SpoolDirEntry[] = [];
		const prefix = `${path}/`;
		for (const dir of this.directories) {
			if (dir.startsWith(prefix) && !dir.slice(prefix.length).includes('/')) {
				entries.push({ name: dir.slice(prefix.length), isDirectory: true });
			}
		}
		for (const file of this.files.keys()) {
			if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) {
				entries.push({ name: file.slice(prefix.length), isDirectory: false });
			}
		}
		return entries;
	}

	async stat(rawPath: string): Promise<SpoolStat> {
		const path = norm(rawPath);
		if (this.directories.has(path)) {
			return { size: 0, isDirectory: true };
		}
		const file = this.files.get(path);
		if (file) {
			return { size: file.length, isDirectory: false };
		}
		throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), {
			code: 'ENOENT',
		});
	}

	async rename(rawFrom: string, rawTo: string): Promise<void> {
		const from = norm(rawFrom);
		const to = norm(rawTo);
		const file = this.files.get(from);
		if (file === undefined) {
			throw Object.assign(new Error(`ENOENT: no such file or directory, rename '${from}'`), {
				code: 'ENOENT',
			});
		}
		this.files.delete(from);
		this.files.set(to, file);
	}

	/** Test helper: current content of a file created through this fake. */
	fileContent(path: string): Buffer | undefined {
		return this.files.get(norm(path));
	}
}

function norm(path: string): string {
	return path.replace(/\\/g, '/');
}

function parentOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}
