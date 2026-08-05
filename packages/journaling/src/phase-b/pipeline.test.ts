import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { OrganizationDomainGroup, PendingEmail } from '@open-archiver/types';
import { loadFixture } from '../../tests/support/fixtures';
import { FakeLedgerLookup, ledgerEntry } from '../../tests/support/fake-ledger-lookup';
import { incomingFilePath } from '../spool/layout';
import type { MeasuredSpoolEntry } from './spool-entry-gate';
import type { SpoolEntryReader } from './spool-entry-reader';
import type { OrganizationDomainsPort } from './organization-domains-port';
import type {
	ArchiveObjectInput,
	ArchiveObjectOutcome,
	ArchiveObjectPort,
} from './archive-object-port';
import type { SpoolEntryReleaser } from './spool-entry-releaser';
import type { PhaseBAlert, PhaseBAlertSink } from './alerts';
import {
	PhaseBArchiveFailedError,
	PhaseBOwnerConfigMissingError,
	PhaseBSpoolEntryRefusedError,
	PhaseBSpoolFileUnreadableError,
	runPhaseBPipeline,
	type PhaseBPipelineDeps,
} from './pipeline';

/**
 * `runPhaseBPipeline()` (`JR-6-02b`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this suite does and does not re-prove
 * ---------------------------------------------------------------------------------------------
 * `classifySpoolEntry()`, `resolveOwner()`, `parseJournalReport()` and `ownerEnvelopeFor()` each have
 * their own dedicated suite already (`JR-6-02a`, E5, ADR-033). This file does not re-derive their
 * correctness -- it proves the thing only the pipeline itself is responsible for: that it calls them
 * in the right order, that a gate refusal or an archiving failure throws *before* anything
 * irreversible (indexing, releasing the spool file) happens, and that every resolved owner -- not just
 * the first -- gets archived and indexed.
 *
 * Every port is a hand-written fake, in this file, following `spool-entry-reader.ts`'s own precedent
 * for why Phase-B-specific test doubles do not need to live in `tests/support/`.
 */

const SPOOL_ROOT = '/spool';
const TXID = '01JZZAAAAAAAAAAAAAAAAAAAAB';
const CHAIN_SCOPE_ID = '11111111-1111-4111-8111-111111111111';
const JOURNALING_SOURCE_ID = '22222222-2222-4222-8222-222222222222';

class FakeSpoolEntryReader implements SpoolEntryReader {
	constructor(
		private readonly bytes: Buffer,
		private readonly measureError: Error | null = null
	) {}

	async measure(): Promise<MeasuredSpoolEntry> {
		if (this.measureError) {
			throw this.measureError;
		}
		return {
			sha256Hex: createHash('sha256').update(this.bytes).digest('hex'),
			sizeBytes: this.bytes.length,
		};
	}

	async read(): Promise<Buffer> {
		return this.bytes;
	}
}

class FakeOrganizationDomains implements OrganizationDomainsPort {
	constructor(private readonly groups: readonly OrganizationDomainGroup[] | null) {}

	async forJournalingSource(): Promise<readonly OrganizationDomainGroup[] | null> {
		return this.groups;
	}
}

class RecordingArchivePort {
	readonly calls: ArchiveObjectInput[] = [];
	private nextId = 1;

	constructor(private readonly outcomeFor: (input: ArchiveObjectInput) => ArchiveObjectOutcome) {}

	readonly port: ArchiveObjectPort = async (input) => {
		this.calls.push(input);
		return this.outcomeFor(input);
	};

	freshId(): string {
		return `archived-${this.nextId++}`;
	}
}

class RecordingReleaser implements SpoolEntryReleaser {
	readonly released: string[] = [];
	async release(path: string): Promise<void> {
		this.released.push(path);
	}
}

/** A receipt whose `content_sha256`/`size_bytes` describe exactly `bytes` -- an internally consistent, archivable row. */
function receiptFor(bytes: Buffer, overrides: Parameters<typeof ledgerEntry>[0] = {}) {
	return ledgerEntry({
		chainScopeId: CHAIN_SCOPE_ID,
		journalingSourceId: JOURNALING_SOURCE_ID,
		contentSha256: new Uint8Array(createHash('sha256').update(bytes).digest()),
		sizeBytes: BigInt(bytes.length),
		...overrides,
	});
}

