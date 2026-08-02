import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';

/**
 * `JR-4-01` -- "importiert kein `packages/backend/src/config/*` und kein `src/database/index.ts`",
 * **measured transitively**, not asserted.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a static walk rather than running the process and inspecting `require.cache`
 * ---------------------------------------------------------------------------------------------
 * `apps/smtp-ingress` has no vitest project of its own (the include globs cover `packages/*`, not
 * `apps/*` -- see `tests/support/suite-inventory.ts`), and per the Product Owner's instruction for
 * this task, anything testable should live in the package rather than force a glob change. A static
 * import-graph walk needs nothing from a vitest project for `apps/*`: it reads source files with
 * `node:fs` and follows `import`/`export ... from` and `require(...)` specifiers by hand, the same
 * pragmatic approach `tests/support/suite-inventory.ts` already uses for glob matching instead of
 * pulling in a dependency for it.
 *
 * This complements, and is stronger than, `ingress-process-boot.test.ts`: that test proves the
 * *compiled* process boots without crashing; this one proves *why* it cannot crash on a
 * backend-only import failure -- by showing the import is not there at the source level, for every
 * file reachable from the entry point, not just the ones a test happened to exercise.
 *
 * ---------------------------------------------------------------------------------------------
 * What the walker does and does not understand
 * ---------------------------------------------------------------------------------------------
 * It resolves: relative specifiers (`./x`, `../x`, with or without an extension, including
 * directory index files), and the two workspace packages this process may legitimately reach
 * (`@open-archiver/journaling`, `@open-archiver/types`) -- mapped to their **source** entry point
 * so the check runs against what was written, not a stale `dist`. Any other specifier (an npm
 * package, a bare Node builtin, or `@open-archiver/backend` itself) is treated as a leaf: recorded,
 * not walked into, and -- for `@open-archiver/backend` specifically -- an immediate failure, since
 * that dependency direction is forbidden regardless of which submodule is imported (ADR-002,
 * ADR-025). It does not evaluate string concatenation, dynamic `require()` targets, or re-exports
 * hidden behind indirection; the codebase's own style (small, explicit imports, no metaprogramming
 * over module paths) makes that an acceptable limit, the same trade `suite-inventory.ts` makes for
 * its hand-rolled glob matcher.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/journaling/tests/unit -> repo root is four segments up.
const REPO_ROOT = path.resolve(HERE, '../../../..');

const ENTRY_FILES = [path.resolve(REPO_ROOT, 'apps/smtp-ingress/src/index.ts')];

const IMPORT_SPECIFIER = /(?:from|require\()\s*['"]([^'"]+)['"]/g;

interface WalkResult {
	/** Every source file visited, as repo-root-relative POSIX paths. */
	readonly visited: readonly string[];
	/** Specifiers that could not be resolved at all (neither relative, workspace, nor external). */
	readonly unresolved: readonly string[];
}

