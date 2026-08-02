import type {
	SpoolDirEntry,
	SpoolFileHandle,
	SpoolFileSystem,
	SpoolStat,
} from '../../src/spool/fs-port';

/**
 * An in-memory, fault-injectable {@link SpoolFileSystem} (`JR-3-03`).
 *
 * This is the fake the acceptance criterion asks for: tests can make file-write, file-fsync and
 * directory-fsync fail **independently**. Each of the three has its own one-shot trigger, keyed by
 * path — `failNextWrite(path)`, `failNextFileFsync(path)`, `failNextDirectoryFsync(path)` — so a
 * test can fail exactly one of the three without the other two being affected, and can then assert
 * that the state afterwards is clean (nothing partially written, no entry left behind).
 *
 * No real filesystem is touched. That keeps the later fault-injection suite (`JR-3-06`) fast and
 * free of platform quirks — notably the directory-`fsync()` gap on Windows documented in
 * `fs-port.ts`, which would otherwise make "directory fsync fails" indistinguishable from "this host
 * cannot do that at all".
 *
 * Every path argument is normalised to forward slashes on entry (`norm()`) and used in that form as
 * the map key from then on. Callers build paths with `node:path`, which joins with `\` on Windows;
 * tests in this package also pass POSIX-style literals like `/spool/incoming` directly. Without
 * normalising once at the boundary, `path.join('/spool', 'incoming')` (`\spool\incoming` on Windows)
 * and the literal `/spool/incoming` used in a test would be treated as two different directories —
 * found the hard way while writing `layout.test.ts` against this fake on a Windows host.
 */
export class FakeSpoolFileSystem implements SpoolFileSystem {
	/** Directory path -> Map<entry name, isDirectory>. Keys are always `norm()`-ed. */
	private readonly directories = new Map<string, Map<string, boolean>>();
	/** File path -> accumulated bytes. Only for files created through `createFile()`. */
	private readonly files = new Map<string, Buffer>();

	private readonly pendingMkdirFailures = new Map<string, Error>();
	private readonly pendingCreateFailures = new Map<string, Error>();
	private readonly pendingWriteFailures = new Map<string, Error>();
	private readonly pendingFileFsyncFailures = new Map<string, Error>();
	private readonly pendingDirectoryFsyncFailures = new Map<string, Error>();

	/** Every `write()` call across every handle, in call order (one entry per chunk). */
	readonly writeLog: string[] = [];
	/** Every file `fsync()` call, in call order. */
	readonly fileFsyncLog: string[] = [];
	/** Every `fsyncDirectory()` call, in call order. */
	readonly directoryFsyncLog: string[] = [];

	private ensureDir(path: string): Map<string, boolean> {
		let dir = this.directories.get(path);
		if (!dir) {
			dir = new Map();
			this.directories.set(path, dir);
		}
		return dir;
	}

