import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	SUITES,
	collectSuiteInventory,
	globToRegExp,
	listTestLikeFiles,
	suiteInclude,
	suitesMatching,
} from '@oa-test/suite-inventory';

/**
 * Units for the suite-inventory guard (JR-1-05b).
 *
 * The guard is the thing that decides whether a *missing* suite or an *uncollected* test file makes
 * the run red. If it is wrong, it is wrong silently -- the same failure class it exists to prevent.
 * So its glob matcher and its two rules are tested against a throwaway directory tree, not against
 * the repository, which lets the "suite is absent" and "file matches no glob" states be constructed
 * on demand instead of by renaming real directories.
 *
 * Classification: `ci`. Pure filesystem work in a temp directory, no infrastructure.
 *
 * This file is also the first inhabitant of the `packages/*\/tests/unit/**` glob, which until now
 * matched nothing -- so it doubles as proof that that half of the `unit` include list works.
 */

function tree(files: string[]): string {
	const root = mkdtempSync(path.join(tmpdir(), 'oa-inventory-'));
	for (const file of files) {
		const absolute = path.join(root, file);
		mkdirSync(path.dirname(absolute), { recursive: true });
		writeFileSync(absolute, '// fixture\n');
	}
	return root;
}

/** Exactly as many unit files as the `unit` suite declares. */
function unitFiles(): string[] {
	return Array.from(
		{ length: suiteExpected('unit') },
		(_unused, index) => `packages/backend/src/unit-${index}.test.ts`
	);
}

/**
 * Exactly as many adversarial files as the `adversarial` suite declares.
 *
 * Derived rather than written out, for the same reason `unitFiles()` is: a fixture that hard-codes
 * one `.adv.test.ts` file silently assumes `expectedFiles: 1`, and then fails the day the suite
 * grows -- with a message about violation counts that says nothing about the real cause. That
 * happened when `JR-2-08`/`JR-2-09` took the suite from one file to three.
 */
function adversarialFiles(): string[] {
	return Array.from(
		{ length: suiteExpected('adversarial') },
		(_unused, index) => `packages/backend/tests/adversarial/adv-${index}.adv.test.ts`
	);
}

/** The tree the repository is expected to have: exactly the declared number of files per suite. */
function healthyTree(): string {
	const files: string[] = [...unitFiles(), ...adversarialFiles()];
	for (let index = 0; index < suiteExpected('integration'); index += 1) {
		files.push(`packages/backend/tests/integration/int-${index}.int.test.ts`);
	}
	return tree(files);
}

function suiteExpected(name: 'unit' | 'integration' | 'adversarial'): number {
	return SUITES.find((spec) => spec.name === name)!.expectedFiles;
}

suite('ci', 'suite-inventory: glob matching (JR-1-05b)', () => {
	it('matches a single segment with * and any depth with **', () => {
		const regex = globToRegExp('packages/*/tests/integration/**/*.int.test.ts');
		expect(regex.test('packages/backend/tests/integration/a.int.test.ts')).toBe(true);
		// `**/` has to match zero segments too, or a file directly in the directory is missed.
		expect(regex.test('packages/backend/tests/integration/nested/deep/a.int.test.ts')).toBe(
			true
		);
		// `*` must not cross a separator.
		expect(regex.test('packages/backend/extra/tests/integration/a.int.test.ts')).toBe(false);
		expect(regex.test('packages/backend/tests/integration/a.test.ts')).toBe(false);
	});

	it('treats dots as literals, not as regex wildcards', () => {
		const regex = globToRegExp('packages/*/tests/adversarial/**/*.adv.test.ts');
		expect(regex.test('packages/backend/tests/adversarial/x.adv.test.ts')).toBe(true);
		// Would match if `.` were left as a regex wildcard.
		expect(regex.test('packages/backend/tests/adversarial/xXadvXtestXts')).toBe(false);
	});

	it('classifies the real repository files the way the vitest projects do', () => {
		expect(suitesMatching('packages/backend/src/iam-policy/ability.test.ts')).toEqual(['unit']);
		expect(suitesMatching('packages/backend/tests/unit/suite-inventory.test.ts')).toEqual([
			'unit',
		]);
		expect(suitesMatching('packages/backend/tests/integration/pg-harness.int.test.ts')).toEqual(
			['integration']
		);
		expect(
			suitesMatching('packages/backend/tests/adversarial/mongo-to-drizzle.adv.test.ts')
		).toEqual(['adversarial']);
	});

	it('exposes the same globs the config consumes', () => {
		expect(suiteInclude('integration')).toEqual([
			'packages/*/tests/integration/**/*.int.test.ts',
		]);
		expect(() => suiteInclude('nope' as never)).toThrow(/Unknown suite/);
	});
});