function toRepoRelative(absolute: string): string {
	return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

/** Resolve a relative specifier against the importing file's directory to an existing `.ts` file. */
function resolveRelative(fromFile: string, specifier: string): string | null {
	const base = path.resolve(path.dirname(fromFile), specifier);
	const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
	for (const candidate of candidates) {
		if (candidate.endsWith('.ts') && existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

/** Map a workspace package specifier to its source entry point, so the walk needs no build. */
function resolveWorkspacePackage(specifier: string): string | null {
	if (specifier === '@open-archiver/journaling') {
		return path.resolve(REPO_ROOT, 'packages/journaling/src/index.ts');
	}
	if (specifier === '@open-archiver/types') {
		return path.resolve(REPO_ROOT, 'packages/types/src/index.ts');
	}
	return null;
}

function extractSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(IMPORT_SPECIFIER)) {
		specifiers.push(match[1]!);
	}
	return specifiers;
}

/**
 * Walk the import graph reachable from `entryFiles`. Returns every visited file plus any specifier
 * this walker could not resolve at all (which is reported as a violation by the caller, rather than
 * silently ignored -- an unresolvable import must not be able to hide a forbidden one behind it).
 */
function walkImportGraph(entryFiles: readonly string[]): WalkResult {
	const visited = new Set<string>();
	const unresolved: string[] = [];
	const queue = [...entryFiles];

	while (queue.length > 0) {
		const file = queue.shift()!;
		if (visited.has(file)) {
			continue;
		}
		if (!existsSync(file)) {
			unresolved.push(`${file} (entry file does not exist)`);
			continue;
		}
		visited.add(file);

		const source = readFileSync(file, 'utf8');
		for (const specifier of extractSpecifiers(source)) {
			if (specifier.startsWith('.')) {
				const resolved = resolveRelative(file, specifier);
				if (resolved === null) {
					unresolved.push(`${specifier} (imported from ${toRepoRelative(file)})`);
					continue;
				}
				queue.push(resolved);
				continue;
			}
			if (specifier === '@open-archiver/backend') {
				// Recorded as visited under its own name so the forbidden-import assertion below finds
				// it directly, without needing a real file to point at.
				visited.add(`FORBIDDEN::${specifier} (imported from ${toRepoRelative(file)})`);
				continue;
			}
			const workspaceEntry = resolveWorkspacePackage(specifier);
			if (workspaceEntry !== null) {
				queue.push(workspaceEntry);
				continue;
			}
			// `node:*`, Node builtins without the prefix, and third-party packages (dotenv, zod, ...):
			// external leaves, not walked into and not a violation by themselves.
		}
	}

	return { visited: [...visited], unresolved };
}

suite('ci', 'apps/smtp-ingress import graph (JR-4-01)', () => {
	it('reaches the entry point and its relative/workspace imports at all (walker sanity check)', () => {
		const { visited } = walkImportGraph(ENTRY_FILES);
		// A walker that resolved nothing would make every assertion below vacuously true. Asserting a
		// minimum, known set of files guards against that -- and against a future rename of any of
		// them silently losing coverage.
		const relative = visited.map(toRelativeIfAbsolute);
		expect(relative).toContain('apps/smtp-ingress/src/index.ts');
		expect(relative).toContain('apps/smtp-ingress/src/config-from-env.ts');
		expect(relative).toContain('packages/journaling/src/index.ts');
		expect(relative).toContain('packages/journaling/src/ingress/config.ts');
		expect(visited.length).toBeGreaterThan(10);
	});

	it('never resolves a specifier it cannot classify (no import hides behind an unresolved one)', () => {
		const { unresolved } = walkImportGraph(ENTRY_FILES);
		expect(unresolved).toEqual([]);
	});

	it('never imports @open-archiver/backend, directly or transitively', () => {
		const { visited } = walkImportGraph(ENTRY_FILES);
		const forbidden = visited.filter((entry) => entry.startsWith('FORBIDDEN::'));
		expect(forbidden).toEqual([]);
	});

	it('never resolves any file under packages/backend/ (the acceptance criterion, at its widest)', () => {
		const { visited } = walkImportGraph(ENTRY_FILES);
		const underBackend = visited
			.map(toRelativeIfAbsolute)
			.filter((entry) => entry.startsWith('packages/backend/'));
		expect(underBackend).toEqual([]);
	});

	it('specifically never resolves packages/backend/src/config/* or src/database/index.ts', () => {
		const { visited } = walkImportGraph(ENTRY_FILES);
		const relative = visited.map(toRelativeIfAbsolute);
		const configImports = relative.filter((entry) =>
			entry.startsWith('packages/backend/src/config/')
		);
		const databaseImport = relative.filter(
			(entry) => entry === 'packages/backend/src/database/index.ts'
		);
		expect(configImports).toEqual([]);
		expect(databaseImport).toEqual([]);
	});
});

function toRelativeIfAbsolute(entry: string): string {
	return path.isAbsolute(entry) ? toRepoRelative(entry) : entry;
}
