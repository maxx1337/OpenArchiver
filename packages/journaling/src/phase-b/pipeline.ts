import type {
	JournalReportParseResult,
	OrganizationDomainGroup,
	OwnerResolutionMethod,
	PendingEmail,
	SmtpTransactionEnvelope,
} from '@open-archiver/types';
import type { LedgerLookup } from '../ledger/ledger-lookup-port';
import type { LedgerBackend } from '../ledger/ledger-port';
import { incomingFilePath } from '../spool/layout';
import { parseJournalReport } from '../parser/journal-report';
import { resolveOwner } from '../parser/owner-resolution';
import { alertSeverityFor, type PhaseBAlertSink } from './alerts';
import { classifySpoolEntry, mayArchive, type SpoolEntryArchive } from './spool-entry-gate';
import type { SpoolEntryReader } from './spool-entry-reader';
import { ownerEnvelopeFor, type OwnerEnvelopeFidelity } from './owner-envelope';
import type { OrganizationDomainsPort } from './organization-domains-port';
import type {
	ArchiveObjectInput,
	ArchiveObjectOutcome,
	ArchiveObjectPort,
	ArchiveObjectRecipient,
} from './archive-object-port';
import type { SpoolEntryReleaser } from './spool-entry-releaser';

/**
 * The Phase-B pipeline (`JR-6-02b`): spool entry → parsed → owner(s) resolved → archived → indexed →
 * spool released. Architecture doc section 6; the ports it composes come from `JR-6-01`/`JR-6-02a`
 * (`../ledger/ledger-lookup-port.ts`, `./spool-entry-gate.ts`, `./spool-entry-reader.ts`,
 * `./owner-envelope.ts`, `./alerts.ts`) plus the three this slice adds
 * (`./archive-object-port.ts`, `./organization-domains-port.ts`, `./spool-entry-releaser.ts`).
 *
 * ---------------------------------------------------------------------------------------------
 * Throws instead of returning a failure value -- and that is the load-bearing contract
 * ---------------------------------------------------------------------------------------------
 * `journalInboundProcessor()` (`packages/backend`) awaits this function directly: a resolved promise
 * means the job completes, a rejected one means BullMQ retries and, once the retry budget is spent,
 * fails it into the set `JR-6-04`'s reconciler and an operator both read. A **completed** job is the
 * claim that the message is archived and searchable (JR-6-01's own reasoning, repeated here because
 * it is the reason every non-happy path below is a `throw`, not a return value): reporting that claim
 * for a spool entry the gate refused, a parse the pipeline never actually indexed, or an archiving
 * call that failed would be the `JR-4-10`/F48 shape again -- the absence of work and its success
 * printing identically.
 *
 * ---------------------------------------------------------------------------------------------
 * The four parse kinds, and why none of them throws either
 * ---------------------------------------------------------------------------------------------
 * `parseJournalReport()` never throws (README constraint 4) and this function must not turn one of
 * its four results into a rejection just because it is not the easy case: `parse_failed`, `plain_bcc`
 * and `ndr` are archived exactly like `journal_report`, through the same owner-resolution call
 * (ADR-033) and the same archiving port. What differs between them is only which bytes feed the
 * envelope and the subject/from metadata -- see `metadataFor()` below.
 *
 * ---------------------------------------------------------------------------------------------
 * Ordering guarantee `./spool-entry-releaser.ts` depends on
 * ---------------------------------------------------------------------------------------------
 * `releaseSpoolEntry.release()` is the **last** call in every successful run, after every resolved
 * owner has been archived (or recognised as a pre-existing duplicate) *and* every one of those rows
 * has been indexed. A failure at any earlier step throws before reaching it, so a spool file is never
 * deleted while Phase B's own claim about it is still unproven.
 */

/** One resolved owner's archiving outcome, kept for the caller to log or act on. */
export interface PhaseBOwnerResult {
	readonly ownerEmail: string;
	readonly method: OwnerResolutionMethod;
	readonly outcome: ArchiveObjectOutcome;
}

/** What a successful Phase-B run produced. */
export interface PhaseBPipelineResult {
	readonly spoolTxId: string;
	readonly parseKind: JournalReportParseResult['kind'];
	readonly ownerFidelity: OwnerEnvelopeFidelity;
	readonly owners: readonly PhaseBOwnerResult[];
}