suite('ci', 'suite-inventory: the two positive expectations (JR-1-05b)', () => {
	it('accepts a tree that matches every declared count exactly', () => {
		const root = healthyTree();
		try {
			const report = collectSuiteInventory(root);
			expect(report.violations).toEqual([]);
			expect(report.unclassified).toEqual([]);
			expect(report.counts.integration).toBe(suiteExpected('integration'));
			// The summary is printed on green runs too, so it has to carry the numbers.
			expect(report.summary).toContain(
				`integration: ${suiteExpected('integration')} file(s)`
			);
			expect(report.summary).toContain(`(expected ${suiteExpected('integration')})`);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('gap (a): an ABSENT integration directory is a violation, not a green run', () => {
		// This is the exact state that was green before JR-1-05b: the directory renamed away, so no
		// integration file exists, no skip notice is printed, and vitest reports success.
		const root = tree([...unitFiles(), ...adversarialFiles()]);
		try {
			const report = collectSuiteInventory(root);
			expect(report.counts.integration).toBe(0);
			// The expected count is read from SUITES rather than written out: JR-13-01 raised it
			// from 4 to 8 and a literal here turned a deliberate inventory change into an
			// unrelated red test.
			expect(report.violations.join('\n')).toContain(
				`Suite "integration" matched 0 file(s), but exactly ${suiteExpected('integration')} ` +
					`are expected`
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('F15: one file *more* than declared is a violation too, not slack', () => {
		// The finding: `minimumFiles` was a lower bound, so a suite that grew past it carried slack,
		// and a deletion the size of the slack passed unnoticed. Equality removes the slack -- at the
		// price of one number per commit that adds a test file, which is what the message asks for.
		const root = healthyTree();
		writeFileSync(
			path.join(root, 'packages/backend/tests/integration/extra.int.test.ts'),
			'// one more than declared\n'
		);
		try {
			const report = collectSuiteInventory(root);
			expect(report.counts.integration).toBe(suiteExpected('integration') + 1);
			expect(report.violations.join('\n')).toContain(
				`matched ${suiteExpected('integration') + 1} file(s), but exactly ` +
					`${suiteExpected('integration')} are expected -- more than declared`
			);
			expect(report.violations.join('\n')).toContain(
				`set expectedFiles to ${suiteExpected('integration') + 1}`
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('gap (a) variant: a renamed directory is caught twice over', () => {
		// Renaming rather than deleting leaves the files behind under a path no glob reaches, so both
		// expectations fire: the suite is empty *and* four files are collected by nobody.
		const root = tree([
			...unitFiles(),
			...adversarialFiles(),
			'packages/backend/tests/integration-renamed/a.int.test.ts',
			'packages/backend/tests/integration-renamed/b.int.test.ts',
			'packages/backend/tests/integration-renamed/c.int.test.ts',
			'packages/backend/tests/integration-renamed/d.int.test.ts',
		]);
		try {
			const report = collectSuiteInventory(root);
			expect(report.counts.integration).toBe(0);
			expect(report.unclassified).toHaveLength(4);
			expect(report.violations).toHaveLength(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('gap (b): a *.test.ts file under tests/integration/ is unclassified', () => {
		const root = healthyTree();
		writeFileSync(
			path.join(root, 'packages/backend/tests/integration/foo.test.ts'),
			'// wrong suffix\n'
		);
		try {
			const report = collectSuiteInventory(root);
			expect(report.unclassified).toEqual(['packages/backend/tests/integration/foo.test.ts']);
			expect(report.violations.join('\n')).toContain('collected by no project');
			// The offending path has to be *named*: not being able to find the file was half of the
			// original defect.
			expect(report.violations.join('\n')).toContain(
				'packages/backend/tests/integration/foo.test.ts'
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('also catches a misnamed adversarial test and a stray *.spec.ts', () => {
		const root = healthyTree();
		writeFileSync(
			path.join(root, 'packages/backend/tests/adversarial/oops.test.ts'),
			'// wrong suffix\n'
		);
		mkdirSync(path.join(root, 'packages/backend/tests/support'), { recursive: true });
		writeFileSync(
			path.join(root, 'packages/backend/tests/support/helper.spec.ts'),
			'// wrong place\n'
		);
		try {
			const report = collectSuiteInventory(root);
			expect(report.unclassified).toEqual([
				'packages/backend/tests/adversarial/oops.test.ts',
				'packages/backend/tests/support/helper.spec.ts',
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('does not mistake tsconfig.test.json or node_modules for tests', () => {
		const root = healthyTree();
		writeFileSync(path.join(root, 'packages/backend/tsconfig.test.json'), '{}\n');
		mkdirSync(path.join(root, 'node_modules/pkg'), { recursive: true });
		writeFileSync(path.join(root, 'node_modules/pkg/index.test.ts'), '// vendored\n');
		mkdirSync(path.join(root, 'packages/backend/dist'), { recursive: true });
		writeFileSync(path.join(root, 'packages/backend/dist/a.test.ts'), '// build output\n');
		try {
			const files = listTestLikeFiles(root);
			expect(files).not.toContain('packages/backend/tsconfig.test.json');
			expect(files.some((file) => file.startsWith('node_modules/'))).toBe(false);
			expect(files.some((file) => file.includes('/dist/'))).toBe(false);
			expect(collectSuiteInventory(root).violations).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('holds for the real repository as committed', () => {
		// The guard runs in globalSetup, so this assertion is redundant by construction -- and that is
		// the reason to keep it: if someone removes the globalSetup entry, this test still fails.
		const report = collectSuiteInventory();
		expect(report.violations, report.summary).toEqual([]);
		for (const spec of SUITES) {
			expect(report.counts[spec.name], `${spec.name} files`).toBe(spec.expectedFiles);
		}
	});
});