function baseDeps(overrides: Partial<PhaseBPipelineDeps> = {}): PhaseBPipelineDeps {
	const archive = new RecordingArchivePort(() => ({
		kind: 'archived',
		archivedEmailId: 'unused-default',
	}));
	return {
		spoolRoot: SPOOL_ROOT,
		ledgerLookup: new FakeLedgerLookup(),
		spoolEntryReader: new FakeSpoolEntryReader(Buffer.from('placeholder')),
		organizationDomains: new FakeOrganizationDomains([]),
		archiveObject: archive.port,
		indexBatch: async () => {},
		releaseSpoolEntry: new RecordingReleaser(),
		alertSink: () => {},
		...overrides,
	};
}

suite(
	'ci',
	'runPhaseBPipeline() -- the happy path archives, indexes, then releases, in that order',
	() => {
		it('archives a journal_report through the port, indexes it, and releases the spool file last', async () => {
			const raw = loadFixture('basic-journal-report.eml');
			const ledger = new FakeLedgerLookup();
			ledger.set(TXID, receiptFor(raw));

			const events: string[] = [];
			const archive = new RecordingArchivePort((input) => {
				events.push(`archive:${input.ownerEmail}`);
				return { kind: 'archived', archivedEmailId: 'email-1' };
			});
			const indexed: PendingEmail[][] = [];
			const releaser = new RecordingReleaser();

			const result = await runPhaseBPipeline(
				TXID,
				baseDeps({
					ledgerLookup: ledger,
					spoolEntryReader: new FakeSpoolEntryReader(raw),
					// No domain groups configured -- resolveOwner()'s heuristic-no-groups path picks
					// to[0] (bob@contoso.com, JR-5-01's own documented expectation for this fixture) and,
					// unlike a domain match, never populates additionalMatches. A single deterministic
					// owner, isolated from the fan-out behaviour the next suite covers on purpose.
					organizationDomains: new FakeOrganizationDomains([]),
					archiveObject: archive.port,
					indexBatch: async (pending) => {
						events.push('index');
						indexed.push([...pending]);
					},
					releaseSpoolEntry: {
						release: async (path) => {
							events.push(`release:${path}`);
							await releaser.release(path);
						},
					},
				})
			);

			expect(result.parseKind).toBe('journal_report');
			expect(result.owners).toHaveLength(1);
			expect(result.owners[0]!.ownerEmail).toBe('bob@contoso.com');
			expect(events).toEqual([
				'archive:bob@contoso.com',
				'index',
				`release:${incomingFilePath(SPOOL_ROOT, TXID)}`,
			]);
			expect(indexed).toEqual([[{ archivedEmailId: 'email-1' }]]);
			expect(releaser.released).toHaveLength(1);
		});
	}
);

suite('ci', 'runPhaseBPipeline() -- fan-out over every resolved owner (constraint 4)', () => {
	it('archives once per matching recipient, not only the winner, and indexes all of them in one batch', async () => {
		const raw = loadFixture('basic-journal-report.eml');
		// to = [bob, carol]@contoso.com, cc = [dave]@contoso.com -- three inbound matches against one
		// configured group, so the winner (bob) has two additionalMatches (carol, dave).
		const ledger = new FakeLedgerLookup();
		ledger.set(TXID, receiptFor(raw));

		let counter = 0;
		const archive = new RecordingArchivePort(() => ({
			kind: 'archived',
			archivedEmailId: `email-${++counter}`,
		}));
		let indexedBatch: PendingEmail[] = [];

		const result = await runPhaseBPipeline(
			TXID,
			baseDeps({
				ledgerLookup: ledger,
				spoolEntryReader: new FakeSpoolEntryReader(raw),
				organizationDomains: new FakeOrganizationDomains([
					{ main: 'contoso.com', aliases: [] },
				]),
				archiveObject: archive.port,
				indexBatch: async (pending) => {
					indexedBatch = [...pending];
				},
			})
		);

		expect(result.owners.map((o) => o.ownerEmail)).toEqual([
			'bob@contoso.com',
			'carol@contoso.com',
			'dave@contoso.com',
		]);
		expect(archive.calls).toHaveLength(3);
		expect(indexedBatch).toEqual([
			{ archivedEmailId: 'email-1' },
			{ archivedEmailId: 'email-2' },
			{ archivedEmailId: 'email-3' },
		]);
	});
});

