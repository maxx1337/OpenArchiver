import { z } from 'zod';
import { parseCidr, type ParsedCidr } from './cidr';

/**
 * Microsoft 365 outbound IP range refresh helper -- the *diff* half (`JR-4-09`, RFC section 4.3:
 * "Ship a helper that refreshes the Microsoft 365 outbound IP ranges from the official endpoint
 * list, with the ranges pinned in config and the refresh producing a diff for operator approval
 * rather than auto-applying. A silently widened ACL is a security regression.").
 *
 * ---------------------------------------------------------------------------------------------
 * Nothing in this module can change anything, and that is the point
 * ---------------------------------------------------------------------------------------------
 * These are pure functions over two lists of CIDR strings. There is no database access, no HTTP
 * client, and no writer of any kind. Reading the official list (from a file or stdin) and reading
 * `journaling_sources.allowed_ips` both happen in `apps/smtp-ingress`'s own
 * `refresh-m365-ranges.ts` entry point, which likewise only ever *reads* (see its doc comment; the
 * process's database role has `SELECT` and nothing else per ADR-002's privilege-separation table).
 * The security criterion of `JR-4-09` -- "a silently widened ACL is a security regression" -- is
 * therefore satisfied structurally rather than by discipline: there is no code path from this
 * helper to the ACL.
 *
 * **Nothing in this repository downloads the list**, either: that is a documented operator step
 * (`curl`, see {@link M365_ENDPOINTS_BASE_URL}), decided by the Product Owner on 2026-08-03 so that
 * `JR-4-07`'s "the receiver never opens an outbound connection" guard stays untouched and the
 * mail-receiving host needs no outbound internet access. The reasoning is in
 * `refresh-m365-ranges.ts`'s doc comment.
 *
 * ---------------------------------------------------------------------------------------------
 * Why only the SMTP entries, not every Exchange range
 * ---------------------------------------------------------------------------------------------
 * The endpoint web service returns *all* Microsoft 365 endpoints, including the Outlook web,
 * autodiscover, and EWS front ends. Copying every `serviceArea: "Exchange"` range into the source
 * ACL would widen it by an order of magnitude for no reason -- this ACL only ever needs to admit
 * the hosts that establish *outbound SMTP* connections to us (a journaling rule's delivery path).
 * So {@link parseM365SmtpRanges} keeps an entry only when it is an Exchange entry **and** its
 * `tcpPorts` list actually contains port 25. That is the whole widening-avoidance argument, and it
 * lives in the parser rather than in the operator's head.
 *
 * ---------------------------------------------------------------------------------------------
 * The diff compares *networks*, not strings, and it is deliberately asymmetric
 * ---------------------------------------------------------------------------------------------
 * `2a01:111:f403::/48` and `2a01:0111:f403:0000::/48` are the same network written two ways, and a
 * text diff would report both as a change. So every entry on both sides goes through
 * {@link parseCidr} (the same parser the live source ACL uses -- see `cidr.ts`'s own doc comment on
 * why there is exactly one address parser in this package) and is compared bit-wise.
 *
 * The two directions are then treated *differently*, on purpose:
 *
 *  - An official range not covered by the ACL is reported as **missing** -- something the operator
 *    probably has to add, or mail from those hosts will be refused with `554 5.7.1`.
 *  - An ACL entry that is not in the official list is reported as **unmatched**, never as "remove
 *    this". An operator legitimately has entries this helper cannot know about: an on-premises
 *    connector, a test relay, a regional smart host. Recommending deletion would turn a helper into
 *    a footgun pointed at a working deployment, and the RFC's concern is the *widening* direction.
 *    Where such an entry is a subnet of an official range, that is stated (`containedIn`), because
 *    "narrower than the official range" is the one case where an operator can act with confidence.
 *
 * **A named limitation, not an oversight:** coverage is checked against *single* official and ACL
 * entries. If an operator splits `40.107.0.0/16` into two `/17`s, their union covers the official
 * range but neither half does, and this helper reports the official range as missing. That is an
 * over-report: it costs the operator one look, and it can never cause a silent widening -- which is
 * the direction RFC section 4.3 cares about. Computing true set coverage would mean interval
 * arithmetic over two address families; it is not worth that for a helper whose entire output is a
 * suggestion.
 */

