import type {
	OrganizationDomainGroup,
	OwnerResolutionEnvelope,
	OwnerResolutionField,
	OwnerResolutionResult,
	OwnerResolutionWinner,
} from '@open-archiver/types';

/**
 * Owner resolution (`JR-5-07`): decides which internal mailbox a `journal_report` result belongs
 * to, following the priority order `docs/enterprise/journaling/guide.md` documents under "How Owner
 * Resolution Works" / "Domain Normalization (Alias Handling)" -- literally, not a re-derivation of
 * it. See `journal-parser.types.ts`'s `OwnerResolutionEnvelope`/`OwnerResolutionMethod` doc comments
 * for why this function is typed to accept exactly that envelope shape (only `journal_report`
 * carries it) and for what each `OwnerResolutionMethod` value promises about how far to trust the
 * result.
 *
 * ---------------------------------------------------------------------------------------------
 * The four cases, in the guide's own order
 * ---------------------------------------------------------------------------------------------
 *  1. **Inbound check**: scan `to`, then `cc`, then `bcc`, in that order and in each field's own
 *     order; the first address whose domain matches a configured group's `main` or any `alias`
 *     wins.
 *  2. **Outbound check**: if nothing in (1) matched, and `sender`'s domain matches a configured
 *     group, the sender is the owner.
 *  3. **No groups configured**: `to[0] -> cc[0] -> bcc[0] -> sender -> 'journal-unknown'` --
 *     whichever is the first non-empty one, completely unchecked against anything (there is nothing
 *     configured to check it against).
 *  4. **Groups configured, nothing matched**: `default_fallback@<first configured group's main>`,
 *     with a warning.
 *
 * ---------------------------------------------------------------------------------------------
 * Address handling (JR-5-07 hard constraint 5)
 * ---------------------------------------------------------------------------------------------
 * Domain comparison is case-insensitive (DNS is); the local part is never cased, trimmed, or
 * otherwise altered. An address is split on its **last** `@` (not the first): a quoted local part
 * can itself legally contain `@` per RFC 5321/5322, and splitting there instead of at the first `@`
 * keeps the domain correct without needing to parse quoting. An address with **no** `@` at all has
 * no domain and can never match a configured group -- it is simply skipped as an inbound/outbound
 * candidate (never thrown over, and still eligible for the *unchecked* no-groups heuristic in case
 * 3, which does not look at domains at all). An address that is only `@domain` (empty local part)
 * is not rejected either: its domain half is still compared normally, and if it wins,
 * `normalizeOwnerEmail()` reproduces the empty local part verbatim (`@company.com`) rather than
 * inventing one -- validating the local part is not this function's job.
 *
 * ---------------------------------------------------------------------------------------------
 * A domain configured twice (JR-5-07 hard constraint 5's last case)
 * ---------------------------------------------------------------------------------------------
 * Nothing stops two `OrganizationDomainGroup` entries from naming the same domain (as each other's
 * `main`, or as an `alias` of both, or any mix) -- that is a configuration mistake this function
 * cannot detect or refuse, since it only ever sees one address at a time. `findGroupMatch()` below
 * resolves it deterministically rather than arbitrarily: **first group in the array wins, checked in
 * the order it is passed; within a group, `main` is checked before its `aliases`.** This is a
 * documented tie-break, not a validation of the input -- flagged in this slice's report to the PO as
 * a config-time check `packages/backend` may want to add (out of scope here: this package takes no
 * database, no config, per the epic's hard rules).
 */

/** A configured group's domain compared against, lowercased and trimmed for the comparison only. */
function normalizedConfiguredDomain(value: string): string {
	return value.trim().toLowerCase();
}

