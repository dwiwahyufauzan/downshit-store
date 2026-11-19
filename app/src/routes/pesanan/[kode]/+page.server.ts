import { error, fail, redirect } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { MAX_UPLOAD_MB } from '$app/env/private';
import { requireRole } from '#lib/server/guards';
import { db } from '#lib/server/db';
import {
	orderItemComponents,
	orderItems,
	orders,
	payments,
	products,
	shipments
} from '#lib/server/db/schema';
import { getSettings } from '#lib/server/settings';
import { canCancel, type Status } from '#lib/server/order-status';
import { cancelOrder } from '#lib/server/orders';
import { completeOrder, orderFail, submitPaymentProof } from '#lib/server/order-flow';
import { rateLimit } from '#lib/server/rate-limit';
import { ReviewError, createReview, getOrderReviewables } from '#lib/server/reviews';
import { deleteImage, saveImage } from '#lib/server/upload';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	}

	const user = requireRole(locals, 'konsumen');

	// Kepemilikan: WHERE code = ? AND user_id = ? — pesanan orang lain = 404 (tidak bocorkan keberadaan)
	const [order] = await db
		.select()
		.from(orders)
		.where(and(eq(orders.code, params.kode), eq(orders.userId, user.id)))
		.limit(1);

	if (!order) {
		throw error(404, 'Pesanan tidak ditemukan');
	}

	const [items, paymentHistory, [shipment], settings] = await Promise.all([
		db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
		db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.id)),
		db.select().from(shipments).where(eq(shipments.orderId, order.id)).limit(1),
		getSettings()
	]);

	// Muat snapshot komponen bundling bila ada
	const bundleItemIds = items.filter((i) => i.itemType === 'bundle').map((i) => i.id);
	const components =
		bundleItemIds.length > 0
			? await db
					.select({
						id: orderItemComponents.id,
						orderItemId: orderItemComponents.orderItemId,
						productId: orderItemComponents.productId,
						quantity: orderItemComponents.quantity,
						size: orderItemComponents.size,
						productName: products.name,
						productPrice: products.price
					})
					.from(orderItemComponents)
					.innerJoin(products, eq(products.id, orderItemComponents.productId))
					.where(inArray(orderItemComponents.orderItemId, bundleItemIds))
			: [];

	const componentsByItemId = new Map<number, typeof components>();
	for (const comp of components) {
		const arr = componentsByItemId.get(comp.orderItemId) ?? [];
		arr.push(comp);
		componentsByItemId.set(comp.orderItemId, arr);
	}

	const enrichedItems = items.map((item) => ({
		...item,
		components: componentsByItemId.get(item.id) ?? []
	}));

	// Status pembayaran "efektif" = baris terbaru; belum ada upload → belum_bayar (BR-20)
	const payment = paymentHistory[0] ?? null;
	const waNumber = settings.whatsapp.replace(/\D/g, '');
	const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(`Halo, pesanan ${order.code}`)}`;

	return {
		order,
		// Produk pada pesanan selesai yang bisa diulas (beserta ulasan yang sudah ditulis)
		reviewables: order.status === 'selesai' ? getOrderReviewables(db, order.id) : [],
		items: enrichedItems,
		payment,
		paymentStatus: payment?.status ?? 'belum_bayar',
		paymentHistory,
		shipment: shipment ?? null,
		settings,
		waUrl,
		maxUploadMb: Number(MAX_UPLOAD_MB ?? 2),
		justCreated: url.searchParams.get('baru') === '1',
		// dihitung di server karena order-status.ts tidak boleh diimpor komponen
		canCancel: canCancel('konsumen', order.status as Status),
		canConfirmReceived: order.status === 'dikirim',
		canUploadPayment: order.status === 'menunggu_pembayaran'
	};
};

export const actions: Actions = {
	ulas: async ({ request, params, locals }) => {
		const user = requireRole(locals, 'konsumen');
		if (rateLimit(`review|${user.id}`, 20, 60_000)) {
			return fail(429, { message: 'Terlalu sering mengirim ulasan. Coba lagi sebentar.' });
		}

		const fd = await request.formData();
		try {
			const r = await createReview({
				userId: user.id,
				orderCode: params.kode,
				productId: Number(fd.get('productId')),
				rating: Number(fd.get('rating')),
				comment: String(fd.get('comment') ?? '')
			});
			return { success: true, message: `Terima kasih! Ulasan untuk "${r.productName}" tersimpan.` };
		} catch (e) {
			if (e instanceof ReviewError) return fail(400, { message: e.message });
			throw e;
		}
	},

	bayar: async ({ request, params, locals }) => {
		const user = requireRole(locals, 'konsumen');

		if (rateLimit(`upload|${user.id}`, 10, 60_000)) {
			return fail(429, { message: 'Terlalu sering mengunggah. Coba lagi sebentar.' });
		}

		const formData = await request.formData();
		const file = formData.get('proofImage');

		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Silakan pilih berkas foto / bukti transfer pembayaran' });
		}

		const res = await saveImage(file, 'proofs');
		if (!res.ok) {
			return fail(400, { message: res.message });
		}

		try {
			// kepemilikan, status & kedaluwarsa dicek di dalam transaksi
			await submitPaymentProof(params.kode, user.id, res.url);
		} catch (err) {
			await deleteImage(res.url); // jangan tinggalkan berkas yatim
			return orderFail(err);
		}

		return {
			success: true,
			message: 'Bukti transfer berhasil diunggah! Menunggu verifikasi admin toko.'
		};
	},

	batal: async ({ request, params, locals }) => {
		const user = requireRole(locals, 'konsumen');

		const [order] = await db
			.select({ id: orders.id })
			.from(orders)
			.where(and(eq(orders.code, params.kode), eq(orders.userId, user.id)))
			.limit(1);

		if (!order) throw error(404, 'Pesanan tidak ditemukan');

		const fd = await request.formData();
		const reason = String(fd.get('reason') ?? '').trim() || 'Dibatalkan oleh pembeli';

		try {
			await cancelOrder(order.id, { id: user.id, role: 'konsumen' }, reason);
		} catch (err) {
			return orderFail(err);
		}

		return {
			success: true,
			message: 'Pesanan Anda telah berhasil dibatalkan.'
		};
	},

	diterima: async ({ params, locals }) => {
		const user = requireRole(locals, 'konsumen');

		try {
			await completeOrder(params.kode, { id: user.id, role: 'konsumen' });
		} catch (err) {
			return orderFail(err);
		}

		return {
			success: true,
			message: 'Terima kasih telah berbelanja di Store Downshit! Pesanan telah selesai.'
		};
	}
};
