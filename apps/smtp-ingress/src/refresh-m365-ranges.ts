import { readFile } from 'node:fs/promises';
import * as dotenv from 'dotenv';
import postgres from 'postgres';
import {
	diffM365Ranges,
	formatM365RangeDiff,
	M365_ENDPOINTS_BASE_URL,
	M365EndpointFeedError,
	parseM365SmtpRanges,
	type M365SmtpRangeSet,
} from '@open-archiver/journaling';

/**
 * `apps/smtp-ingress` -- the Microsoft 365 IP range refresh helper's entry point (`JR-4-09`, RFC
 * section 4.3). Reads the official endpoint list from a **file or stdin**, compares it against every
 * `journaling_sources.allowed_ips`, prints a diff, and changes nothing:
 *
 * ```
 * curl -s 'https://endpoints.office.com/endpoints/worldwide?clientRequestId=<GUID>' > m365.json
 * pnpm --filter smtp-ingress-app refresh-m365-ranges m365.json      # or: … | … refresh-m365-ranges
 * ```
 *
 * ---------------------------------------------------------------------------------------------
 * Why this does not fetch the list itself -- decided by the Product Owner on 2026-08-03
 * ---------------------------------------------------------------------------------------------
 * The backlog wording for `JR-4-09` is "holt die offizielle Endpunktliste", and an earlier draft of
 * this file did exactly that with `fetch`. That draft **failed a test**, and the test was right:
 * `packages/journaling/tests/unit/no-outbound-mail-path.test.ts` (`JR-4-07`, RFC section 4.4 "no
 * relaying, ever") scans this very directory for any call that opens an outbound connection --
 * `fetch` explicitly included -- because the receiver's security story is that it *only ever accepts*
 * connections. Three ways out were put to the Product Owner (weaken the scan with a named exemption,
 * move this helper into its own workspace package, or stop fetching); the decision was the third,
 * and it is the strongest of them rather than the cheapest:
 *
 *  - The `JR-4-07` guard stays **untouched and unweakened**. No exemption list, no narrowed scope.
 *  - **The mail-receiving host needs no outbound internet access at all** -- which in a
 *    compliance-grade deployment it usually is not allowed to have anyway. The download happens
 *    wherever the operator's change process already lives.
 *  - The operator sees the bytes they are acting on. A diff computed from a feed nobody looked at is
 *    weaker input to a security decision than a file that was fetched, kept, and can be attached to
 *    the change ticket.
 *
 * The named deviation: the *download* is a documented operator step (the `curl` line above, with the
 * `clientRequestId` GUID Microsoft's service requires -- see {@link M365_ENDPOINTS_BASE_URL}), not
 * something this program performs. Everything else `JR-4-09` asks for -- reading the official list,
 * producing a diff for approval, applying nothing -- is here.
 *
 * ---------------------------------------------------------------------------------------------
 * This program cannot change the ACL, and that is its main design property
 * ---------------------------------------------------------------------------------------------
 * RFC section 4.3: the refresh must produce "a diff for operator approval rather than auto-applying",
 * because "a silently widened ACL is a security regression". Three independent things make that true
 * here rather than merely intended:
 *
 *  1. **No writing statement exists in this file.** The only SQL is one `select` over
 *     `journaling_sources`.
 *  2. **The credential cannot write either.** This reuses `SMTP_INGRESS_DATABASE_URL` -- the receive
 *     path's own read-only role (ADR-002's privilege-separation table: `SELECT` on
 *     `journaling_sources`, nothing else). Even a future editing mistake here would be refused by
 *     Postgres.
 *  3. **The diff logic has no database or filesystem access at all** -- pure functions in
 *     `@open-archiver/journaling`'s `m365-ip-ranges.ts` (see that module's doc comment).
 *
 * `packages/backend/tests/integration/m365-range-refresh-cli.int.test.ts` measures 1 and 2 directly:
 * it runs this compiled program against a real database and then re-reads every `allowed_ips` row to
 * show it is byte-for-byte unchanged. That test is calibrated -- with an `update` deliberately added
 * here, it fails.
 *
 * ---------------------------------------------------------------------------------------------
 * Exit codes, so this can be a monitored routine and not just a one-off command
 * ---------------------------------------------------------------------------------------------
 * `0` -- every official range is covered by every source's ACL. `2` -- at least one source is missing
 * a range (or the list contained an unparseable entry): actionable, not an error. `1` -- the helper
 * could not do its job (no configuration, unreadable input, database unreachable). The split matters
 * for an operator whose nightly cron should stay quiet when nothing changed, page a human only for
 * `1`, and open a change ticket for `2`.
 */