/**
 * A configured group's domain as it goes **into** an owner address: trimmed, but deliberately **not**
 * lowercased -- see `normalizeOwnerEmail()` for why the operator's casing is preserved.
 *
 * Trimming here is not cosmetic. Until `JR-5-09` it was missing, and because matching went through
 * `normalizedConfiguredDomain()` (which trims) while the output used the raw string, a single stray
 * space in `organizationDomains` still matched and then leaked into the address: `'company.com '`
 * produced `alice@company.com ` and `' company.com'` produced `alice@ company.com` -- whitespace in
 * the middle of an address that is never deliverable and never compares equal to anything downstream.
 * Recorded as **F43**.
 *
 * What this does **not** repair: a `main` that is not a bare domain at all (`'admin@company.com'`
 * yields `default_fallback@admin@company.com`, two `@` signs). Guessing which half the operator meant
 * would be the forbidden move -- inventing a value out of a broken input. That belongs in a
 * config-time check where `journaling_sources.organizationDomains` is written, together with the
 * duplicate-domain check from `JR-5-07`; both are proposed follow-ups for `packages/backend`.
 */
function configuredDomainForOwnerAddress(value: string): string {
	return value.trim();
}

/**
 * The domain half of an address, lowercased for comparison -- `null` when the address has no `@` at
 * all (or the domain half is empty, e.g. a trailing `@`). Splits on the **last** `@`; see the module
 * doc comment.
 */
function domainOf(address: string): string | null {
	const at = address.lastIndexOf('@');
	if (at === -1) {
		return null;
	}
	const domain = address
		.slice(at + 1)
		.trim()
		.toLowerCase();
	return domain.length > 0 ? domain : null;
}

/** The local-part half of an address, untouched -- everything before the last `@`, or the whole
 * string when there is no `@` at all. Never cased, trimmed, or otherwise modified (hard constraint
 * 5: the local part is never touched). */
function localPartOf(address: string): string {
	const at = address.lastIndexOf('@');
	return at === -1 ? address : address.slice(0, at);
}

interface GroupMatch {
	readonly group: OrganizationDomainGroup;
	readonly kind: 'main' | 'alias';
}

/**
 * First configured group (in array order) whose `main` or any `alias` equals `domain`
 * case-insensitively. See the module doc comment for why "first in array order, `main` before
 * `aliases`" is the deliberate tie-break for a domain configured in more than one group.
 */
function findGroupMatch(
	domain: string,
	domainGroups: readonly OrganizationDomainGroup[]
): GroupMatch | null {
	for (const group of domainGroups) {
		if (normalizedConfiguredDomain(group.main) === domain) {
			return { group, kind: 'main' };
		}
		for (const alias of group.aliases) {
			if (normalizedConfiguredDomain(alias) === domain) {
				return { group, kind: 'alias' };
			}
		}
	}
	return null;
}

/**
 * `<local-part>@<group.main>`, trimmed but not re-lowercased -- so storage is always
 * keyed by the exact primary-domain string the operator configured, regardless of what casing the
 * matching address happened to carry. The local part is copied verbatim from `address`.
 */
function normalizeOwnerEmail(address: string, group: OrganizationDomainGroup): string {
	return `${localPartOf(address)}@${configuredDomainForOwnerAddress(group.main)}`;
}

interface InboundCandidate {
	readonly field: OwnerResolutionField;
	readonly address: string;
	readonly match: GroupMatch;
}

/**
 * Scans `to`, then `cc`, then `bcc` -- in that order, and in each field's own order -- collecting
 * *every* address that matches a configured domain group, not just the first. `resolveOwner()`
 * still only ever picks the first as the owner (the guide's documented rule), but the rest are
 * returned too so a caller does not lose the fact that more than one internal participant was on
 * the message (JR-5-07 hard constraint 4).
 */
function scanInboundMatches(
	envelope: OwnerResolutionEnvelope,
	domainGroups: readonly OrganizationDomainGroup[]
): InboundCandidate[] {
	const fields: ReadonlyArray<{ field: OwnerResolutionField; addresses: readonly string[] }> = [
		{ field: 'to', addresses: envelope.to },
		{ field: 'cc', addresses: envelope.cc },
		{ field: 'bcc', addresses: envelope.bcc },
	];

	const found: InboundCandidate[] = [];
	for (const { field, addresses } of fields) {
		for (const address of addresses) {
			const domain = domainOf(address);
			if (domain === null) {
				continue;
			}
			const match = findGroupMatch(domain, domainGroups);
			if (match !== null) {
				found.push({ field, address, match });
			}
		}
	}
	return found;
}

