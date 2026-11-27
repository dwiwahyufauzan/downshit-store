import { and, desc, eq, lt } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';
import { afterCommit, db, transact, type Tx } from './db';
import { NOW_ISO, orders, payments, shipments } from './db/schema';
import { canTransition, type Status } from './order-status';
import { OrderError, expireUnpaidOrders } from './orders';
import { cancelTransaction } from './midtrans';
import { enabledMethods, reconcileGatewayPayments } from './gateway-payments';
import { getSettings } from './settings';
import { logActivity } from './activity';
import { notifyOrder } from './notifications';
import { notifyRestocked } from './stock-alerts';
import { PAYMENT_NOTE_GATEWAY_REPLACED } from '#lib/constants';

const notFound = () => new OrderError('Pesanan tidak ditemukan', 'not_found');

// `transact` memakai BEGIN IMMEDIATE, jadi pembacaan di dalamnya sudah terkunci tulis
// (tidak ada proses lain yang bisa mengubah status di antara baca dan tulis).
const findByCode = (tx: Tx, code: string) =>
	tx.select().from(orders).where(eq(orders.code, code)).get();

const latestPayment = (tx: Tx, orderId: number) =>
	tx.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.id)).get();

export function orderFail(e: unknown) {
	if (e instanceof OrderError) {
		if (e.kind === 'not_found') throw error(404, e.message);
		return fail(400, { message: e.message });
	}
	throw e;
}

/* ---------- Konsumen: unggah bukti pembayaran ---------- */
export async function submitPaymentProof(code: string, userId: number, proofUrl: string) {
	if (!enabledMethods(await getSettings()).includes('transfer_bank')) {
		throw new OrderError(
			'Transfer bank manual sedang tidak tersedia. Pilih metode pembayaran lain.'
		);
	}
	// pembayaran online yang masih terbuka dibatalkan agar pelanggan tidak membayar dua kali
	const gatewayToCancel: string[] = [];
	await transact((tx) => {
		const o = findByCode(tx, code);
		if (!o || o.userId !== userId) throw notFound();
		if (o.status !== 'menunggu_pembayaran') {
			throw new OrderError('Pesanan tidak dalam status menunggu pembayaran');
		}
		if (o.expiresAt && new Date(o.expiresAt).getTime() < Date.now()) {
			throw new OrderError('Batas waktu pembayaran pesanan ini sudah lewat');
		}

		for (const p of tx.select().from(payments).where(eq(payments.orderId, o.id)).all()) {
			if (!p.gatewayOrderId || p.status !== 'menunggu') continue;
			tx.update(payments)
				.set({ status: 'ditolak', note: PAYMENT_NOTE_GATEWAY_REPLACED })
				.where(eq(payments.id, p.id))
				.run();
			gatewayToCancel.push(p.gatewayOrderId);
		}

		tx.insert(payments)
			.values({ orderId: o.id, amount: o.total, proofUrl, status: 'menunggu' })
			.run();
		tx.update(orders)
			.set({ status: 'menunggu_konfirmasi', updatedAt: NOW_ISO })
			.where(eq(orders.id, o.id))
			.run();

		logActivity(
			userId,
			'payment.proof',
			'order',
			o.id,
			`Bukti bayar pesanan ${o.code} diunggah oleh konsumen`,
			tx
		);
	});
	await Promise.all(gatewayToCancel.map(cancelTransaction));
}

/* ---------- Admin: konfirmasi pembayaran ---------- */
export async function confirmPayment(code: string, adminId: number) {
	return transact((tx) => {
		const o = findByCode(tx, code);
		if (!o) throw notFound();
		if (!canTransition(o.status as Status, 'diproses')) {
			throw new OrderError('Status pesanan tidak valid untuk dikonfirmasi');
		}

		const pay = latestPayment(tx, o.id);
		if (!pay || pay.status !== 'menunggu' || !pay.proofUrl || pay.gatewayOrderId) {
			throw new OrderError('Bukti transfer pembayaran belum diunggah atau tidak ditemukan');
		}

		const now = new Date().toISOString();
		tx.update(payments)
			.set({ status: 'dikonfirmasi', confirmedBy: adminId, confirmedAt: now })
			.where(eq(payments.id, pay.id))
			.run();
		tx.update(orders).set({ status: 'diproses', updatedAt: now }).where(eq(orders.id, o.id)).run();

		logActivity(
			adminId,
			'payment.confirm',
			'order',
			o.id,
			`Pembayaran pesanan ${o.code} dikonfirmasi oleh admin`,
			tx
		);
		afterCommit(tx, () => notifyOrder(o.id, 'dibayar'));
	});
}

/* ---------- Admin: tolak bukti pembayaran ---------- */
export async function rejectPayment(code: string, adminId: number, reason: string) {
	const why = reason.trim();
	if (why.length < 5) throw new OrderError('Alasan penolakan wajib diisi (min. 5 karakter)');
	const cfg = await getSettings();

	return transact((tx) => {
		const o = findByCode(tx, code);
		if (!o) throw notFound();
		if (
			o.status !== 'menunggu_konfirmasi' ||
			!canTransition('menunggu_konfirmasi', 'menunggu_pembayaran')
		) {
			throw new OrderError('Status pesanan tidak valid untuk ditolak');
		}

		const pay = latestPayment(tx, o.id);
		if (!pay || pay.status !== 'menunggu') {
			throw new OrderError('Tidak ada bukti pembayaran yang sedang menunggu verifikasi');
		}

		const now = new Date().toISOString();
		tx.update(payments)
			.set({ status: 'ditolak', note: why.slice(0, 255), confirmedBy: adminId, confirmedAt: now })
			.where(eq(payments.id, pay.id))
			.run();

		// Batas waktu bayar baru agar pesanan tidak langsung kedaluwarsa
		const newExpires = new Date(Date.now() + cfg.paymentDeadlineHours * 3_600_000).toISOString();
		tx.update(orders)
			.set({ status: 'menunggu_pembayaran', expiresAt: newExpires, updatedAt: now })
			.where(eq(orders.id, o.id))
			.run();

		logActivity(
			adminId,
			'payment.reject',
			'order',
			o.id,
			`Bukti transfer ${o.code} ditolak: ${why}`,
			tx
		);
		afterCommit(tx, () => notifyOrder(o.id, 'ditolak'));
	});
}

