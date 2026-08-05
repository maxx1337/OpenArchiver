import type { Job } from 'bullmq';
import type { JournalInboundJobData } from '@open-archiver/journaling';

/**
 * Phase B of the journaling receiver -- the job body (`JR-6-02`, architecture doc section 6).
 *
 * `JR-6-01` builds the process around this function: the worker, its queue parameters, the
 * `start:journal-worker` script. The pipeline itself -- read the spool file, parse the journal report,
 * put the outer object into the object store, write `archived_emails`, index, release the spool entry
 * -- is `JR-6-02`, and it depends on a decision that is not made yet (**ADR-010**: extend
 * `IngestionService.processEmail()` or stand a journaling-specific path beside it).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this throws instead of returning
 * ---------------------------------------------------------------------------------------------
 * The alternative -- a body that logs and returns -- would mark the job **completed**. A completed
 * Phase-B job is a claim that the message is archived and searchable, and it is the claim the spool
 * reconciler (`JR-6-04`) reads to decide that an entry needs no further attention. A no-op that
 * reports success would therefore not be a harmless placeholder: it would be the one failure mode
 * this project has already paid for twice. `JR-4-10` shipped two consecutive test versions that were
 * useless on every platform and still reported green, and F48 hid twelve red CI runs behind a step
 * that never ran. Both had the same shape: the absence of work and the success of work printed
 * identically.
 *
 * Failing loudly makes the unfinished state visible in the only place that matters -- the queue's
 * failed set -- and costs nothing today, because nothing enqueues into this queue yet: architecture
 * section 3 step 7 (the ingress enqueueing the hint after `250`) is not wired, and the reconciler does
 * not exist. Any job reaching here before `JR-6-02` is a wiring mistake, and that is exactly what the
 * message says.
 */
export class PhaseBNotImplementedError extends Error {
	public override readonly name = 'PhaseBNotImplementedError';

	public constructor(public readonly spoolTxId: string | undefined) {
		super(
			`Phase B is not implemented yet (JR-6-02, ADR-010 undecided): refusing to report the spool ` +
				`entry ${spoolTxId ?? '(no spoolTxId in payload)'} as archived. JR-6-01 builds only the ` +
				`worker process; nothing should be enqueueing journal-inbound jobs at this point, so this ` +
				`job indicates premature wiring rather than a processing failure. The spool entry is ` +
				`untouched and stays authoritative.`
		);
	}
}

/**
 * Process one Phase-B job.
 *
 * Kept as the single dispatch target of the worker's name switch so `JR-6-02` fills one function
 * rather than restructuring the process.
 */
export const journalInboundProcessor = async (job: Job<JournalInboundJobData>): Promise<never> => {
	throw new PhaseBNotImplementedError(job.data?.spoolTxId);
};

export default journalInboundProcessor;