function winnerOf(candidate: InboundCandidate): OwnerResolutionWinner {
	return { field: candidate.field, address: candidate.address };
}

function domainMatchResult(
	winner: InboundCandidate,
	additional: readonly InboundCandidate[]
): OwnerResolutionResult {
	return {
		ownerEmail: normalizeOwnerEmail(winner.address, winner.match.group),
		method: winner.match.kind === 'main' ? 'primary-domain-match' : 'alias-domain-match',
		winner: winnerOf(winner),
		matchedDomain: domainOf(winner.address),
		additionalMatches: additional.map(winnerOf),
		warning: null,
	};
}

/**
 * Case 3: no domain groups configured at all -- `to[0] -> cc[0] -> bcc[0] -> sender ->
 * 'journal-unknown'`, taking whichever is the first non-empty one, completely unchecked (there is
 * nothing configured to check it against). Never normalizes the winning address: with no groups,
 * there is no primary domain to normalize *to*.
 */
function heuristicResult(envelope: OwnerResolutionEnvelope): OwnerResolutionResult {
	const winner: OwnerResolutionWinner | null =
		envelope.to.length > 0
			? { field: 'to', address: envelope.to[0]! }
			: envelope.cc.length > 0
				? { field: 'cc', address: envelope.cc[0]! }
				: envelope.bcc.length > 0
					? { field: 'bcc', address: envelope.bcc[0]! }
					: envelope.sender !== null
						? { field: 'sender', address: envelope.sender }
						: null;

	return {
		ownerEmail: winner?.address ?? 'journal-unknown',
		method: 'heuristic-no-groups',
		winner,
		matchedDomain: null,
		additionalMatches: [],
		warning: null,
	};
}

/**
 * Case 4: domain groups are configured, but nothing in the message matched any of them.
 * `default_fallback@<first configured group's main>`, with the warning JR-5-07's acceptance
 * criterion requires -- as a value, not a log call (see `OwnerResolutionMethod`'s doc comment for
 * why this package never logs it itself).
 */
function fallbackResult(firstGroup: OrganizationDomainGroup): OwnerResolutionResult {
	const ownerEmail = `default_fallback@${configuredDomainForOwnerAddress(firstGroup.main)}`;
	return {
		ownerEmail,
		method: 'fallback',
		winner: null,
		matchedDomain: null,
		additionalMatches: [],
		warning:
			`No To/Cc/Bcc/From participant matched any configured organization domain; ` +
			`falling back to "${ownerEmail}".`,
	};
}

/**
 * Resolves the mailbox owner of a `journal_report` result. See the module doc comment for the four
 * cases and their order, and `journal-parser.types.ts`'s `OwnerResolutionEnvelope`/
 * `OwnerResolutionMethod` for why the input is this narrow envelope shape rather than
 * `JournalReportParseResult` -- pass `JournalReportParsed.envelope` directly; there is no equivalent
 * call for `'plain_bcc'`/`'ndr'` results (see those doc comments).
 */
export function resolveOwner(
	envelope: OwnerResolutionEnvelope,
	domainGroups: readonly OrganizationDomainGroup[]
): OwnerResolutionResult {
	const inboundMatches = scanInboundMatches(envelope, domainGroups);
	if (inboundMatches.length > 0) {
		const [winner, ...additional] = inboundMatches;
		return domainMatchResult(winner!, additional);
	}

	if (envelope.sender !== null) {
		const senderDomain = domainOf(envelope.sender);
		if (senderDomain !== null) {
			const senderMatch = findGroupMatch(senderDomain, domainGroups);
			if (senderMatch !== null) {
				return domainMatchResult(
					{ field: 'sender', address: envelope.sender, match: senderMatch },
					[]
				);
			}
		}
	}

	if (domainGroups.length === 0) {
		return heuristicResult(envelope);
	}

	return fallbackResult(domainGroups[0]!);
}
