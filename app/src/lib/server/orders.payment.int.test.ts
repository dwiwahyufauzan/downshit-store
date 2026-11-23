/**
 * Pembayaran, pembatalan, kedaluwarsa & pengiriman (SRS-F-008/010/014; BR-10/11/17/20/22).
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

import { eq } from 'drizzle-orm';
import { db } from './db';
import { orders, products, shipments } from './db/schema';
import { cancelOrder, createOrderFromCart, expireUnpaidOrders, OrderError } from './orders';
import {
	autoCompleteShippedOrders,
	completeOrder,
	runLightMaintenance,
	confirmPayment,
	rejectPayment,
	shipOrder,
	submitPaymentProof,
	updateShipment
} from './order-flow';
import { allowedNext, canCancel } from './order-status';
import * as maintenance from '../../routes/internal/maintenance/+server';
import {
	SHIP,
	adminId,
	bundleId,
	bundleStock,
	buyer2Id,
	buyerId,
	cartAdd,
	catchResult,
	dayMs,
	expireNow,
	kaosId,
	logsOf,
	newOrder,
	orderOf,
	paidOrder,
	paysOf,
	stockOf,
	topiId,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

/* ====================================================================== */
describe('pembayaran: satu baris per unggahan (BR-20, TC-008-*, TC-010-08)', () => {
	it('unggah bukti membuat 1 baris menunggu; status pesanan menunggu_konfirmasi', async () => {
		const { orderId, code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		const pays = paysOf(orderId);
		expect(pays).toHaveLength(1);
		expect(pays[0]).toMatchObject({
			status: 'menunggu',
			proofUrl: '/uploads/proofs/a.png',
			amount: 115_000
		});
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
		expect(logsOf(orderId).map((l) => l.action)).toContain('payment.proof');
	});

	it('tolak → ditolak+alasan, pesanan kembali menunggu_pembayaran, batas bayar diperpanjang; unggah ulang = baris ke-2 (TC-008-05/10)', async () => {
		const { orderId, code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		const short = new Date(Date.now() + 60_000).toISOString();
		db.update(orders).set({ expiresAt: short }).where(eq(orders.id, orderId)).run();

		await rejectPayment(code, adminId, 'Nominal tidak sesuai');
		let o = orderOf(orderId);
		expect(o.status).toBe('menunggu_pembayaran');
		expect(Date.parse(o.expiresAt!)).toBeGreaterThan(Date.now() + 23 * 3_600_000);

		await submitPaymentProof(code, buyerId, '/uploads/proofs/b.png');
		o = orderOf(orderId);
		expect(o.status).toBe('menunggu_konfirmasi');
		const pays = paysOf(orderId);
		expect(pays.map((p) => p.status)).toEqual(['ditolak', 'menunggu']);
		expect(pays[0].note).toBe('Nominal tidak sesuai');
		expect(pays[0].proofUrl).toBe('/uploads/proofs/a.png');
		expect(pays[0].confirmedBy).toBe(adminId);
	});

	it('tolak tanpa alasan / alasan < 5 karakter ditolak (TC-008-04)', async () => {
		const { orderId, code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		for (const reason of ['', '   ', 'abc']) {
			await expect(rejectPayment(code, adminId, reason)).rejects.toThrow(/Alasan/);
		}
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
		expect(paysOf(orderId)[0].status).toBe('menunggu');
	});

	it('konfirmasi tanpa bukti ditolak (TC-008-06); konfirmasi mencatat admin & waktu (TC-008-03)', async () => {
		const { orderId, code } = await newOrder();
		await expect(confirmPayment(code, adminId)).rejects.toBeInstanceOf(OrderError);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
		expect(paysOf(orderId)).toHaveLength(0);

		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		const p = paysOf(orderId)[0];
		expect(p).toMatchObject({ status: 'dikonfirmasi', confirmedBy: adminId });
		expect(p.confirmedAt).toBeTruthy();
		expect(orderOf(orderId).status).toBe('diproses');
	});

	it('unggah oleh pemilik lain = tidak ditemukan; unggah ke pesanan non-menunggu_pembayaran ditolak', async () => {
		const { code, orderId } = await newOrder();
		await expect(submitPaymentProof(code, buyer2Id, '/uploads/proofs/a.png')).rejects.toMatchObject(
			{ kind: 'not_found' }
		);
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await expect(submitPaymentProof(code, buyerId, '/uploads/proofs/b.png')).rejects.toThrow(
			/menunggu pembayaran/
		);
		expect(paysOf(orderId)).toHaveLength(1);
	});

	it('unggah pada pesanan yang sudah lewat batas bayar ditolak (TC-010-13)', async () => {
		const { code, orderId } = await newOrder();
		expireNow(orderId);
		await expect(submitPaymentProof(code, buyerId, '/uploads/proofs/a.png')).rejects.toThrow(
			/Batas waktu/
		);
		expect(paysOf(orderId)).toHaveLength(0);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});
});

/* ====================================================================== */
describe('pembatalan (BR-10, BR-20, TC-010-04…07, TC-008-09)', () => {
	it('konsumen batal saat menunggu_pembayaran: stok produk, paket & komponen kembali (TC-010-04/07)', async () => {
		await cartAdd(buyerId, 'bundle', bundleId, 2);
		await cartAdd(buyerId, 'product', kaosId, 1);
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'Salah pilih');
		expect(stockOf(kaosId)).toBe(10);
		expect(stockOf(topiId)).toBe(5);
		expect(bundleStock()).toBe(3);
		const o = orderOf(orderId);
		expect(o).toMatchObject({ status: 'dibatalkan', cancelReason: 'Salah pilih' });
		expect(o.cancelledAt).toBeTruthy();
		expect(logsOf(orderId).map((l) => l.action)).toContain('order.cancel');
	});

	it('konsumen batal saat menunggu_konfirmasi: stok kembali, bukti menunggu → ditolak "Pesanan dibatalkan" (TC-010-05)', async () => {
		const { orderId, code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'Batal');
		expect(stockOf(kaosId)).toBe(10);
		const p = paysOf(orderId);
		expect(p).toHaveLength(1);
		expect(p[0]).toMatchObject({ status: 'ditolak', note: 'Pesanan dibatalkan' });
	});

	it('konsumen tidak bisa batal saat diproses (TC-010-06); admin bisa → payment dikembalikan (TC-008-09)', async () => {
		const { orderId } = await paidOrder();
		await expect(cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x')).rejects.toThrow(
			'Pesanan sudah diproses dan tidak dapat dibatalkan'
		);
		expect(stockOf(kaosId)).toBe(9);

		await cancelOrder(orderId, { id: adminId, role: 'admin' }, 'Barang cacat saat packing');
		expect(stockOf(kaosId)).toBe(10);
		expect(paysOf(orderId)[0].status).toBe('dikembalikan');
		expect(paysOf(orderId)[0].note).toMatch(/Pesanan dibatalkan/);
		expect(orderOf(orderId).status).toBe('dibatalkan');
	});

	it('admin wajib beri alasan ≥ 5 karakter; tanpa itu tidak ada perubahan', async () => {
		const { orderId } = await paidOrder();
		for (const reason of ['', '  ', 'abc']) {
			await expect(cancelOrder(orderId, { id: adminId, role: 'admin' }, reason)).rejects.toThrow(
				/Alasan pembatalan wajib/
			);
		}
		expect(orderOf(orderId).status).toBe('diproses');
		expect(stockOf(kaosId)).toBe(9);
		expect(paysOf(orderId)[0].status).toBe('dikonfirmasi');
	});

	it('tidak ada yang bisa membatalkan pesanan dikirim/selesai/dibatalkan', async () => {
		const { orderId, code } = await paidOrder();
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });
		for (const role of ['konsumen', 'admin'] as const) {
			await expect(
				cancelOrder(orderId, { id: role === 'admin' ? adminId : buyerId, role }, 'alasan jelas')
			).rejects.toBeInstanceOf(OrderError);
		}
		await completeOrder(code, { id: buyerId, role: 'konsumen' });
		await expect(
			cancelOrder(orderId, { id: adminId, role: 'admin' }, 'alasan jelas')
		).rejects.toBeInstanceOf(OrderError);
		expect(orderOf(orderId).status).toBe('selesai');
	});

	it('pembatalan ganda tidak menggandakan stok', async () => {
		const { orderId } = await newOrder(buyerId, kaosId, 3);
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x');
		await expect(
			cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x')
		).rejects.toBeInstanceOf(OrderError);
		await expect(
			cancelOrder(orderId, { id: adminId, role: 'admin' }, 'alasan jelas')
		).rejects.toBeInstanceOf(OrderError);
		expect(stockOf(kaosId)).toBe(10);
	});

	it('konsumen lain → not_found; aturan CANCELLABLE_BY terpusat', async () => {
		const { orderId } = await newOrder();
		await expect(
			cancelOrder(orderId, { id: buyer2Id, role: 'konsumen' }, 'x')
		).rejects.toMatchObject({ kind: 'not_found' });
		expect(canCancel('konsumen', 'diproses')).toBe(false);
		expect(canCancel('admin', 'diproses')).toBe(true);
		expect(canCancel('system', 'menunggu_konfirmasi')).toBe(false);
		expect(canCancel('system', 'menunggu_pembayaran')).toBe(true);
		expect(allowedNext('selesai')).toEqual([]);
	});

	it('balapan batal vs unggah bukti: selalu dibatalkan, stok kembali tepat sekali (TC-010-12)', async () => {
		for (let i = 0; i < 12; i++) {
			const { orderId, code } = await newOrder(buyerId, kaosId, 2);
			const stockWhileHeld = stockOf(kaosId);
			const jobs = [
				() => cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'Batal'),
				() => submitPaymentProof(code, buyerId, `/uploads/proofs/r${i}.png`)
			];
			if (i % 2) jobs.reverse();
			await Promise.allSettled(jobs.map((j) => j()));

			expect(orderOf(orderId).status).toBe('dibatalkan');
			expect(stockOf(kaosId)).toBe(stockWhileHeld + 2); // kembali sekali, bukan dua kali
			expect(paysOf(orderId).every((p) => p.status !== 'menunggu')).toBe(true);
			// reset stok untuk iterasi berikut
			db.update(products).set({ stock: 10 }).where(eq(products.id, kaosId)).run();
		}
	});
});

