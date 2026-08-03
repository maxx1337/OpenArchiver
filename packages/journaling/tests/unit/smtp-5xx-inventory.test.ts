import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';

/**
 * `JR-4-06b` -- "kein lokaler Fehler erzeugt jemals ein `5xx`" is a universal claim (skill
 * `journal-ledger` section 1: "A `5xx` tells the sending MTA the message is permanently
 * undeliverable... Local failure => `4xx`, always."). Ten checked call sites only say something about
 * those ten; what actually backs a universal claim is an **inventory**: every place in the receive
 * path that writes a `5xx`, matched by a reasoned entry that argues the cause is the **sender's own
 * doing** (syntax, sequence, an unsupported request, a proven credential failure, a declared oversize,
 * an unconfigured recipient, a source not on the ACL) -- never our disk, our database, our network, or
 * our process.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a source scan, not a curated list of assertions against a running server
 * ---------------------------------------------------------------------------------------------
 * A suite of "send X, expect 5xx" cases (several already exist, spread across
 * `smtp-server-protocol.test.ts`, `smtp-starttls-protocol.test.ts`, `smtp-auth-protocol.test.ts`,
 * `smtp-recipient-acl-protocol.test.ts`, `smtp-source-acl-protocol.test.ts`) proves each case it
 * happens to think of, and nothing else -- exactly the gap the Product Owner's task note calls out.
 * A **future** `5xx` call site added without a corresponding, reasoned inventory entry needs to make
 * *this* test red, not merely go unnoticed until someone happens to write a case for it. The only
 * mechanism that can do that is reading the source itself, the same technique
 * `ingress-import-graph.test.ts` (`JR-4-01`) already established for a different universal claim
 * ("never imports `packages/backend`") -- a static, total scan beats a curated sample for exactly the
 * same reason there: a sample only proves what it happened to check.
 *
 * ---------------------------------------------------------------------------------------------
 * What the scan looks for, and what it deliberately does not understand
 * ---------------------------------------------------------------------------------------------
 * Every `5xx` this file's own protocol code writes goes through exactly two call shapes:
 * `this.writeResponse(<code>, '<enhanced>', ...)` and `this.rejectAuthAttempt(<code>, '<enhanced>',
 * ...)` (itself a thin wrapper that always ends in a `writeResponse` call -- see that method's own
 * doc comment), plus exactly one raw `socket.end('<code> <enhanced> ...')` literal at connect time,
 * before an `SmtpConnection` exists to call `writeResponse` at all (`EsmtpServer.handleConnection`'s
 * `554` case). The regex below matches literal numeric/string-literal arguments only -- it would not
 * understand a code assembled at runtime from a variable, which is exactly why every response code in
 * this file *is* a literal at its call site (grep confirms `rejectAuthAttempt`'s own `code`/`enhancedCode`
 * parameters are themselves always passed literals by every caller, never forwarded from further up).
 * A hypothetical future site that built a `5xx` from a variable would not be caught by this scan --
 * but it also would not match this codebase's own established style anywhere else in this file, the
 * same trade `ingress-import-graph.test.ts`'s own doc comment already accepts for its walker.
 *
 * ---------------------------------------------------------------------------------------------
 * Exact multiset equality, the same discipline `tests/support/suite-inventory.ts` already uses
 * ---------------------------------------------------------------------------------------------
 * The inventory below is not a subset check ("every entry in the source is accounted for") -- it is
 * exact, in both directions, per `(code, enhancedCode)` pair: the source's count must equal the
 * inventory's declared count. A future edit that adds *or removes* a `5xx` call site, of any existing
 * pair or a brand new one, changes the count and fails this test with the exact pair and the observed
 * vs. expected number -- the same "equality, not a lower bound" argument `suite-inventory.ts`'s own
 * doc comment makes for exactly the same reason (a lower bound is slack, and slack hides a change).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMTP_SERVER_SOURCE = path.resolve(HERE, '../../src/ingress/smtp-server.ts');
const SOURCE_ACL_CACHE_SOURCE = path.resolve(HERE, '../../src/ingress/source-acl-cache.ts');

/** One reasoned category. Every 5xx call site in the inventory below is tagged with exactly one --
 * see each constant's own comment for why that code is the sender's own doing, never a local failure. */
