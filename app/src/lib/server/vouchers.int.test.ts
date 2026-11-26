/**
 * Voucher/promo: perhitungan potongan, aturan pakai, kuota atomik, pengembalian kuota saat pesanan batal,
 * aksi admin, pratinjau /api/voucher, dan pengaruhnya ke laporan.
 */
import { describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-orders-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file, uploads: `./tests/.tmp-uploads-orders-${rand}` };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: env.uploads,
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { eq } from 'drizzle-orm';
import { db } from './db';
import { orders, products, voucherRedemptions, vouchers } from './db/schema';
import { computeDiscount, checkVoucher, listHomeVouchers, voucherStatus } from './vouchers';
import { cancelOrder, createOrderFromCart, expireUnpaidOrders } from './orders';
import { salesSummary } from './reports';
import { confirmPayment, submitPaymentProof } from './order-flow';
import * as adminVoucher from '../../routes/admin/voucher/+page.server';
import * as apiVoucher from '../../routes/api/voucher/+server';
import * as home from '../../routes/+page.server';
import {
	SHIP,
	U,
	adminId,
	buyer2Id,
	buyerId,
	cartAdd,
	catchResult,
	expireNow,
	kaosId,
	stockOf,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

type NewVoucher = Partial<typeof vouchers.$inferInsert>;
const mkVoucher = (o: NewVoucher = {}) =>
	db
		.insert(vouchers)
		.values({ code: 'HEMAT10', type: 'percent', value: 10, ...o })
		.returning()
		.get();

const buy = async (userId = buyerId, code?: string, qty = 1) => {
	await cartAdd(userId, 'product', kaosId, qty);
	return createOrderFromCart(userId, { ...SHIP, voucherCode: code });
};
/** `U()` mengembalikan locals utuh (bertipe never); beranda hanya butuh `.user` */
const userOf = (locals: unknown) => (locals as { user: unknown }).user;
const ordersRow = (id: number) => db.select().from(orders).where(eq(orders.id, id)).get()!;
const voucherRow = () => db.select().from(vouchers).get()!;

describe('computeDiscount', () => {
	it('persen dibulatkan ke bawah dan dibatasi maxDiscount; nominal tidak melebihi subtotal', () => {
		expect(computeDiscount({ type: 'percent', value: 15, maxDiscount: null }, 99_999)).toBe(14_999);
		expect(computeDiscount({ type: 'percent', value: 50, maxDiscount: 20_000 }, 200_000)).toBe(
			20_000
		);
		expect(computeDiscount({ type: 'fixed', value: 30_000, maxDiscount: null }, 100_000)).toBe(
			30_000
		);
		expect(computeDiscount({ type: 'fixed', value: 30_000, maxDiscount: null }, 10_000)).toBe(
			10_000
		);
		expect(computeDiscount({ type: 'percent', value: 100, maxDiscount: null }, 5_000)).toBe(5_000);
	});
});

describe('checkVoucher (aturan pakai)', () => {
	const chk = (code: string, subtotal = 100_000, now?: Date) =>
		checkVoucher(db, code, buyerId, subtotal, now);

	it('kode dinormalkan (huruf besar, spasi); tak dikenal / nonaktif → pesan umum', () => {
		mkVoucher();
		expect(chk(' hemat10 ')).toMatchObject({ ok: true, discount: 10_000 });
		expect(chk('')).toMatchObject({ ok: false });
		expect(chk('TIDAKADA')).toMatchObject({
			ok: false,
			message: expect.stringMatching(/tidak valid/)
		});
		db.update(vouchers).set({ isActive: false }).run();
		expect(chk('HEMAT10')).toMatchObject({
			ok: false,
			message: expect.stringMatching(/tidak valid/)
		});
	});

	it('periode, minimal belanja, dan kuota total', () => {
		mkVoucher({
			startsAt: '2026-11-10T00:00:00.000Z',
			endsAt: '2026-11-20T00:00:00.000Z',
			minSubtotal: 50_000,
			usageLimit: 1
		});
		const at = (d: string) => new Date(`${d}T12:00:00Z`);
		expect(chk('HEMAT10', 100_000, at('2026-11-09')).ok).toBe(false); // belum mulai
		expect(chk('HEMAT10', 100_000, at('2026-11-21')).ok).toBe(false); // sudah berakhir
		expect(chk('HEMAT10', 100_000, at('2026-11-15')).ok).toBe(true);
		expect(chk('HEMAT10', 49_000, at('2026-11-15'))).toMatchObject({
			ok: false,
			message: expect.stringMatching(/Minimal belanja Rp 50\.000/)
		});
		db.update(vouchers).set({ usedCount: 1 }).run();
		expect(chk('HEMAT10', 100_000, at('2026-11-15'))).toMatchObject({
			ok: false,
			message: expect.stringMatching(/Kuota/)
		});
	});
});

describe('voucher di checkout', () => {
	it('potongan masuk total & tersimpan; kuota terpakai; satu kali per pelanggan', async () => {
		mkVoucher(); // 10% dari 100.000
		const o = await buy(buyerId, 'hemat10');
		const row = ordersRow(o.orderId);
		expect(row).toMatchObject({ subtotal: 100_000, discount: 10_000, voucherCode: 'HEMAT10' });
		expect(row.total).toBe(100_000 - 10_000 + row.shippingCost);
		expect(voucherRow().usedCount).toBe(1);
		expect(db.select().from(voucherRedemptions).all()).toHaveLength(1);

		await cartAdd(buyerId, 'product', kaosId, 1);
		await expect(createOrderFromCart(buyerId, { ...SHIP, voucherCode: 'HEMAT10' })).rejects.toThrow(
			/sudah kamu pakai/
		);
	});

	it('voucher tidak valid menggagalkan seluruh pesanan (stok & keranjang utuh)', async () => {
		await cartAdd(buyerId, 'product', kaosId, 2);
		await expect(createOrderFromCart(buyerId, { ...SHIP, voucherCode: 'NGAWUR' })).rejects.toThrow(
			/tidak valid/
		);
		expect(stockOf(kaosId)).toBe(10);
		expect(db.select().from(orders).all()).toHaveLength(0);
	});

	it('kuota terakhir diperebutkan dua pelanggan: tepat satu yang berhasil', async () => {
		mkVoucher({ usageLimit: 1 });
		await cartAdd(buyerId, 'product', kaosId, 1);
		await cartAdd(buyer2Id, 'product', kaosId, 1);
		const res = await Promise.allSettled([
			createOrderFromCart(buyerId, { ...SHIP, voucherCode: 'HEMAT10' }),
			createOrderFromCart(buyer2Id, { ...SHIP, voucherCode: 'HEMAT10' })
		]);
		expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(voucherRow().usedCount).toBe(1);
	});

	it('pesanan dibatalkan / kedaluwarsa → kuota & jatah per pelanggan kembali', async () => {
		mkVoucher({ usageLimit: 5 });
		const a = await buy(buyerId, 'HEMAT10');
		expect(voucherRow().usedCount).toBe(1);
		await cancelOrder(a.orderId, { id: buyerId, role: 'konsumen' }, 'Salah pilih');
		expect(voucherRow().usedCount).toBe(0);
		expect(db.select().from(voucherRedemptions).all()).toHaveLength(0);

		const b = await buy(buyerId, 'HEMAT10'); // boleh dipakai lagi
		expect(voucherRow().usedCount).toBe(1);
		expireNow(b.orderId);
		await expireUnpaidOrders();
		expect(voucherRow().usedCount).toBe(0);
		// riwayat potongan pada pesanan batal tetap tercatat apa adanya
		expect(ordersRow(b.orderId).discount).toBe(10_000);
	});

	it('laporan: pendapatan = subtotal − diskon (tanpa ongkir)', async () => {
		mkVoucher();
		const o = await buy(buyerId, 'HEMAT10');
		await submitPaymentProof(o.code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(o.code, adminId); // laporan hanya menghitung pesanan yang sudah dibayar
		const s = await salesSummary(
			new Date(Date.now() - 86_400_000),
			new Date(Date.now() + 86_400_000)
		);
		expect(s.revenue).toBe(90_000);
		expect(s.gross).toBe(90_000 + ordersRow(o.orderId).shippingCost);
	});
});

describe('admin voucher & pratinjau', () => {
	const form = (
		fields: Record<string, string>,
		uid = adminId,
		role: 'admin' | 'konsumen' = 'admin'
	) => {
		const fd = new FormData();
		for (const [k, v] of Object.entries(fields)) fd.set(k, v);
		return {
			locals: U(uid, role),
			request: new Request('http://x', { method: 'POST', body: fd })
		} as never;
	};
	const base = {
		code: 'promo-natal',
		type: 'percent',
		value: '20',
		minSubtotal: '0',
		perUserLimit: '1',
		isActive: 'on'
	};
	type Out = {
		success?: boolean;
		status?: number;
		data?: { errors?: Record<string, string[]>; message?: string };
	};

	it('membuat voucher (kode dinormalkan, tanggal WIB → UTC), menolak kode ganda & nilai tak valid', async () => {
		const ok = (await adminVoucher.actions.simpan(
			form({ ...base, startsOn: '2026-12-01', endsOn: '2026-12-25', usageLimit: '100' })
		)) as Out;
		expect(ok.success).toBe(true);
		expect(voucherRow()).toMatchObject({
			code: 'PROMO-NATAL',
			startsAt: '2026-11-30T17:00:00.000Z', // 00:00 WIB
			endsAt: '2026-12-25T16:59:59.999Z', // 23:59:59 WIB
			usageLimit: 100
		});

		const dup = (await adminVoucher.actions.simpan(form(base))) as Out;
		expect(dup.status).toBe(400);
		expect(dup.data?.errors?.code?.length).toBeGreaterThan(0);

		const over = (await adminVoucher.actions.simpan(
			form({ ...base, code: 'X1X', value: '150' })
		)) as Out;
		expect(over.data?.errors?.value?.[0]).toMatch(/maksimal 100/);
		expect(db.select().from(vouchers).all()).toHaveLength(1);
	});

	it('ubah: kuota tidak boleh di bawah yang terpakai; nonaktifkan; hapus hanya bila belum pernah dipakai', async () => {
		mkVoucher({ code: 'ABC', usageLimit: 10 });
		await buy(buyerId, 'ABC');
		const id = String(voucherRow().id);

		const low = (await adminVoucher.actions.simpan(
			form({ ...base, id, code: 'ABC', usageLimit: '0' })
		)) as Out;
		expect(low.status).toBe(400);
		const same = (await adminVoucher.actions.simpan(
			form({ ...base, id, code: 'ABC', usageLimit: '1' })
		)) as Out;
		expect(same.data?.errors?.usageLimit).toBeUndefined();

		await adminVoucher.actions.toggle(form({ id, active: '0' }));
		expect(voucherRow().isActive).toBe(false);

		const del = (await adminVoucher.actions.hapus(form({ id }))) as Out;
		expect(del.status).toBe(400);
		expect(db.select().from(vouchers).all()).toHaveLength(1);

		const fresh = mkVoucher({ code: 'BARU' });
		const ok = (await adminVoucher.actions.hapus(form({ id: String(fresh.id) }))) as Out;
		expect(ok.success).toBe(true);
	});

	it('hanya admin yang boleh mengelola voucher', async () => {
		const r = await catchResult(() => adminVoucher.actions.simpan(form(base, buyerId, 'konsumen')));
		expect(!r.ok && r.error.status).toBe(403);
	});

	it('GET /api/voucher: pratinjau potongan untuk item tercentang; kode salah → pesan; wajib login', async () => {
		mkVoucher();
		await cartAdd(buyerId, 'product', kaosId, 1);
		const call = (code: string, user = true) =>
			catchResult(
				() =>
					apiVoucher.GET({
						locals: user ? U(buyerId) : { user: null, sessionId: null },
						url: new URL(`http://x/api/voucher?code=${code}`)
					} as never) as Promise<Response>
			);
		const ok = await call('hemat10');
		expect(await (ok as { value: Response }).value.json()).toMatchObject({
			ok: true,
			code: 'HEMAT10',
			discount: 10_000
		});
		const bad = await call('SALAH');
		expect(await (bad as { value: Response }).value.json()).toMatchObject({ ok: false });
		const guest = await call('hemat10', false);
		expect(guest.ok).toBe(false);
		expect(db.select().from(voucherRedemptions).all()).toHaveLength(0); // pratinjau tidak memakai kuota
		expect(db.select().from(products).all().length).toBeGreaterThan(0);
	});
});

describe('status & banner beranda', () => {
	const at = (d: string) => new Date(`${d}T12:00:00Z`);

	it('voucherStatus: urutan prioritas nonaktif → habis → kedaluwarsa → belum mulai → aktif', () => {
		const base = { isActive: true, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0 };
		expect(voucherStatus(base)).toBe('aktif');
		expect(voucherStatus({ ...base, isActive: false, usageLimit: 1, usedCount: 1 })).toBe(
			'nonaktif'
		);
		expect(
			voucherStatus({ ...base, usageLimit: 3, usedCount: 3, endsAt: '2000-01-01T00:00:00Z' })
		).toBe('habis');
		expect(voucherStatus({ ...base, endsAt: '2026-11-20T00:00:00Z' }, at('2026-11-26'))).toBe(
			'kedaluwarsa'
		);
		expect(voucherStatus({ ...base, startsAt: '2026-12-01T00:00:00Z' }, at('2026-11-26'))).toBe(
			'belum_mulai'
		);
	});

	it('hanya voucher aktif yang ditandai showOnHome; paling cepat berakhir dulu; maks. 3', () => {
		mkVoucher({ code: 'PRIVAT' }); // tidak ditandai
		mkVoucher({ code: 'MATI', showOnHome: true, isActive: false });
		mkVoucher({ code: 'LAMA', showOnHome: true, endsAt: '2026-11-01T00:00:00.000Z' });
		mkVoucher({ code: 'NANTI', showOnHome: true, startsAt: '2026-12-15T00:00:00.000Z' });
		mkVoucher({ code: 'HABIS', showOnHome: true, usageLimit: 1, usedCount: 1 });
		mkVoucher({ code: 'TANPAAKHIR', showOnHome: true });
		mkVoucher({ code: 'SEBENTAR', showOnHome: true, endsAt: '2026-11-30T16:59:59.999Z' });
		mkVoucher({ code: 'AKHIRBULAN', showOnHome: true, endsAt: '2026-12-31T16:59:59.999Z' });
		mkVoucher({ code: 'EKSTRA', showOnHome: true, endsAt: '2027-03-01T00:00:00.000Z' });

		const list = listHomeVouchers(db, null, at('2026-11-26'));
		expect(list.map((v) => v.code)).toEqual(['SEBENTAR', 'AKHIRBULAN', 'EKSTRA']);
		expect(listHomeVouchers(db, null, at('2026-11-26'), 10).map((v) => v.code)).toEqual([
			'SEBENTAR',
			'AKHIRBULAN',
			'EKSTRA',
			'TANPAAKHIR'
		]);
	});

	it('sisa kuota dihitung; voucher yang jatah pelanggan itu habis tidak ditampilkan padanya', async () => {
		const v = mkVoucher({ code: 'SATUKALI', showOnHome: true, usageLimit: 10, perUserLimit: 1 });
		expect(listHomeVouchers(db, null, new Date())[0]).toMatchObject({
			code: 'SATUKALI',
			remaining: 10
		});

		await buy(buyerId, 'SATUKALI');
		expect(listHomeVouchers(db, buyerId, new Date())).toHaveLength(0); // sudah dipakai buyerId
		expect(listHomeVouchers(db, buyer2Id, new Date())[0]).toMatchObject({ remaining: 9 }); // pelanggan lain tetap melihat
		expect(listHomeVouchers(db, null, new Date())).toHaveLength(1);

		// pesanan dibatalkan → jatah kembali → muncul lagi
		const o = db.select().from(orders).get()!;
		await cancelOrder(o.id, { id: buyerId, role: 'konsumen' }, 'Batal');
		expect(listHomeVouchers(db, buyerId, new Date())).toHaveLength(1);
		expect(v.id).toBeGreaterThan(0);
	});

	it('load beranda memuat promo untuk tamu & konsumen, dan memuat tanpa voucher bila tidak ada', async () => {
		const run = (user: unknown) =>
			(home.load as never as (e: unknown) => Promise<{ promos: { code: string }[] }>)({
				locals: { user }
			});
		expect((await run(null)).promos).toEqual([]);

		mkVoucher({ code: 'BERANDA', showOnHome: true });
		expect((await run(null)).promos.map((p) => p.code)).toEqual(['BERANDA']);

		await buy(buyerId, 'BERANDA');
		expect((await run(userOf(U(buyerId)))).promos).toEqual([]);
		expect((await run(userOf(U(buyer2Id)))).promos).toHaveLength(1);
		// staf tidak dihitung sebagai pelanggan (tidak ada jatah yang bisa habis)
		expect((await run(userOf(U(adminId, 'admin')))).promos).toHaveLength(1);
	});

	it('admin menyimpan & mengubah flag "tampilkan di beranda"', async () => {
		const form = (f: Record<string, string>) => {
			const fd = new FormData();
			for (const [k, v] of Object.entries(f)) fd.set(k, v);
			return {
				locals: U(adminId, 'admin'),
				request: new Request('http://x', { method: 'POST', body: fd })
			} as never;
		};
		const base = {
			code: 'BANNER1',
			type: 'percent',
			value: '10',
			minSubtotal: '0',
			perUserLimit: '1',
			isActive: 'on'
		};
		await adminVoucher.actions.simpan(form({ ...base, showOnHome: 'on' }));
		const row = db.select().from(vouchers).where(eq(vouchers.code, 'BANNER1')).get()!;
		expect(row.showOnHome).toBe(true);
		await adminVoucher.actions.simpan(form({ ...base, id: String(row.id) })); // checkbox tak dicentang
		expect(db.select().from(vouchers).get()!.showOnHome).toBe(false);
	});

	it('daftar admin: status tiap voucher, filter status & pencarian, total potongan tanpa pesanan batal', async () => {
		mkVoucher({ code: 'AKTIF1' });
		mkVoucher({ code: 'MATI1', isActive: false });
		mkVoucher({ code: 'LAMA1', endsAt: '2020-01-01T00:00:00.000Z' });
		const used = await buy(buyerId, 'AKTIF1');
		const load = (qs = '') =>
			(
				adminVoucher.load as never as (e: unknown) => Promise<{
					vouchers: { code: string; status: string; discountGiven: number }[];
					stats: {
						total: number;
						counts: Record<string, number>;
						discountGiven: number;
						redemptions: number;
					};
				}>
			)({
				locals: userOf(U(adminId, 'admin')) ? U(adminId, 'admin') : null,
				url: new URL(`http://x/admin/voucher${qs}`)
			});

		const all = await load();
		expect(all.stats.total).toBe(3);
		expect(all.stats.counts).toMatchObject({ aktif: 1, nonaktif: 1, kedaluwarsa: 1 });
		expect(all.stats.redemptions).toBe(1);
		expect(all.stats.discountGiven).toBe(10_000);
		expect(all.vouchers.find((v) => v.code === 'AKTIF1')).toMatchObject({
			status: 'aktif',
			discountGiven: 10_000
		});

		expect((await load('?status=kedaluwarsa')).vouchers.map((v) => v.code)).toEqual(['LAMA1']);
		expect((await load('?q=mati')).vouchers.map((v) => v.code)).toEqual(['MATI1']);
		expect((await load('?status=ngawur')).vouchers).toHaveLength(3); // nilai tak dikenal diabaikan

		await cancelOrder(used.orderId, { id: buyerId, role: 'konsumen' }, 'Batal');
		expect((await load()).stats.discountGiven).toBe(0);
	});
});
