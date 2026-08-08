import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probeMinio } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import {
	S3Client,
	CreateBucketCommand,
	PutBucketVersioningCommand,
	ListObjectVersionsCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	GetObjectRetentionCommand,
	PutObjectRetentionCommand,
} from '@aws-sdk/client-s3';
import { S3StorageProvider } from '../../src/services/storage/S3StorageProvider';

/**
 * `JR-7-05` -- WORM/Object Lock verified against a real MinIO instance (backlog E7, RFC §7).
 * Classification: `nightly`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `nightly`, not `ci`, and why that is a safe choice for the CI that exists today
 * ---------------------------------------------------------------------------------------------
 * `docker-compose.yml` has no MinIO service and `.github/workflows/ci.yml` provisions none either
 * (both checked before writing this file: `postgres`, `valkey`, `meilisearch`, `tika` only). Adding a
 * MinIO service container to CI is an infrastructure decision for DEV/PO, not something a TEST task
 * should make unilaterally -- the same reasoning `journal-object-store-outage.int.test.ts` (`JR-6-06`)
 * already recorded when it chose a fake `ArchiveObjectPort` over standing up MinIO for a *different*
 * claim. That reasoning does not apply here: JR-7-05's entire point is "verified against real MinIO",
 * so a fake object store would prove nothing about this task's claim specifically. The resolution is
 * to write the real thing, gate it on infrastructure nobody has to provision by default
 * (`probeMinio()`, `OA_TEST_MINIO_ENDPOINT` with **no default** -- see that function's own doc
 * comment for why not even `localhost` is a safe default for a suite that writes irreversible
 * objects), and classify it `nightly`. `ci.yml`'s current single job does not set `OA_TEST_CLASSES`,
 * so it defaults to `ci` only and this suite's `nightly` class is not selected there -- it skips via
 * `suite()`'s ordinary class-not-selected path and `OA_TEST_REQUIRE_INFRA=1` (set in that job, line
 * ~120) is never consulted, because `suiteRequiring()` only reaches the infra check once the class
 * itself is selected. **This has been proven by running with the class deliberately unselected below,
 * not merely inferred from reading the classification module** -- see the "calibration" run in the
 * session report.
 *
 * Evidence this file's four cases actually ran against a real endpoint is in the session's own run:
 * a MinIO container (`minio/minio:latest`, no persistent volume) started for this session,
 * `OA_TEST_MINIO_ENDPOINT`/`_ACCESS_KEY`/`_SECRET_KEY` set, `OA_TEST_CLASSES=nightly` (this file's
 * only class) or `ci,nightly`. The report names the exact numbers from that run. Whoever accepts
 * `JR-7-06` and does not have a MinIO reachable cannot re-run this file live -- that is itself the
 * finding this task was warned to expect and document rather than paper over (task instructions,
 * "falls in diesem Container kein laufendes MinIO ... verfügbar ist").
 *
 * ---------------------------------------------------------------------------------------------
 * The backlog's four cases, read literally, and what real Object Lock actually gives you
 * ---------------------------------------------------------------------------------------------
 * `03-backlog.md` E7/JR-7-05 asks for: (1) overwrite of a locked object fails, (2) delete of a locked
 * object fails, including with ordinary credentials, (3) retention is actually set on write, (4) a
 * shortening attempt fails. Cases 3 and 4 are unambiguous and are asserted as literally worded below.
 * Cases 1 and 2, taken *literally* against `S3StorageProvider`'s actual API (`put(path, content)`,
 * `delete(path)` -- neither takes a version ID), do **not** hold, and this file asserts what *does*
 * happen rather than rewording the claim to make it pass:
 *
 *  - **Case 1 ("overwrite fails")**: S3 Object Lock is enforced *per object version*
 *    (`docs/enterprise/journaling/guide.md` line ~310, confirmed against real MinIO below). Object
 *    Lock requires bucket versioning; a second `put()` to the same key does not modify the locked
 *    version -- there is no S3 operation that does -- it creates a **new** version. That call
 *    **succeeds**. The old version's bytes stay exactly as written and independently fetchable by
 *    its version ID (asserted below). What is *not* protected is the read path: `S3StorageProvider
 *    .get()` and `IStorageProvider.get()` generally take no version ID, so a plain read after a
 *    second `put()` silently returns the **new** content, not the archived original -- indistinguishable
 *    from successful tampering to any caller that does not separately verify `storage_hash_sha256`
 *    (`IntegrityService.checkEmailIntegrity()` is the only code path in this repository that would
 *    catch it, and only when explicitly run). Reported as a finding below, not silently absorbed into
 *    a redefinition of "overwrite fails".
 *  - **Case 2 ("delete fails, including with ordinary credentials")**: a version-*targeted*
 *    `DeleteObjectCommand` (explicit `VersionId`) against the locked version, issued with the same
 *    ordinary credentials the application uses (no `BypassGovernanceRetention`, which does not even
 *    exist for `COMPLIANCE` mode), genuinely fails with `AccessDenied` -- this is the real guarantee
 *    and it holds. But `S3StorageProvider.delete()` never passes a `VersionId` either. `DeleteObject`
 *    without a version ID on a versioned bucket is defined by S3 to create a **delete marker**
 *    regardless of Object Lock -- Object Lock has no say over delete markers, only over deleting an
 *    actual data version. That call **succeeds** (no throw), `exists()` and `get()` afterwards report
 *    the object as gone, and the locked data version is still physically present and still
 *    independently fetchable by version ID. This means an operator (or an attacker) with the
 *    application's ordinary, non-bypass credentials can make an archived object disappear from the
 *    application's own view without needing any special permission and without any error -- which is
 *    a materially different, and weaker, guarantee than "deletion is technically impossible" as
 *    `guide.md` states it for the *object version*, once you consider what the *key* looks like to
 *    ordinary application code. This is asserted and reported as a finding, severity distinguished
 *    from the wording-only issue in case 1.
 *
 * Both findings are about the **application's own storage-provider surface**, not about MinIO/S3
 * failing to honour Object Lock -- the underlying per-version guarantee is real and is proven
 * separately (the version-ID-targeted assertions in both tests). Fixing them (pinning `VersionId` on
 * read, or making `delete()` refuse rather than soft-delete) is `packages/backend/src/**` work for the
 * senior-dev role, not this task.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a fresh bucket per run, and why cleanup is intentionally incomplete
 * ---------------------------------------------------------------------------------------------
 * Object Lock must be enabled at bucket-creation time and cannot be added later (task instructions;
 * confirmed in `guide.md`), so this suite creates its own uniquely-named bucket rather than reusing
 * any fixture, and never touches a caller-supplied bucket name. Retention is kept short (a few
 * minutes, expressed as a fractional `objectLockRetainUntilDays` -- the field's own doc comment says
 * "in days" but is a plain `number`, so a fraction is accepted and keeps the irreversible window
 * short) precisely because this is real, working COMPLIANCE-mode lock: the objects it writes cannot
 * be deleted by anything, including this suite's own `afterAll`, until that window passes. `afterAll`
 * does not attempt bucket deletion -- it would fail anyway while any version, including delete
 * markers, remains -- and instead logs the bucket name so a human can decide what to do with it. In
 * this session the underlying MinIO container has no persistent volume and is destroyed outright
 * afterward; Object Lock protects against the S3 *API* deleting data, not against the datastore itself
 * being torn down, which is a distinction worth stating plainly rather than leaving implicit.
 */

