# Access Control Changes in Role Policies

Read this page **before** upgrading to a release whose release notes point to it. It describes a set
of changes to the way role policies are evaluated, and it contains SQL you can run against your own
database — on your current version, before you upgrade — to look for the roles that behave differently
afterwards.

None of the changes touch the policy format. Your stored policies are read exactly as before; what
changes is the answer the application gives for a few specific shapes of policy.

## The change in one sentence

A permission that no rule grants is now **denied**, where it previously placed **no restriction** at
all on the query.

Until this release, "this role has no applicable permission" and "this role may see everything" were
represented by the same internal value, and the second reading was the one that took effect. A role
whose only statement about archived emails was a prohibition therefore granted unrestricted access to
the whole archive. That is now a denial: a user who previously saw everything through such a role now
sees nothing.

The rest of this page describes the shapes of policy these changes affect, gives you queries that look
for them in your own database, and — because a query over a schemaless column cannot be shown to be
complete — a behaviour check that does not depend on the shapes at all. Read
[How to read an empty result](#how-to-read-an-empty-result) before you take a query's output as an
all-clear.

## What changes

### 1. A permission that no rule grants is denied

If a role has no `can` rule for the action and subject being checked — because it has no rule for
them at all, or because it only has `cannot` rules — the query is now denied instead of unrestricted.

**Who this affects:** roles whose only statement about a subject is a prohibition. This is the shape
you get when you write a role by starting from "this role must not see mailbox X" and never add the
matching `can` rule. Such a role granted full access before; it grants nothing now.

**How to fix it:** state the grant explicitly and carve the exception out of it, which is the pattern
described under
[Inverted Rules](/services/iam-service/iam-policy#inverted-rules-creating-exceptions-with-cannot):

```json
[
	{ "action": ["read", "search"], "subject": "archive" },
	{
		"inverted": true,
		"action": ["read", "search"],
		"subject": "archive",
		"conditions": { "userEmail": "someone@example.com" }
	}
]
```

### 2. A prohibition that carries no condition revokes the action

A `cannot` rule without a `conditions` object cannot be expressed as a row filter — there is no row
it would single out. It is now treated as what it says: the action is revoked, and the query is
denied. Previously such a rule was dropped, and a broad `can` next to it produced full access.

Requests made over the HTTP API were already rejected for these roles by the permission check on the
route, so in most installations this change is not visible from the outside.

### 3. A grant with an empty condition object is denied

A rule written as `"conditions": {}` states no condition that can be checked against a row. It is now
denied rather than treated as an unconditional grant. Either remove the key, which makes the rule
unconditional on purpose, or fill in the condition you meant.

An empty object states nothing wherever it stands, so the same applies below the top level: a branch of
an `$or`/`$and` written as `{}`, the body of a `$not`, or the value of a condition key as in
`{"userEmail": {}}`. Such a condition is refused when the policy is used, which is change 7.

### 4. Searching the archive uses the search permission

The row filter for a search over the archive is now built from the role's `search` rules. It was
previously built from the role's `read` rules, while the route itself checked `search` — so a role
that granted `search` on `archive` without granting `read` searched the entire archive unfiltered.

**Who this affects:** roles that grant `search` on `archive` but not `read`. After the upgrade their
searches are restricted by the conditions of their own `search` rule, which is what the policy says.
Note that such a role can search but cannot open a result, because opening one is a `read`. Grant both
actions together, the way the read-only example in
[IAM Policy](/services/iam-service/iam-policy#global-read-only-auditor) does.

A role that uses `manage` on `archive`, or that grants `read` and `search` together, is unaffected.

### 5. A prohibition whose condition uses an operator now excludes

A `cannot` rule whose condition uses an operator — `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$ne`,
`$exists` — did not exclude anything before this release; the exclusion was silently lost, and the
rows the policy author wanted hidden stayed visible. The exclusion now takes effect.

**Who this affects:** anybody using an operator inside a `cannot` rule. Users of that role will see
**fewer** rows after the upgrade than before — the number the policy always intended. Check that the
exclusion is really the one you want before you upgrade, because it starts working.

### 6. Condition keys must be column references

A condition key is a column name, optionally prefixed by a resolvable relation
(`userEmail`, `ingestionSource.userId`). Keys are now checked against that shape:

- **Saving** a role whose condition key is not of that shape fails with HTTP `400` and a message
  naming the key. This applies to `POST` and `PUT` on roles.
- An **already stored** key of that shape is refused when the policy is used, so requests that need
  the policy return an error instead of a result set.

Only `ingestionSource` resolves as a relation prefix. A two-part key with any other prefix, and a key
with more than two parts, is refused.

This is the most visible change for an operator, because a malformed key in a stored policy used to
have no effect at all. It was neither honoured nor reported — the rule silently restricted nothing.

### 7. A condition that cannot be translated raises an error

A stored policy whose condition cannot be expressed as a database query now produces an error for the
requests that need that policy. It is no longer partially translated. Conditions in this class are: an
operator outside the supported list; an `$or` or `$and` with no branches, or one whose value is not a
list of branches; a branch of an `$or`/`$and`, or the body of a `$not`, that is not an object of
condition keys; and an empty condition object — not only as the rule's own `conditions`, but also as a
branch or as the value of a condition key, where it is just as untranslatable.

That is deliberate: a partially translated condition means something different from what the policy
says, in either direction — it can hide rows the role is entitled to, and it can expose rows a
prohibition was meant to hide. An error is findable, a wrong result set is not.

The supported operators are the ones documented in
[IAM Policy](/services/iam-service/iam-policy#supported-operators-and-examples): `$eq`, `$ne`, `$gt`,
`$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, plus `$or`, `$and` and `$not` for combining
conditions. Anything else — `$regex` and `$nor` are the ones that come up in practice — was never
supported and is now refused rather than dropped.

### 8. A `conditions` value that must be an object is checked when the role is saved

`conditions` is a JSON object of condition keys, or it is absent. Saving a role whose `conditions` is
a number, a string, a boolean, `null` or an array now fails with HTTP `400`. Such a value states no
condition that can be checked against a row, and it was accepted before.

This check is made on the rule's own `conditions`. A value in the wrong shape **deeper inside** a
condition — a branch of an `$or`, the body of a `$not`, an empty object as the value of a key — is not
refused when the role is saved; it is refused when the policy is used, which is change 7.

For policies **already** in your database this release changes nothing about the shape check — it
happens when a role is saved, not when it is read — but what those policies do today depends on the
value:

- A value JSON reads as empty — `null`, `false`, `0`, `""` — counts as "this rule carries no
  condition". The rule then applies without restriction, which for a grant means unrestricted access
  and for a prohibition means the action is revoked. That was the behaviour before this release and
  it still is.
- Any other non-object value — a non-zero number, a non-empty string, `true`, an array — counts as a
  condition. It cannot be translated, so the request is denied. Before this release such a rule
  either granted unrestricted access or produced a database error, depending on the value.

The second case is change 1 in a different guise: a role that saw everything and sees nothing
afterwards. Query 2 below reports both, and says which of the two it found.

## What is still not checked

A condition key that has the shape of a column reference but names **no existing column** is not
rejected when the role is saved. It is only noticed when a request uses the policy, and then it
surfaces as a database error. A typo in a column name is the usual cause.

The check cannot be made when the role is saved, because the same policy statement can be written for
several subjects, and the column set depends on the subject. Do not read this page as "your policies
are fully validated": the third query below is what looks for this case, for the subjects it can
resolve, and you have to run it yourself.

## The predefined roles are not affected

None of the roles Open Archiver defines itself is affected by any of the changes above, for the
action and subject combinations the application actually filters on. The super-admin role holds an
unconditional grant on everything, and the other two predefined policies either grant their subject
unconditionally or grant it with a condition that translates. This is covered by an automated test
that runs against a real database on every change.

One thing to know before you go looking: in a fresh installation the **only** predefined role that is
actually created is the super-admin role, created for the first user during setup. The other
predefined policies exist as templates in the documentation, not as rows in your database. If you
search your roles for a read-only role and find none, that is not a fault in your installation — you
have to create one, and the [IAM Policy](/services/iam-service/iam-policy#policy-examples) page has
the policy to paste.

That is also why the review below matters: because there is no shipped read-only role, every
restricted role in your installation is hand-written, and hand-written restrictions are exactly what
these changes affect.

## Before you upgrade: review your roles

The three queries below read `roles`, `users` and `user_roles` only. They work on your current
version, they change nothing, and you can run them again after the upgrade.

Connect to the Open Archiver database — with the default Docker Compose setup:

```bash
docker compose exec postgres psql -U open_archiver -d open_archiver
```

### Query 1 — users without a role

A user with no role at all has no applicable permission, so every row-level check for that user is now
a denial. Such a user could read the whole archive before.

```sql
SELECT u.email
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
WHERE ur.user_id IS NULL
ORDER BY u.email;
```

Rows here are users who will see an empty archive after the upgrade. Assign them a role, or confirm
that they are meant to have no access.

### Query 2 — roles whose behaviour changes

This is the widest of the three queries. It expands every rule in `roles.policies`, walks into the
`conditions` objects, and reports one row per role and finding, with the rule number the finding is in
— counted from 1 in the order the rules appear in the policy. What it reports, and what it cannot, is
spelled out under [How to read an empty result](#how-to-read-an-empty-result) below the query; read
that before you act on the output, in either direction.

The row-level findings are limited to the three permissions the application actually builds a row
filter for: reading archived emails, searching the archive, and listing ingestion sources. A role that
has no rule for some other combination is not reported, because nothing filters on it. The same limit
applies to the finding for a `conditions` that is not an object at all, which is reported per action and
subject.

The findings **inside** a `conditions` object — condition keys, operators, and the shape of the nodes
below the top level — are not limited that way. They are reported for every rule in the policy, because
a condition the application refuses is worth fixing whatever action and subject it is attached to.

```sql
WITH RECURSIVE rule AS (
    SELECT r.name AS role_name,
           r.slug AS role_slug,
           p.ord  AS rule_no,
           p.rule AS rule
    FROM roles r
    CROSS JOIN LATERAL jsonb_array_elements(r.policies) WITH ORDINALITY AS p(rule, ord)
),
scoped_pair (action, subject) AS (
    VALUES ('read', 'archive'), ('search', 'archive'), ('read', 'ingestion')
),
listed AS (
    SELECT rule.*,
           coalesce((rule.rule ->> 'inverted')::boolean, false) AS inverted,
           a.action,
           s.subject
    FROM rule
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(rule.rule -> 'action') = 'array'
             THEN rule.rule -> 'action'
             ELSE jsonb_build_array(rule.rule -> 'action') END) AS a(action)
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(rule.rule -> 'subject') = 'array'
             THEN rule.rule -> 'subject'
             ELSE jsonb_build_array(rule.rule -> 'subject') END) AS s(subject)
),
pair AS (
    SELECT l.role_name, l.role_slug, l.rule_no, l.inverted, l.rule,
           sp.action, sp.subject
    FROM listed l
    JOIN scoped_pair sp
      ON (l.action = 'manage' OR l.action = sp.action)
     AND (l.subject = 'all'  OR l.subject = sp.subject)
),
cond AS (
    SELECT r0.role_name, r0.role_slug, r0.rule_no, r0.inverted,
           NULL::text AS key,
           '"conditions"'::text AS path,
           r0.rule -> 'conditions' AS node
    FROM (SELECT rule.*, coalesce((rule.rule ->> 'inverted')::boolean, false) AS inverted
          FROM rule) r0
    WHERE jsonb_typeof(r0.rule -> 'conditions') = 'object'
  UNION ALL
    SELECT c.role_name, c.role_slug, c.rule_no, c.inverted, child.key,
           c.path || CASE WHEN child.key IS NULL THEN ' -> []'
                          ELSE ' -> ' || to_json(child.key)::text END,
           child.value
    FROM cond c
    CROSS JOIN LATERAL (
        SELECT kv.key, kv.value
        FROM jsonb_each(CASE WHEN jsonb_typeof(c.node) = 'object'
                             THEN c.node ELSE '{}'::jsonb END) AS kv
        UNION ALL
        SELECT NULL::text, ae.value
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.node) = 'array'
                                       THEN c.node ELSE '[]'::jsonb END) AS ae
    ) AS child
),
finding AS (
    -- 1. A prohibition on a permission the role is never granted.
    SELECT p.role_name, p.role_slug,
           'prohibition without a matching grant' AS finding,
           format('%s %s is forbidden by rule #%s, but no rule grants it',
                  p.action, p.subject, p.rule_no) AS detail
    FROM pair p
    WHERE p.inverted
      AND NOT EXISTS (SELECT 1 FROM pair g
                      WHERE g.role_name = p.role_name AND NOT g.inverted
                        AND g.action = p.action AND g.subject = p.subject)

    UNION ALL
    -- 4. Searching the archive without being allowed to read it.
    SELECT DISTINCT p.role_name, p.role_slug,
           'archive search granted without archive read',
           'search archive is granted, read archive is not'
    FROM pair p
    WHERE NOT p.inverted AND p.action = 'search' AND p.subject = 'archive'
      AND NOT EXISTS (SELECT 1 FROM pair g
                      WHERE g.role_name = p.role_name AND NOT g.inverted
                        AND g.action = 'read' AND g.subject = 'archive')

    UNION ALL
    -- 2. A prohibition that carries no condition.
    SELECT DISTINCT p.role_name, p.role_slug,
           'prohibition without conditions',
           format('rule #%s forbids %s %s and carries no condition',
                  p.rule_no, p.action, p.subject)
    FROM pair p
    WHERE p.inverted
      AND (NOT (p.rule ? 'conditions') OR jsonb_typeof(p.rule -> 'conditions') = 'null')

    UNION ALL
    -- 3. An empty condition object: the rule's own "conditions", and every node below it that the
    --    walk reaches. The application refuses one wherever it stands, so a root-only check would
    --    stay quiet about `{"$or": [{"userEmail": "a@x"}, {}]}`, which fails exactly the way
    --    `"conditions": {}` does. An ordinary condition value is a scalar or an operator object and
    --    is not matched here.
    SELECT DISTINCT c.role_name, c.role_slug,
           'empty condition object',
           format('rule #%s: %s is {}, which states no condition that can be checked against a row',
                  c.rule_no, c.path)
    FROM cond c
    WHERE c.node = '{}'::jsonb

    UNION ALL
    -- 8. A "conditions" that exists and is not an object. Not walked into -- there are no keys to
    --    walk -- so the value itself is reported, together with how it is read.
    SELECT DISTINCT p.role_name, p.role_slug,
           'conditions is not an object',
           format('rule #%s (%s %s %s) has "conditions": %s, which is not an object. %s',
                  p.rule_no, CASE WHEN p.inverted THEN 'cannot' ELSE 'can' END,
                  p.action, p.subject, p.rule -> 'conditions',
                  CASE WHEN p.rule -> 'conditions'
                            IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb)
                       THEN 'It counts as "no condition at all", as it did before this release.'
                       ELSE 'It counts as a condition that cannot be translated, so the request is '
                            || 'denied where it was unrestricted or an error before.'
                  END)
    FROM pair p
    WHERE p.rule ? 'conditions'
      AND jsonb_typeof(p.rule -> 'conditions') <> 'object'

    UNION ALL
    -- 5. A prohibition whose condition uses an operator: the exclusion starts working.
    SELECT DISTINCT c.role_name, c.role_slug,
           'prohibition with an operator condition',
           format('rule #%s uses the operator %s inside a "cannot" condition', c.rule_no, c.key)
    FROM cond c
    WHERE c.inverted
      AND c.key IN ('$in', '$nin', '$gt', '$gte', '$lt', '$lte', '$ne', '$exists')

    UNION ALL
    -- 6. Condition keys that are not column references.
    SELECT DISTINCT c.role_name, c.role_slug,
           'condition key is not a column reference',
           format('rule #%s: key %s', c.rule_no, to_json(c.key)::text)
    FROM cond c
    WHERE c.key IS NOT NULL
      AND left(c.key, 1) <> '$'
      AND (EXISTS (SELECT 1 FROM unnest(string_to_array(c.key, '.')) AS seg
                   WHERE seg !~ '^[A-Za-z_][A-Za-z0-9_]*$')
           OR array_length(string_to_array(c.key, '.'), 1) > 2)

    UNION ALL
    -- 6. A two-part key naming a relation that does not resolve.
    SELECT DISTINCT c.role_name, c.role_slug,
           'condition key names an unresolvable relation',
           format('rule #%s: key %s (resolvable relation: ingestionSource)',
                  c.rule_no, to_json(c.key)::text)
    FROM cond c
    WHERE c.key IS NOT NULL
      AND left(c.key, 1) <> '$'
      AND array_length(string_to_array(c.key, '.'), 1) = 2
      AND split_part(c.key, '.', 1) <> 'ingestionSource'
      AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(c.key, '.')) AS seg
                      WHERE seg !~ '^[A-Za-z_][A-Za-z0-9_]*$')

    UNION ALL
    -- 7. An operator that is not supported.
    SELECT DISTINCT c.role_name, c.role_slug,
           'unsupported condition operator',
           format('rule #%s: operator %s', c.rule_no, to_json(c.key)::text)
    FROM cond c
    WHERE c.key LIKE '$%'
      AND c.key NOT IN ('$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
                        '$in', '$nin', '$exists', '$or', '$and', '$not')

    UNION ALL
    -- 7. An "$or"/"$and" with no branches.
    SELECT DISTINCT c.role_name, c.role_slug,
           'condition branch list is empty',
           format('rule #%s: %s has no branches', c.rule_no, c.key)
    FROM cond c
    WHERE c.key IN ('$or', '$and')
      AND jsonb_typeof(c.node) = 'array'
      AND jsonb_array_length(c.node) = 0

    UNION ALL
    -- 7. A branch of an "$or"/"$and" that is not a condition object. Each branch is a condition in
    --    its own right and is checked like the rule's own "conditions", so a number, a string, a
    --    list or null in that position is refused. Only branch positions are read: this is
    --    deliberately not "any node that is not an object", which would report the value of every
    --    ordinary condition, and not the elements of an operand list such as the array of an "$in",
    --    whose elements are values rather than conditions.
    SELECT DISTINCT c.role_name, c.role_slug,
           'condition node is not an object',
           format('rule #%s: a branch of %s is %s, not an object of condition keys',
                  c.rule_no, c.path, b.value)
    FROM cond c
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN c.key IN ('$or', '$and') AND jsonb_typeof(c.node) = 'array'
             THEN c.node ELSE '[]'::jsonb END) AS b(value)
    WHERE jsonb_typeof(b.value) <> 'object'

    UNION ALL
    -- 7. The body of a "$not" that is not a condition object, for the same reason.
    SELECT DISTINCT c.role_name, c.role_slug,
           'condition node is not an object',
           format('rule #%s: the body of %s is %s, not an object of condition keys',
                  c.rule_no, c.path, c.node)
    FROM cond c
    WHERE c.key = '$not'
      AND jsonb_typeof(c.node) <> 'object'

    UNION ALL
    -- 7. An "$or"/"$and" whose value is not a list of branches at all.
    SELECT DISTINCT c.role_name, c.role_slug,
           'condition branch list is not an array',
           format('rule #%s: %s is %s, not an array of branches',
                  c.rule_no, c.path, c.node)
    FROM cond c
    WHERE c.key IN ('$or', '$and')
      AND jsonb_typeof(c.node) <> 'array'
)
SELECT role_name, coalesce(role_slug, '(none)') AS slug, finding, detail
FROM finding
ORDER BY role_name, finding, detail;
```

Every row names the role, the rule inside it, and which change applies; the sections above say what to
do about each.

#### How to read an empty result

No rows means the query reported none of its findings. It does **not** mean that no role is affected,
and the difference matters enough to spell out: `roles.policies` is a JSONB column with no schema
behind it. A policy can be shaped in a way nobody has written down, so **a query over that column
cannot be shown to be complete** — for any list of shapes, another one can be constructed a level
deeper. Read an empty result as an indication, not as a clearance, and run the behaviour check in
[After the upgrade](#after-the-upgrade), which does not depend on knowing the shapes at all.

**What it reports:**

- every rule in every row of `roles.policies`, expanded per action and per subject. `manage` is
  matched against each of the three permissions the application builds a row filter for, and
  `subject: "all"` is matched against each of them too.
- the three findings that need no condition at all: a prohibition without a matching grant, a
  prohibition carrying no condition, and archive search granted without archive read.
- a `conditions` that exists and is **not** an object, together with which of the two readings under
  change 8 applies to the value it found. That value is reported as it stands and is not walked into,
  so a condition nested inside an array-shaped `conditions` gets no finding of its own.
- findings inside a `conditions` that **is** an object, at the rule's own `conditions` and at the
  nodes below it the walk descends into: an empty condition object, an operator key, the shape of a
  condition key, a relation prefix that does not resolve, an `$or`/`$and` with no branches or with a
  value that is not a list of branches, and an `$or`/`$and` branch or `$not` body that is not an
  object of condition keys. Each finding names the position it was found at, so
  `"conditions" -> "$or" -> []` is a branch and `"conditions" -> "userEmail"` is the value of a key.

**What it does not report:**

- **whether a condition key names a column that exists.** Query 3 below looks for that, for the
  subjects it can resolve. Run it as well — an empty result from Query 2 does not stand in for it.
- **a scalar value in the wrong place.** A condition on the right column with a wrong value — an
  address that is no longer in use, an ID that belongs to something else — is a policy mistake this
  page's queries cannot tell from a correct one. A value that is itself a **structure** is a different
  matter: an empty object, or a branch list where a value belongs, changes what the rule does, and it
  is reported as one of the findings above.
- **anything outside the `roles` table.** A role in a database this query is not run against is
  invisible to it, and so is any permission granted by some other mechanism.
- **a rule whose own structure is not the documented one.** The query assumes each rule is an object
  carrying `action`, `subject`, optionally `inverted` and optionally `conditions`. A rule that is not
  that — a bare number or string where a rule object belongs, an `action` or `subject` that is neither
  a string nor an array of strings — is skipped without a row. If you have hand-edited policies
  directly in the database, read those roles yourself.
- **a shape that is not in the list above.** That is the limit of a query over a schemaless column, not
  a gap somebody forgot to close: the queries report what has been written down, and the behaviour
  check is what covers the rest.

**What it may report even though the role still works.** The queries err towards reporting. They match
on the shape they find at a position, not on what the application does with it, so a reported row is a
prompt to look — not a verdict that the role is broken. The known case: an empty object inside a
**value-level** operator list, such as `{"id": {"$in": [{}]}}`, is reported as an empty condition
object, and the rule is nevertheless translated and keeps working. Every finding names the position it
was found at, and that is what tells the two apart: a position ending in a condition key or an
`$or`/`$and` branch changes what the rule does, whereas one sitting inside the value of `$in`, `$nin`
or another value-level operator may not. When in doubt, use the behaviour check in
[After the upgrade](#after-the-upgrade) — it answers the question the query cannot.

One structural problem is not skipped but reported as a failure: if any `roles.policies` value is not
a JSON array, the query stops with `ERROR: cannot extract elements from an object`. That is the query
telling you it cannot answer, not an empty result — find the offending row with
`SELECT name FROM roles WHERE jsonb_typeof(policies) <> 'array';` and fix it before you read anything
into either query.

Query 2 and Query 3 are worth running again after the upgrade, and neither replaces the last step on
this page: exercising each role you changed.

### Query 3 — condition keys that name no column

This query covers the gap described under
[What is still not checked](#what-is-still-not-checked). It resolves every condition key against the
table the filter is applied to — archived emails for the `archive` subject, ingestion sources for the
`ingestion` subject and for the `ingestionSource.` prefix — and reports the keys that name no column
there.

A rule whose subject is `all` is resolved against **both** tables, because `all` is not a third
subject: it maps onto every subject, so such a rule filters the archive and the ingestion source list
alike. You get one row per table the key fails to resolve against, so a key that exists in neither
appears twice. A key under `subject: "all"` that exists in one table and not the other is reported for
the table it is missing from — and that is a real finding, not noise: the request against that other
subject fails, even though the same rule works for the archive.

The application does **not** perform this check. The query does, and only for the two subjects above
and for `all`. A condition key on any other subject is not resolved, because the application builds no
row filter for those. A two-part key whose relation prefix does not resolve is not listed here either;
Query 2 reports it as a key-shape finding instead.

```sql
WITH RECURSIVE rule AS (
    SELECT r.name AS role_name,
           p.ord  AS rule_no,
           p.rule AS rule
    FROM roles r
    CROSS JOIN LATERAL jsonb_array_elements(r.policies) WITH ORDINALITY AS p(rule, ord)
),
listed AS (
    SELECT rule.role_name, rule.rule_no, s.subject
    FROM rule
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(rule.rule -> 'subject') = 'array'
             THEN rule.rule -> 'subject'
             ELSE jsonb_build_array(rule.rule -> 'subject') END) AS s(subject)
),
cond AS (
    SELECT role_name, rule_no, NULL::text AS key, rule -> 'conditions' AS node
    FROM rule
    WHERE jsonb_typeof(rule -> 'conditions') = 'object'
  UNION ALL
    SELECT c.role_name, c.rule_no, child.key, child.value
    FROM cond c
    CROSS JOIN LATERAL (
        SELECT kv.key, kv.value
        FROM jsonb_each(CASE WHEN jsonb_typeof(c.node) = 'object'
                             THEN c.node ELSE '{}'::jsonb END) AS kv
        UNION ALL
        SELECT NULL::text, ae.value
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.node) = 'array'
                                       THEN c.node ELSE '[]'::jsonb END) AS ae
    ) AS child
),
key_use AS (
    SELECT DISTINCT c.role_name, c.rule_no, l.subject, c.key
    FROM cond c
    JOIN listed l ON l.role_name = c.role_name AND l.rule_no = c.rule_no
    WHERE c.key IS NOT NULL
      AND left(c.key, 1) <> '$'
      AND array_length(string_to_array(c.key, '.'), 1) <= 2
      AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(c.key, '.')) AS seg
                      WHERE seg !~ '^[A-Za-z_][A-Za-z0-9_]*$')
),
subject_table (subject, table_name) AS (
    VALUES ('archive',   'archived_emails'),
           ('ingestion', 'ingestion_sources'),
           -- "all" is not a third subject: it maps onto every subject, so a rule written for it
           -- filters both tables and every key in it has to resolve against both.
           ('all',       'archived_emails'),
           ('all',       'ingestion_sources')
),
resolved AS (
    SELECT DISTINCT k.role_name, k.rule_no, k.subject, k.key,
           CASE
               WHEN array_length(string_to_array(k.key, '.'), 1) = 2
                    AND split_part(k.key, '.', 1) = 'ingestionSource' THEN 'ingestion_sources'
               WHEN array_length(string_to_array(k.key, '.'), 1) = 1 THEN st.table_name
           END AS table_name,
           lower(regexp_replace(
               split_part(k.key, '.', array_length(string_to_array(k.key, '.'), 1)),
               '([A-Z])', '_\1', 'g')) AS column_name
    FROM key_use k
    JOIN subject_table st ON st.subject = k.subject
)
SELECT role_name, rule_no, subject, key, table_name, column_name
FROM resolved r
WHERE table_name IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = r.table_name
        AND c.column_name = r.column_name)
ORDER BY role_name, rule_no, key, table_name;
```

Every row is a rule that does not do what its author expected, in this release and in the previous
one. Fix the key, or drop the rule.

## After the upgrade

The queries look for shapes in your policies. This check looks at behaviour instead, and that is why it
does not depend on any list of shapes being complete: it exercises the policies you actually have,
whatever they look like inside.

1. **Before you upgrade**, write down for each restricted role what a user holding it sees: how many
   rows the archive list returns, and the result count of one search. A role that has no user of its
   own can be measured with a test user you assign it to.
2. **After the upgrade**, or on a copy of the installation if you would rather not find this out in
   production, log in as a user of each of those roles and take the same two numbers again.
3. **Compare them.** A role that now returns nothing, or noticeably fewer rows, is affected by one of
   the changes above — the sections say which one and what to do. A role whose numbers are unchanged is
   not affected, whatever the queries did or did not report about it.

An empty result where you expect rows means the role has no grant for the permission being checked — go
back to change 1 above.

This step is cheaper than it was before this release, because a policy the application cannot translate
no longer fails quietly. The request that needs it returns an error instead of a result set, and the
reason is in the error response or the server log, depending on the endpoint. A broken condition
announces itself rather than handing back a plausible but wrong set of rows.
