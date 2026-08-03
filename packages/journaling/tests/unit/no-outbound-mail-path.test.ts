import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';

/**
 * `JR-4-07`, first half -- "kein ausgehender Mailpfad im Paket vorhanden", made structural rather
 * than asserted (RFC section 4.4, skill `journal-ledger` section 10: "No relaying. The ingress has
 * no outbound mail path.").
 *
 * ---------------------------------------------------------------------------------------------
 * Why a source-text scan rather than another import-graph walk
 * ---------------------------------------------------------------------------------------------
 * `ingress-import-graph.test.ts` (`JR-4-01`) already proves this process never *imports*
 * `@open-archiver/backend`. That is the wrong shape of proof for this task: an outbound mail path
 * does not need a forbidden **import** to exist -- `node:net`/`node:tls`/`node:http` are already
 * legitimately imported (`smtp-server.ts` uses `node:net`/`node:tls` to *terminate* inbound
 * connections), and the built-in global `fetch` needs no import at all. What distinguishes "this
 * process only ever accepts connections" from "this process could also open one" is not which
 * modules are reachable, but which **calls** are made against them. So this file greps the actual
 * source text of every file under `packages/journaling/src` and `apps/smtp-ingress/src` for the
 * small, fixed vocabulary of APIs that open an outbound connection, plus a couple of
 * library-shaped signatures (`nodemailer`'s `createTransport`/`sendMail`) that a hand-rolled outbound
 * path would plausibly use even without a matching low-level call in the same file.
 *
 * ---------------------------------------------------------------------------------------------
 * The legitimate exception this scan must not become blind to, and why it does not
 * ---------------------------------------------------------------------------------------------
 * This process **does** connect outbound -- to Postgres, twice over (`apps/smtp-ingress/src/index.ts`:
 * the source-ACL connection and the ledger connection, both bare `postgres()` clients, `JR-4-05a`/
 * `JR-4-06a`). That is a legitimate, necessary connection and must not make this test toothless by
 * being excluded via a special case. It already is not caught: the `postgres` npm package does its
 * own socket work *inside its own package*, under `node_modules`, which this scan never reads --
 * only `packages/journaling/src` and `apps/smtp-ingress/src` are walked. Nothing in *this
 * repository's own source* calls `net.connect`/`tls.connect`/`http(s).request`/`fetch` to reach
 * Postgres; it calls the `postgres()` factory the dependency exports. The distinction the
 * patterns below draw -- low-level socket/HTTP client primitives used directly in this repository's
 * own code -- is exactly the one that lets a real, necessary database dependency through while still
 * catching a hand-rolled outbound SMTP/HTTP client, which is what an outbound mail path would have to
 * be built from. The calibration suite below proves both halves of that claim on fixture text, not
 * merely by assertion.
 *
 * ---------------------------------------------------------------------------------------------
 * Proof that this scan is not vacuous
 * ---------------------------------------------------------------------------------------------
 * Before committing this file, every pattern below was proven to catch a real violation: a scratch
 * file (`packages/journaling/src/ingress/_tmp_outbound_probe.ts`, never committed) containing
 * `net.connect(25, 'example.com')` was added, this suite was run and observed to fail with that file
 * named in the violation list, and the scratch file was then deleted and the suite re-run green. See
 * this task's report for the exact commands and output.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/journaling/tests/unit -> repo root is four segments up.
const REPO_ROOT = path.resolve(HERE, '../../../..');

const SOURCE_ROOTS = [
	path.resolve(REPO_ROOT, 'packages/journaling/src'),
	path.resolve(REPO_ROOT, 'apps/smtp-ingress/src'),
];

interface OutboundPattern {
	readonly label: string;
	readonly pattern: RegExp;
	/** A minimal snippet that must itself match `pattern` -- keeps the fixture and the real pattern
	 * from silently drifting apart. */
	readonly violatingSample: string;
}

