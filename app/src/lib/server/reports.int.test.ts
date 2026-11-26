/**
 * Uji integrasi laporan owner (SRS-F-011/012/013): angka laporan HARUS sama dengan hitungan SQL
 * manual dan dengan angka tangan pada data sintetis. Memakai DB SQLite terisolasi (salinan skema
 * kosong dari tests/global-setup.ts) sehingga aman dijalankan paralel dengan tes lain.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbFile = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const file = template.replace(
		'.tmp-template-',
		`.tmp-reports-${Math.random().toString(36).slice(2)}-`
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
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import {
	bundleComponentUnits,
	bundleVsSingle,
	dailyRevenue,
	fillDays,
	itemsSold,
	parseStatus,
	salesList,
	salesSummary,
	topItems
} from './reports';
import { parseRange, wibEnd, wibStart } from './time';
import {
	makeOrderInserter,
	generateOrders,
	seedCatalog,
	type Catalog
} from '../../../tests/synthetic';

// --- jalur kode halaman owner (diimpor langsung; `load` dipanggil seperti SvelteKit) ---
import * as dashboard from '../../routes/owner/+page.server';
import * as laporan from '../../routes/owner/laporan/+page.server';
import * as ekspor from '../../routes/owner/laporan/export/+server';
import * as stok from '../../routes/owner/stok/+page.server';
import * as aktivitas from '../../routes/owner/aktivitas/+page.server';

let raw: Database.Database;
let cat: Catalog;

const R = (dari: string, sampai: string): [Date, Date] => [wibStart(dari), wibEnd(sampai)];
const range = (dari: string, sampai: string) => ({
	from: wibStart(dari),
	to: wibEnd(sampai)
});

beforeAll(() => {
	raw = new Database(dbFile);
	raw.pragma('journal_mode = WAL');
	raw.pragma('foreign_keys = ON');
	// Pastikan ini DB tes (bukan DB pengguna)
	if (!/\.tmp-reports-/.test(dbFile)) throw new Error('MENOLAK: bukan DB tes laporan');

	cat = seedCatalog(raw, ['=HYPERLINK("http://contoh.test")', 'Siti Aminah', 'Citra Dewi']);
	const [A, B, C, , E] = cat.products;
	const [b1, b2] = cat.bundles;
	const [u1, u2, u3] = cat.buyers;
	const insert = makeOrderInserter(raw, cat);
	const p = (product: { id: number }, qty: number) => ({
		kind: 'product' as const,
		productId: product.id,
		qty
	});
	const bd = (b: { id: number }, qty: number) => ({ kind: 'bundle' as const, bundleId: b.id, qty });

	// o1: 31 Okt 23:30 WIB (masuk OKTOBER)
	insert({
		code: 'T-O1',
		userId: u1,
		status: 'selesai',
		createdAt: '2026-10-31T16:30:00.000Z',
		items: [p(A, 1)]
	});
	// o2: 1 Nov 00:30 WIB (masuk NOVEMBER, bukan Oktober)
	insert({
		code: 'T-O2',
		userId: u2,
		status: 'diproses',
		createdAt: '2026-10-31T17:30:00.000Z',
		items: [p(B, 2)]
	});
	// o3: 1 Nov 07:00 WIB; paket 2x + kaos
	insert({
		code: 'T-O3',
		userId: u3,
		status: 'dikirim',
		createdAt: '2026-11-01T00:00:00.000Z',
		items: [bd(b1, 2), p(A, 1)]
	});
	// o4: 10 Nov 12:00 WIB; hoodie + paket lengkap; ongkir 0
	insert({
		code: 'T-O4',
		userId: u2,
		status: 'selesai',
		createdAt: '2026-11-10T05:00:00.000Z',
		shipping: 0,
		items: [p(C, 1), bd(b2, 1)]
	});
	// o5: 30 Nov 23:59:59.999 WIB (batas akhir, masuk NOVEMBER)
	insert({
		code: 'T-O5',
		userId: u1,
		status: 'selesai',
		createdAt: '2026-11-30T16:59:59.999Z',
		items: [p(A, 3)]
	});
	// o6: 1 Des 00:00:00 WIB (masuk DESEMBER)
	insert({
		code: 'T-O6',
		userId: u1,
		status: 'selesai',
		createdAt: '2026-11-30T17:00:00.000Z',
		items: [p(E, 2)]
	});
	// tidak dihitung
	insert({
		code: 'T-O7',
		userId: u1,
		status: 'dibatalkan',
		createdAt: '2026-11-05T03:00:00.000Z',
		items: [p(A, 5)]
	});
	insert({
		code: 'T-O8',
		userId: u1,
		status: 'menunggu_pembayaran',
		createdAt: '2026-11-06T03:00:00.000Z',
		items: [p(A, 1)]
	});
	insert({
		code: 'T-O9',
		userId: u1,
		status: 'menunggu_konfirmasi',
		createdAt: '2026-11-07T03:00:00.000Z',
		items: [p(A, 1)]
	});
});

afterAll(() => {
	raw?.close();
	for (const ext of ['', '-wal', '-shm']) rmSync(dbFile + ext, { force: true });
});

describe('ringkasan penjualan (BR-12, BR-21)', () => {
	it('November: pendapatan = Σ subtotal TANPA ongkir; omzet = pendapatan + ongkir', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		const s = await salesSummary(from, to);
		expect(s.revenue).toBe(100_000 + 360_000 + 590_000 + 300_000); // o2+o3+o4+o5 = 1.350.000
		expect(s.shipping).toBe(15_000 + 15_000 + 0 + 15_000);
		expect(s.gross).toBe(s.revenue + s.shipping);
		expect(s.orders).toBe(4);
		expect(s.avg).toBe(337_500); // subtotal / jumlah pesanan
	});

	it('pesanan yang dananya sudah dikembalikan PENUH tidak dihitung sebagai penjualan', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		const before = await salesSummary(from, to);
		const o5 = raw.prepare("SELECT id FROM orders WHERE code = 'T-O5'").get() as { id: number };
		const addPay = (status: string) =>
			raw
				.prepare('INSERT INTO payments (order_id, amount, status) VALUES (?, 300000, ?)')
				.run(o5.id, status);
		try {
			addPay('dikembalikan');
			const refunded = await salesSummary(from, to);
			expect(refunded.revenue).toBe(before.revenue - 300_000);
			expect(refunded.orders).toBe(before.orders - 1);

			// ada pembayaran lain yang dikonfirmasi (mis. bayar ganda lalu salah satunya di-refund) → tetap penjualan
			addPay('dikonfirmasi');
			expect((await salesSummary(from, to)).revenue).toBe(before.revenue);
		} finally {
			raw.prepare('DELETE FROM payments WHERE order_id = ?').run(o5.id);
		}
	});

	it('hanya diproses/dikirim/selesai: batal & menunggu tidak dihitung', async () => {
		const { from, to } = range('2026-11-05', '2026-11-07');
		const s = await salesSummary(from, to);
		expect(s.orders).toBe(0);
		expect(s.revenue).toBe(0);
		expect(s.avg).toBe(0);
	});

	it('batas hari WIB: 31 Okt 23:30 WIB masuk Oktober; 1 Nov 00:30 WIB masuk November', async () => {
		const okt = await salesSummary(...R('2026-10-01', '2026-10-31'));
		expect(okt.orders).toBe(1);
		expect(okt.revenue).toBe(100_000); // hanya o1

		const nov = await salesSummary(...R('2026-11-01', '2026-11-30'));
		expect(nov.orders).toBe(4); // o2 (00:30 WIB) ikut November
	});

	it('batas akhir inklusif sampai 23:59:59.999 WIB dan 00:00:00 WIB hari berikutnya keluar', async () => {
		const des = await salesSummary(...R('2026-12-01', '2026-12-01'));
		expect(des.orders).toBe(1); // o6 tepat 00:00 WIB 1 Des
		expect(des.revenue).toBe(30_000);
		const nov30 = await salesSummary(...R('2026-11-30', '2026-11-30'));
		expect(nov30.orders).toBe(1); // o5 pada 23:59:59.999
		expect(nov30.revenue).toBe(300_000);
	});

	it('filter status', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		expect((await salesSummary(from, to, 'dikirim')).revenue).toBe(360_000);
		expect((await salesSummary(from, to, 'selesai')).orders).toBe(2);
		expect((await salesSummary(from, to, 'diproses')).orders).toBe(1);
	});

	it('parseStatus memakai whitelist', () => {
		expect(parseStatus('dibatalkan')).toBe('semua');
		expect(parseStatus("selesai' OR 1=1 --")).toBe('semua');
		expect(parseStatus(null)).toBe('semua');
		expect(parseStatus('dikirim')).toBe('dikirim');
	});

	it('unit terjual: paket dihitung 1 unit per paket', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		// o2: 2, o3: 2 paket + 1 = 3, o4: 1 + 1 = 2, o5: 3
		expect(await itemsSold(from, to)).toBe(10);
	});
});

describe('grafik harian (WIB, terisi nol)', () => {
	it('mengelompokkan per hari WIB dan mengisi hari kosong dengan 0', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		const rows = await dailyRevenue(from, to);
		expect(rows).toEqual([
			{ day: '2026-11-01', revenue: 460_000, orders: 2 }, // o2 (00:30 WIB) + o3 (07:00 WIB)
			{ day: '2026-11-10', revenue: 590_000, orders: 1 },
			{ day: '2026-11-30', revenue: 300_000, orders: 1 }
		]);
		const filled = fillDays(rows, '2026-11-01', '2026-11-30');
		expect(filled).toHaveLength(30);
		expect(filled[1]).toEqual({ day: '2026-11-02', revenue: 0, orders: 0 });
		expect(filled.reduce((s, r) => s + r.revenue, 0)).toBe(1_350_000);
	});

	it('fillDays melintasi pergantian bulan/tahun dan 29 Februari', () => {
		expect(fillDays([], '2027-12-30', '2028-01-02').map((d) => d.day)).toEqual([
			'2027-12-30',
			'2027-12-31',
			'2028-01-01',
			'2028-01-02'
		]);
		expect(fillDays([], '2028-02-28', '2028-03-01').map((d) => d.day)).toEqual([
			'2028-02-28',
			'2028-02-29',
			'2028-03-01'
		]);
	});
});

describe('produk/paket terlaris & bundling', () => {
	it('dikelompokkan per produk/paket (bukan per nama); rename tidak memecah baris', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		const top = await topItems(from, to, 10);
		expect(top.map((t) => [t.type, t.qty, t.revenue])).toEqual([
			['product', 4, 400_000], // Kaos: o3 1 + o5 3
			['bundle', 2, 260_000], // Paket hemat (qty sama dgn Topi; pendapatan lebih besar)
			['product', 2, 100_000], // Topi
			['bundle', 1, 340_000],
			['product', 1, 250_000]
		]);

		const kaos = cat.products[0];
		raw
			.prepare('update products set name = ? where id = ?')
			.run('Kaos Downshit (Nama Baru)', kaos.id);
		const after = await topItems(from, to, 10);
		expect(after.filter((t) => t.productId === kaos.id)).toHaveLength(1);
		expect(after[0].name).toBe('Kaos Downshit (Nama Baru)');
		raw.prepare('update products set name = ? where id = ?').run(kaos.name, kaos.id);
	});

	it('limit diterapkan', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		expect(await topItems(from, to, 3)).toHaveLength(3);
	});

	it('bundling vs satuan: unit, pendapatan, porsi %', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		const split = Object.fromEntries((await bundleVsSingle(from, to)).map((r) => [r.type, r]));
		expect(split.product).toMatchObject({ qty: 7, revenue: 750_000, share: 55.6 });
		expect(split.bundle).toMatchObject({ qty: 3, revenue: 600_000, share: 44.4 });
	});

	it('unit produk fisik yang keluar lewat paket (komponen)', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		const comp = await bundleComponentUnits(from, to);
		const byName = Object.fromEntries(comp.rows.map((r) => [r.productId, r.units]));
		const [A, B, C, D] = cat.products;
		// paket1 x2 -> Kaos 2, Topi 2; paket2 x1 -> Kaos 1, Hoodie 1, Totebag 2
		expect(byName[A.id]).toBe(3);
		expect(byName[B.id]).toBe(2);
		expect(byName[C.id]).toBe(1);
		expect(byName[D.id]).toBe(2);
		expect(comp.total).toBe(8);
	});

	it('periode tanpa data -> hasil kosong, tidak crash', async () => {
		const { from, to } = range('2020-01-01', '2020-01-31');
		expect(await topItems(from, to)).toEqual([]);
		expect(await bundleVsSingle(from, to)).toEqual([]);
		expect((await bundleComponentUnits(from, to)).total).toBe(0);
		expect(await dailyRevenue(from, to)).toEqual([]);
		const s = await salesSummary(from, to);
		expect(s).toMatchObject({ revenue: 0, orders: 0, avg: 0, gross: 0, shipping: 0 });
	});
});

describe('daftar transaksi & paginasi', () => {
	it('urut terbaru dulu, paginasi, total sesuai', async () => {
		const { from, to } = range('2026-11-01', '2026-11-30');
		const all = await salesList(from, to);
		expect(all.total).toBe(4);
		expect(all.rows.map((r) => r.code)).toEqual(['T-O5', 'T-O4', 'T-O3', 'T-O2']);
		const p2 = await salesList(from, to, 'semua', { page: 2, perPage: 2 });
		expect(p2.rows.map((r) => r.code)).toEqual(['T-O3', 'T-O2']);
		expect(p2.total).toBe(4);
		const p9 = await salesList(from, to, 'semua', { page: 9, perPage: 2 });
		expect(p9.rows).toEqual([]);
	});
});

describe('integritas data (SQL §9 (f)): HARUS 0 baris', () => {
	it('subtotal = Σ item dan total = subtotal + ongkir', () => {
		const bad = raw
			.prepare(
				`select o.id from orders o
				 where o.subtotal <> (select coalesce(sum(subtotal),0) from order_items where order_id = o.id)
				    or o.total <> o.subtotal + o.shipping_cost`
			)
			.all();
		expect(bad).toEqual([]);
	});
});

describe('angka laporan = hitungan SQL manual (data acak 800 pesanan, banyak rentang)', () => {
	beforeAll(() => {
		generateOrders(raw, cat, {
			count: 800,
			fromIso: '2025-06-01T00:00:00.000Z',
			toIso: '2026-10-15T23:59:59.999Z',
			seed: 7
		});
	});

	// Kueri pembanding ditulis berbeda dari implementasi: hari WIB dihitung dengan date(created_at,'+7 hours')
	const manual = (dari: string, sampai: string, statuses = ['diproses', 'dikirim', 'selesai']) => {
		const marks = statuses.map(() => '?').join(',');
		const where = `status in (${marks}) and date(created_at, '+7 hours') between ? and ?`;
		const args = [...statuses, dari, sampai];
		const sum = raw
			.prepare(
				`select coalesce(sum(subtotal),0) rev, coalesce(sum(shipping_cost),0) ship, coalesce(sum(total),0) gross, count(*) n from orders where ${where}`
			)
			.get(...args) as { rev: number; ship: number; gross: number; n: number };
		const days = raw
			.prepare(
				`select date(created_at,'+7 hours') day, sum(subtotal) revenue, count(*) orders from orders where ${where} group by day order by day`
			)
			.all(...args);
		const units = raw
			.prepare(
				`select coalesce(sum(oi.quantity),0) q from order_items oi join orders o on o.id = oi.order_id
				 where o.status in (${marks}) and date(o.created_at,'+7 hours') between ? and ?`
			)
			.get(...args) as { q: number };
		const comp = raw
			.prepare(
				`select oic.product_id productId, sum(oic.quantity) units
				 from order_item_components oic join order_items oi on oi.id = oic.order_item_id join orders o on o.id = oi.order_id
				 where o.status in (${marks}) and date(o.created_at,'+7 hours') between ? and ?
				 group by oic.product_id order by units desc, productId`
			)
			.all(...args) as { productId: number; units: number }[];
		const top = raw
			.prepare(
				`select oi.item_type type, oi.product_id productId, oi.bundle_id bundleId, sum(oi.quantity) qty, sum(oi.subtotal) revenue
				 from order_items oi join orders o on o.id = oi.order_id
				 where o.status in (${marks}) and date(o.created_at,'+7 hours') between ? and ?
				 group by oi.item_type, oi.product_id, oi.bundle_id order by qty desc, revenue desc`
			)
			.all(...args) as {
			type: string;
			productId: number | null;
			bundleId: number | null;
			qty: number;
			revenue: number;
		}[];
		return { sum, days, units: units.q, comp, top };
	};

	const cases: [string, string][] = [
		['2025-06-01', '2026-10-15'],
		['2026-03-15', '2026-03-15'],
		['2026-02-27', '2026-03-02'],
		['2025-12-31', '2026-01-01'],
		['2026-06-01', '2026-06-30'],
		['2025-10-31', '2025-11-01']
	];

	it.each(cases)('rentang %s s/d %s', async (dari, sampai) => {
		const m = manual(dari, sampai);
		const { from, to } = range(dari, sampai);

		const s = await salesSummary(from, to);
		expect([s.revenue, s.shipping, s.gross, s.orders]).toEqual([
			m.sum.rev,
			m.sum.ship,
			m.sum.gross,
			m.sum.n
		]);
		expect(s.avg).toBe(m.sum.n ? Math.round(m.sum.rev / m.sum.n) : 0);

		expect(await dailyRevenue(from, to)).toEqual(
			(m.days as { day: string; revenue: number; orders: number }[]).map((d) => ({ ...d }))
		);
		expect(await itemsSold(from, to)).toBe(m.units);

		const comp = await bundleComponentUnits(from, to);
		expect(comp.total).toBe(m.comp.reduce((t, r) => t + r.units, 0));
		expect(Object.fromEntries(comp.rows.map((r) => [r.productId, r.units]))).toEqual(
			Object.fromEntries(m.comp.map((r) => [r.productId, r.units]))
		);

		const top = await topItems(from, to, 100);
		expect(top.map((t) => [t.type, t.productId, t.bundleId, t.qty, t.revenue])).toEqual(
			m.top.map((t) => [t.type, t.productId, t.bundleId, t.qty, t.revenue])
		);

		const list = await salesList(from, to);
		expect(list.total).toBe(m.sum.n);
		expect(list.rows.reduce((t, r) => t + r.subtotal, 0)).toBe(m.sum.rev);

		// jumlah grafik harian terisi nol = pendapatan total
		const filled = fillDays(await dailyRevenue(from, to), dari, sampai);
		expect(filled.reduce((t, r) => t + r.revenue, 0)).toBe(m.sum.rev);
	});

	it('filter status sama dengan SQL manual', async () => {
		const { from, to } = range('2025-06-01', '2026-10-15');
		for (const st of ['diproses', 'dikirim', 'selesai'] as const) {
			const m = manual('2025-06-01', '2026-10-15', [st]);
			const s = await salesSummary(from, to, st);
			expect([s.revenue, s.orders]).toEqual([m.sum.rev, m.sum.n]);
		}
	});

	it('pesanan 00:00-07:00 WIB tercatat pada hari WIB yang benar (bukan hari UTC)', async () => {
		const pre = raw
			.prepare(
				`select count(*) n from orders where status in ('diproses','dikirim','selesai')
				 and substr(created_at, 12, 2) >= '17' `
			)
			.get() as { n: number };
		expect(pre.n).toBeGreaterThan(5); // data acak memang memuat jam 17:00-24:00 UTC
		const { from, to } = range('2025-06-01', '2026-12-31');
		const days = await dailyRevenue(from, to);
		// tiap pesanan 17:00-23:59 UTC harus dipetakan ke tanggal UTC + 1
		const expected = raw
			.prepare(
				`select count(*) n from orders where status in ('diproses','dikirim','selesai')
				 and substr(created_at, 12, 2) >= '17'
				 and date(created_at,'+7 hours') <> substr(created_at, 1, 10)`
			)
			.get() as { n: number };
		expect(expected.n).toBe(pre.n);
		expect(days.reduce((t, d) => t + d.orders, 0)).toBe(
			(
				raw
					.prepare(`select count(*) n from orders where status in ('diproses','dikirim','selesai')`)
					.get() as { n: number }
			).n
		);
	});
});

describe('hak akses owner vs admin vs konsumen (BR/NF-04)', () => {
	const user = (role: 'owner' | 'admin' | 'konsumen') => ({
		id: 1,
		name: role,
		email: `${role}@x.id`,
		role,
		mustChangePassword: false
	});
	const url = (p = '/owner') => new URL('http://localhost' + p);

	// Handler diuji dengan event minimal (bukan RequestEvent lengkap)
	type Handler = (e: never) => unknown;
	const call = async (fn: Handler, role: 'owner' | 'admin' | 'konsumen' | null, p?: string) => {
		try {
			await fn({
				locals: { user: role ? user(role) : null },
				url: url(p),
				request: new Request(url(p))
			} as never);
			return 200;
		} catch (e) {
			if (isHttpError(e)) return e.status;
			if (isRedirect(e)) return e.status;
			throw e;
		}
	};

	const handlers: [string, (e: never) => unknown][] = [
		['/owner', dashboard.load as never],
		['/owner/laporan', laporan.load as never],
		['/owner/laporan/export', ekspor.GET as never],
		['/owner/stok', stok.load as never],
		['/owner/aktivitas', aktivitas.load as never]
	];

	it.each(handlers)(
		'%s: owner 200; admin & konsumen 403; tamu dialihkan ke login',
		async (path, fn) => {
			expect(await call(fn, 'owner', path)).toBe(200);
			expect(await call(fn, 'admin', path)).toBe(403);
			expect(await call(fn, 'konsumen', path)).toBe(403);
			expect(await call(fn, null, path)).toBe(303);
		}
	);

	it('route owner tidak punya form action (read-only; POST -> 405 oleh SvelteKit)', () => {
		for (const mod of [dashboard, laporan, stok, aktivitas]) {
			expect('actions' in mod).toBe(false);
		}
		expect('POST' in ekspor).toBe(false);
		expect('PUT' in ekspor).toBe(false);
		expect('DELETE' in ekspor).toBe(false);
	});
});

describe('halaman owner: load tidak crash pada input liar', () => {
	const owner = {
		id: 1,
		name: 'o',
		email: 'o@x',
		role: 'owner' as const,
		mustChangePassword: false
	};
	const load = async <T>(fn: (e: never) => T, q: string) =>
		(await fn({
			locals: { user: owner },
			url: new URL('http://localhost/owner?' + q)
		} as never)) as Exclude<Awaited<T>, void>;

	it.each([
		'dari=abc&sampai=xyz',
		'dari=2026-11-20&sampai=2026-11-01',
		'dari=2020-01-01&sampai=2026-11-01',
		'dari=2026-02-31&sampai=2026-03-01',
		"dari=2026-11-01&sampai=2026-11-30&status='; DROP TABLE orders;--",
		'dari=&sampai=',
		'page=-5',
		'page=abc',
		'page=99999999999'
	])('laporan & dashboard: %s', async (q) => {
		const l = await load(laporan.load, q);
		expect(l.rows).toBeDefined();
		const d = await load(dashboard.load, q);
		expect(d.summary).toBeDefined();
		if (/dari=(abc|2026-11-20|2020|2026-02-31)/.test(q)) {
			expect(l.range.error).toBeTruthy();
			expect(d.range.error).toBeTruthy();
		}
	});

	it('rentang tidak valid -> rentang bawaan dipakai + pesan galat', async () => {
		const l = await load(laporan.load, 'dari=2026-11-20&sampai=2026-11-01');
		expect(l.range.error).toMatch(/lebih awal/);
		expect(l.range.dari).toMatch(/^\d{4}-\d{2}-01$/);
	});

	it('laporan November: halaman memuat angka sama dengan fungsi laporan', async () => {
		const l = await load(laporan.load, 'dari=2026-11-01&sampai=2026-11-30&status=semua');
		const d = await load(dashboard.load, 'dari=2026-11-01&sampai=2026-11-30');
		const { from, to } = range('2026-11-01', '2026-11-30');
		const s = await salesSummary(from, to);
		expect(l.summary).toEqual(s);
		expect(d.summary).toEqual(s);
		expect(d.units).toBe(await itemsSold(from, to));
		expect(l.daily).toHaveLength(30);
		expect(d.daily).toHaveLength(30);
		expect(l.total).toBe(s.orders);
	});

	it('ekspor CSV: BOM, pemisah, tanggal WIB, TOTAL, nama berkas, anti formula injection', async () => {
		const res = await (ekspor.GET as never as (e: unknown) => Promise<Response>)({
			locals: { user: owner },
			url: new URL('http://localhost/owner/laporan/export?dari=2026-11-01&sampai=2026-11-30')
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="laporan-penjualan_2026-11-01_2026-11-30.csv"'
		);
		expect(res.headers.get('cache-control')).toMatch(/no-store/);
		const bytes = new Uint8Array(await res.clone().arrayBuffer());
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 agar Excel membaca UTF-8
		const text = await res.text(); // text() membuang BOM
		const lines = text.split('\r\n');
		expect(lines[0]).toBe(
			'"Kode Pesanan";"Tanggal (WIB)";"Pelanggan";"Status";"Subtotal (Barang)";"Diskon Voucher";"Pendapatan (Subtotal - Diskon)";"Ongkir";"Total (Omzet)"'
		);
		expect(lines).toHaveLength(1 + 4 + 1); // header + 4 pesanan + TOTAL
		expect(lines[lines.length - 1]).toBe(
			'"TOTAL";"";"";"4 pesanan";1350000;0;1350000;45000;1395000'
		);
		// o5 30 Nov 23:59 WIB (16:59 UTC), o2 1 Nov 00:30 WIB (31 Okt 17:30 UTC)
		expect(text).toContain('"T-O5";"2026-11-30 23:59"');
		expect(text).toContain('"T-O2";"2026-11-01 00:30"');
		// pelanggan o1 bernama =HYPERLINK(...) hanya di Oktober; ekspor Oktober menetralkannya
		const okt = await (ekspor.GET as never as (e: unknown) => Promise<Response>)({
			locals: { user: owner },
			url: new URL(
				'http://localhost/owner/laporan/export?dari=2026-10-01&sampai=2026-10-31&pemisah=koma'
			)
		});
		const oktText = await okt.text();
		expect(oktText).toContain(`"'=HYPERLINK(""http://contoh.test"")"`);
		expect(oktText).toContain('"T-O1","2026-10-31 23:30"');
	});

	it('ekspor dengan rentang salah -> 400 (bukan diam-diam memakai rentang lain)', async () => {
		try {
			await (ekspor.GET as never as (e: unknown) => Promise<Response>)({
				locals: { user: owner },
				url: new URL('http://localhost/owner/laporan/export?dari=2026-11-20&sampai=2026-11-01')
			});
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e) && e.status).toBe(400);
		}
	});
});

describe('parseRange bawaan (WIB)', () => {
	it('awal bulan s/d hari ini menurut WIB, bukan UTC', () => {
		// 31 Okt 20:00 UTC = 1 Nov 03:00 WIB
		const r = parseRange(new URL('http://x/'), new Date('2026-10-31T20:00:00Z'));
		expect([r.dari, r.sampai]).toEqual(['2026-11-01', '2026-11-01']);
	});
});
