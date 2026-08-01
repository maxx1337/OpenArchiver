import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import type { CaslPolicy } from '@open-archiver/types';
import { PolicyValidator } from '../../src/iam-policy/policy-validator';
import { mongoToDrizzle } from '../../src/helpers/mongoToDrizzle';

/**
 * The two gates that judge a policy condition, held against each other (JR-13-13, epic E13).
 *
 * Classification: `ci`. Both modules under test are pure -- `PolicyValidator` imports types and
 * `helpers/conditionKey`, `mongoToDrizzle` imports `drizzle-orm` and the same helper. Neither opens
 * a socket.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this file exists rather than two files, one per gate
 * ---------------------------------------------------------------------------------------------
 * A condition key passes two gates. `PolicyValidator` decides whether a policy may be *stored*
 * (`iam.controller.ts` turns a refusal into HTTP 400 on `POST`/`PUT /roles`), and `mongoToDrizzle`
 * decides whether a stored policy may be *translated* into a row filter. They are meant to reach the
 * same verdict.
 *
 * They did not. Each carried its own copy of the rule, and while every test of each gate on its own
 * looked right, the validator accepted any number of dot-separated segments and any relation prefix
 * while the translator accepted at most two segments and only a relation it could resolve. So
 * `foo.bar` and `attachment.name` were stored with HTTP 200 and then made every scoped query of that
 * role fail -- fail-closed, but the operator upgrade guide states the opposite, that such a key is
 * refused when the role is saved.
 *
 * The construction that finds this is the one below: send **every** key through **both** gates and
 * compare the verdicts side by side. Two separate files cannot see a divergence, because neither one
 * knows what the other decided.
 *
 * ---------------------------------------------------------------------------------------------
 * What the shared predicate covers, and what it deliberately does not
 * ---------------------------------------------------------------------------------------------
 * Covered: the form of a key that is meant to name a column, and the shape of `conditions` itself.
 *
 * Not covered, and asserted as such further down so that closing either gap has to be a deliberate
 * edit to this file:
 *
 *   1. **Whether the column exists.** `foo` is a single harmless identifier that names no column. It
 *      passes both gates on purpose: the check needs the subject the filter is applied to, and the
 *      same policy statement can be written for several subjects.
 *   2. **Operator names.** `$regex` is accepted by the validator and refused by the translator. The
 *      SQL translator and the search translator support different operator sets, so there is no one
 *      allowlist a save-time gate could agree with; an unsupported operator is reported at query
 *      time instead.
 *   3. **An empty condition object.** `conditions: {}` is an object, so it is storable; it states no
 *      condition that can be checked against a row, so it is denied when used.
 */

/** Does the gate that runs before storage accept this key? */
function validatorAccepts(key: string): boolean {
	const policy = {
		action: 'read',
		subject: 'archive',
		conditions: { [key]: 'v' },
	} as unknown as CaslPolicy;
	return PolicyValidator.isValid(policy).valid;
}

/** Does the gate that runs at query time accept this key? */
function translatorAccepts(key: string): boolean {
	try {
		mongoToDrizzle({ [key]: 'v' });
		return true;
	} catch {
		return false;
	}
}

interface KeyCase {
	readonly key: string;
	readonly verdict: 'accept' | 'refuse';
	readonly why: string;
}

/**
 * Every case is stated with the verdict both gates must reach, not only with "they must agree".
 * Agreement alone is satisfied by two gates that are both broken in the same direction.
 */
const keyCases: readonly KeyCase[] = [
	{ key: 'userEmail', verdict: 'accept', why: 'a plain column reference' },
	{
		key: 'ingestionSource.userId',
		verdict: 'accept',
		why: 'the one relation prefix that resolves',
	},
	{
		key: 'foo',
		verdict: 'accept',
		why: 'a single identifier that names no column -- the deliberate gap, see the header',
	},
	{ key: 'foo.bar', verdict: 'refuse', why: 'two parts, and "foo" is not a resolvable relation' },
	{
		key: 'attachment.name',
		verdict: 'refuse',
		why: 'a plausible-looking relation prefix that does not resolve either',
	},
	{ key: 'a.b.c', verdict: 'refuse', why: 'more than two parts is not a column reference' },
	{
		key: 'ingestionSource.userId.x',
		verdict: 'refuse',
		why: 'a resolvable prefix does not buy a third part',
	},
	{ key: '.userId', verdict: 'refuse', why: 'an empty first part is not an identifier' },
	{ key: 'userEmail.', verdict: 'refuse', why: 'an empty second part is not an identifier' },
	{ key: '', verdict: 'refuse', why: 'the empty key' },
	{ key: '1userEmail', verdict: 'refuse', why: 'an identifier may not start with a digit' },
	{ key: 'user email', verdict: 'refuse', why: 'a space is not part of an identifier' },
	{
		key: 'ｕserEmail',
		verdict: 'refuse',
		why: 'a fullwidth homoglyph is not an ASCII identifier',
	},
	{
		key: 'userEmail\n',
		verdict: 'refuse',
		why: 'a trailing newline is not part of an identifier',
	},
	{ key: 'user\u0000Email', verdict: 'refuse', why: 'a NUL byte is not part of an identifier' },
	{ key: 'id" or 1=1 --', verdict: 'refuse', why: 'the injection from the original finding' },
	{
		key: 'ingestionSource.x" or 1=1 --',
		verdict: 'refuse',
		why: 'the same injection behind a resolvable relation prefix',
	},
	{
		key: 'userEmail" is not null or "id" is not null --',
		verdict: 'refuse',
		why: 'an injection that would widen rather than break the query',
	},
	{ key: 'id"; drop table archived_emails; --', verdict: 'refuse', why: 'statement termination' },
	{ key: '$$', verdict: 'refuse', why: 'a "$" prefix that is not a well-formed operator either' },
];