/* ---------- Admin: input pengiriman & nomor resi ---------- */
export type ShipmentInput = { courier: string; trackingNumber: string; note?: string };

export async function shipOrder(code: string, adminId: number, d: ShipmentInput) {
	return transact((tx) => {
		const o = findByCode(tx, code);
		if (!o) throw notFound();
		if (!canTransition(o.status as Status, 'dikirim')) {
			throw new OrderError('Pesanan belum dapat dikirim (status harus sudah berstatus diproses)');
		}

		const now = new Date().toISOString();
		const values = {
			courier: d.courier,
			trackingNumber: d.trackingNumber,
			note: d.note ?? null,
			status: 'dikirim' as const,
			shippedAt: now
		};
		const existing = tx.select().from(shipments).where(eq(shipments.orderId, o.id)).get();
		if (existing) {
			tx.update(shipments)
				.set({ ...values, updatedAt: now })
				.where(eq(shipments.orderId, o.id))
				.run();
		} else {
			tx.insert(shipments)
				.values({ orderId: o.id, ...values })
				.run();
		}

		tx.update(orders).set({ status: 'dikirim', updatedAt: now }).where(eq(orders.id, o.id)).run();

		logActivity(
			adminId,
			'shipment.send',
			'order',
			o.id,
			`Pesanan ${o.code} dikirim via ${d.courier} (Resi: ${d.trackingNumber})`,
			tx
		);
		afterCommit(tx, () => notifyOrder(o.id, 'dikirim'));
	});
}

/* ---------- Admin: koreksi nomor resi ---------- */
export async function updateShipment(code: string, adminId: number, d: ShipmentInput) {
	return transact((tx) => {
		const o = findByCode(tx, code);
		if (!o) throw notFound();
		if (o.status !== 'dikirim') {
			throw new OrderError('Resi hanya dapat dikoreksi saat pesanan berstatus dikirim');
		}

		tx.update(shipments)
			.set({
				courier: d.courier,
				trackingNumber: d.trackingNumber,
				note: d.note ?? null,
				updatedAt: NOW_ISO
			})
			.where(eq(shipments.orderId, o.id))
			.run();

		logActivity(
			adminId,
			'shipment.update',
			'order',
			o.id,
			`Nomor resi pesanan ${o.code} dikoreksi menjadi ${d.trackingNumber} (${d.courier})`,
			tx
		);
	});
}

/* ---------- Konsumen / Sistem: tandai selesai ---------- */
type Actor = { id: number | null; role: 'konsumen' | 'system' };

export async function completeOrder(code: string, actor: Actor) {
	return transact((tx) => {
		const o = findByCode(tx, code);
		if (!o) throw notFound();
		if (actor.role === 'konsumen' && o.userId !== actor.id) throw notFound();
		if (!canTransition(o.status as Status, 'selesai')) {
			throw new OrderError('Pesanan belum dalam status dikirim untuk diselesaikan');
		}

		const now = new Date().toISOString();
		tx.update(shipments)
			.set({ status: 'diterima', deliveredAt: now, updatedAt: now })
			.where(eq(shipments.orderId, o.id))
			.run();
		tx.update(orders).set({ status: 'selesai', updatedAt: now }).where(eq(orders.id, o.id)).run();

		logActivity(
			actor.id,
			'order.complete',
			'order',
			o.id,
			`Pesanan ${o.code} diselesaikan oleh ${actor.role}`,
			tx
		);
		// ajak pelanggan memberi ulasan, baik diselesaikan sendiri maupun otomatis oleh sistem
		afterCommit(tx, () => notifyOrder(o.id, 'selesai'));
	});
}

/* ---------- Auto-complete pesanan terkirim (BR-22) ---------- */
export async function autoCompleteShippedOrders(limit = 200): Promise<number> {
	const { autoCompleteDays } = await getSettings();
	const cutoff = new Date(Date.now() - autoCompleteDays * 86_400_000).toISOString();

	const due = await db
		.select({ code: orders.code })
		.from(orders)
		.innerJoin(shipments, eq(shipments.orderId, orders.id))
		.where(and(eq(orders.status, 'dikirim'), lt(shipments.shippedAt, cutoff)))
		.limit(limit);

	let done = 0;
	for (const { code } of due) {
		try {
			await completeOrder(code, { id: null, role: 'system' });
			done++;
		} catch (e) {
			if (e instanceof OrderError) continue;
			console.error('[auto-complete] gagal:', code, e);
		}
	}
	return done;
}

/* ---------- Pemeliharaan Otomatis Ringan (cadangan bila cron belum dipasang) ---------- */
let lastLightRun = 0;
export async function runLightMaintenance() {
	if (Date.now() - lastLightRun < 300_000) return; // maks 1x per 5 menit
	lastLightRun = Date.now();
	const jobs = [
		expireUnpaidOrders(),
		autoCompleteShippedOrders(),
		reconcileGatewayPayments(),
		notifyRestocked()
	];
	for (const r of await Promise.allSettled(jobs)) {
		if (r.status === 'rejected') console.error('[maintenance error]:', r.reason);
	}
}
