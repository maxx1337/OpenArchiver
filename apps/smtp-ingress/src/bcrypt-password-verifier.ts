import { compare } from 'bcryptjs';
import type { PasswordVerifier } from '@open-archiver/journaling';

/**
 * `PasswordVerifier` (`JR-4-05c`) implemented over `bcryptjs` -- the same library
 * `packages/backend`'s `AuthService`/`UserService` already use for user-login and backup-code
 * verification (`bcryptjs@^3.0.2`, see `AuthService.ts`'s `verifyPassword()`), reused here rather
 * than adding a second bcrypt dependency to the workspace.
 *
 * `packages/journaling` must not depend on it at all (architecture section 2: only
 * `@open-archiver/types`/`zod`) -- this three-line adapter is this app's own concern, the same split
 * `./postgres-query.ts`'s `createLedgerQuery()` already established for the database port and
 * `./index.ts`'s `pino` construction already established for the logging port.
 */
export function createBcryptPasswordVerifier(): PasswordVerifier {
	return {
		compare: (password, hash) => compare(password, hash),
	};
}
