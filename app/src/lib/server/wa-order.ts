import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { activityLogs } from './db/schema';
import type { StoreSettings } from './settings';
import { CANCEL_REASON_BY_CUSTOMER, CANCEL_REASON_EXPIRED, type OrderStatus } from '#lib/constants';
import { refundCase, type CancelledBy, type WaOrder, type WaStore } from '#lib/utils/wa-messages';

/**
 * Siapa yang membatalkan pesanan, dibaca dari log `order.cancel`: tanpa pengguna = job otomatis,
 * pemilik pesanan = pembeli. Data lama tanpa log ditebak dari alasan bakunya, jika tidak bisa → null.
 */
export async function getCancelledBy(
	orderId: number,
	orderOwnerId: number,
	cancelReason?: string | null
): Promise<CancelledBy | null> {
	const [log] = await db
		.select({ userId: activityLogs.userId })
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.entity, 'order'),
				eq(activityLogs.entityId, orderId),
				eq(activityLogs.action, 'order.cancel')
			)
		)
		.orderBy(desc(activityLogs.id))
		.limit(1);

	if (!log) {
		if (cancelReason === CANCEL_REASON_EXPIRED) return 'sistem';
		if (cancelReason === CANCEL_REASON_BY_CUSTOMER) return 'konsumen';
		return null;
	}
	if (log.userId === null) return 'sistem';
	return log.userId === orderOwnerId ? 'konsumen' : 'admin';
}

type OrderRow = {
	code: string;
	status: string;
	total: number;
	expiresAt: string | null;
	recipientName: string;
	shippingAddress: string;
	cancelReason: string | null;
};

/** Merakit data yang dibutuhkan templat pesan WhatsApp dari baris-baris database. */
export function toWaOrder(a: {
	order: OrderRow;
	items: {
		itemName: string;
		itemType: string;
		size: string;
		quantity: number;
		components?: { productName: string; size: string; quantity: number }[];
	}[];
	/** Riwayat pembayaran, terbaru lebih dulu */
	payments: { status: string; note: string | null }[];
	shipment: { courier: string | null; trackingNumber: string | null } | null;
	cancelledBy: CancelledBy | null;
}): WaOrder {
	const o = a.order;
	return {
		code: o.code,
		status: o.status as OrderStatus,
		total: o.total,
		expiresAt: o.expiresAt,
		recipientName: o.recipientName,
		shippingAddress: o.shippingAddress,
		cancelReason: o.cancelReason,
		cancelledBy: a.cancelledBy,
		items: a.items.map((i) => ({
			name: i.itemName,
			// ukuran paket bundling = kode pilihan internal ("36:L|54:34"); yang bermakna adalah isi paketnya
			size: i.itemType === 'bundle' ? '' : i.size,
			quantity: i.quantity,
			components: i.components?.map((c) => ({
				name: c.productName,
				size: c.size,
				quantity: c.quantity
			}))
		})),
		payment: a.payments[0] ? { status: a.payments[0].status, note: a.payments[0].note } : null,
		refund: refundCase(a.payments),
		shipment: a.shipment
			? { courier: a.shipment.courier, trackingNumber: a.shipment.trackingNumber }
			: null
	};
}

export const toWaStore = (s: StoreSettings, origin: string): WaStore => ({
	name: s.storeName,
	origin: origin.replace(/\/+$/, ''),
	bankName: s.bankName,
	bankNumber: s.bankNumber,
	bankHolder: s.bankHolder,
	autoCompleteDays: s.autoCompleteDays
});
