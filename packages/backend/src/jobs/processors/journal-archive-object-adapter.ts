import { and, eq } from 'drizzle-orm';
import type { EmailAttachment, EmailObject } from '@open-archiver/types';
import type {
	ArchiveObjectInput,
	ArchiveObjectOutcome,
	ArchiveObjectPort,
} from '@open-archiver/journaling';
import { db } from '../../database';
import { archivedEmails } from '../../database/schema';
import { IngestionService } from '../../services/IngestionService';
import { StorageService } from '../../services/StorageService';
import { logger } from '../../config/logger';

/**
 * The one implementation of `ArchiveObjectPort` (ADR-010, `JR-6-02b`): a thin wrapper around
 * `IngestionService.processEmail()`, called **unmodified**. See ADR-010 in
 * `docs/dev/journaling/05-entscheidungen.md` for why this is a port instead of either extending
 * `processEmail()` or standing a second archiving path beside it.
 *
 * ---------------------------------------------------------------------------------------------
 * Three things this adapter must get right, each traceable to a non-negotiable
 * ---------------------------------------------------------------------------------------------
 * 1. **`skipTempFileCleanup: true`, always.** `input.spoolFilePath` is the durable spool file, not a
 *    scratch temp file -- `processEmail()`'s `finally` block must never delete it. Release is
 *    `NodeSpoolEntryReleaser`'s job, after every owner has been archived *and* indexed
 *    (`pipeline.ts`).
 * 2. **The identity handed to `processEmail()`'s dedup gates is hash-derived, not the message's own
 *    `Message-Id` header.** `input.contentSha256Hex` is already the gate's *verified* hash
 *    (`SpoolEntryArchive.contentSha256Hex`) -- a forged or missing `Message-Id` must not defeat
 *    object-level dedup (ADR-010 point 1).
 * 3. **A `null` return is a duplicate, not "nothing happened".** The adapter resolves the
 *    *pre-existing* row's id with the same key `processEmail()`'s own Gate 1 used, so
 *    `runPhaseBPipeline()` can index it unconditionally on every run (see `archive-object-port.ts`'s
 *    doc comment on why that closes a retry gap).
 */

/** `<local-part>@<domain>` is never assumed -- this is a synthetic identity, not an address. */
function syntheticMessageId(contentSha256Hex: string): string {
	return `<phase-b-sha256-${contentSha256Hex}@journal.internal>`;
}

/**
 * Always non-empty. `processEmail()`'s preserve-original-file mode never reads the *content* of
 * `email.attachments` -- it only uses `.length > 0` to set the `archived_emails.has_attachments`
 * flag (no attachment rows are created in this mode regardless). Indexing later re-parses the stored
 * raw bytes itself (`IndexingService.createEmailDocument()`) and only *then* decides whether there is
 * anything to extract. Setting the flag unconditionally true means that re-parse is always attempted;
 * setting it false when the raw message actually has an inner/attached part would silently skip
 * indexing content that exists. Over-inclusive is the safe direction here -- see the handover for the
 * measurement this is based on.
 */
const HAS_CONTENT_PLACEHOLDER: EmailAttachment[] = [
	{ filename: 'placeholder', contentType: 'message/rfc822', size: 0, content: Buffer.alloc(0) },
];

async function findExistingArchivedEmailId(
	messageId: string,
	ownerEmail: string,
	ingestionSourceId: string
): Promise<string | null> {
	const existing = await db.query.archivedEmails.findFirst({
		where: and(
			eq(archivedEmails.messageIdHeader, messageId),
			eq(archivedEmails.userEmail, ownerEmail),
			eq(archivedEmails.ingestionSourceId, ingestionSourceId)
		),
		columns: { id: true },
	});
	return existing?.id ?? null;
}

export function createJournalArchiveObjectPort(
	ingestionService: IngestionService,
	storage: StorageService
): ArchiveObjectPort {
	return async (input: ArchiveObjectInput): Promise<ArchiveObjectOutcome> => {
		const source = await IngestionService.findById(input.ingestionSourceId);
		if (source.provider !== 'smtp_journaling') {
			// A wiring defect, not a data problem: the ledger's chain_scope_id (ADR-007) is supposed
			// to name exactly the ingestion_sources row created for a journaling source.
			throw new Error(
				`ingestion source ${input.ingestionSourceId} has provider "${source.provider}", ` +
					`expected "smtp_journaling" -- refusing to archive spool bytes into a non-journaling ` +
					`source.`
			);
		}

		const messageId = syntheticMessageId(input.contentSha256Hex);
		const headers = new Map<string, unknown>([['message-id', messageId]]);

		const email: EmailObject = {
			id: input.contentSha256Hex,
			from: [...input.from],
			to: [...input.to],
			cc: [...input.cc],
			bcc: [...input.bcc],
			subject: input.subject,
			body: '',
			html: '',
			headers,
			attachments: HAS_CONTENT_PLACEHOLDER,
			receivedAt: input.receivedAt,
			tempFilePath: input.spoolFilePath,
		};

		const result = await ingestionService.processEmail(
			email,
			source,
			storage,
			input.ownerEmail,
			/* skipTempFileCleanup */ true
		);

		if (result === null) {
			const archivedEmailId = await findExistingArchivedEmailId(
				messageId,
				input.ownerEmail,
				input.ingestionSourceId
			);
			if (archivedEmailId === null) {
				// processEmail()'s Gate 1/2 said "duplicate" but the same key finds nothing -- the two
				// checks disagree, which should be impossible. Reported as an error outcome rather than
				// silently treated as "nothing to index": an operator needs to see this.
				logger.error(
					{
						spoolFilePath: input.spoolFilePath,
						contentSha256Hex: input.contentSha256Hex,
						ownerEmail: input.ownerEmail,
					},
					'processEmail() reported a duplicate but no matching archived_emails row was found'
				);
				return {
					kind: 'error',
					message:
						`processEmail() returned null (duplicate) for owner ${input.ownerEmail}, but no ` +
						`archived_emails row matches messageIdHeader=${messageId}. The dedup checks disagree.`,
				};
			}
			return { kind: 'duplicate', archivedEmailId };
		}
		if ('error' in result) {
			return { kind: 'error', message: result.message };
		}
		return { kind: 'archived', archivedEmailId: result.archivedEmailId };
	};
}
