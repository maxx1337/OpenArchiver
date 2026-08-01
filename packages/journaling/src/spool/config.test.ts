import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { parseSpoolConfig } from './config';

/**
 * Spool configuration validation (`JR-3-01`), per CLAUDE.md section 5.6 ("prefer zod for new config
 * validation"). Classification: `ci`.
 */

suite('ci', 'parseSpoolConfig()', () => {
	it('accepts a valid configuration and coerces highWaterBytes to bigint', () => {
		const config = parseSpoolConfig({
			rootPath: '/var/lib/oa/spool',
			highWaterBytes: 21474836480,
		});
		expect(config.rootPath).toBe('/var/lib/oa/spool');
		expect(config.highWaterBytes).toBe(21474836480n);
	});

	it('coerces a string byte value, as it would arrive from an environment variable', () => {
		const config = parseSpoolConfig({ rootPath: '/spool', highWaterBytes: '21474836480' });
		expect(config.highWaterBytes).toBe(21474836480n);
	});

	it('accepts a bigint directly', () => {
		const config = parseSpoolConfig({ rootPath: '/spool', highWaterBytes: 1_000_000_000n });
		expect(config.highWaterBytes).toBe(1_000_000_000n);
	});

	it('rejects an empty rootPath', () => {
		expect(() => parseSpoolConfig({ rootPath: '', highWaterBytes: 100 })).toThrow();
	});

	it('rejects a missing rootPath', () => {
		expect(() => parseSpoolConfig({ highWaterBytes: 100 })).toThrow();
	});

	it('rejects a zero highWaterBytes', () => {
		expect(() => parseSpoolConfig({ rootPath: '/spool', highWaterBytes: 0 })).toThrow();
	});

	it('rejects a negative highWaterBytes', () => {
		expect(() => parseSpoolConfig({ rootPath: '/spool', highWaterBytes: -1 })).toThrow();
	});

	it('rejects a non-numeric highWaterBytes', () => {
		expect(() =>
			parseSpoolConfig({ rootPath: '/spool', highWaterBytes: 'not-a-number' })
		).toThrow();
	});
});