/** Everything `runPhaseBPipeline()` needs, injected -- no DB, no config module, per the package rule. */
export interface PhaseBPipelineDeps {
	/** Where the spool lives. A plain value, not a port -- `incomingFilePath()` is already pure. */
	readonly spoolRoot: string;
	readonly ledgerLookup: LedgerLookup;
	readonly spoolEntryReader: SpoolEntryReader;
	readonly organizationDomains: OrganizationDomainsPort;
	readonly archiveObject: ArchiveObjectPort;
	/** `IndexingService.indexEmailBatch()`, injected as a function so this package never imports it. */
	readonly indexBatch: (pending: readonly PendingEmail[]) => Promise<void>;
	readonly releaseSpoolEntry: SpoolEntryReleaser;
	readonly alertSink: PhaseBAlertSink;
	/**
	 * `LedgerBackend.append()` (`JR-6-03`) -- writes the `duplicate_of` marker for a genuinely
	 * redelivered owner. Injected as a bare function, matching `archiveObject`/`indexBatch` above,
	 * rather than the whole `LedgerBackend`: this pipeline only ever calls `append()`, never opens a
	 * transaction itself.
	 */
	readonly ledgerAppend: LedgerBackend['append'];
}

/** The gate refused to archive. Carries the verdict a caller may want to log alongside the alert. */
export class PhaseBSpoolEntryRefusedError extends Error {
	public override readonly name = 'PhaseBSpoolEntryRefusedError';

	public constructor(
		public readonly spoolTxId: string,
		public readonly verdictKind: string,
		reason: string
	) {
		super(
			`spool entry ${spoolTxId} was not archived (${verdictKind}): ${reason}. An alert was ` +
				`sent before this job failed.`
		);
	}
}

/** The spool file could not be measured/read at all -- the gate never got a chance to decide. */
export class PhaseBSpoolFileUnreadableError extends Error {
	public override readonly name = 'PhaseBSpoolFileUnreadableError';

	public constructor(
		public readonly spoolTxId: string,
		public readonly spoolPath: string,
		cause: unknown
	) {
		super(
			`spool file for transaction ${spoolTxId} at ${spoolPath} could not be read: ` +
				`${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause }
		);
	}
}

/**
 * The archive verdict's `journalingSourceId` is `null`, or names a `journaling_sources` row that no
 * longer exists. Both are wiring/data defects, never a normal outcome for a receipt that passed the
 * gate: `journalingSourceId` is set from the matched recipient at acceptance time, and acceptance
 * requires one (no catch-all, ADR rule in the skill).
 */
export class PhaseBOwnerConfigMissingError extends Error {
	public override readonly name = 'PhaseBOwnerConfigMissingError';

	public constructor(
		public readonly spoolTxId: string,
		public readonly journalingSourceId: string | null
	) {
		super(
			journalingSourceId === null
				? `spool entry ${spoolTxId}'s receipt carries no journalingSourceId -- cannot resolve ` +
						`organization domains for owner resolution. This should be impossible for an ` +
						`accepted smtp_journaling receipt; treat as a wiring defect, not a retry candidate.`
				: `journaling source ${journalingSourceId} (for spool entry ${spoolTxId}) has no ` +
						`configuration -- the row it was resolved from at acceptance time no longer exists.`
		);
	}
}

/** One resolved owner's `archiveObject()` call returned `{ kind: 'error' }`. */
export class PhaseBArchiveFailedError extends Error {
	public override readonly name = 'PhaseBArchiveFailedError';

	public constructor(
		public readonly spoolTxId: string,
		public readonly ownerEmail: string,
		message: string
	) {
		super(`archiving spool entry ${spoolTxId} for owner ${ownerEmail} failed: ${message}`);
	}
}

function recipientsOf(addresses: readonly string[]): ArchiveObjectRecipient[] {
	return addresses.map((address) => ({ name: '', address }));
}

/**
 * Subject and `from` for the archived object's metadata -- constraint 2 from the handover, RFC
 * section 6.1: for `journal_report`, sourced from the **inner** message when present, falling back to
 * the report envelope's own `subject`/`sender` (`JR-5-03`'s `innerMessage: { present: false }` case,
 * or an S/MIME-encrypted inner message whose plaintext headers are still safe to read). For the three
 * kinds with no inner message to speak of, sourced from the outer message's own extractable headers,
 * falling back to the header-derived envelope's `sender` for `from` -- `extractableHeaders.from` is
 * the raw, undecoded header value and is tried first because it is the more direct source; the parsed
 * `sender` only fills in when that header was missing or unreadable.
 */
function metadataFor(
	parseResult: JournalReportParseResult,
	ownerEnvelopeSender: string | null
): { readonly subject: string; readonly from: readonly ArchiveObjectRecipient[] } {
	let subject: string | null;
	let fromAddress: string | null;
	if (parseResult.kind === 'journal_report') {
		const inner = parseResult.innerMessage;
		subject = (inner.present ? inner.subject : null) ?? parseResult.envelope.subject;
		fromAddress = (inner.present ? inner.from : null) ?? parseResult.envelope.sender;
	} else {
		subject = parseResult.extractableHeaders.subject;
		fromAddress = parseResult.extractableHeaders.from ?? ownerEnvelopeSender;
	}
	return {
		subject: subject ?? '(no subject)',
		from: fromAddress === null ? [] : [{ name: '', address: fromAddress }],
	};
}

