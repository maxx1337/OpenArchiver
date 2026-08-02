import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads a fixture file from `packages/journaling/tests/fixtures/` by name, as a `Buffer`. Fixtures
 * are `.eml` files with CRLF line endings (matching real SMTP wire format), built for `JR-5-01`/
 * `JR-5-02` -- see `docs/dev/journaling/03-backlog.md` epic E5. The full corpus (`JR-5-08`) is a
 * later slice; these cover only what the parser's current acceptance criteria require.
 */

const FIXTURES_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures');

export function loadFixture(name: string): Buffer {
	return readFileSync(path.join(FIXTURES_DIR, name));
}
