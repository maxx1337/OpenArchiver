import net from 'node:net';

/**
 * Infrastructure probes (JR-1-01).
 *
 * This container has no Docker, no Postgres, no Valkey and no `.env`. The `integration` suite must
 * therefore be able to establish, before declaring its suites, whether its infrastructure exists,
 * and skip **visibly** when it does not. Never silently, never disguised as green
 * (Testplan rule 6).
 *
 * Probing is a plain TCP connect: it needs no driver, cannot fail on an import-time throw, and
 * does not depend on credentials being correct.
 */

export interface Probe {
	available: boolean;
	/** Human-readable, printed into the skipped suite name. */
	reason: string;
	target: string;
}

const cache = new Map<string, Promise<Probe>>();

export async function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const socket = new net.Socket();
		const done = (result: boolean) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => done(true));
		socket.once('timeout', () => done(false));
		socket.once('error', () => done(false));
		socket.connect(port, host);
	});
}

/**
 * Is there a reachable Postgres for the integration suite?
 *
 * Answers `false` with a precise reason for the two distinct failure modes we care about:
 * `DATABASE_URL` missing entirely, and `DATABASE_URL` set but nothing listening.
 */
export function probePostgres(timeoutMs = 1500): Promise<Probe> {
	const key = `postgres:${process.env.DATABASE_URL ?? ''}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const result = (async (): Promise<Probe> => {
		const raw = process.env.DATABASE_URL;
		if (!raw) {
			return {
				available: false,
				reason: 'DATABASE_URL is not set (no .env in this environment) -- integration suite needs Postgres',
				target: '(none)',
			};
		}
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return {
				available: false,
				reason: `DATABASE_URL is not a parseable URL -- integration suite needs Postgres`,
				target: '(unparseable)',
			};
		}
		const host = url.hostname || 'localhost';
		const port = Number(url.port || '5432');
		const target = `${host}:${port}`;
		const reachable = await probeTcp(host, port, timeoutMs);
		return reachable
			? { available: true, reason: `Postgres reachable at ${target}`, target }
			: {
					available: false,
					reason: `no Postgres listening at ${target} (DATABASE_URL is set) -- integration suite skipped`,
					target,
				};
	})();
	cache.set(key, result);
	return result;
}

/**
 * Is there a reachable Redis/Valkey for a suite that needs BullMQ (`JR-6-01`)?
 *
 * Added for the `journal-inbound` worker: proving that the worker process *starts* means starting it,
 * and a BullMQ `Worker` needs a broker. Until E6 every suite got by with Postgres, which is why this
 * did not exist.
 *
 * Reads the same variables as `packages/backend/src/config/redis.ts` and applies the same defaults, so
 * a probe that says "reachable" is a statement about the connection the code under test will actually
 * open. Duplicating the defaults is deliberate: importing that module would pull `dotenv/config` and a
 * `bullmq` type into the harness for two `??`s, and the harness stays free of the packages it tests.
 * The `unit`-suite rule (no `src/database` import) is the same instinct.
 *
 * A plain TCP connect, like `probePostgres()`: it proves something is listening, not that the password
 * is right. A wrong `REDIS_PASSWORD` therefore reaches the test as a connection error rather than a
 * skip -- which is the correct split. "Nothing is running here" is a legitimate reason to skip;
 * "credentials are wrong" is a broken environment and must not be disguised as an absent one.
 */
export function probeRedis(timeoutMs = 1500): Promise<Probe> {
	const host = process.env.REDIS_HOST || 'localhost';
	const port = Number(process.env.REDIS_PORT || '6379');
	const key = `redis:${host}:${port}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const result = (async (): Promise<Probe> => {
		const target = `${host}:${port}`;
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			return {
				available: false,
				reason: `REDIS_PORT is not a valid port number (${JSON.stringify(process.env.REDIS_PORT)})`,
				target,
			};
		}
		const reachable = await probeTcp(host, port, timeoutMs);
		return reachable
			? { available: true, reason: `Redis reachable at ${target}`, target }
			: {
					available: false,
					reason: `no Redis/Valkey listening at ${target} -- BullMQ suite skipped`,
					target,
				};
	})();
	cache.set(key, result);
	return result;
}

/**
 * Is there a reachable Meilisearch for a suite that needs real search (`JR-6-02b`'s Phase-B
 * end-to-end test, ADR-035)?
 *
 * Reads `MEILI_HOST`, the same variable `packages/backend/src/config/search.ts` reads, with the same
 * default (`http://127.0.0.1:7700`) -- a probe that says "reachable" is a statement about the host
 * `SearchService` will actually connect to. Duplicating the default rather than importing that module
 * is the same instinct `probeRedis()` already documents: the harness stays free of the packages it
 * tests.
 *
 * A plain TCP connect against the parsed host/port, like `probePostgres()`/`probeRedis()` -- it
 * proves something is listening, not that `MEILI_MASTER_KEY` is right. Measured directly (not
 * assumed) against a container started the same way a GitHub Actions service container would be
 * (`image`/`env`/`ports`, no `command`): Meilisearch's `/health` responds without authentication, but
 * every other endpoint requires the configured key, and a *wrong* key gets `403` rather than
 * connection failure -- so a misconfigured `MEILI_MASTER_KEY` reaches the test that actually calls
 * `SearchService` as a real assertion failure, never disguised as "Meilisearch is not running".
 */
export function probeMeilisearch(timeoutMs = 1500): Promise<Probe> {
	const raw = process.env.MEILI_HOST || 'http://127.0.0.1:7700';
	const key = `meilisearch:${raw}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const result = (async (): Promise<Probe> => {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return {
				available: false,
				reason: `MEILI_HOST is not a parseable URL (${JSON.stringify(raw)})`,
				target: '(unparseable)',
			};
		}
		const host = url.hostname || '127.0.0.1';
		const port = Number(url.port || (url.protocol === 'https:' ? '443' : '80'));
		const target = `${host}:${port}`;
		const reachable = await probeTcp(host, port, timeoutMs);
		return reachable
			? { available: true, reason: `Meilisearch reachable at ${target}`, target }
			: {
					available: false,
					reason: `no Meilisearch listening at ${target} (MEILI_HOST=${raw}) -- suite skipped`,
					target,
				};
	})();
	cache.set(key, result);
	return result;
}