suite(
	'ci',
	'runPhaseBPipeline() -- a duplicate outcome is indexed, never treated as an error',
	() => {
		it('indexes the pre-existing archivedEmailId a duplicate outcome carries, and does not throw', async () => {
			const raw = loadFixture('basic-journal-report.eml');
			const ledger = new FakeLedgerLookup();
			ledger.set(TXID, receiptFor(raw));

			const archive = new RecordingArchivePort(() => ({
				kind: 'duplicate',
				archivedEmailId: 'pre-existing-email',
			}));
			let indexedBatch: PendingEmail[] = [];

			const result = await runPhaseBPipeline(
				TXID,
				baseDeps({
					ledgerLookup: ledger,
					spoolEntryReader: new FakeSpoolEntryReader(raw),
					organizationDomains: new FakeOrganizationDomains([
						{ main: 'contoso.com', aliases: [] },
					]),
					archiveObject: archive.port,
					indexBatch: async (pending) => {
						indexedBatch = [...pending];
					},
				})
			);

			expect(result.owners.every((o) => o.outcome.kind === 'duplicate')).toBe(true);
			// Every owner resolves to the same pre-existing id in this test, so the batch has one entry
			// per owner, each pointing at it -- the point is that 'duplicate' entries are indexed at all.
			expect(indexedBatch.length).toBe(result.owners.length);
			for (const entry of indexedBatch) {
				expect(entry.archivedEmailId).toBe('pre-existing-email');
			}
		});
	}
);

suite(
	'ci',
	'runPhaseBPipeline() -- the four parse kinds all archive, none is rejected (README constraint 4)',
	() => {
		it('archives a plain_bcc result using the header-derived envelope for metadata', async () => {
			const raw = Buffer.from(
				'From: alice@contoso.com\r\nTo: bob@contoso.com\r\nSubject: Ordinary memo\r\n\r\nBody.\r\n',
				'utf8'
			);
			const ledger = new FakeLedgerLookup();
			ledger.set(
				TXID,
				receiptFor(raw, {
					envelopeFrom: 'alice@contoso.com',
					envelopeRcpt: ['journal@example.com'],
				})
			);

			const archive = new RecordingArchivePort(() => ({
				kind: 'archived',
				archivedEmailId: 'e',
			}));

			const result = await runPhaseBPipeline(
				TXID,
				baseDeps({
					ledgerLookup: ledger,
					spoolEntryReader: new FakeSpoolEntryReader(raw),
					organizationDomains: new FakeOrganizationDomains([
						{ main: 'contoso.com', aliases: [] },
					]),
					archiveObject: archive.port,
				})
			);

			expect(result.parseKind).toBe('plain_bcc');
			expect(result.ownerFidelity).toBe('rfc5322-headers');
			expect(archive.calls[0]!.subject).toBe('Ordinary memo');
			expect(archive.calls[0]!.to).toEqual([{ name: '', address: 'bob@contoso.com' }]);
		});

		it("archives an ndr result, using the null reverse-path signal from the receipt's own envelope_from", async () => {
			const raw = Buffer.from(
				'From: postmaster@mx.example.org\r\nTo: journal-archive@example.org\r\n' +
					'Subject: Delivery has failed\r\n\r\nBounce body.\r\n',
				'utf8'
			);
			const ledger = new FakeLedgerLookup();
			// The null reverse-path (`MAIL FROM:<>`) is `''`, never `null` -- see SmtpTransactionEnvelope's
			// doc comment. This is the strongest NDR signal and it travels through the widened
			// LedgerEntryByTxId -> SpoolEntryArchive -> SmtpTransactionEnvelope chain this slice added.
			ledger.set(
				TXID,
				receiptFor(raw, { envelopeFrom: '', envelopeRcpt: ['journal-archive@example.org'] })
			);

			const archive = new RecordingArchivePort(() => ({
				kind: 'archived',
				archivedEmailId: 'e',
			}));

			const result = await runPhaseBPipeline(
				TXID,
				baseDeps({
					ledgerLookup: ledger,
					spoolEntryReader: new FakeSpoolEntryReader(raw),
					archiveObject: archive.port,
				})
			);

			expect(result.parseKind).toBe('ndr');
		});

		it('archives a parse_failed result (an empty spool file), tagging owner fidelity as none', async () => {
			const raw = Buffer.alloc(0);
			const ledger = new FakeLedgerLookup();
			ledger.set(TXID, receiptFor(raw));

			const archive = new RecordingArchivePort(() => ({
				kind: 'archived',
				archivedEmailId: 'e',
			}));

			const result = await runPhaseBPipeline(
				TXID,
				baseDeps({
					ledgerLookup: ledger,
					spoolEntryReader: new FakeSpoolEntryReader(raw),
					archiveObject: archive.port,
				})
			);

			expect(result.parseKind).toBe('parse_failed');
			expect(result.ownerFidelity).toBe('none');
			expect(archive.calls[0]!.subject).toBe('(no subject)');
		});
	}
);