/* ====================================================================== */
describe('kedaluwarsa & auto-selesai (BR-17, BR-22, TC-010-13/14)', () => {
	it('expireUnpaidOrders: batal oleh sistem, stok kembali, log tanpa pelaku, alasan standar', async () => {
		const { orderId } = await newOrder(buyerId, kaosId, 4);
		expireNow(orderId);
		expect(await expireUnpaidOrders()).toBe(1);
		const o = orderOf(orderId);
		expect(o.status).toBe('dibatalkan');
		expect(o.cancelReason).toBe('Melewati batas waktu pembayaran');
		expect(stockOf(kaosId)).toBe(10);
		const log = logsOf(orderId).find((l) => l.action === 'order.cancel')!;
		expect(log.userId).toBeNull();
		expect(await expireUnpaidOrders()).toBe(0); // tidak diproses dua kali
		expect(stockOf(kaosId)).toBe(10);
	});

	it('belum lewat batas bayar tidak dibatalkan; menunggu_konfirmasi tidak disentuh', async () => {
		const a = await newOrder();
		const b = await newOrder();
		await submitPaymentProof(b.code, buyerId, '/uploads/proofs/a.png');
		expireNow(b.orderId); // sudah ada bukti → tidak boleh kedaluwarsa
		expect(await expireUnpaidOrders()).toBe(0);
		expect(orderOf(a.orderId).status).toBe('menunggu_pembayaran');
		expect(orderOf(b.orderId).status).toBe('menunggu_konfirmasi');
		// pengaman di cancelOrder: sistem menolak pesanan yang belum kedaluwarsa
		await expect(
			cancelOrder(a.orderId, { id: null, role: 'system' }, 'Melewati batas waktu pembayaran')
		).rejects.toThrow(/Belum melewati/);
	});

	it('kedaluwarsa bundling mengembalikan stok paket & komponen', async () => {
		await cartAdd(buyerId, 'bundle', bundleId, 3);
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		expect(bundleStock()).toBe(0);
		expireNow(orderId);
		await expireUnpaidOrders();
		expect(bundleStock()).toBe(3);
		expect(stockOf(kaosId)).toBe(10);
		expect(stockOf(topiId)).toBe(5);
	});

	it('auto-selesai: dikirim > 7 hari → selesai & diterima; < 7 hari tidak berubah', async () => {
		const old = await newOrder(buyerId, kaosId, 1);
		const fresh = await newOrder(buyerId, topiId, 1);
		for (const o of [old, fresh]) {
			await submitPaymentProof(o.code, buyerId, '/uploads/proofs/a.png');
			await confirmPayment(o.code, adminId);
			await shipOrder(o.code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });
		}
		db.update(shipments)
			.set({ shippedAt: new Date(Date.now() - 8 * dayMs).toISOString() })
			.where(eq(shipments.orderId, old.orderId))
			.run();
		db.update(shipments)
			.set({ shippedAt: new Date(Date.now() - 3 * dayMs).toISOString() })
			.where(eq(shipments.orderId, fresh.orderId))
			.run();

		expect(await autoCompleteShippedOrders()).toBe(1);
		expect(orderOf(old.orderId).status).toBe('selesai');
		expect(orderOf(fresh.orderId).status).toBe('dikirim');
		const sh = db.select().from(shipments).where(eq(shipments.orderId, old.orderId)).get()!;
		expect(sh.status).toBe('diterima');
		expect(sh.deliveredAt).toBeTruthy();
		const log = logsOf(old.orderId).find((l) => l.action === 'order.complete')!;
		expect(log.userId).toBeNull();
	});

	it('cadangan tanpa cron: runLightMaintenance (dashboard admin) membatalkan kedaluwarsa & menyelesaikan', async () => {
		const exp = await newOrder();
		expireNow(exp.orderId);
		const shipped = await paidOrder();
		await shipOrder(shipped.code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });
		db.update(shipments)
			.set({ shippedAt: new Date(Date.now() - 9 * dayMs).toISOString() })
			.where(eq(shipments.orderId, shipped.orderId))
			.run();
		await runLightMaintenance();
		expect(orderOf(exp.orderId).status).toBe('dibatalkan');
		expect(orderOf(shipped.orderId).status).toBe('selesai');
	});

	it('endpoint /internal/maintenance: tanpa rahasia 404; dengan rahasia menjalankan kedaluwarsa & auto-selesai', async () => {
		const { orderId } = await newOrder();
		expireNow(orderId);
		const mk = (token?: string) =>
			({
				request: new Request('http://x/internal/maintenance', {
					method: 'POST',
					headers: token ? { authorization: `Bearer ${token}` } : {}
				})
			}) as never;
		const bad = await catchResult(() => maintenance.POST(mk()));
		expect(bad.ok === false && bad.error.status).toBe(404);
		const bad2 = await catchResult(() => maintenance.POST(mk('salah'.repeat(10))));
		expect(bad2.ok === false && bad2.error.status).toBe(404);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');

		const res = await maintenance.POST(mk('x'.repeat(32)));
		const body = await res.json();
		expect(body.expiredOrders).toBe(1);
		expect(orderOf(orderId).status).toBe('dibatalkan');
	});
});

