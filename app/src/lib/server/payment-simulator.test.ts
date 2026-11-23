import { afterEach, describe, expect, it, vi } from 'vitest';

/** isSimulator() harus mati bila Midtrans asli terpasang atau mode produksi — jangan sampai uang "palsu" lolos. */
async function simulatorFor(env: Record<string, string | undefined>) {
	vi.resetModules();
	vi.doMock('$app/env/private', () => ({
		DATABASE_URL: process.env.TEST_DB_PATH ?? 'tests/.tmp-test-missing.db',
		MIDTRANS_SERVER_KEY: undefined,
		MIDTRANS_IS_PRODUCTION: undefined,
		PAYMENT_SIMULATOR: undefined,
		...env
	}));
	return (await import('./payment-simulator')).isSimulator();
}
afterEach(() => vi.doUnmock('$app/env/private'));

describe('isSimulator', () => {
	it('aktif hanya bila PAYMENT_SIMULATOR="true"', async () => {
		expect(await simulatorFor({ PAYMENT_SIMULATOR: 'true' })).toBe(true);
		expect(await simulatorFor({})).toBe(false);
		expect(await simulatorFor({ PAYMENT_SIMULATOR: 'false' })).toBe(false);
		expect(await simulatorFor({ PAYMENT_SIMULATOR: '1' })).toBe(false);
	});
	it('Midtrans asli (Server Key terisi) selalu menang', async () => {
		expect(
			await simulatorFor({ PAYMENT_SIMULATOR: 'true', MIDTRANS_SERVER_KEY: 'SB-Mid-server-x' })
		).toBe(false);
	});
	it('mode produksi Midtrans mematikan simulator', async () => {
		expect(await simulatorFor({ PAYMENT_SIMULATOR: 'true', MIDTRANS_IS_PRODUCTION: 'true' })).toBe(
			false
		);
	});
});
