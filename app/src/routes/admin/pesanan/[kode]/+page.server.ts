import { error, fail } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { activityLogs, orders, payments, shipments, users } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { getOrderItemsWithComponents } from '#lib/server/order-items';
import {
	confirmPayment,
	orderFail,
	rejectPayment,
	shipOrder,
	updateShipment
} from '#lib/server/order-flow';
import { cancelOrder } from '#lib/server/orders';
import { syncPendingForOrder } from '#lib/server/gateway-payments';
import { isGatewayConfigured } from '#lib/server/midtrans';
import { allowedNext, canCancel, type Status } from '#lib/server/order-status';
import { shipmentSchema } from '#lib/schemas/shipment';
import { getSettings } from '#lib/server/settings';
import { getCancelledBy, toWaOrder, toWaStore } from '#lib/server/wa-order';
import { waLink } from '#lib/utils/whatsapp';
import { messageToCustomer } from '#lib/utils/wa-messages';

export const load = async ({ params, locals, url }) => {
	requireRole(locals, 'admin');

	const [o] = await db.select().from(orders).where(eq(orders.code, params.kode)).limit(1);

	if (!o) throw error(404, 'Pesanan tidak ditemukan');

	const [customer] = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			phone: users.phone
		})
		.from(users)
		.where(eq(users.id, o.userId))
		.limit(1);

	const itemsWithComps = getOrderItemsWithComponents(o.id);

	const paymentRows = await db
		.select()
		.from(payments)
		.where(eq(payments.orderId, o.id))
		.orderBy(desc(payments.id));

	const [shipment] = await db.select().from(shipments).where(eq(shipments.orderId, o.id)).limit(1);

	const logs = await db
		.select({
			id: activityLogs.id,
			action: activityLogs.action,
			description: activityLogs.description,
			createdAt: activityLogs.createdAt,
			userName: users.name
		})
		.from(activityLogs)
		.leftJoin(users, eq(users.id, activityLogs.userId))
		.where(and(eq(activityLogs.entity, 'order'), eq(activityLogs.entityId, o.id)))
		.orderBy(desc(activityLogs.id));

	const settings = await getSettings();

	// WhatsApp ke penerima: nomor & nama dari pesanan ini (nomor akun pelanggan sebagai cadangan);
	// isi pesan menyesuaikan status pesanan (lihat utils/wa-messages)
	const waMessage = messageToCustomer(
		toWaOrder({
			order: o,
			items: itemsWithComps,
			payments: paymentRows,
			shipment: shipment ?? null,
			cancelledBy:
				o.status === 'dibatalkan' ? await getCancelledBy(o.id, o.userId, o.cancelReason) : null
		}),
		toWaStore(settings, ORIGIN ?? url.origin)
	);
	const waUrl = waLink(o.recipientPhone, waMessage.text) ?? waLink(customer?.phone, waMessage.text);

	return {
		order: o,
		customer,
		items: itemsWithComps,
		payments: paymentRows,
		latestPayment: paymentRows[0] ?? null,
		paymentStatus: paymentRows[0]?.status ?? 'belum_bayar',
		waUrl,
		waTopic: waMessage.topic,
		shipment,
		logs,
		settings,
		nextAllowed: allowedNext(o.status as Status),
		bisaBatal: canCancel('admin', o.status as Status)
	};
};

export const actions = {
	konfirmasi: async ({ locals, params }) => {
		const admin = requireRole(locals, 'admin');
		try {
			await confirmPayment(params.kode, admin.id);
		} catch (e) {
			return orderFail(e);
		}
		return { success: true, message: 'Pembayaran dikonfirmasi. Pesanan masuk ke status diproses.' };
	},

	sinkron: async ({ locals, params }) => {
		requireRole(locals, 'admin');
		if (!isGatewayConfigured()) return fail(400, { message: 'Midtrans belum dikonfigurasi' });
		const [o] = await db
			.select({ id: orders.id })
			.from(orders)
			.where(eq(orders.code, params.kode))
			.limit(1);
		if (!o) throw error(404, 'Pesanan tidak ditemukan');
		await syncPendingForOrder(o.id, 10_000);
		return { success: true, message: 'Status pembayaran diperiksa ke Midtrans.' };
	},

	tolak: async ({ request, locals, params }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const reason = String(fd.get('reason') ?? '');
		try {
			await rejectPayment(params.kode, admin.id, reason);
		} catch (e) {
			return orderFail(e);
		}
		return {
			success: true,
			message: 'Bukti pembayaran ditolak. Pelanggan diminta mengunggah bukti yang baru.'
		};
	},

	kirim: async ({ request, locals, params }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const parsed = shipmentSchema.safeParse({
			courier: fd.get('courier'),
			trackingNumber: fd.get('trackingNumber'),
			note: fd.get('note') || undefined
		});

		if (!parsed.success) {
			const errors = parsed.error.flatten().fieldErrors;
			return fail(400, {
				errors,
				message: parsed.error.issues[0]?.message ?? 'Data pengiriman tidak valid'
			});
		}

		try {
			await shipOrder(params.kode, admin.id, parsed.data);
		} catch (e) {
			return orderFail(e);
		}
		return { success: true, message: 'Pesanan ditandai dikirim dan nomor resi tersimpan.' };
	},

	koreksiResi: async ({ request, locals, params }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const parsed = shipmentSchema.safeParse({
			courier: fd.get('courier'),
			trackingNumber: fd.get('trackingNumber'),
			note: fd.get('note') || undefined
		});

		if (!parsed.success) {
			const errors = parsed.error.flatten().fieldErrors;
			return fail(400, {
				errors,
				message: parsed.error.issues[0]?.message ?? 'Data pengiriman tidak valid'
			});
		}

		try {
			await updateShipment(params.kode, admin.id, parsed.data);
		} catch (e) {
			return orderFail(e);
		}
		return { success: true, message: 'Nomor resi berhasil dikoreksi.' };
	},

	batal: async ({ request, locals, params }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const reason = String(fd.get('reason') ?? '').trim();
		if (reason.length < 5) {
			return fail(400, { message: 'Alasan pembatalan wajib diisi (min. 5 karakter)' });
		}

		const [o] = await db
			.select({ id: orders.id })
			.from(orders)
			.where(eq(orders.code, params.kode))
			.limit(1);

		if (!o) throw error(404, 'Pesanan tidak ditemukan');

		try {
			await cancelOrder(o.id, { id: admin.id, role: 'admin' }, reason);
		} catch (e) {
			return orderFail(e);
		}
		return { success: true, message: 'Pesanan dibatalkan dan stok dikembalikan.' };
	}
};
