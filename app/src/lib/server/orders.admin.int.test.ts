/**
 * Admin kelola transaksi (SRS-F-008) dan cetak nota & label pengiriman.
 * Memakai DB SQLite terisolasi (salinan skema kosong dari tests/global-setup.ts) + fixture bersama orders.fixture.ts.
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
	CRON_SECRET: 'x'.repeat(32)
}));

import { eq } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import { db } from './db';
import { orders, shipments } from './db/schema';
import { cancelOrder, createOrderFromCart } from './orders';
import { confirmPayment, rejectPayment, shipOrder, submitPaymentProof } from './order-flow';
import * as adminList from '../../routes/admin/pesanan/+page.server';
import * as adminDetail from '../../routes/admin/pesanan/[kode]/+page.server';
import * as cetak from '../../routes/admin/pesanan/[kode]/cetak/+page.server';
import {
	GUEST,
	SHIP,
	U,
	adminId,
	bundleId,
	buyer2Id,
	buyerId,
	cartAdd,
	catchResult,
	hoodieId,
	kaosId,
	newOrder,
	orderOf,
	ownerId,
	paidOrder,
	topiId,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

/* ====================================================================== */
describe('admin kelola transaksi (SRS-F-008, TC-008-01/08)', () => {
	const listEv = (qs = '', uid = adminId, role: 'admin' | 'konsumen' = 'admin') =>
		({ url: new URL(`http://x/admin/pesanan${qs}`), locals: U(uid, role) }) as never;
	type Row = { code: string; status: string; paymentStatus: string };
	const rows = async (qs = '') =>
		((await adminList.load(listEv(qs))) as unknown as { orders: Row[] }).orders;

	it('status pembayaran belum_bayar bila belum ada unggahan; menunggu_konfirmasi paling atas', async () => {
		const a = await newOrder(buyerId, kaosId, 1);
		const b = await newOrder(buyerId, topiId, 1);
		await submitPaymentProof(b.code, buyerId, '/uploads/proofs/a.png');
		const c = await newOrder(buyerId, hoodieId, 1);
		const list = await rows();
		expect(list.map((r) => r.code)[0]).toBe(b.code);
		expect(list.find((r) => r.code === a.code)!.paymentStatus).toBe('belum_bayar');
		expect(list.find((r) => r.code === b.code)!.paymentStatus).toBe('menunggu');
		expect(list.find((r) => r.code === c.code)!.paymentStatus).toBe('belum_bayar');
	});

	it('filter status, cari kode/nama (karakter wildcard aman), rentang tanggal', async () => {
		const a = await newOrder();
		const b = await newOrder();
		await cancelOrder(b.orderId, { id: buyerId, role: 'konsumen' }, 'x');
		expect((await rows('?status=dibatalkan')).map((r) => r.code)).toEqual([b.code]);
		expect((await rows('?status=ngawur')).length).toBe(2); // status tak valid diabaikan
		expect((await rows(`?q=${a.code}`)).map((r) => r.code)).toEqual([a.code]);
		expect(await rows('?q=%25')).toHaveLength(0);
		expect(await rows('?q=Buyer')).toHaveLength(2);

		db.update(orders)
			.set({ createdAt: '2026-10-31T16:30:00.000Z' }) // 31 Okt 23:30 WIB
			.where(eq(orders.id, a.orderId))
			.run();
		expect((await rows('?dari=2026-10-31&sampai=2026-10-31')).map((r) => r.code)).toEqual([a.code]);
		expect((await rows('?dari=2026-11-01')).map((r) => r.code)).toEqual([b.code]);
		expect(await rows('?dari=salah&sampai=2026-13-45')).toHaveLength(2);
	});

	it('hanya admin; konsumen 403', async () => {
		const r = await catchResult(() => adminList.load(listEv('', buyerId, 'konsumen')));
		expect(!r.ok && r.error.status).toBe(403);
	});

	it('detail admin: riwayat pembayaran lengkap, log hanya milik pesanan, WA dengan encodeURIComponent', async () => {
		const a = await newOrder();
		const other = await newOrder(buyer2Id, topiId, 1);
		await submitPaymentProof(a.code, buyerId, '/uploads/proofs/a.png');
		await rejectPayment(a.code, adminId, 'Nominal tidak sesuai');
		await submitPaymentProof(a.code, buyerId, '/uploads/proofs/b.png');
		const d = (await adminDetail.load({
			params: { kode: a.code },
			locals: U(adminId, 'admin')
		} as never)) as {
			payments: { status: string; note: string | null }[];
			logs: { description: string }[];
			paymentStatus: string;
			waUrl: string;
			bisaBatal: boolean;
		};
		expect(d.payments.map((p) => p.status)).toEqual(['menunggu', 'ditolak']);
		expect(d.payments[1].note).toBe('Nominal tidak sesuai');
		expect(d.paymentStatus).toBe('menunggu');
		expect(d.logs.every((l) => !l.description.includes(other.code))).toBe(true);
		expect(d.logs.length).toBeGreaterThanOrEqual(4);
		expect(d.waUrl).toContain('https://wa.me/6281234567890?text=');
		expect(d.waUrl).not.toContain(' ');
		expect(d.bisaBatal).toBe(true);
	});

	it('aksi admin: kirim memvalidasi resi & kurir; batal wajib alasan; tolak wajib alasan', async () => {
		const { code, orderId } = await paidOrder();
		const act = (name: keyof typeof adminDetail.actions, fields: Record<string, string>) => {
			const fd = new FormData();
			for (const [k, v] of Object.entries(fields)) fd.set(k, v);
			return (adminDetail.actions[name] as (e: never) => Promise<unknown>)({
				params: { kode: code },
				locals: U(adminId, 'admin'),
				request: new Request('http://x', { method: 'POST', body: fd })
			} as never) as Promise<{ status?: number; success?: boolean; data?: { message?: string } }>;
		};
		expect((await act('kirim', { courier: 'JNE', trackingNumber: '' }))!.status).toBe(400); // TC-014-02
		expect(
			(await act('kirim', { courier: 'Kurir Ngawur', trackingNumber: 'ABC12345' }))!.status
		).toBe(400);
		expect(orderOf(orderId).status).toBe('diproses');
		const batal = await act('batal', { reason: 'ab' });
		expect(batal.status).toBe(400);
		expect(orderOf(orderId).status).toBe('diproses');
		expect((await act('kirim', { courier: 'JNE', trackingNumber: 'JNE12345' }))!.success).toBe(
			true
		);
		expect(orderOf(orderId).status).toBe('dikirim');
		const koreksi = await act('koreksiResi', { courier: 'SiCepat', trackingNumber: 'SC1234567' });
		expect(koreksi.success).toBe(true);
		expect(db.select().from(shipments).get()!.courier).toBe('SiCepat');
	});
});