	private static enoent(syscall: string, path: string): Error {
		return Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${path}'`), {
			code: 'ENOENT',
		});
	}

	/**
	 * Make the very next `mkdir(path, ...)` reject with `error`. One-shot.
	 *
	 * Added for `JR-3-06` (`tests/adversarial/spool-fsync-fault-injection.adv.test.ts`): the PO
	 * decision recorded in `docs/dev/journaling/02-architektur.md` section 3 requires the `'write'`
	 * stage's fault-injection matrix to cover a failing shard `mkdir()`, not only `createFile()` and
	 * `write()` -- `ensureIncomingShardDir()` (`../../src/spool/layout.ts`) calls `fs.mkdir()` before
	 * `writeDurableSpoolFile()` ever calls `createFile()`, so without this the 'write' stage's first
	 * sub-operation had no way to fail at all.
	 */
	failNextMkdir(
		path: string,
		error: Error = Object.assign(new Error(`EIO: i/o error, mkdir '${path}'`), { code: 'EIO' })
	): void {
		this.pendingMkdirFailures.set(norm(path), error);
	}

	async mkdir(rawPath: string, options?: { recursive?: boolean }): Promise<void> {
		const path = norm(rawPath);
		const mkdirFailure = this.pendingMkdirFailures.get(path);
		if (mkdirFailure) {
			this.pendingMkdirFailures.delete(path);
			throw mkdirFailure;
		}
		if (!options?.recursive && this.directories.has(path)) {
			throw Object.assign(new Error(`EEXIST: file already exists, mkdir '${path}'`), {
				code: 'EEXIST',
			});
		}
		if (options?.recursive) {
			// Materialise every ancestor, the same way `fs.mkdir(..., { recursive: true })` does, so a
			// later `readdir()` on a parent sees the shard directory as an entry.
			const rooted = path.startsWith('/');
			const segments = path.split('/').filter(Boolean);
			let built = rooted ? '/' : '';
			for (const segment of segments) {
				const child =
					built === '' || built === '/' ? built + segment : `${built}/${segment}`;
				this.ensureDir(child);
				if (built !== '') {
					this.ensureDir(built).set(segment, true);
				}
				built = child;
			}
			return;
		}
		this.ensureDir(path);
	}

	/** Make the very next `createFile(path)` reject with `error`. One-shot. */
	failNextCreateFile(
		path: string,
		error: Error = new Error('injected createFile failure')
	): void {
		this.pendingCreateFailures.set(norm(path), error);
	}

	/** Make the very next `write()` on `path`'s handle reject with `error`. One-shot. */
	failNextWrite(
		path: string,
		error: Error = Object.assign(
			new Error(`ENOSPC: no space left on device, write '${path}'`),
			{
				code: 'ENOSPC',
			}
		)
	): void {
		this.pendingWriteFailures.set(norm(path), error);
	}

	/** Make the very next file `fsync()` on `path`'s handle reject with `error`. One-shot. */
	failNextFileFsync(
		path: string,
		error: Error = Object.assign(new Error(`EIO: i/o error, fsync '${path}'`), { code: 'EIO' })
	): void {
		this.pendingFileFsyncFailures.set(norm(path), error);
	}

	/** Make the very next `fsyncDirectory(path)` call reject with `error`. One-shot. */
	failNextDirectoryFsync(
		path: string,
		error: Error = Object.assign(new Error(`EIO: i/o error, fsync '${path}'`), { code: 'EIO' })
	): void {
		this.pendingDirectoryFsyncFailures.set(norm(path), error);
	}

	async createFile(rawPath: string): Promise<SpoolFileHandle> {
		const path = norm(rawPath);
		const createFailure = this.pendingCreateFailures.get(path);
		if (createFailure) {
			this.pendingCreateFailures.delete(path);
			throw createFailure;
		}
		if (this.files.has(path)) {
			throw Object.assign(new Error(`EEXIST: file already exists, open '${path}'`), {
				code: 'EEXIST',
			});
		}
		this.files.set(path, Buffer.alloc(0));
		const dirPath = parentOf(path);
		this.ensureDir(dirPath).set(baseNameOf(path), false);

		const fake = this;
		let closed = false;

		return {
			async write(chunk: Uint8Array): Promise<void> {
				if (closed) {
					throw new Error(`write() on a closed handle for '${path}'`);
				}
				fake.writeLog.push(path);
				const failure = fake.pendingWriteFailures.get(path);
				if (failure) {
					fake.pendingWriteFailures.delete(path);
					throw failure;
				}
				const existing = fake.files.get(path) ?? Buffer.alloc(0);
				fake.files.set(path, Buffer.concat([existing, Buffer.from(chunk)]));
			},
			async fsync(): Promise<void> {
				if (closed) {
					throw new Error(`fsync() on a closed handle for '${path}'`);
				}
				fake.fileFsyncLog.push(path);
				const failure = fake.pendingFileFsyncFailures.get(path);
				if (failure) {
					fake.pendingFileFsyncFailures.delete(path);
					throw failure;
				}
			},
			async close(): Promise<void> {
				closed = true;
			},
		};
	}

	async fsyncDirectory(rawPath: string): Promise<void> {
		const path = norm(rawPath);
		this.directoryFsyncLog.push(path);
		const failure = this.pendingDirectoryFsyncFailures.get(path);
		if (failure) {
			this.pendingDirectoryFsyncFailures.delete(path);
			throw failure;
		}
		if (!this.directories.has(path)) {
			throw FakeSpoolFileSystem.enoent('open', path);
		}
	}

	async readdir(rawPath: string): Promise<SpoolDirEntry[]> {
		const path = norm(rawPath);
		const dir = this.directories.get(path);
		if (!dir) {
			throw FakeSpoolFileSystem.enoent('scandir', path);
		}
		return [...dir.entries()].map(([name, isDirectory]) => ({ name, isDirectory }));
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
		throw FakeSpoolFileSystem.enoent('stat', path);
	}

	async rename(rawFrom: string, rawTo: string): Promise<void> {
		const from = norm(rawFrom);
		const to = norm(rawTo);
		const file = this.files.get(from);
		if (file === undefined) {
			throw FakeSpoolFileSystem.enoent('rename', from);
		}
		this.files.delete(from);
		this.files.set(to, file);
		this.ensureDir(parentOf(from)).delete(baseNameOf(from));
		this.ensureDir(parentOf(to)).set(baseNameOf(to), false);
	}

	/** Test helper: does a file exist at this exact path right now? */
	hasFile(path: string): boolean {
		return this.files.has(norm(path));
	}

	/** Test helper: current content of a file created through this fake. */
	fileContent(path: string): Buffer | undefined {
		return this.files.get(norm(path));
	}
}

/** Canonicalise a path to forward slashes. See the class doc comment for why this runs at every boundary. */
function norm(path: string): string {
	return path.replace(/\\/g, '/');
}

function parentOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}

function baseNameOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? path : path.slice(index + 1);
}