type SenderFaultReason =
	| 'sender-syntax'
	| 'sender-bad-sequence'
	| 'sender-protocol-precondition'
	| 'sender-unsupported-request'
	| 'sender-proven-auth-failure'
	| 'sender-declared-oversize'
	| 'sender-unknown-recipient'
	| 'sender-recipient-not-authorized'
	| 'sender-source-not-permitted';

interface InventoryEntry {
	readonly code: number;
	readonly enhanced: string;
	/** How many literal `writeResponse`/`rejectAuthAttempt` call sites use this exact pair. */
	readonly count: number;
	readonly reason: SenderFaultReason;
	/** One line, human-readable, naming the actual condition -- what a reviewer checks against the
	 * source, not just the category. */
	readonly note: string;
}

/**
 * Every `5xx` this file's protocol code can write, as of `JR-4-06b`. Adding, removing, or changing the
 * count of any call site must update this table in the same commit -- the failing assertion below
 * names the exact pair and the counts on both sides.
 */
const INVENTORY: readonly InventoryEntry[] = [
	{
		code: 500,
		enhanced: '5.5.1',
		count: 3,
		reason: 'sender-unsupported-request',
		note:
			'a command line over the RFC 5321 512-byte limit ("Line too long"); an unrecognised verb; ' +
			'AUTH attempted when this deployment has none configured (falls through to the same bucket ' +
			'as any other unrecognised verb -- EHLO never advertised it either)',
	},
	{
		code: 501,
		enhanced: '5.5.4',
		count: 5,
		reason: 'sender-syntax',
		note:
			'malformed arguments to STARTTLS (parameters given, RFC 3207 forbids them), AUTH, ' +
			'MAIL FROM, RCPT TO, and BDAT -- every one a parser returning null on the sender’s own ' +
			'malformed command line',
	},
	{
		code: 501,
		enhanced: '5.5.2',
		count: 4,
		reason: 'sender-proven-auth-failure',
		note:
			'malformed base64 or a malformed SASL-PLAIN payload (wrong field count) in an AUTH ' +
			'continuation -- the sender’s own undecodable credential exchange, RFC 4954’s own bucket ' +
			'for it',
	},
	{
		code: 501,
		enhanced: '5.7.0',
		count: 3,
		reason: 'sender-proven-auth-failure',
		note:
			'the client’s own SASL cancellation ("*") during PLAIN/LOGIN’s two continuation points -- ' +
			'the sender’s deliberate choice, not a failure on this end',
	},
	{
		code: 503,
		enhanced: '5.5.1',
		count: 7,
		reason: 'sender-bad-sequence',
		note:
			'a command issued out of the protocol’s required order: STARTTLS twice, AUTH twice, AUTH ' +
			'mid-transaction, MAIL/RCPT/DATA/BDAT each out of sequence (x4, one of which is also RFC ' +
			'3030’s "DATA after BDAT" case, which needs no separate branch)',
	},
	{
		code: 504,
		enhanced: '5.5.4',
		count: 1,
		reason: 'sender-unsupported-request',
		note: 'AUTH with a mechanism other than PLAIN/LOGIN -- RFC 4954 section 5’s own example wording',
	},
	{
		code: 530,
		enhanced: '5.7.0',
		count: 1,
		reason: 'sender-protocol-precondition',
		note:
			'skill table row: STARTTLS required but refused -- the sender attempted a command that ' +
			'requires TLS, which this deployment mandates, before ever issuing STARTTLS',
	},
	{
		code: 535,
		enhanced: '5.7.8',
		count: 1,
		reason: 'sender-proven-auth-failure',
		note:
			'a proven-wrong AUTH credential -- an unknown username and a wrong password both answer ' +
			'this exact code and wording (module doc comment, "AUTH" section, point 5: the dummy-hash ' +
			'comparison is what keeps the two indistinguishable in timing, not in fault)',
	},
	{
		code: 538,
		enhanced: '5.7.11',
		count: 1,
		reason: 'sender-protocol-precondition',
		note: 'AUTH attempted before a TLS handshake -- RFC 4954 section 4’s dedicated code for exactly this',
	},
	{
		code: 550,
		enhanced: '5.1.1',
		count: 1,
		reason: 'sender-unknown-recipient',
		note: 'skill table row: recipient not a configured journal address',
	},
	{
		code: 550,
		enhanced: '5.7.1',
		count: 1,
		reason: 'sender-recipient-not-authorized',
		note:
			'an authenticated source addressing a different source’s routing_address -- the recipient ' +
			'is real and configured (not 5.1.1), but this authenticated session’s own credentials say ' +
			'nothing about that chain (JR-4-05c)',
	},
	{
		code: 552,
		enhanced: '5.3.4',
		count: 3,
		reason: 'sender-declared-oversize',
		note:
			'skill table row: message exceeds the SIZE limit -- a MAIL FROM SIZE= parameter over the ' +
			'configured limit, and the two places completeTransfer()/finalizeAcceptance() answer an ' +
			'over-limit DATA/BDAT transfer (with or without journalAcceptance wired)',
	},
];

