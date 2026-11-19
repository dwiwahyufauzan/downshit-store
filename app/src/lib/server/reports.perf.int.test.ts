/**
 * NF-06 (respons) untuk laporan owner: 5000 pesanan sintetis, laporan 1 bulan & 366 hari harus
 * < 2 detik dan kueri filter tanggal harus memakai indeks (bukan scan penuh).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbFile = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const file = template.replace(
		'.tmp-template-',
		`.tmp-perf-${Math.random().toString(36).slice(2)}-`
	);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return file;
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: dbFile,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32)
}));

import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
	bundleComponentUnits,
	bundleVsSingle,
	dailyRevenue,
	fillDays,
	itemsSold,
	salesList,
	salesSummary,
	topItems
} from './reports';
import { wibEnd, wibStart } from './time';
import { generateOrders, seedCatalog } from '../../../tests/synthetic';

let raw: Database.Database;

beforeAll(() => {
	if (!/\.tmp-perf-/.test(dbFile)) throw new Error('MENOLAK: bukan DB tes performa');
	raw = new Database(dbFile);
	raw.pragma('journal_mode = WAL');
	const cat = seedCatalog(raw);
	generateOrders(raw, cat, {
		count: 5000,
		fromIso: '2026-01-01T00:00:00.000Z',
		toIso: '2026-11-14T23:59:59.999Z',
		seed: 2026
	});
	raw.exec('analyze');
});

afterAll(() => {
	raw?.close();
	for (const ext of ['', '-wal', '-shm']) rmSync(dbFile + ext, { force: true });
});

const ms = async (fn: () => Promise<unknown>) => {
	const t = performance.now();
	await fn();
	return performance.now() - t;
};

/** Semua kueri yang dipakai halaman laporan untuk satu rentang */
const allReports = async (dari: string, sampai: string) => {
	const from = wibStart(dari);
	const to = wibEnd(sampai);
	return Promise.all([
		salesSummary(from, to),
		itemsSold(from, to),
		dailyRevenue(from, to),
		topItems(from, to, 10),
		bundleVsSingle(from, to),
		bundleComponentUnits(from, to),
		salesList(from, to, 'semua', { page: 1, perPage: 20 })
	]);
};

describe('performa laporan dengan 5000 pesanan (NF-06)', () => {
	it('data sintetis terbentuk', () => {
		const n = raw.prepare('select count(*) n from orders').get() as { n: number };
		expect(n.n).toBe(5000);
	});

	it('laporan 1 bulan < 2 dtk', async () => {
		await allReports('2026-10-01', '2026-10-31'); // pemanasan
		const t = await ms(() => allReports('2026-10-01', '2026-10-31'));
		console.info(`[perf] laporan 1 bulan (5000 pesanan): ${t.toFixed(0)} ms`);
		expect(t).toBeLessThan(2000);
	});

	it('laporan 366 hari penuh < 2 dtk', async () => {
		const t = await ms(() => allReports('2026-01-01', '2026-12-31'));
		console.info(`[perf] laporan 12 bulan (5000 pesanan): ${t.toFixed(0)} ms`);
		expect(t).toBeLessThan(2000);
	});

	it('ekspor CSV semua baris (tanpa paginasi) < 2 dtk', async () => {
		const t = await ms(() => salesList(wibStart('2026-01-01'), wibEnd('2026-12-31')));
		console.info(`[perf] salesList penuh: ${t.toFixed(0)} ms`);
		expect(t).toBeLessThan(2000);
	});

	it('grafik 366 hari tetap terisi nol', async () => {
		const rows = await dailyRevenue(wibStart('2026-01-01'), wibEnd('2026-12-31'));
		expect(fillDays(rows, '2026-01-01', '2026-12-31')).toHaveLength(365);
	});

	it('filter tanggal memakai indeks (EXPLAIN QUERY PLAN)', () => {
		const plan = raw
			.prepare(
				`explain query plan select sum(subtotal) from orders
				 where status in ('diproses','dikirim','selesai') and created_at >= ? and created_at <= ?`
			)
			.all('2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z') as { detail: string }[];
		const text = plan.map((p) => p.detail).join(' | ');
		console.info(`[perf] rencana kueri: ${text}`);
		expect(text).toMatch(/USING (COVERING )?INDEX idx_orders_(created|status)/);
		expect(text).not.toMatch(/SCAN orders(?! USING)/);
	});
});