interface OwnerCandidate {
	readonly email: string;
	readonly method: OwnerResolutionMethod;
}

/**
 * `resolveOwner()`'s winner plus every `additionalMatches` entry, normalized and deduplicated
 * (constraint 4 from the handover -- "je aufgelöstem Owner"). `ownerEmail` is always present even
 * when `winner` is `null` (the `'fallback'`/`'journal-unknown'` cases), so there is always at least
 * one candidate. Two entries collapsing to the same normalized address (the same recipient appearing
 * in both `To` and `Cc`, say) archive once, not twice -- `IngestionService.processEmail()`'s own Gate
 * 1 would have caught this as a same-mailbox duplicate anyway, but that is a *reported* duplicate
 * outcome for what was never a second owner in the first place.
 */
function ownerCandidatesOf(result: ReturnType<typeof resolveOwner>): OwnerCandidate[] {
	const candidates: OwnerCandidate[] = [{ email: result.ownerEmail, method: result.method }];
	for (const additional of result.additionalMatches) {
		candidates.push({ email: additional.normalizedEmail, method: result.method });
	}
	const seen = new Set<string>();
	const deduped: OwnerCandidate[] = [];
	for (const candidate of candidates) {
		if (seen.has(candidate.email)) {
			continue;
		}
		seen.add(candidate.email);
		deduped.push(candidate);
	}
	return deduped;
}

