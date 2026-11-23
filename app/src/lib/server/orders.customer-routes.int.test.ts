/**
 * Halaman konsumen (route): kepemilikan, unggah bukti, pembatalan, akses bukti bayar.
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
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isRedirect } from '@sveltejs/kit';
import { db } from './db';
import { payments } from './db/schema';
import { cancelOrder } from './orders';
import * as detail from '../../routes/pesanan/[kode]/+page.server';
import * as riwayat from '../../routes/pesanan/+page.server';
import * as uploads from '../../routes/uploads/[...path]/+server';
import {
	GUEST,
	PNG,
	U,
	adminId,
	buyer2Id,
	buyerId,
	catchResult,
	kaosId,
	newOrder,
	orderOf,
	ownerId,
	paidOrder,
	paysOf,
	topiId,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

/* ====================================================================== */
describe('halaman konsumen: kepemilikan, upload bukti, pembatalan (route)', () => {
	const detailEvent = (code: string, uid: number | null) =>
		({
			params: { kode: code },
			locals: uid ? U(uid) : GUEST,
			url: new URL(`http://x/pesanan/${code}`)
		}) as never;

	const bayarEvent = (code: string, uid: number, file?: File | string) => {
		const fd = new FormData();
		if (file !== undefined) fd.set('proofImage', file);
		return {
			params: { kode: code },
			locals: U(uid),
			request: new Request('http://x', { method: 'POST', body: fd })
		} as never;
	};
	const proofFiles = () =>
		existsSync(path.join(env.uploads, 'proofs'))
			? readdirSync(path.join(env.uploads, 'proofs'))
			: [];

	it('pesanan orang lain → 404; tanpa login → redirect; admin → 403 (TC-010-03)', async () => {
		const { code } = await newOrder();
		const other = await catchResult(() => detail.load(detailEvent(code, buyer2Id)));
		expect(!other.ok && other.error.status).toBe(404);
		const guest = await catchResult(() => detail.load(detailEvent(code, null)));
		expect(!guest.ok && isRedirect(guest.error)).toBe(true);
		const adm = await catchResult(() =>
			detail.load({
				params: { kode: code },
				locals: U(adminId, 'admin'),
				url: new URL('http://x/pesanan/x')
			} as never)
		);
		expect(!adm.ok && adm.error.status).toBe(403);
		const mine = (await detail.load(detailEvent(code, buyerId))) as Record<string, unknown>;
		expect(mine.paymentStatus).toBe('belum_bayar');
		expect(mine.canUploadPayment).toBe(true);
		expect(mine.canCancel).toBe(true);
		expect(mine.shipment).toMatchObject({ status: 'belum_dikirim', trackingNumber: null });
	});

	it('aksi bayar/batal/diterima milik orang lain → 404', async () => {
		const { code } = await newOrder();
		const bad = await catchResult(() =>
			detail.actions.bayar(
				bayarEvent(code, buyer2Id, new File([PNG], 'a.png', { type: 'image/png' }))
			)
		);
		expect(!bad.ok && bad.error.status).toBe(404);
		const cancel = await catchResult(() =>
			detail.actions.batal({
				params: { kode: code },
				locals: U(buyer2Id),
				request: new Request('http://x', { method: 'POST', body: new FormData() })
			} as never)
		);
		expect(!cancel.ok && cancel.error.status).toBe(404);
		const recv = await catchResult(() =>
			detail.actions.diterima({ params: { kode: code }, locals: U(buyer2Id) } as never)
		);
		expect(!recv.ok && recv.error.status).toBe(404);
	});

	it('upload bukti: bukan gambar ditolak (TC-010-09); gambar valid → menunggu_konfirmasi', async () => {
		const { code, orderId } = await newOrder();
		const before = proofFiles().length;

		const none = (await detail.actions.bayar(bayarEvent(code, buyerId))) as { status: number };
		expect(none.status).toBe(400);
		const txt = (await detail.actions.bayar(
			bayarEvent(
				code,
				buyerId,
				new File(['bukan gambar apa pun, hanya teks biasa'], 'a.png', { type: 'image/png' })
			)
		)) as { status: number; data: { message: string } };
		expect(txt.status).toBe(400);
		expect(txt.data.message).toMatch(/Format file/);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
		expect(proofFiles().length).toBe(before);

		const ok = (await detail.actions.bayar(
			bayarEvent(code, buyerId, new File([PNG], 'a.png', { type: 'image/png' }))
		)) as { success: boolean };
		expect(ok.success).toBe(true);
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
		expect(paysOf(orderId)).toHaveLength(1);
		expect(proofFiles().length).toBe(before + 1);
	});

	it('upload gagal (pesanan sudah dibatalkan) menghapus berkas yang sudah tersimpan', async () => {
		const { code, orderId } = await newOrder();
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x');
		const before = proofFiles().length;
		const r = (await detail.actions.bayar(
			bayarEvent(code, buyerId, new File([PNG], 'a.png', { type: 'image/png' }))
		)) as { status: number; data: { message: string } };
		expect(r.status).toBe(400);
		expect(r.data.message).toMatch(/menunggu pembayaran/);
		expect(proofFiles().length).toBe(before);
		expect(paysOf(orderId)).toHaveLength(0);
	});

	it('batal oleh konsumen via route: alasan default; saat diproses ditolak dengan pesan yang benar', async () => {
		const a = await newOrder();
		const res = (await detail.actions.batal({
			params: { kode: a.code },
			locals: U(buyerId),
			request: new Request('http://x', { method: 'POST', body: new FormData() })
		} as never)) as { success: boolean };
		expect(res.success).toBe(true);
		expect(orderOf(a.orderId).cancelReason).toBe('Dibatalkan oleh pembeli');

		const p = await paidOrder();
		const refused = (await detail.actions.batal({
			params: { kode: p.code },
			locals: U(buyerId),
			request: new Request('http://x', { method: 'POST', body: new FormData() })
		} as never)) as { status: number; data: { message: string } };
		expect(refused.status).toBe(400);
		expect(refused.data.message).toBe('Pesanan sudah diproses dan tidak dapat dibatalkan');
	});

	it('riwayat hanya milik sendiri, filter status, paginasi, "Belum ada pesanan" (TC-010-01/11)', async () => {
		const empty = (await riwayat.load({
			locals: U(buyerId),
			url: new URL('http://x/pesanan')
		} as never)) as { orders: unknown[] };
		expect(empty.orders).toHaveLength(0);

		await newOrder(buyerId, kaosId, 2);
		const b = await newOrder(buyerId, topiId, 1);
		await newOrder(buyer2Id, kaosId, 1);
		await cancelOrder(b.orderId, { id: buyerId, role: 'konsumen' }, 'x');

		const all = (await riwayat.load({
			locals: U(buyerId),
			url: new URL('http://x/pesanan')
		} as never)) as { orders: { code: string; itemCount: number; status: string }[] };
		expect(all.orders).toHaveLength(2);
		expect(all.orders.find((o) => o.status === 'menunggu_pembayaran')!.itemCount).toBe(2);

		const cancelled = (await riwayat.load({
			locals: U(buyerId),
			url: new URL('http://x/pesanan?status=dibatalkan')
		} as never)) as { orders: { status: string }[] };
		expect(cancelled.orders.map((o) => o.status)).toEqual(['dibatalkan']);
	});
});

/* ====================================================================== */
describe('bukti pembayaran: akses (TC-010-03, TC-017-01)', () => {
	it('hanya pemilik, admin, owner; tanpa login 401; konsumen lain 404', async () => {
		const { code } = await newOrder();
		const fd = new FormData();
		fd.set('proofImage', new File([PNG], 'a.png', { type: 'image/png' }));
		await detail.actions.bayar({
			params: { kode: code },
			locals: U(buyerId),
			request: new Request('http://x', { method: 'POST', body: fd })
		} as never);
		const url = db.select().from(payments).get()!.proofUrl!;
		const rel = url.replace('/uploads/', '');
		const get = (locals: unknown) =>
			catchResult(() => uploads.GET({ params: { path: rel }, locals } as never));

		const guest = await get(GUEST);
		expect(!guest.ok && guest.error.status).toBe(401);
		const other = await get(U(buyer2Id));
		expect(!other.ok && other.error.status).toBe(404);
		for (const loc of [U(buyerId), U(adminId, 'admin'), U(ownerId, 'owner')]) {
			const r = await get(loc);
			expect(r.ok && (r.value as Response).status).toBe(200);
		}
	});
});
