import net from 'node:net';

/**
 * Infrastructure probes (JR-101).
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
