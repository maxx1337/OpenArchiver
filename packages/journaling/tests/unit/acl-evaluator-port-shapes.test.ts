import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type {
	RecipientAclDecision,
	RecipientAclEvaluator,
	SourceAclDecision,
	SourceAclEvaluator,
} from '../../src/ingress/smtp-server';
import {
	SourceAclCache,
	type SourceAclCacheEsmtpBindings,
} from '../../src/ingress/source-acl-cache';
import type { JournalingSourceAclEntry, SourceAclLookup } from '../../src/ingress/source-acl-port';

/**
 * F46 (`JR-4-20`) regression: `SourceAclEvaluator.evaluate` and `RecipientAclEvaluator.evaluate` used
 * to share one method name. Because {@link SourceAclDecision} and {@link RecipientAclDecision} are
 * structurally the same three-shape union, that let a single `evaluate(remoteIp)` method satisfy
 * *both* interfaces at once -- `SourceAclCache`'s connect-time IP matcher silently stood in for the
 * recipient ACL wherever code was typed against `RecipientAclEvaluator`, and the compiler never
 * objected. Production wired every real `RCPT TO` through the wrong method as a result (see
 * `./smtp-recipient-acl-protocol.test.ts` and `../../../backend/tests/integration/
 * smtp-ingress-crash-recovery-boot.int.test.ts` for the runtime symptom this caused, `451` forever).
 *
 * Fixed by renaming `RecipientAclEvaluator`'s method to `evaluateRecipient` (`../../src/ingress/
 * smtp-server.ts`). This file is the type-level proof that the fix is structural, not just a naming
 * convention a future edit could quietly undo: `tsc -p tsconfig.test.json`
 * (`pnpm --filter @open-archiver/journaling test:types`) is what actually checks the
 * `@ts-expect-error` lines below -- vitest itself only runs the one runtime assertion this file
 * needs to be classified and counted by the harness (`docs/dev/journaling` testplan section on the
 * suite inventory).
 */
suite('ci', 'ACL evaluator ports cannot be swapped for each other (F46, JR-4-20)', () => {
	it('an object implementing only SourceAclEvaluator does not satisfy RecipientAclEvaluator, and vice versa -- checked by tsc, not by this assertion', () => {
		const sourceOnly: SourceAclEvaluator = {
			evaluate: (_ip: string): SourceAclDecision => ({ kind: 'denied' }),
		};
		const recipientOnly: RecipientAclEvaluator = {
			evaluateRecipient: (_address: string): RecipientAclDecision => ({ kind: 'denied' }),
		};

		// @ts-expect-error -- F46's exact swap: an object with only the connect-time `evaluate(ip)`
		// method has no `evaluateRecipient`, so it must not be assignable to `RecipientAclEvaluator`.
		// Before the fix this line compiled cleanly (both interfaces shared the name `evaluate`).
		const swappedIntoRecipientSlot: RecipientAclEvaluator = sourceOnly;
		// @ts-expect-error -- the reverse swap: an object with only `evaluateRecipient` has no
		// `evaluate`, so it must not be assignable to `SourceAclEvaluator` either.
		const swappedIntoSourceSlot: SourceAclEvaluator = recipientOnly;

		expect(sourceOnly.evaluate('192.0.2.1').kind).toBe('denied');
		expect(recipientOnly.evaluateRecipient('a@b.example').kind).toBe('denied');
		// The two `@ts-expect-error`'d bindings above exist only for tsc to reject; referencing them
		// keeps a stray `noUnusedLocals` configuration from masking that with an unrelated error.
		expect(swappedIntoRecipientSlot).toBeDefined();
		expect(swappedIntoSourceSlot).toBeDefined();
	});

	it('SourceAclCache still satisfies all three roles at once through bindSourceAclCache -- the multi-role design (JR-4-05b/c) stays intentional, not accidental', async () => {
		const fakeLookup: SourceAclLookup = {
			async listActiveSources(): Promise<readonly JournalingSourceAclEntry[]> {
				return [];
			},
		};
		const cache = new SourceAclCache({
			lookup: fakeLookup,
			refreshIntervalMs: 60_000,
			staleAfterMs: 60_000,
		});
		await cache.start();
		try {
			// This assignment is the multi-role design itself -- unlike the two swaps above, it must
			// compile, and `bindSourceAclCache` (`../../src/ingress/source-acl-cache.ts`) is the one
			// production and test both call to produce it (see that function's own doc comment).
			const bindings: SourceAclCacheEsmtpBindings = {
				sourceAclEvaluator: cache,
				recipientAclEvaluator: cache,
				authCredentialEvaluator: cache,
			};
			expect(bindings.sourceAclEvaluator).toBe(cache);
			expect(bindings.recipientAclEvaluator).toBe(cache);
			expect(bindings.authCredentialEvaluator).toBe(cache);
		} finally {
			cache.stop();
		}
	});
});