/** The official Microsoft 365 endpoint web service. `clientRequestId` must be a caller-generated
 * GUID -- Microsoft's service rejects the request without one. **Not fetched anywhere in this
 * repository** (see the module doc comment): this constant is what the helper prints in its usage
 * text and what the operator documentation quotes, so the URL an operator is told to `curl` and the
 * URL this project means by "the official list" cannot drift apart. */
export const M365_ENDPOINTS_BASE_URL = 'https://endpoints.office.com/endpoints/worldwide';

/** The `serviceArea` value that carries Exchange Online's endpoints. */
const EXCHANGE_SERVICE_AREA = 'exchange';

/** The port an Exchange Online journaling rule actually connects to us on. */
const SMTP_PORT = 25;

/**
 * The subset of the endpoint web service's schema this helper reads. Deliberately permissive:
 * every field is optional and unknown fields are dropped (zod's default for `z.object`), because
 * Microsoft adds fields to this feed without notice and a strict schema would turn an unrelated
 * addition into a hard failure of an operator's routine check. What this helper *needs* is
 * validated where it is used, not by rejecting the whole document.
 */
const endpointEntrySchema = z.object({
	id: z.number().optional(),
	serviceArea: z.string().optional(),
	tcpPorts: z.string().optional(),
	ips: z.array(z.string()).optional(),
});

const endpointListSchema = z.array(endpointEntrySchema);

export interface M365SmtpRangeSet {
	/** The CIDR literals of every Exchange entry that speaks port 25, in feed order, deduplicated
	 * by exact literal (bit-wise deduplication is the diff's job, not the parser's). */
	readonly ranges: string[];
	/** `id`s of the entries that contributed, so an operator can look them up in the feed. */
	readonly matchedEntryIds: number[];
	/** How many entries the feed contained in total -- the denominator that makes
	 * `matchedEntryIds.length` interpretable ("2 of 78", not just "2"). */
	readonly entriesInFeed: number;
}

/** Thrown when the payload is not the endpoint web service's documented shape at all. A caller
 * must treat this as "the feed could not be read", never as "the feed is empty" -- an empty range
 * list would make every official range look absent and the whole ACL look obsolete. */
export class M365EndpointFeedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'M365EndpointFeedError';
	}
}

/** Does `tcpPorts` (e.g. `"80,443"`, `"25"`, `"50000-50059"`) include `port`? */
function tcpPortsInclude(tcpPorts: string, port: number): boolean {
	for (const token of tcpPorts.split(',')) {
		const trimmed = token.trim();
		if (trimmed === '') continue;
		const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
		if (range) {
			const from = Number(range[1]);
			const to = Number(range[2]);
			if (port >= Math.min(from, to) && port <= Math.max(from, to)) return true;
			continue;
		}
		if (/^\d+$/.test(trimmed) && Number(trimmed) === port) return true;
	}
	return false;
}

/**
 * Extract the Exchange-Online-over-SMTP IP ranges from a parsed endpoint web service response.
 * See the module doc comment for why the port-25 filter is the security-relevant part.
 *
 * Throws {@link M365EndpointFeedError} when `payload` is not a list of endpoint entries. An
 * otherwise valid feed with no matching entry returns an empty `ranges` -- a different situation
 * (Microsoft restructured the feed) that the caller must also not silently read as "remove
 * everything"; `formatM365RangeDiff` says so in its output.
 */