/* ====================================================================== */
describe('pengiriman & transisi status (SRS-F-014, BR-11, TC-008-07, TC-014-*)', () => {
	it('alur lengkap: kirim → koreksi resi (status tetap) → diterima (TC-014-01/06, TC-010-10)', async () => {
		const { orderId, code } = await paidOrder();
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345', note: 'Fragile' });
		let sh = db.select().from(shipments).where(eq(shipments.orderId, orderId)).get()!;
		expect(sh).toMatchObject({ courier: 'JNE', trackingNumber: 'JNE12345', status: 'dikirim' });
		expect(sh.shippedAt).toBeTruthy();
		expect(orderOf(orderId).status).toBe('dikirim');

		await updateShipment(code, adminId, { courier: 'J&T', trackingNumber: 'JT999999' });
		sh = db.select().from(shipments).where(eq(shipments.orderId, orderId)).get()!;
		expect(sh).toMatchObject({ courier: 'J&T', trackingNumber: 'JT999999', status: 'dikirim' });
		expect(orderOf(orderId).status).toBe('dikirim');

		await completeOrder(code, { id: buyerId, role: 'konsumen' });
		sh = db.select().from(shipments).where(eq(shipments.orderId, orderId)).get()!;
		expect(sh.status).toBe('diterima');
		expect(sh.deliveredAt).toBeTruthy();
		expect(orderOf(orderId).status).toBe('selesai');

		// TC-014-07: koreksi resi pada pesanan selesai ditolak
		await expect(
			updateShipment(code, adminId, { courier: 'JNE', trackingNumber: 'JNE00000' })
		).rejects.toThrow(/berstatus dikirim/);
		const actions = logsOf(orderId).map((l) => l.action);
		for (const a of [
			'order.create',
			'payment.proof',
			'payment.confirm',
			'shipment.send',
			'shipment.update',
			'order.complete'
		])
			expect(actions).toContain(a);
	});

	it('kirim sebelum diproses ditolak (TC-014-03); transisi ilegal ditolak (TC-008-07)', async () => {
		const { orderId, code } = await newOrder();
		await expect(
			shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' })
		).rejects.toBeInstanceOf(OrderError);
		await expect(completeOrder(code, { id: buyerId, role: 'konsumen' })).rejects.toBeInstanceOf(
			OrderError
		);
		await expect(confirmPayment(code, adminId)).rejects.toBeInstanceOf(OrderError);
		await expect(
			updateShipment(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' })
		).rejects.toBeInstanceOf(OrderError);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');

		// diproses → selesai langsung ditolak
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		await expect(completeOrder(code, { id: buyerId, role: 'konsumen' })).rejects.toBeInstanceOf(
			OrderError
		);
		await expect(completeOrder(code, { id: null, role: 'system' })).rejects.toBeInstanceOf(
			OrderError
		);
		expect(orderOf(orderId).status).toBe('diproses');
	});

	it('pesanan dibatalkan tidak bisa dikonfirmasi/dikirim/diunggah', async () => {
		const { orderId, code } = await newOrder();
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x');
		await expect(submitPaymentProof(code, buyerId, '/uploads/proofs/a.png')).rejects.toBeInstanceOf(
			OrderError
		);
		await expect(confirmPayment(code, adminId)).rejects.toBeInstanceOf(OrderError);
		await expect(rejectPayment(code, adminId, 'alasan jelas')).rejects.toBeInstanceOf(OrderError);
		await expect(
			shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' })
		).rejects.toBeInstanceOf(OrderError);
		expect(orderOf(orderId).status).toBe('dibatalkan');
		expect(paysOf(orderId)).toHaveLength(0);
	});

	it('hanya pemilik yang menandai diterima (milik orang lain = not_found)', async () => {
		const { code } = await paidOrder();
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });
		await expect(completeOrder(code, { id: buyer2Id, role: 'konsumen' })).rejects.toMatchObject({
			kind: 'not_found'
		});
	});
});