/** The one 5xx this file's protocol code does *not* write through `writeResponse`/`rejectAuthAttempt`:
 * `EsmtpServer.handleConnection`'s connect-time source-ACL denial, a raw `socket.end()` literal
 * because no `SmtpConnection` exists yet to call `writeResponse` on. */
const CONNECT_TIME_ENTRY: InventoryEntry = {
	code: 554,
	enhanced: '5.7.1',
	count: 1,
	reason: 'sender-source-not-permitted',
	note: 'skill table row: source IP not in any active journaling source ACL, checked before the 220 greeting',
};

interface FoundSite {
	readonly code: number;
	readonly enhanced: string;
}

/** Matches `this.writeResponse(<code>, '<enhanced>', ...)` and `this.rejectAuthAttempt(<code>,
 * '<enhanced>', ...)` regardless of whether the call is on one line or wrapped across several --
 * `\s*` already matches newlines in a JS regex without a dotAll flag, so no flag is needed for that. */
const CALL_SITE_PATTERN = /(?:writeResponse|rejectAuthAttempt)\(\s*(\d{3})\s*,\s*'([\d.]+)'/g;

function findWriteResponseSites(source: string): FoundSite[] {
	const sites: FoundSite[] = [];
	for (const match of source.matchAll(CALL_SITE_PATTERN)) {
		sites.push({ code: Number(match[1]), enhanced: match[2]! });
	}
	return sites;
}

/** `socket.end('<code> <enhanced> ...')` literals -- the one shape `findWriteResponseSites` cannot
 * see, since it is not a `writeResponse`/`rejectAuthAttempt` call at all. */
const SOCKET_END_LITERAL_PATTERN = /socket\.end\('(\d{3}) ([\d.]+) [^']*'\)/g;

function findSocketEndLiteralSites(source: string): FoundSite[] {
	const sites: FoundSite[] = [];
	for (const match of source.matchAll(SOCKET_END_LITERAL_PATTERN)) {
		sites.push({ code: Number(match[1]), enhanced: match[2]! });
	}
	return sites;
}

function fiveXxOnly(sites: readonly FoundSite[]): FoundSite[] {
	return sites.filter((site) => site.code >= 500 && site.code < 600);
}

function tally(sites: readonly FoundSite[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const site of sites) {
		const key = `${site.code} ${site.enhanced}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

suite(
	'ci',
	'every 5xx this receive path can write is inventoried and reasoned as the sender’s own fault (JR-4-06b)',
	() => {
		it('smtp-server.ts writes no 5xx outside the reasoned inventory, and none of the inventory is stale', () => {
			const source = readFileSync(SMTP_SERVER_SOURCE, 'utf8');
			const found = tally(fiveXxOnly(findWriteResponseSites(source)));

			const expected = new Map<string, number>();
			for (const entry of INVENTORY) {
				expected.set(`${entry.code} ${entry.enhanced}`, entry.count);
			}

			const foundKeys = new Set(found.keys());
			const expectedKeys = new Set(expected.keys());

			// Every pair the source actually writes must be in the inventory (an uninventoried 5xx --
			// new or an increased count -- is exactly the "no reasoning" case this test exists to
			// catch).
			for (const key of foundKeys) {
				expect(
					expectedKeys.has(key),
					`smtp-server.ts writes ${key} at ${found.get(key)} call site(s), but no inventory ` +
						`entry names it. Add a reasoned InventoryEntry (why is this the sender's fault, ` +
						`never a local failure?) to this test file.`
				).toBe(true);
			}

			// And the inventory must not claim more (or fewer) call sites than the source actually has --
			// a stale entry is exactly as misleading as a missing one.
			for (const [key, expectedCount] of expected) {
				const actualCount = found.get(key) ?? 0;
				expect(
					actualCount,
					`inventory claims ${expectedCount} call site(s) for ${key}, smtp-server.ts has ` +
						`${actualCount}. Update the InventoryEntry's count (and re-check the reasoning still ` +
						`applies to every site) in this test file.`
				).toBe(expectedCount);
			}
		});

		it('the one 5xx written before an SmtpConnection exists (source ACL denial, EsmtpServer.handleConnection) is exactly the inventoried 554 5.7.1, once', () => {
			const source = readFileSync(SMTP_SERVER_SOURCE, 'utf8');
			const found = tally(fiveXxOnly(findSocketEndLiteralSites(source)));
			expect(found.size).toBe(1);
			expect(found.get(`${CONNECT_TIME_ENTRY.code} ${CONNECT_TIME_ENTRY.enhanced}`)).toBe(
				CONNECT_TIME_ENTRY.count
			);
		});

		it('source-acl-cache.ts (the ACL implementation itself) writes no 5xx of its own -- every response code stays in smtp-server.ts', () => {
			// SourceAclCache only ever returns a typed SourceAclDecision/RecipientAclDecision/
			// AuthCredentialLookupResult (see smtp-server.ts's own port doc comments) -- it has no
			// socket, and therefore structurally cannot write a response code of any kind. Checked
			// directly rather than assumed: a future refactor moving response-writing into the ACL
			// cache would otherwise leave a second, unaudited place a 5xx could originate from.
			const source = readFileSync(SOURCE_ACL_CACHE_SOURCE, 'utf8');
			expect(findWriteResponseSites(source)).toEqual([]);
			expect(findSocketEndLiteralSites(source)).toEqual([]);
			expect(source).not.toContain('socket.write');
			expect(source).not.toContain('.end(');
		});

		it('sanity: the scan itself finds a non-trivial number of sites (a walker that matched nothing would make every assertion above vacuous)', () => {
			const source = readFileSync(SMTP_SERVER_SOURCE, 'utf8');
			const total = fiveXxOnly(findWriteResponseSites(source)).length;
			expect(total).toBeGreaterThan(20);
			expect(total).toBe(INVENTORY.reduce((sum, entry) => sum + entry.count, 0));
		});

		it('every reason category is one of the fixed sender-fault vocabulary -- never "local", "infra", or unset', () => {
			const allowed = new Set<SenderFaultReason>([
				'sender-syntax',
				'sender-bad-sequence',
				'sender-protocol-precondition',
				'sender-unsupported-request',
				'sender-proven-auth-failure',
				'sender-declared-oversize',
				'sender-unknown-recipient',
				'sender-recipient-not-authorized',
				'sender-source-not-permitted',
			]);
			for (const entry of [...INVENTORY, CONNECT_TIME_ENTRY]) {
				expect(allowed.has(entry.reason)).toBe(true);
				expect(entry.note.length).toBeGreaterThan(10);
			}
		});
	}
);