suite('ci', 'condition keys -- both gates reach the same verdict (JR-13-13)', () => {
	it('every key is judged the same way before storage and at query time', () => {
		coverageNotice(
			'This is the check that finding F29 was missed for: the verdicts of PolicyValidator ' +
				'and mongoToDrizzle are compared per key, in one place. Operator names and column ' +
				'existence are outside the shared predicate on purpose -- both carve-outs are ' +
				'asserted separately in this file.'
		);
		const divergent: string[] = [];
		const wrong: string[] = [];
		for (const { key, verdict, why } of keyCases) {
			const beforeStorage = validatorAccepts(key);
			const atQueryTime = translatorAccepts(key);
			if (beforeStorage !== atQueryTime) {
				divergent.push(
					`${JSON.stringify(key)}: PolicyValidator=${beforeStorage ? 'ACCEPT' : 'REFUSE'}, ` +
						`mongoToDrizzle=${atQueryTime ? 'ACCEPT' : 'REFUSE'} (${why})`
				);
			}
			if (beforeStorage !== (verdict === 'accept')) {
				wrong.push(
					`${JSON.stringify(key)}: expected both gates to ${verdict}, PolicyValidator ` +
						`said ${beforeStorage ? 'ACCEPT' : 'REFUSE'} (${why})`
				);
			}
		}
		expect(
			divergent,
			`the two gates disagree about ${divergent.length} key(s). A key one gate accepts and the ` +
				`other refuses is stored with HTTP 200 and then breaks every request that needs the ` +
				`policy. Both gates must ask helpers/conditionKey.resolveConditionKey().\n` +
				divergent.join('\n')
		).toEqual([]);
		expect(
			wrong,
			`the gates agree but on the wrong answer for ${wrong.length} key(s):\n${wrong.join('\n')}`
		).toEqual([]);
	});

	it('a refusal before storage names the offending key, because an operator reads it', () => {
		// `iam.controller.ts` returns this text with the 400. "invalid policy" would leave the
		// operator to find the key in a JSON blob by hand.
		for (const { key, verdict } of keyCases) {
			if (verdict !== 'refuse' || key === '') {
				continue;
			}
			const policy = {
				action: 'read',
				subject: 'archive',
				conditions: { [key]: 'v' },
			} as unknown as CaslPolicy;
			const { valid, reason } = PolicyValidator.isValid(policy);
			expect(valid, `${JSON.stringify(key)} was accepted`).toBe(false);
			// The message quotes the key with `JSON.stringify`, so a key containing a quote, a
			// newline or a NUL byte stays readable in a log line instead of breaking it.
			expect(reason, `the refusal of ${JSON.stringify(key)} does not name it`).toContain(
				JSON.stringify(key)
			);
		}
	});

	it('a nested key is judged like a top-level one, at both gates', () => {
		// Rejecting only top-level keys is a fix the exploit walks around: conditions nest, and both
		// translators recurse into $or/$and/$not before they build the column reference.
		const nested: Array<Record<string, unknown>> = [
			{ $or: [{ userEmail: 'a' }, { 'foo.bar': 'v' }] },
			{ $and: [{ 'a.b.c': 'v' }] },
			{ $not: { 'attachment.name': 'v' } },
			{ $or: [{ $and: [{ $not: { 'id" or 1=1 --': 'v' } }] }] },
		];
		for (const conditions of nested) {
			const policy = {
				action: 'read',
				subject: 'archive',
				conditions,
			} as unknown as CaslPolicy;
			expect(
				PolicyValidator.isValid(policy).valid,
				`accepted a nested bad key: ${JSON.stringify(conditions)}`
			).toBe(false);
			expect(
				() => mongoToDrizzle(conditions),
				`translated a nested bad key: ${JSON.stringify(conditions)}`
			).toThrow();
		}
	});
});