export function parseM365SmtpRanges(payload: unknown): M365SmtpRangeSet {
	const parsed = endpointListSchema.safeParse(payload);
	if (!parsed.success) {
		throw new M365EndpointFeedError(
			`the Microsoft 365 endpoint feed is not a list of endpoint entries: ${parsed.error.message}`
		);
	}

	const ranges: string[] = [];
	const seen = new Set<string>();
	const matchedEntryIds: number[] = [];
	for (const entry of parsed.data) {
		if ((entry.serviceArea ?? '').toLowerCase() !== EXCHANGE_SERVICE_AREA) continue;
		if (entry.tcpPorts === undefined || !tcpPortsInclude(entry.tcpPorts, SMTP_PORT)) continue;
		if (entry.ips === undefined || entry.ips.length === 0) continue;
		if (entry.id !== undefined) matchedEntryIds.push(entry.id);
		for (const ip of entry.ips) {
			if (seen.has(ip)) continue;
			seen.add(ip);
			ranges.push(ip);
		}
	}
	return { ranges, matchedEntryIds, entriesInFeed: parsed.data.length };
}

/** An entry that could not be parsed, with the reason, so it can be reported instead of ignored. */
export interface InvalidRange {
	readonly value: string;
	readonly reason: string;
}

/** An ACL entry the official list does not contain. */
export interface UnmatchedConfiguredRange {
	readonly value: string;
	/** The official range this entry is a subnet of, or `null` when it is unrelated to all of them.
	 * See the module doc comment for why this distinction is reported instead of a delete
	 * recommendation. */
	readonly containedIn: string | null;
}

export interface M365RangeDiff {
	/** Official ranges no single ACL entry covers -- the "probably add these" list. */
	readonly missing: string[];
	/** Official ranges already covered by the ACL. */
	readonly covered: string[];
	/** ACL entries the official list does not account for. Never a removal recommendation. */
	readonly unmatched: UnmatchedConfiguredRange[];
	readonly invalidConfigured: InvalidRange[];
	readonly invalidOfficial: InvalidRange[];
	/** `true` when the ACL needs no addition -- every official range is covered. Deliberately not
	 * "the two lists are equal": `unmatched` entries are not a reason to act. */
	readonly upToDate: boolean;
}

/** Mask `bytes` to `prefixLength` significant bits, so two literals for the same network compare
 * equal. `ParsedCidr.networkBytes` is explicitly *not* masked (see its doc comment). */
function maskedBits(cidr: ParsedCidr): Uint8Array {
	const masked = new Uint8Array(cidr.networkBytes);
	const fullBytes = cidr.prefixLength >> 3;
	const remainingBits = cidr.prefixLength & 7;
	if (remainingBits !== 0) {
		masked[fullBytes] = (masked[fullBytes] ?? 0) & (0xff << (8 - remainingBits));
	}
	for (let i = fullBytes + (remainingBits === 0 ? 0 : 1); i < masked.length; i++) {
		masked[i] = 0;
	}
	return masked;
}

/** Is every address of `inner` also in `outer`? Same family, `outer` no narrower, and the leading
 * `outer.prefixLength` bits identical. */
