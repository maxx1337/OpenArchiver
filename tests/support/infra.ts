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