/** Process one Phase-B job for one spool transaction id. See the module doc comment for the contract. */
export async function runPhaseBPipeline(
	spoolTxId: string,
	deps: PhaseBPipelineDeps
): Promise<PhaseBPipelineResult> {
	const spoolPath = incomingFilePath(deps.spoolRoot, spoolTxId);

	const ledgerEntries = await deps.ledgerLookup.findBySpoolTxIds([spoolTxId]);
	const entry = ledgerEntries.get(spoolTxId);

	let measured;
	try {
		measured = await deps.spoolEntryReader.measure(spoolPath);
	} catch (cause) {
		throw new PhaseBSpoolFileUnreadableError(spoolTxId, spoolPath, cause);
	}

	const verdict = classifySpoolEntry(entry, measured);
	if (!mayArchive(verdict)) {
		deps.alertSink({
			spoolTxId,
			spoolPath,
			verdict,
			severity: alertSeverityFor(verdict),
		});
		// Every non-archive member of SpoolEntryVerdict carries `reason` -- see spool-entry-gate.ts.
		throw new PhaseBSpoolEntryRefusedError(spoolTxId, verdict.kind, verdict.reason);
	}

	const archived: SpoolEntryArchive = verdict;
	const raw = await deps.spoolEntryReader.read(spoolPath);

	const smtpEnvelope: SmtpTransactionEnvelope = {
		envelopeFrom: archived.envelopeFrom,
		envelopeRcpt: archived.envelopeRcpt,
	};
	const parseResult = await parseJournalReport(raw, smtpEnvelope, 'infer');
	const ownerEnvelopeSource = await ownerEnvelopeFor(parseResult, raw);

	if (archived.journalingSourceId === null) {
		throw new PhaseBOwnerConfigMissingError(spoolTxId, null);
	}
	const domainGroups: readonly OrganizationDomainGroup[] | null =
		await deps.organizationDomains.forJournalingSource(archived.journalingSourceId);
	if (domainGroups === null) {
		throw new PhaseBOwnerConfigMissingError(spoolTxId, archived.journalingSourceId);
	}

	const ownerResult = resolveOwner(ownerEnvelopeSource.envelope, domainGroups);
	const { subject, from } = metadataFor(parseResult, ownerEnvelopeSource.envelope.sender);
	const to = recipientsOf(ownerEnvelopeSource.envelope.to);
	const cc = recipientsOf(ownerEnvelopeSource.envelope.cc);
	const bcc = recipientsOf(ownerEnvelopeSource.envelope.bcc);

	const owners: PhaseBOwnerResult[] = [];
	const toIndex: PendingEmail[] = [];

	// `JR-6-03`: resolved at most once per spool entry, not per owner -- `chainScopeId`/
	// `contentSha256Hex` are constant across the whole fan-out (they describe the spool file, not the
	// owner), so every 'duplicate' outcome for this entry asks the same question. `undefined` means
	// "not looked up yet"; `null` is a legitimate answer (see below) and must stay distinguishable
	// from "haven't asked".
	let originalReceiptSeq: bigint | null | undefined;

	for (const candidate of ownerCandidatesOf(ownerResult)) {
		const input: ArchiveObjectInput = {
			ingestionSourceId: archived.chainScopeId,
			spoolFilePath: spoolPath,
			contentSha256Hex: archived.contentSha256Hex,
			ownerEmail: candidate.email,
			subject,
			from,
			to,
			cc,
			bcc,
			receivedAt: archived.receivedAt,
			parseKind: parseResult.kind,
			ownerFidelity: ownerEnvelopeSource.fidelity,
			ownerMethod: candidate.method,
		};
		const outcome = await deps.archiveObject(input);
		owners.push({ ownerEmail: candidate.email, method: candidate.method, outcome });

		// `JR-6-03`, RFC section 4.5: the object is deduplicated, the receipt never is. A 'duplicate'
		// outcome means processEmail() found this owner's object already archived -- but that can mean
		// either of two different things, and only one of them calls for a new ledger row:
		//
		//   (a) a genuine redelivery: some *other* transaction's receipt (a smaller seq) already
		//       carries this exact content_sha256 in this chain. The message was accepted twice, and
		//       RFC section 4.5 requires the second acceptance to keep its own receipt in evidence --
		//       this transaction's Phase-A receipt already does that (`archived.seq`, unconditional,
		//       written before this pipeline ever ran); what is still missing is the link back to the
		//       original, which this pipeline now appends as its own row (never as an edit to either
		//       existing receipt -- the ledger has no UPDATE).
		//   (b) the *same* job being retried after an earlier attempt archived this owner but the run
		//       died before reaching this point (ADR-034 point 2): `findOriginalReceiptSeq()` then
		//       resolves to this transaction's *own* receipt (`archived.seq`), because no other receipt
		//       shares the content yet. Pointing `duplicate_of` at itself would be nonsensical and
		//       would fabricate a second event for something that only happened once -- so this case
		//       writes nothing and simply lets the unconditional `toIndex.push()` below repair the
		//       interrupted retry, exactly as it already did before this slice.
		if (outcome.kind === 'duplicate') {
			if (originalReceiptSeq === undefined) {
				originalReceiptSeq = await deps.ledgerLookup.findOriginalReceiptSeq(
					archived.chainScopeId,
					Buffer.from(archived.contentSha256Hex, 'hex')
				);
			}
			if (originalReceiptSeq !== null && originalReceiptSeq !== archived.seq) {
				await deps.ledgerAppend({
					chainScopeId: archived.chainScopeId,
					receivedAtMicros: BigInt(archived.receivedAt.getTime()) * 1000n,
					// ADR-037: a distinct event type, not 'receipt'. This row was written as 'receipt'
					// before ADR-037 -- there was no other value for it -- which overcounted every
					// query that holds receipt rows against accepted messages (verify, E9, will do
					// exactly this). The discriminator (spool_txid is null) existed but only in a doc
					// comment; this makes it a first-class, queryable fact instead.
					eventType: 'duplicate_marker',
					// Connection-level fields belong to the SMTP transaction that is *this* receipt
					// (`archived.seq`, untouched, already durable) -- this marker records a link, not a
					// new acceptance event, and has no connection of its own to describe.
					remoteIp: null,
					ehloName: null,
					tlsVersion: null,
					tlsCipher: null,
					envelopeFrom: archived.envelopeFrom,
					envelopeRcpt: archived.envelopeRcpt,
					sizeBytes: BigInt(archived.sizeBytes),
					contentSha256: Buffer.from(archived.contentSha256Hex, 'hex'),
					duplicateOf: originalReceiptSeq,
					journalingSourceId: archived.journalingSourceId,
					// Never this transaction's own spool_txid, and never the original's -- both are
					// already the key of an existing row, and `findBySpoolTxIds()`'s one-row-per-id
					// assumption (ADR-030) would silently collapse a second one under either (see
					// `ledger-lookup-port.ts`'s doc comment).
					spoolTxId: null,
					eventPayload: null,
				});
			}
		}

		if (outcome.kind === 'error') {
			throw new PhaseBArchiveFailedError(spoolTxId, candidate.email, outcome.message);
		}
		// Indexed unconditionally for 'archived' *and* 'duplicate' -- see archive-object-port.ts's
		// doc comment on the duplicate case for why a retry must be able to repair a prior run that
		// archived successfully but died before this step.
		toIndex.push({ archivedEmailId: outcome.archivedEmailId });
	}

	await deps.indexBatch(toIndex);
	await deps.releaseSpoolEntry.release(spoolPath);

	return {
		spoolTxId,
		parseKind: parseResult.kind,
		ownerFidelity: ownerEnvelopeSource.fidelity,
		owners,
	};
}
