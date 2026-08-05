import { eq } from 'drizzle-orm';
import type { OrganizationDomainGroup } from '@open-archiver/types';
import type { OrganizationDomainsPort } from '@open-archiver/journaling';
import { db } from '../../database';
import { journalingSources } from '../../database/schema';

/**
 * The backend implementation of `OrganizationDomainsPort` (`JR-6-02b`). `packages/journaling` cannot
 * import Drizzle or `db` directly (architecture doc section 2), so this is the one place that reads
 * `journaling_sources.organization_domains` on Phase B's behalf.
 */
export class DrizzleOrganizationDomainsAdapter implements OrganizationDomainsPort {
	async forJournalingSource(
		journalingSourceId: string
	): Promise<readonly OrganizationDomainGroup[] | null> {
		const row = await db.query.journalingSources.findFirst({
			where: eq(journalingSources.id, journalingSourceId),
			columns: { organizationDomains: true },
		});
		if (!row) {
			return null;
		}
		return row.organizationDomains;
	}
}