/* ====================================================================== */
describe('cetak nota & label pengiriman (admin)', () => {
	type Cetak = {
		jenis: 'nota' | 'label';
		order: { code: string; total: number; recipientName: string };
		items: { itemName: string; components: { productName: string; quantity: number }[] }[];
		paymentStatus: string;
		shipment: { courier: string | null; trackingNumber: string | null } | null;
		store: { name: string };
	};
	const load = (
		code: string,
		qs = '',
		uid = adminId,
		role: 'admin' | 'konsumen' | 'owner' = 'admin'
	) =>
		cetak.load({
			params: { kode: code },
			locals: U(uid, role),
			url: new URL(`http://x/admin/pesanan/${code}/cetak${qs}`)
		} as never) as unknown as Promise<Cetak>;

	it('nota: memuat penerima, total, status bayar, dan ringkasan toko', async () => {
		const { code, orderId } = await paidOrder();
		const d = await load(code);
		expect(d.jenis).toBe('nota');
		expect(d.order).toMatchObject({ code, recipientName: SHIP.recipientName });
		expect(d.order.total).toBe(orderOf(orderId).total);
		expect(d.paymentStatus).toBe('dikonfirmasi');
		expect(d.items).toHaveLength(1);
		expect(d.shipment).toMatchObject({ courier: null, trackingNumber: null });
		expect(d.store.name).toBe('Downshit Store');
	});

	it('?jenis=label → label; nilai lain (termasuk aneh) kembali ke nota', async () => {
		const { code } = await newOrder();
		expect((await load(code, '?jenis=label')).jenis).toBe('label');
		expect((await load(code, '?jenis=nota')).jenis).toBe('nota');
		expect((await load(code, '?jenis=<script>')).jenis).toBe('nota');
		expect((await load(code)).jenis).toBe('nota');
	});

	it('paket bundling disertai isi paket; resi tampil setelah dikirim', async () => {
		await cartAdd(buyerId, 'bundle', bundleId, 1);
		const { code } = await createOrderFromCart(buyerId, SHIP);
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });

		const d = await load(code, '?jenis=label');
		expect(d.items[0].itemName).toBe('Paket Hemat');
		expect(d.items[0].components.map((c) => c.productName).sort()).toEqual([
			'Kaos Classic - L',
			'Topi'
		]);
		expect(d.shipment).toMatchObject({ courier: 'JNE', trackingNumber: 'JNE12345' });
	});

	it('hanya admin: konsumen & owner ditolak 403, tanpa login diarahkan ke login, kode tak ada 404', async () => {
		const { code } = await newOrder();
		await expect(load(code, '', buyerId, 'konsumen')).rejects.toMatchObject({ status: 403 });
		await expect(load(code, '', ownerId, 'owner')).rejects.toMatchObject({ status: 403 });
		await expect(
			cetak.load({
				params: { kode: code },
				locals: GUEST,
				url: new URL('http://x/')
			} as never)
		).rejects.toSatisfy((e) => isRedirect(e));
		await expect(load('DWN-TIDAKADA')).rejects.toMatchObject({ status: 404 });
	});
});