suite('ci', 'runPhaseBPipeline() -- refuses before archiving, and alerts before it throws', () => {
	it('throws PhaseBSpoolEntryRefusedError and alerts, for a spool file with no ledger row (no_receipt)', async () => {
		const raw = Buffer.from('irrelevant', 'utf8');
		const alerts: PhaseBAlert[] = [];
		const archive = new RecordingArchivePort(() => ({
			kind: 'archived',
			archivedEmailId: 'e',
		}));
		const releaser = new RecordingReleaser();
		let indexed = false;

		await expect(
			runPhaseBPipeline(
				TXID,
				baseDeps({
					ledgerLookup: new FakeLedgerLookup(), // nothing registered for TXID
					spoolEntryReader: new FakeSpoolEntryReader(raw),
					archiveObject: archive.port,
					indexBatch: async () => {
						indexed = true;
					},
					releaseSpoolEntry: releaser,
					alertSink: (alert) => {
						alerts.push(alert);
					},
				})
			)
		).rejects.toThrow(PhaseBSpoolEntryRefusedError);

		expect(alerts).toHaveLength(1);
		expect(alerts[0]!.verdict.kind).toBe('no_receipt');
		expect(alerts[0]!.severity).toBe('warning');
		expect(archive.calls).toHaveLength(0);
		expect(indexed).toBe(false);
		expect(releaser.released).toHaveLength(0);
	});

	it('throws PhaseBSpoolFileUnreadableError when the file cannot even be measured', async () => {
		const unreadable = new FakeSpoolEntryReader(Buffer.alloc(0), new Error('ENOENT'));

		await expect(
			runPhaseBPipeline(TXID, baseDeps({ spoolEntryReader: unreadable }))
		).rejects.toThrow(PhaseBSpoolFileUnreadableError);
	});

	it('throws PhaseBOwnerConfigMissingError when the receipt has no journalingSourceId', async () => {
		const raw = Buffer.from('irrelevant', 'utf8');
		const ledger = new FakeLedgerLookup();
		ledger.set(TXID, receiptFor(raw, { journalingSourceId: null }));

		await expect(
			runPhaseBPipeline(
				TXID,
				baseDeps({ ledgerLookup: ledger, spoolEntryReader: new FakeSpoolEntryReader(raw) })
			)
		).rejects.toThrow(PhaseBOwnerConfigMissingError);
	});

	it('throws PhaseBOwnerConfigMissingError when the journaling source has no configuration', async () => {
		const raw = Buffer.from('irrelevant', 'utf8');
		const ledger = new FakeLedgerLookup();
		ledger.set(TXID, receiptFor(raw));

		await expect(
			runPhaseBPipeline(
				TXID,
				baseDeps({
					ledgerLookup: ledger,
					spoolEntryReader: new FakeSpoolEntryReader(raw),
					organizationDomains: new FakeOrganizationDomains(null),
				})
			)
		).rejects.toThrow(PhaseBOwnerConfigMissingError);
	});

	it('throws PhaseBArchiveFailedError and never indexes or releases when the port reports an error', async () => {
		const raw = Buffer.from('irrelevant', 'utf8');
		const ledger = new FakeLedgerLookup();
		ledger.set(TXID, receiptFor(raw));
		const releaser = new RecordingReleaser();
		let indexed = false;

		await expect(
			runPhaseBPipeline(
				TXID,
				baseDeps({
					ledgerLookup: ledger,
					spoolEntryReader: new FakeSpoolEntryReader(raw),
					archiveObject: async () => ({ kind: 'error', message: 'storage unreachable' }),
					indexBatch: async () => {
						indexed = true;
					},
					releaseSpoolEntry: releaser,
				})
			)
		).rejects.toThrow(PhaseBArchiveFailedError);

		expect(indexed).toBe(false);
		expect(releaser.released).toHaveLength(0);
	});
});