const minioProbe = await probeMinio();
const enabled = minioProbe.available && isClassSelected('nightly');

const bucketSuffix = randomBytes(6).toString('hex');
const bucketName = `oa-test-worm-${bucketSuffix}`;
// A few minutes, not a realistic production value -- see module doc comment. Computed once so every
// assertion in both tests reasons about the same expected window.
const retainDays = 3 / (24 * 60);

let client: S3Client | undefined;
let provider: S3StorageProvider | undefined;
let unlockedProvider: S3StorageProvider | undefined;

if (enabled) {
	const endpoint = process.env.OA_TEST_MINIO_ENDPOINT!;
	const accessKeyId = process.env.OA_TEST_MINIO_ACCESS_KEY!;
	const secretAccessKey = process.env.OA_TEST_MINIO_SECRET_KEY!;

	client = new S3Client({
		endpoint,
		region: 'us-east-1',
		credentials: { accessKeyId, secretAccessKey },
		forcePathStyle: true,
	});

	await client.send(
		new CreateBucketCommand({ Bucket: bucketName, ObjectLockEnabledForBucket: true })
	);
	// Belt-and-suspenders: MinIO enables versioning implicitly with Object Lock, but doing it
	// explicitly means this suite does not depend on that implicit behaviour continuing to hold.
	await client.send(
		new PutBucketVersioningCommand({
			Bucket: bucketName,
			VersioningConfiguration: { Status: 'Enabled' },
		})
	);

	provider = new S3StorageProvider({
		type: 's3',
		endpoint,
		region: 'us-east-1',
		bucket: bucketName,
		accessKeyId,
		secretAccessKey,
		forcePathStyle: true,
		openArchiverFolderName: 'oa-test',
		objectLockMode: 'COMPLIANCE',
		objectLockRetainUntilDays: retainDays,
	});
	// A second provider instance, same bucket, with Object Lock config *omitted* -- used once, as a
	// calibration control, to show the lock-specific assertions below are not merely "every S3 call on
	// this bucket happens to fail for an unrelated reason".
	unlockedProvider = new S3StorageProvider({
		type: 's3',
		endpoint,
		region: 'us-east-1',
		bucket: bucketName,
		accessKeyId,
		secretAccessKey,
		forcePathStyle: true,
		openArchiverFolderName: 'oa-test',
	});
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream as AsyncIterable<Buffer>) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

