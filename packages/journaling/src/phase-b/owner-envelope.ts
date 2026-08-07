import type { JournalReportParseResult, OwnerResolutionEnvelope } from '@open-archiver/types';
import { parseHeaderAddressList } from '../parser/envelope';
import { splitHeaderAndBody } from '../parser/mime-split';

/**
 * Where the envelope `resolveOwner()` is given came from (**ADR-033**, `JR-6-02b`).
 *
 * ---------------------------------------------------------------------------------------------
 * The gap this closes
 * ---------------------------------------------------------------------------------------------
 * `resolveOwner()` is typed on `OwnerResolutionEnvelope` -- `to`/`cc`/`bcc`/`sender` of a **journal
 * report** envelope -- and only `JournalReportParsed` carries one. E5 typed it that way deliberately and
 * handed the follow-up question on:
 *
 * > Whether/how to resolve an owner for those two kinds is an open question left to whichever later
 * > slice needs it.
 *
 * Phase B is that slice, because it has to archive **every** message, including one that could not be
 * parsed as a journal report at all. Nothing is rejected here -- the receipt already exists.
 *
 * ---------------------------------------------------------------------------------------------
 * One resolver, two envelope sources
 * ---------------------------------------------------------------------------------------------
 * `resolveOwner()` is **not** widened. Instead the three weaker results (`plain_bcc`, `ndr`,
 * `parse_failed`) get an envelope built from the **outer message's own RFC 5322 headers**, and the same
 * `resolveOwner()` runs over it. Two implementations of "which domain is ours" would be the same class
 * of mistake ADR-010 avoids for deduplication.
 *
 * The header-derived envelope is weaker but **real**, and that is worth being precise about:
 *
 *  - **`plain_bcc`** -- `To`/`Cc` on the outer bytes *are* the original message's own recipient headers.
 *    A BCC copy is a copy of the same bytes; Postfix does not rewrite them. Best available source, not a
 *    workaround.
 *  - **`ndr`** -- the recipient header of a bounce is the **original sender**, which is the right owner
 *    for a bounce. `extractableHeaders.from` would not be: that is the mailer-daemon.
 *  - **`parse_failed`** -- whatever is readable is read; the rest ends in `'fallback'`.
 *
 * ---------------------------------------------------------------------------------------------
 * What is deliberately **not** used
 * ---------------------------------------------------------------------------------------------
 * **`SmtpTransactionEnvelope.envelopeRcpt` is never treated as the owner.** For a plain-BCC copy that is
 * the archive mailbox address itself -- E5 measured and documented this -- so using it would attribute
 * every such message to one pseudo-mailbox *and look like a successful resolution*. A wrong owner that
 * presents itself as right is worse than an admittedly unknown one.
 *
 * And one loss no resolver can repair: in plain-BCC mode a **genuine Bcc-only recipient is gone without
 * a trace**. That is a property of the deployment mode (ADR-033 records it for the operator
 * documentation), which is why {@link OwnerEnvelopeFidelity} travels with the result instead of being
 * smoothed away.
 */

/** How much the envelope handed to `resolveOwner()` is worth. */
export type OwnerEnvelopeFidelity =
	/** From the journal report's own envelope fields -- the intended, full-fidelity source. */
	| 'journal-report'
	/** From the outer message's own `To`/`Cc`/`Bcc`/`From` headers. Real, but a Bcc-only recipient is lost. */
	| 'rfc5322-headers'
	/** Nothing to resolve from: no journal envelope and no usable recipient headers either. */
	| 'none';

/** An envelope for `resolveOwner()`, plus where it came from. */
export interface OwnerEnvelopeSource {
	readonly envelope: OwnerResolutionEnvelope;
	readonly fidelity: OwnerEnvelopeFidelity;
}

const EMPTY_ENVELOPE: OwnerResolutionEnvelope = {
	to: [],
	cc: [],
	bcc: [],
	sender: null,
};

/**
 * Build the envelope `resolveOwner()` should see for one parse result.
 *
 * @param result What `parseJournalReport()` returned.
 * @param rawOuter The raw **outer** message -- the same bytes that were hashed, receipted and stored.
 *   Only read for the three weaker kinds; a `journal_report` result never needs it.
 *
 * Never throws: `splitHeaderAndBody()` is no-throw by construction and `parseHeaderAddressList()`
 * treats a `mailparser` failure as "no addresses". A caller in the Phase-B path must not have to guard
 * owner resolution with a try/catch -- the message is already accepted.
 */
export async function ownerEnvelopeFor(
	result: JournalReportParseResult,
	rawOuter: Buffer
): Promise<OwnerEnvelopeSource> {
	if (result.kind === 'journal_report') {
		return { envelope: result.envelope, fidelity: 'journal-report' };
	}
	return headerDerivedEnvelope(rawOuter);
}

/**
 * Read `To`/`Cc`/`Bcc`/`From` off the outer message's top-level header block.
 *
 * `sender` takes the **first** address of `From`: `OwnerResolutionEnvelope.sender` is a single address,
 * and RFC 5322 permits `From` to carry a list (a rarity, but a real one). Taking the first matches what
 * a journal report's own single `Sender:` field means, and `resolveOwner()` only consults `sender` after
 * the inbound `to`/`cc`/`bcc` scan already found nothing.
 */
async function headerDerivedEnvelope(rawOuter: Buffer): Promise<OwnerEnvelopeSource> {
	const { headers } = splitHeaderAndBody(rawOuter);
	const [to, cc, bcc, from] = await Promise.all([
		parseHeaderAddressList('To', headers.get('to') ?? ''),
		parseHeaderAddressList('Cc', headers.get('cc') ?? ''),
		parseHeaderAddressList('Bcc', headers.get('bcc') ?? ''),
		parseHeaderAddressList('From', headers.get('from') ?? ''),
	]);
	const sender = from[0] ?? null;
	if (to.length === 0 && cc.length === 0 && bcc.length === 0 && sender === null) {
		// Reported as `'none'` rather than as an empty `'rfc5322-headers'` envelope. The two are the same
		// input to `resolveOwner()` but not the same statement to an operator: "we looked at the headers
		// and they named nobody" is a message worth alerting on, and it must not be indistinguishable
		// from "we looked at the headers and found the owner".
		return { envelope: EMPTY_ENVELOPE, fidelity: 'none' };
	}
	return { envelope: { to, cc, bcc, sender }, fidelity: 'rfc5322-headers' };
}
