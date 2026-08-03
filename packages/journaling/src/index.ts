/**
 * `@open-archiver/journaling` — the logic of the compliance-grade SMTP journaling receiver.
 *
 * Pure logic: spool, ledger, canonical encoding, chain computation, journal-report parser, crash
 * recovery. No HTTP layer, no SMTP server (that is `apps/smtp-ingress`), and **no imports from
 * `@open-archiver/backend`**.
 *
 * That last rule is not stylistic. Several `packages/backend/src/config/*` modules `throw` at import
 * time (`config/storage.ts` validates `STORAGE_ENCRYPTION_KEY`), and `src/database/index.ts` is a
 * module singleton over `DATABASE_URL`. An ingress process importing those inherits both the
 * credentials and the crashes of subsystems it does not use. Configuration and database connections
 * are therefore **injected** into this package, never imported by it.
 *
 * See `docs/dev/journaling/02-architektur.md` section 2.
 */

export {
	FORMAT_VERSION,
	GENESIS_PREFIX,
	LEDGER_FIELD_COUNT,
	TAG,
	canonicalJson,
	chainHash,
	encodeLedgerRecord,
	genesisChainHash,
	normalizeRemoteIp,
} from './ledger/canonical-encoding';

export {
	MERKLE_LEAF_FIELD_COUNT,
	MERKLE_LEAF_PREFIX,
	MERKLE_NODE_PREFIX,
	merkleLeaf,
	merkleNode,
	merkleRoot,
} from './ledger/merkle';

export type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
	LedgerQuery,
	LedgerTransactor,
} from './ledger/ledger-port';

export {
	PostgresLedgerWriter,
	advisoryLockKey,
	type PostgresLedgerWriterOptions,
} from './ledger/ledger-writer';

export type { LedgerEntryByTxId, LedgerLookup } from './ledger/ledger-lookup-port';
export { PostgresLedgerLookup } from './ledger/ledger-lookup';

export type { SpoolDirEntry, SpoolFileHandle, SpoolFileSystem, SpoolStat } from './spool/fs-port';
export { NodeSpoolFileSystem } from './spool/fs-port';

export { generateTxId, isValidTxId } from './spool/txid';

export {
	INCOMING_DIR_NAME,
	QUARANTINE_DIR_NAME,
	checkSpoolHighWaterMark,
	computeDirectoryUsageBytes,
	ensureIncomingShardDir,
	ensureQuarantineShardDir,
	ensureSpoolLayout,
	evaluateHighWaterMark,
	incomingFilePath,
	incomingShardDir,
	quarantineFilePath,
	quarantineShardDir,
	shardOf,
	type HighWaterMarkStatus,
} from './spool/layout';

export { parseSpoolConfig, spoolConfigSchema, type SpoolConfig } from './spool/config';

export {
	DurableWriteError,
	writeDurableSpoolFile,
	type DurableWriteRequest,
	type DurableWriteResult,
	type DurableWriteStage,
} from './spool/durable-write';

export {
	JournalAcceptance,
	isAccepted,
	type AcceptedJournalTransaction,
	type HighWaterMarkExceeded,
	type JournalAcceptanceOptions,
	type JournalAcceptanceResult,
	type JournalTransactionInput,
	type LedgerAppendFailed,
	type SpoolCapacityExceeded,
	type SpoolWriteFailed,
} from './spool/acceptance';

export {
	quarantineSpoolFile,
	type QuarantineAlert,
	type QuarantineAlertSink,
	type QuarantineReason,
	type QuarantinedEntry,
} from './spool/quarantine';

export {
	runCrashRecoveryScan,
	type CrashRecoveryAlert,
	type CrashRecoveryAlertSink,
	type CrashRecoveryScanOptions,
	type CrashRecoveryScanResult,
	type RequeueCandidate,
} from './spool/crash-recovery';

export {
	formatIngressConfigError,
	ingressConfigSchema,
	parseIngressConfig,
	type IngressConfig,
} from './ingress/config';

export {
	DEFAULT_COMMAND_TIMEOUT_MS,
	DEFAULT_CONNECTION_TIMEOUT_MS,
	DEFAULT_DATA_TIMEOUT_MS,
	DEFAULT_SMTP_HOSTNAME,
	DEFAULT_SMTP_SIZE_LIMIT_BYTES,
	smtpServerConfigSchema,
	type SmtpServerConfig,
} from './ingress/smtp-config';

export {
	AUTH_DUMMY_PASSWORD_HASH,
	AUTH_MECHANISMS,
	buildEhloResponseLines,
	DataScanner,
	decodeSaslBase64,
	decodeSaslPlain,
	EsmtpServer,
	formatMultilineResponse,
	MAX_AUTH_ATTEMPTS_PER_CONNECTION,
	noopIngressLogger,
	parseAuthArguments,
	parseMailFromArguments,
	parseRcptToArguments,
	type AuthCredentialEvaluator,
	type AuthCredentialLookupResult,
	type DecodedSaslPlain,
	type EsmtpServerOptions,
	type IngressLogger,
	type JournalAcceptancePort,
	type ParsedAuthCommand,
	type ParsedMailFrom,
	type PasswordVerifier,
	type RecipientAclDecision,
	type RecipientAclEvaluator,
	type RequireTlsContext,
	type RequireTlsResolver,
	type SourceAclDecision,
	type SourceAclEvaluator,
} from './ingress/smtp-server';

export { SpoolWriteBridge, type SpoolWriteBridgeCallbacks } from './ingress/spool-write-bridge';

export { matchesCidr, parseCidr, type ParsedCidr } from './ingress/cidr';

export { normalizeJournalRecipient } from './ingress/recipient-address';

export type { JournalingSourceAclEntry, SourceAclLookup } from './ingress/source-acl-port';
export { PostgresSourceAclLookup } from './ingress/source-acl';

export {
	buildAuthIndex,
	buildRecipientIndex,
	compileSourceAcl,
	createSourceAclRequireTlsResolver,
	SourceAclCache,
	type CompiledSourceAcl,
	type SourceAclCacheOptions,
} from './ingress/source-acl-cache';

export {
	DEFAULT_SOURCE_ACL_REFRESH_INTERVAL_MS,
	DEFAULT_SOURCE_ACL_STALE_AFTER_MS,
	sourceAclConfigSchema,
	type SourceAclConfig,
} from './ingress/source-acl-config';

export { ledgerConfigSchema, type LedgerConfig } from './ingress/ledger-config';