async function latestVersionId(key: string): Promise<string> {
	const listed = await client!.send(
		new ListObjectVersionsCommand({ Bucket: bucketName, Prefix: key })
	);
	const versions = (listed.Versions ?? []).filter((v) => v.Key === key);
	if (versions.length === 0) {
		throw new Error(`no versions found for ${key} while probing test state`);
	}
	// Newest first, per S3's documented ordering for ListObjectVersions.
	return versions[0]!.VersionId!;
}

async function allVersionIds(key: string): Promise<string[]> {
	const listed = await client!.send(
		new ListObjectVersionsCommand({ Bucket: bucketName, Prefix: key })
	);
	return (listed.Versions ?? []).filter((v) => v.Key === key).map((v) => v.VersionId!);
}

afterAll(() => {
	if (enabled) {
		coverageNotice(
			`[JR-7-05] test bucket "${bucketName}" on ${process.env.OA_TEST_MINIO_ENDPOINT} was not ` +
				`deleted -- it holds objects under COMPLIANCE-mode Object Lock, which no credential can ` +
				`remove before their retention window (~${(retainDays * 24 * 60).toFixed(1)} minutes from ` +
				`write) expires. This is expected (irreversible by design, see this file's module doc ` +
				`comment) and named here rather than left implicit.`
		);
	}
});

