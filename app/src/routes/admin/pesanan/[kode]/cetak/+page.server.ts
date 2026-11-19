import { error } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { orders, payments, shipments } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { getOrderItemsWithComponents } from '#lib/server/order-items';
import { getSettings } from '#lib/server/settings';
import type { PageServerLoad } from './$types';

/** Nota & label pengiriman untuk dicetak admin. `?jenis=label` = label pengiriman, selain itu nota. */
export const load: PageServerLoad = async ({ params, locals, url }) => {
	requireRole(locals, 'admin');

	const [order] = await db.select().from(orders).where(eq(orders.code, params.kode)).limit(1);
	if (!order) throw error(404, 'Pesanan tidak ditemukan');

	const [latestPayment] = await db
		.select({ status: payments.status })
		.from(payments)
		.where(eq(payments.orderId, order.id))
		.orderBy(desc(payments.id))
		.limit(1);
	const [shipment] = await db
		.select({ courier: shipments.courier, trackingNumber: shipments.trackingNumber })
		.from(shipments)
		.where(eq(shipments.orderId, order.id))
		.limit(1);
	const settings = await getSettings();

	return {
		jenis: url.searchParams.get('jenis') === 'label' ? ('label' as const) : ('nota' as const),
		order: {
			code: order.code,
			status: order.status,
			createdAt: order.createdAt,
			recipientName: order.recipientName,
			recipientPhone: order.recipientPhone,
			shippingAddress: order.shippingAddress,
			notes: order.notes,
			subtotal: order.subtotal,
			shippingCost: order.shippingCost,
			total: order.total
		},
		items: getOrderItemsWithComponents(order.id),
		paymentStatus: latestPayment?.status ?? 'belum_bayar',
		shipment: shipment ?? null,
		store: { name: settings.storeName, whatsapp: settings.whatsapp }
	};
};
