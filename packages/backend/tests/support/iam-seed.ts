import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CaslPolicy } from '@open-archiver/types';
import * as schema from '../../src/database/schema';
import {
	roles,
	userRoles,
	users,
	ingestionSources,
	archivedEmails,
} from '../../src/database/schema';

/**
 * Seed helper for the integration suite (JR-1-04).
 *
 * `FilterBuilder.create()` resolves its ability through `IamService.getAbilityForUser()`, which
 * reads `users`, `user_roles` and `roles.policies` from the database. There is no seam to inject an
 * ability (see the open proposal 1 in docs/dev/journaling/09-befunde-bestandscode.md), so the only
 * way to test the row-level scoping is to put real rows in a real database.
 *
 * Writes go through drizzle directly rather than through `IamService.createRole()` on purpose:
 * `IamService` is bound to the `db` singleton, and its slug derivation is a known repo defect
 * (`name.toLocaleLowerCase().replaceAll('', '_')`, see the E0 table in 09-befunde-bestandscode.md).
 * The seed is infrastructure; it must not depend on the code under test being correct.
 *
 * Every name and e-mail is randomised, so seeding twice in the same database cannot collide on the
 * unique constraints of `users.email` / `roles.name` / `roles.slug`. No real personal data
 * (Testplan rule 7).
 */

export type SeedDatabase = PostgresJsDatabase<typeof schema>;

export interface SeededPrincipal {
	userId: string;
	email: string;
	roleId: string;
	roleName: string;
}

/**
 * Create one user, one role carrying `policies`, and the join row between them.
 *
 * `policies` is stored verbatim. That matters for the `${user.id}` placeholder: `IamService`
 * interpolates it at ability-build time, so the fixture must reach the database uninterpolated for
 * the interpolation to be under test at all.
 */
export async function seedPrincipal(
	db: SeedDatabase,
	policies: CaslPolicy[],
	label = 'principal'
): Promise<SeededPrincipal> {
	const suffix = randomUUID().slice(0, 8);
	const email = `${label}-${suffix}@journaling.test.invalid`;
	const roleName = `${label}-role-${suffix}`;

	const [user] = await db
		.insert(users)
		.values({ email, first_name: 'Test', last_name: label })
		.returning();
	const [role] = await db
		.insert(roles)
		.values({ name: roleName, slug: `${label}-slug-${suffix}`, policies })
		.returning();
	await db.insert(userRoles).values({ userId: user!.id, roleId: role!.id });

	return { userId: user!.id, email, roleId: role!.id, roleName };
}

/** A user with no role at all -- the "no permissions whatsoever" case. */
export async function seedUserWithoutRole(db: SeedDatabase, label = 'roleless'): Promise<string> {
	const suffix = randomUUID().slice(0, 8);
	const [user] = await db
		.insert(users)
		.values({ email: `${label}-${suffix}@journaling.test.invalid` })
		.returning();
	return user!.id;
}

export interface SeededSource {
	id: string;
	name: string;
}

export async function seedIngestionSource(
	db: SeedDatabase,
	options: { userId?: string | null; name?: string; status?: 'active' | 'paused' } = {}
): Promise<SeededSource> {
	const suffix = randomUUID().slice(0, 8);
	const name = options.name ?? `source-${suffix}`;
	const [source] = await db
		.insert(ingestionSources)
		.values({
			userId: options.userId ?? null,
			name,
			provider: 'generic_imap',
			status: options.status ?? 'active',
		})
		.returning();
	return { id: source!.id, name };
}

export async function seedArchivedEmail(
	db: SeedDatabase,
	options: {
		ingestionSourceId: string;
		userEmail: string;
		subject?: string;
		sizeBytes?: number;
	}
): Promise<string> {
	const suffix = randomUUID().slice(0, 8);
	const [email] = await db
		.insert(archivedEmails)
		.values({
			ingestionSourceId: options.ingestionSourceId,
			userEmail: options.userEmail,
			sentAt: new Date('2026-01-01T00:00:00.000Z'),
			subject: options.subject ?? `subject-${suffix}`,
			senderEmail: `sender-${suffix}@journaling.test.invalid`,
			storagePath: `test/${suffix}.eml`,
			storageHashSha256: suffix.padEnd(64, '0'),
			sizeBytes: options.sizeBytes ?? 1024,
		})
		.returning();
	return email!.id;
}