suite('ci', 'the shape of `conditions` itself is judged before storage (JR-13-13)', () => {
	/**
	 * A `conditions` that is not an object states no condition, and the two readings it invited were
	 * both wrong. A falsy value (`null`, `""`, `0`, `false`) was read at request time as "this rule
	 * carries no condition", which is unrestricted access -- a silently widened permission out of an
	 * obviously broken policy. A truthy scalar (`5`, `"userEmail"`) or an array was read as a
	 * condition and then refused, denying every request. Neither is what the author of such a policy
	 * meant, so it is refused before it is stored.
	 */
	const malformed: ReadonlyArray<{ readonly label: string; readonly conditions: unknown }> = [
		{ label: 'a number', conditions: 5 },
		{ label: 'zero', conditions: 0 },
		{ label: 'a string', conditions: 'userEmail' },
		{ label: 'the empty string', conditions: '' },
		{ label: 'true', conditions: true },
		{ label: 'false', conditions: false },
		{ label: 'null', conditions: null },
		{ label: 'an empty array', conditions: [] },
		{ label: 'an array of conditions', conditions: [{ userEmail: 'a@example.com' }] },
	];

	it.each(malformed)('refuses `conditions` that is $label', ({ conditions }) => {
		const policy = { action: 'read', subject: 'archive', conditions } as unknown as CaslPolicy;
		const { valid, reason } = PolicyValidator.isValid(policy);
		expect(valid, `accepted conditions: ${JSON.stringify(conditions)}`).toBe(false);
		expect(reason).toContain('conditions');
	});

	it.each(malformed)(
		'the translator refuses `conditions` that is $label too',
		({ conditions }) => {
			expect(() => mongoToDrizzle(conditions as Record<string, unknown>)).toThrow();
		}
	);

	it('a policy with no conditions at all stays valid -- absent is not malformed', () => {
		expect(PolicyValidator.isValid({ action: 'read', subject: 'archive' }).valid).toBe(true);
		expect(
			PolicyValidator.isValid({
				action: 'read',
				subject: 'archive',
				conditions: undefined,
			}).valid
		).toBe(true);
	});

	it('the policies shipped by createDefaultRoles and the fixtures still validate', () => {
		// Counter-check. A stricter gate that refuses what Open Archiver itself ships would be a
		// regression dressed up as a fix.
		const shipped: CaslPolicy[] = [
			{ action: 'manage', subject: 'all' },
			{ action: 'read', subject: 'dashboard' },
			{ action: 'create', subject: 'ingestion' },
			{ action: 'manage', subject: 'ingestion', conditions: { userId: '${user.id}' } },
			{
				action: 'manage',
				subject: 'archive',
				conditions: { 'ingestionSource.userId': '${user.id}' },
			},
			{
				action: ['read', 'search'],
				subject: ['ingestion', 'archive', 'dashboard', 'users', 'roles'],
			},
		];
		for (const policy of shipped) {
			const { valid, reason } = PolicyValidator.isValid(policy);
			expect(valid, `${JSON.stringify(policy)} was refused: ${reason}`).toBe(true);
		}
	});
});

/**
 * The carve-outs, asserted rather than described.
 *
 * Each of these is a place where the two gates deliberately do *not* agree, or where neither checks
 * something. Writing them down as passing assertions means that closing one of them turns this
 * describe block red, so it cannot happen by accident and cannot happen without someone reading the
 * reason. The alternative -- a comment -- is what let F29 stand.
 */
suite('ci', 'deliberate gaps in the shared predicate (JR-13-13)', () => {
	it('an identifier-shaped key that names no column passes both gates', () => {
		// Closing this needs the subject the filter is applied to, which neither gate has. It is
		// tracked separately; until then a typo in a column name surfaces as a database error and
		// the third query in the upgrade guide is what finds it.
		expect(validatorAccepts('foo')).toBe(true);
		expect(translatorAccepts('foo')).toBe(true);
	});

	it('an operator name is checked at query time only, not before storage', () => {
		// The SQL translator and the search translator support different operator sets, so there is
		// no single allowlist the save-time gate could apply without refusing a policy the other
		// translator would have accepted.
		const policy = {
			action: 'read',
			subject: 'archive',
			conditions: { subject: { $regex: '^invoice' } },
		} as unknown as CaslPolicy;
		expect(PolicyValidator.isValid(policy).valid).toBe(true);
		expect(() => mongoToDrizzle({ subject: { $regex: '^invoice' } })).toThrow(
			/unsupported operator/
		);
	});

	it('an empty condition object is storable and denied when used', () => {
		// `{}` is an object, so the shape check passes it. It expresses no condition that can be
		// checked against a row, so the translator refuses it and the row-level decision is a denial
		// rather than full access.
		expect(
			PolicyValidator.isValid({ action: 'read', subject: 'archive', conditions: {} }).valid
		).toBe(true);
		expect(() => mongoToDrizzle({})).toThrow();
	});
});
