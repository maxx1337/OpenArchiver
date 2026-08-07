import type { OrganizationDomainGroup } from '@open-archiver/types';

/**
 * Configuration lookup for `resolveOwner()`'s `domainGroups` argument (`JR-6-02b`).
 *
 * `journaling_sources.organizationDomains` lives in `packages/backend`'s database, which this
 * package may not import (architecture doc section 2: configuration is injected, never imported).
 * Keyed by `journalingSourceId` -- the value `SpoolEntryArchive.journalingSourceId` already carries,
 * resolved from the ledger receipt at no extra query -- rather than by `ingestionSourceId`
 * (`chainScopeId`): the two happen to be different columns of the *same* `journaling_sources` row
 * today, but `journalingSourceId` is the one this package already has in hand from the gate's
 * verdict, and asking for it directly means the adapter needs exactly one indexed lookup, not a join
 * the caller has to know to ask for.
 */
export interface OrganizationDomainsPort {
	/**
	 * Resolve the configured organization domain groups for a journaling source.
	 *
	 * @returns `null` when no such source is configured -- a wiring defect (the ledger receipt's
	 * `journalingSourceId` names a row that no longer exists), never treated the same as "configured
	 * with zero groups" (`[]`, a legitimate, common configuration that makes `resolveOwner()` take its
	 * unchecked heuristic path). `runPhaseBPipeline()` must tell the two apart.
	 */
	forJournalingSource(
		journalingSourceId: string
	): Promise<readonly OrganizationDomainGroup[] | null>;
}