suiteRequiring(
	'nightly',
	'WORM / S3 Object Lock verified against real MinIO (JR-7-05)',
	minioProbe,
	() => {
		it('case 1: overwrite of a locked object -- the literal claim is false for a plain put(), but the old version stays byte-identical and independently fetchable; a plain read after the overwrite silently returns the new content', async () => {
			const key = `case1/${randomBytes(6).toString('hex')}.eml`;
			const original = Buffer.from(`original-${randomBytes(16).toString('hex')}`, 'utf8');
			const overwrite = Buffer.from(`overwrite-${randomBytes(16).toString('hex')}`, 'utf8');

			await provider!.put(key, original);
			const originalVersionId = await latestVersionId(key);

			// The literal backlog claim: does a second put() to the same key fail? Observed: no. This
			// assertion documents the real, observed behaviour -- not a rewritten expectation.
			await expect(provider!.put(key, overwrite)).resolves.toBeUndefined();

			const versionsAfter = await allVersionIds(key);
			expect(versionsAfter).toHaveLength(2);
			expect(versionsAfter).toContain(originalVersionId);

			// The old version's bytes are untouched -- fetch it explicitly by version ID.
			const originalStillThere = await client!.send(
				new GetObjectCommand({ Bucket: bucketName, Key: key, VersionId: originalVersionId })
			);
			const originalBytes = await streamToBuffer(
				originalStillThere.Body as NodeJS.ReadableStream
			);
			expect(originalBytes.equals(original)).toBe(true);

			// Finding: a plain, version-unaware read (what the application actually does everywhere)
			// now returns the *new* content, not the archived original.
			const plainRead = await streamToBuffer(await provider!.get(key));
			expect(plainRead.equals(overwrite)).toBe(true);
			expect(plainRead.equals(original)).toBe(false);

			coverageNotice(
				'[JR-7-05] case 1 FINDING: S3StorageProvider.put() to an existing, locked key does not ' +
					'fail (it creates a new, also-locked version -- correct S3 semantics). The old ' +
					'version is provably intact by VersionId. But S3StorageProvider.get()/IStorageProvider ' +
					'.get() take no VersionId, so an ordinary application read after such an overwrite ' +
					'silently returns the NEW bytes, not the archived original, with no error anywhere in ' +
					'the path -- a read-side gap distinct from the (real, holding) version-level lock ' +
					'guarantee. Reported for JR-7-06/E8, not fixed here (TEST role).'
			);
		});

		it("case 2: delete of a locked object with ordinary credentials -- a version-targeted delete genuinely fails (the real guarantee), but the application's own delete() succeeds by creating a delete marker while the locked bytes remain, orphaned and inaccessible via the normal API", async () => {
			const key = `case2/${randomBytes(6).toString('hex')}.eml`;
			const content = Buffer.from(`locked-${randomBytes(16).toString('hex')}`, 'utf8');
			await provider!.put(key, content);
			const versionId = await latestVersionId(key);

			// Calibration: the same version-targeted DeleteObject call, issued with the *unlocked*
			// provider's identical credentials against a key that was never put under Object Lock,
			// succeeds -- proving a failure below is caused by the lock, not by broken credentials or a
			// misconfigured client.
			const controlKey = `case2-control/${randomBytes(6).toString('hex')}.eml`;
			await unlockedProvider!.put(controlKey, content);
			const controlVersionId = await latestVersionId(controlKey);
			await expect(
				client!.send(
					new DeleteObjectCommand({
						Bucket: bucketName,
						Key: controlKey,
						VersionId: controlVersionId,
					})
				)
			).resolves.toBeDefined();

			// The real guarantee: deleting the *specific locked version*, with the same ordinary
			// credentials the application uses (no BypassGovernanceRetention -- COMPLIANCE mode does not
			// recognise it), fails.
			await expect(
				client!.send(
					new DeleteObjectCommand({ Bucket: bucketName, Key: key, VersionId: versionId })
				)
			).rejects.toBeTruthy();

			// The application's own delete(path) -- no version ID -- against the same key.
			await expect(provider!.delete(key)).resolves.toBeUndefined();

			// From the application's point of view the object is now gone...
			expect(await provider!.exists(key)).toBe(false);
			await expect(provider!.get(key)).rejects.toBeTruthy();

			// ...but the locked bytes are still physically present, reachable only by version ID.
			const stillThere = await client!.send(
				new GetObjectCommand({ Bucket: bucketName, Key: key, VersionId: versionId })
			);
			const stillThereBytes = await streamToBuffer(stillThere.Body as NodeJS.ReadableStream);
			expect(stillThereBytes.equals(content)).toBe(true);

			coverageNotice(
				'[JR-7-05] case 2 FINDING: a version-targeted delete of the locked version genuinely ' +
					'fails under COMPLIANCE mode with ordinary credentials (the real guarantee, calibrated ' +
					'against an unlocked control object that deletes successfully with the same ' +
					'credentials). But S3StorageProvider.delete() -- what the application actually calls -- ' +
					'passes no VersionId, so DeleteObject on a versioned bucket creates a delete marker ' +
					'regardless of Object Lock: the call succeeds, exists()/get() report the object gone, ' +
					'and the locked data version is left orphaned -- present but unreachable through the ' +
					"normal API. An operator or attacker with the application's ordinary credentials can " +
					"therefore make an archived object disappear from the application's own view without " +
					'any special permission and without any error. Reported for JR-7-06/E8, not fixed here.'
			);
		});

		it('case 3: retention is actually set on write, and matches the configured mode and window', async () => {
			const key = `case3/${randomBytes(6).toString('hex')}.eml`;
			const before = Date.now();
			await provider!.put(key, Buffer.from('retention-check', 'utf8'));
			const after = Date.now();
			const versionId = await latestVersionId(key);

			const retention = await client!.send(
				new GetObjectRetentionCommand({
					Bucket: bucketName,
					Key: key,
					VersionId: versionId,
				})
			);
			expect(retention.Retention?.Mode).toBe('COMPLIANCE');
			const retainUntil = retention.Retention?.RetainUntilDate;
			expect(retainUntil).toBeInstanceOf(Date);

			const expectedMinMs = before + retainDays * 24 * 60 * 60 * 1000;
			const expectedMaxMs = after + retainDays * 24 * 60 * 60 * 1000;
			const toleranceMs = 5_000; // clock skew between this process and the MinIO container
			expect(retainUntil!.getTime()).toBeGreaterThanOrEqual(expectedMinMs - toleranceMs);
			expect(retainUntil!.getTime()).toBeLessThanOrEqual(expectedMaxMs + toleranceMs);

			coverageNotice(
				`[JR-7-05] case 3 verified: GetObjectRetention on a version written through ` +
					`S3StorageProvider.put() with objectLockMode=COMPLIANCE reports Mode=COMPLIANCE and a ` +
					`RetainUntilDate within ${toleranceMs}ms of write-time + ${retainDays.toFixed(6)} days.`
			);
		});

		it('case 4: a retention-shortening attempt fails, while a legitimate extension succeeds (calibration)', async () => {
			const key = `case4/${randomBytes(6).toString('hex')}.eml`;
			await provider!.put(key, Buffer.from('shorten-check', 'utf8'));
			const versionId = await latestVersionId(key);

			const current = await client!.send(
				new GetObjectRetentionCommand({
					Bucket: bucketName,
					Key: key,
					VersionId: versionId,
				})
			);
			const currentUntil = current.Retention!.RetainUntilDate!;

			// Calibration: extending retention is legitimate and must succeed -- if it did not, a
			// failure below would prove nothing about *shortening* specifically, only that every
			// PutObjectRetention call on this object fails for some other reason.
			const extended = new Date(currentUntil.getTime() + 60_000);
			await expect(
				client!.send(
					new PutObjectRetentionCommand({
						Bucket: bucketName,
						Key: key,
						VersionId: versionId,
						Retention: { Mode: 'COMPLIANCE', RetainUntilDate: extended },
					})
				)
			).resolves.toBeDefined();

			// The actual claim: shortening (even relative to the *original* retention, i.e. well before
			// the now-extended one) fails, with ordinary credentials, no bypass.
			const shortened = new Date(Date.now() + 1_000);
			await expect(
				client!.send(
					new PutObjectRetentionCommand({
						Bucket: bucketName,
						Key: key,
						VersionId: versionId,
						Retention: { Mode: 'COMPLIANCE', RetainUntilDate: shortened },
					})
				)
			).rejects.toBeTruthy();

			// The extension from the calibration step actually stuck -- shortening did not silently
			// "succeed" by leaving the pre-extension value in place, it was genuinely rejected.
			const after = await client!.send(
				new GetObjectRetentionCommand({
					Bucket: bucketName,
					Key: key,
					VersionId: versionId,
				})
			);
			expect(after.Retention!.RetainUntilDate!.getTime()).toBe(extended.getTime());

			coverageNotice(
				'[JR-7-05] case 4 verified: PutObjectRetention extending the window succeeds ' +
					'(calibration -- the mechanism works), and a subsequent PutObjectRetention attempting ' +
					'to shorten it fails under COMPLIANCE mode with ordinary credentials; the retention ' +
					'value after the failed attempt is still the extended one, not silently reverted or ' +
					'left at a shortened value.'
			);
		});
	}
);