dotenv.config();

const USAGE =
	'usage: refresh-m365-ranges [<endpoint-list.json>]\n' +
	'  With no argument (or "-"), the list is read from stdin. Fetch it first, e.g.:\n' +
	`  curl -s '${M365_ENDPOINTS_BASE_URL}?clientRequestId=<GUID>' > m365.json\n` +
	'  The clientRequestId must be a GUID you generate; Microsoft rejects the request without one.';

/** Read the whole of stdin. Used for the `curl … | refresh-m365-ranges` form. */
async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
	}
	return Buffer.concat(chunks).toString('utf8');
}

async function readOfficialRanges(source: string | undefined): Promise<M365SmtpRangeSet> {
	const raw =
		source === undefined || source === '-' ? await readStdin() : await readFile(source, 'utf8');
	if (raw.trim() === '') {
		// An empty input must never look like "the official list is empty", which would make every
		// configured range look obsolete -- see m365-ip-ranges.ts on that distinction.
		throw new M365EndpointFeedError('the endpoint list was empty');
	}
	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch (err) {
		throw new M365EndpointFeedError(
			`the endpoint list is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
		);
	}
	return parseM365SmtpRanges(payload);
}

interface SourceRow {
	readonly id: string;
	readonly name: string;
	readonly routing_address: string;
	readonly allowed_ips: string[];
	readonly status: string;
}

async function main(): Promise<number> {
	const databaseUrl = process.env.SMTP_INGRESS_DATABASE_URL;
	if (databaseUrl === undefined || databaseUrl === '') {
		console.error(
			'refresh-m365-ranges: SMTP_INGRESS_DATABASE_URL is not set -- this helper reads the same\n' +
				'read-only credential the receive path uses (ADR-002).'
		);
		return 1;
	}

	const input = process.argv[2];
	if (input === undefined && process.stdin.isTTY) {
		console.error(`refresh-m365-ranges: no endpoint list given.\n${USAGE}`);
		return 1;
	}

	let feed: M365SmtpRangeSet;
	try {
		feed = await readOfficialRanges(input);
	} catch (err) {
		console.error(
			`refresh-m365-ranges: could not read the official endpoint list -- ` +
				`${err instanceof Error ? err.message : String(err)}\n${USAGE}`
		);
		// Deliberately not "the ACL is up to date": an unread list says nothing about the ACL.
		return 1;
	}

	const sql = postgres(databaseUrl, { onnotice: () => {} });
	try {
		const rows = await sql<SourceRow[]>`
			select id, name, routing_address, allowed_ips, status
			from journaling_sources
			order by routing_address
		`;
		if (rows.length === 0) {
			console.log(
				'refresh-m365-ranges: no journaling sources are configured; nothing to compare.'
			);
			return 0;
		}

		let actionable = false;
		const reports: string[] = [];
		for (const row of rows) {
			const diff = diffM365Ranges({ configured: row.allowed_ips, official: feed.ranges });
			if (!diff.upToDate) actionable = true;
			reports.push(
				formatM365RangeDiff(diff, {
					sourceLabel:
						`${row.name} <${row.routing_address}> (${row.id})` +
						`${row.status === 'active' ? '' : ` [${row.status}]`}`,
					feed,
				})
			);
		}
		console.log(reports.join('\n\n'));
		return actionable ? 2 : 0;
	} catch (err) {
		console.error(
			`refresh-m365-ranges: could not read journaling_sources -- ` +
				`${err instanceof Error ? err.message : String(err)}`
		);
		return 1;
	} finally {
		await sql.end({ timeout: 5 }).catch(() => undefined);
	}
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error('refresh-m365-ranges: unexpected failure --', error);
		process.exit(1);
	}
);