function cidrContains(outer: ParsedCidr, inner: ParsedCidr): boolean {
	if (outer.family !== inner.family) return false;
	if (outer.prefixLength > inner.prefixLength) return false;
	const a = maskedBits(outer);
	const b = maskedBits({ ...inner, prefixLength: outer.prefixLength });
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function parseAll(values: readonly string[]): {
	valid: { value: string; cidr: ParsedCidr }[];
	invalid: InvalidRange[];
} {
	const valid: { value: string; cidr: ParsedCidr }[] = [];
	const invalid: InvalidRange[] = [];
	for (const value of values) {
		try {
			valid.push({ value, cidr: parseCidr(value) });
		} catch (err) {
			invalid.push({ value, reason: err instanceof Error ? err.message : String(err) });
		}
	}
	return { valid, invalid };
}

/**
 * Compare an ACL against the official list. Pure; see the module doc comment for the asymmetry
 * between the two directions and for the named single-entry-coverage limitation.
 */
export function diffM365Ranges(input: {
	readonly configured: readonly string[];
	readonly official: readonly string[];
}): M365RangeDiff {
	const configured = parseAll(input.configured);
	const official = parseAll(input.official);

	const missing: string[] = [];
	const covered: string[] = [];
	for (const entry of official.valid) {
		const isCovered = configured.valid.some((c) => cidrContains(c.cidr, entry.cidr));
		(isCovered ? covered : missing).push(entry.value);
	}

	const unmatched: UnmatchedConfiguredRange[] = [];
	for (const entry of configured.valid) {
		// Exactly-equal counts as matched: mutual containment is equality for CIDRs.
		const identical = official.valid.some(
			(o) => cidrContains(o.cidr, entry.cidr) && cidrContains(entry.cidr, o.cidr)
		);
		if (identical) continue;
		const container = official.valid.find((o) => cidrContains(o.cidr, entry.cidr));
		unmatched.push({ value: entry.value, containedIn: container?.value ?? null });
	}

	return {
		missing,
		covered,
		unmatched,
		invalidConfigured: configured.invalid,
		invalidOfficial: official.invalid,
		upToDate: missing.length === 0 && official.invalid.length === 0,
	};
}

/**
 * Render a diff for an operator. Plain text on purpose: this is read in a terminal or pasted into a
 * change ticket, and it has to state what the helper did **not** do as prominently as what it
 * found -- an operator who mistakes this output for an applied change is exactly the failure RFC
 * section 4.3 warns about.
 */
export function formatM365RangeDiff(
	diff: M365RangeDiff,
	context: {
		readonly sourceLabel: string;
		readonly feed?: Pick<M365SmtpRangeSet, 'matchedEntryIds' | 'entriesInFeed'>;
	}
): string {
	const lines: string[] = [];
	lines.push(`journaling source: ${context.sourceLabel}`);
	if (context.feed) {
		lines.push(
			`official feed: ${context.feed.matchedEntryIds.length} Exchange/port-25 entr` +
				`${context.feed.matchedEntryIds.length === 1 ? 'y' : 'ies'} ` +
				`(id ${context.feed.matchedEntryIds.join(', ') || 'none'}) of ${context.feed.entriesInFeed} in the feed`
		);
	}

	if (diff.missing.length === 0) {
		lines.push('missing from allowed_ips: none -- every official range is already covered');
	} else {
		lines.push(`missing from allowed_ips (${diff.missing.length}) -- mail from these would be`);
		lines.push('refused with 554 5.7.1:');
		for (const range of diff.missing) lines.push(`  + ${range}`);
	}

	if (diff.unmatched.length > 0) {
		lines.push(
			`in allowed_ips but not in the official list (${diff.unmatched.length}) -- NOT a removal`
		);
		lines.push(
			'recommendation: an on-premises connector, test relay or smart host belongs here and'
		);
		lines.push('this helper cannot know about it:');
		for (const entry of diff.unmatched) {
			lines.push(
				entry.containedIn === null
					? `  ? ${entry.value}`
					: `  ? ${entry.value} (narrower than the official ${entry.containedIn})`
			);
		}
	}

	for (const invalid of diff.invalidConfigured) {
		lines.push(`unparseable allowed_ips entry: ${invalid.value} -- ${invalid.reason}`);
	}
	for (const invalid of diff.invalidOfficial) {
		lines.push(`unparseable entry in the official feed: ${invalid.value} -- ${invalid.reason}`);
	}
	if (diff.covered.length === 0 && diff.missing.length === 0) {
		lines.push(
			'note: the official list contributed no ranges at all -- treat this as "feed not read",'
		);
		lines.push('never as "the ACL is obsolete".');
	}

	lines.push('');
	lines.push(
		'Nothing was changed. This helper only reads; apply additions yourself after review.'
	);
	return lines.join('\n');
}