/**
 * The fixed vocabulary of "this call opens (or could open) an outbound connection" signatures.
 * Deliberately narrow and explicit rather than a generic "any network-shaped identifier" pattern --
 * a broad pattern would also flag `net.createServer`/`tls.createSecureContext`/`new tls.TLSSocket`,
 * all of which are this process's own legitimate inbound listener (`smtp-server.ts`), and a pattern
 * that cries wolf on the file's own normal operation stops being read.
 */
const FORBIDDEN_OUTBOUND_PATTERNS: readonly OutboundPattern[] = [
	{
		label: 'net.connect(...)',
		pattern: /\bnet\.connect\s*\(/,
		violatingSample: "const s = net.connect(25, 'mail.example.com');",
	},
	{
		label: 'net.createConnection(...)',
		pattern: /\bnet\.createConnection\s*\(/,
		violatingSample: "const s = net.createConnection(25, 'mail.example.com');",
	},
	{
		label: 'tls.connect(...)',
		pattern: /\btls\.connect\s*\(/,
		violatingSample: "const s = tls.connect(465, 'mail.example.com');",
	},
	{
		label: 'http.request(...)',
		pattern: /\bhttp\.request\s*\(/,
		violatingSample: "http.request('http://example.com/webhook');",
	},
	{
		label: 'https.request(...)',
		pattern: /\bhttps\.request\s*\(/,
		violatingSample: "https.request('https://example.com/webhook');",
	},
	{
		label: 'http.get(...)',
		pattern: /\bhttp\.get\s*\(/,
		violatingSample: "http.get('http://example.com/webhook');",
	},
	{
		label: 'https.get(...)',
		pattern: /\bhttps\.get\s*\(/,
		violatingSample: "https.get('https://example.com/webhook');",
	},
	{
		// Negative lookbehind so `.prefetch(` (a hypothetical, unrelated method name) is not mistaken
		// for a call to the global `fetch`. Deliberately still matches a bare, unqualified `fetch(`,
		// since Node's global fetch needs no import at all.
		label: 'global fetch(...)',
		pattern: /(?<![.\w])fetch\s*\(/,
		violatingSample: "await fetch('https://example.com/webhook', { method: 'POST' });",
	},
	{
		label: 'nodemailer-shaped .sendMail(...)',
		pattern: /\.sendMail\s*\(/,
		violatingSample: 'await transporter.sendMail({ to, from, subject, text });',
	},
	{
		label: 'nodemailer-shaped createTransport(...)',
		pattern: /\bcreateTransport\s*\(/,
		violatingSample: "const transporter = createTransport({ host: 'smtp.example.com' });",
	},
	{
		label: 'XMLHttpRequest',
		pattern: /\bXMLHttpRequest\b/,
		violatingSample: 'const xhr = new XMLHttpRequest();',
	},
];

/** Text that must trigger **none** of the patterns above -- the legitimate-exception half of the
 * calibration. `postgres(...)`/`net.createServer(...)`/`tls.createSecureContext(...)` are this
 * process's real, necessary outbound-to-Postgres and inbound-listener code, verbatim as it appears
 * in `apps/smtp-ingress/src/index.ts` and `packages/journaling/src/ingress/smtp-server.ts`. */
const INNOCUOUS_SAMPLE = `
const sourceAclSql = postgres(config.sourceAcl.databaseUrl, { onnotice: () => {} });
this.server = net.createServer((socket) => this.handleConnection(socket));
const secureContext = tls.createSecureContext({ cert, key });
const secureSocket = new tls.TLSSocket(socket, { isServer: true, secureContext });
`;

function scanTextForOutboundPatterns(text: string): string[] {
	const hits: string[] = [];
	for (const { label, pattern } of FORBIDDEN_OUTBOUND_PATTERNS) {
		if (pattern.test(text)) {
			hits.push(label);
		}
	}
	return hits;
}

/** Every non-test `.ts` file under `root`, recursively. `dist/` and `node_modules/` are never
 * walked -- compiled output would only ever restate what `src` already says, and third-party code is
 * out of scope by design (see this file's module doc comment on the Postgres exception). */
function listSourceFiles(root: string): string[] {
	const out: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name === 'dist') {
				continue;
			}
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
				out.push(full);
			}
		}
	}
	return out;
}

function toRepoRelative(absolute: string): string {
	return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

suite('ci', 'no outbound mail path exists in the receiver (JR-4-07)', () => {
	it('calibration: every forbidden pattern catches its own violating sample, and matches nothing else in it', () => {
		for (const { label, pattern, violatingSample } of FORBIDDEN_OUTBOUND_PATTERNS) {
			// The sample is built to match its own pattern -- if it did not, this test would prove
			// nothing about the pattern actually working.
			expect(
				pattern.test(violatingSample),
				`sample for "${label}" must match its own pattern`
			).toBe(true);
			expect(scanTextForOutboundPatterns(violatingSample)).toContain(label);
		}
	});

	it('calibration: the legitimate Postgres/inbound-listener sample trips nothing', () => {
		expect(scanTextForOutboundPatterns(INNOCUOUS_SAMPLE)).toEqual([]);
	});

	it('walks a non-trivial number of real files, including the ones this task is actually about', () => {
		const files = SOURCE_ROOTS.flatMap(listSourceFiles).map(toRepoRelative);
		// A scan that resolved zero files would make the "no violations" assertion below vacuously
		// true -- the same guard `ingress-import-graph.test.ts` uses for the same reason.
		expect(files.length).toBeGreaterThan(30);
		expect(files).toContain('packages/journaling/src/ingress/smtp-server.ts');
		expect(files).toContain('packages/journaling/src/index.ts');
		expect(files).toContain('apps/smtp-ingress/src/index.ts');
	});

	it('no file under packages/journaling/src or apps/smtp-ingress/src contains an outbound-network-capable call', () => {
		const files = SOURCE_ROOTS.flatMap(listSourceFiles);
		const violations: string[] = [];
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			for (const label of scanTextForOutboundPatterns(text)) {
				violations.push(`${toRepoRelative(file)}: ${label}`);
			}
		}
		expect(violations).toEqual([]);
	});

	// ---------------------------------------------------------------------------------------------
	// The second, independent signal: neither package.json can declare a dependency that is itself an
	// outbound mail/HTTP client, even one that never shows up as a bare net.*/tls.*/http(s).* call in
	// this repository's own source (a library wraps its own socket handling inside itself). A future
	// PR that adds one of these to either package.json fails here, at review time, rather than
	// depending on someone noticing an unused-looking import.
	// ---------------------------------------------------------------------------------------------
	const FORBIDDEN_DEPENDENCY_NAMES: readonly string[] = [
		'nodemailer',
		'emailjs',
		'smtp-client',
		'smtp-connection',
		'mailgun-js',
		'mailgun.js',
		'@sendgrid/mail',
		'sendgrid',
		'postmark',
		'@aws-sdk/client-ses',
		'@aws-sdk/client-sesv2',
		'aws-sdk',
		'node-ses',
		'mailersend',
		'sparkpost',
		'node-fetch',
		'axios',
		'got',
		'superagent',
		'needle',
		'request',
		'undici',
	];

	const PACKAGE_JSON_PATHS = [
		path.resolve(REPO_ROOT, 'packages/journaling/package.json'),
		path.resolve(REPO_ROOT, 'apps/smtp-ingress/package.json'),
	];

	it('neither package.json declares a dependency capable of sending outbound mail or generic HTTP', () => {
		for (const pkgPath of PACKAGE_JSON_PATHS) {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
			const found = declared.filter((name) => FORBIDDEN_DEPENDENCY_NAMES.includes(name));
			expect(
				found,
				`${toRepoRelative(pkgPath)} must not depend on: ${found.join(', ')}`
			).toEqual([]);
		}
	});
});
