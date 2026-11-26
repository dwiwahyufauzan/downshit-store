import { defineConfig } from '@playwright/test';
import { PORT } from './env';

/**
 * Alur utama toko (daftar → belanja → checkout → bayar → kirim → selesai) di peramban sungguhan melawan
 * build produksi + database SQLite sementara. Server dijalankan global-setup.ts (bukan `webServer`) supaya
 * lognya bisa dibaca tes (tautan reset password dicetak MAIL_PROVIDER=log).
 *
 * Peramban: bawaan Chromium unduhan Playwright (`npm run install:browser`); lokal tanpa unduhan bisa
 * memakai Chrome terpasang:  PW_CHANNEL=chrome npm test
 */
export default defineConfig({
	testDir: './tests',
	globalSetup: './global-setup.ts',
	globalTeardown: './global-teardown.ts',
	// satu database bersama + urutan pesanan: tes dijalankan berurutan
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		channel: process.env.PW_CHANNEL || undefined,
		locale: 'id-ID',
		timezoneId: 'Asia/Jakarta',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	}
});
