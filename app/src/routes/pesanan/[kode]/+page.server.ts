import { error, fail, redirect } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { MAX_UPLOAD_MB, ORIGIN } from '$app/env/private';
import { CANCEL_REASON_BY_CUSTOMER } from '#lib/constants';
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
import { getCancelledBy, toWaOrder, toWaStore } from '#lib/server/wa-order';
import { waLink } from '#lib/utils/whatsapp';
import { messageToStore } from '#lib/utils/wa-messages';
import { canCancel, type Status } from '#lib/server/order-status';
import { cancelOrder } from '#lib/server/orders';
import { completeOrder, orderFail, submitPaymentProof } from '#lib/server/order-flow';
import {
	getPaymentOptions,
	startOnlinePayment,
	syncPendingForOrder
} from '#lib/server/gateway-payments';
import { gatewayMode } from '#lib/server/midtrans';
import { isGatewayMethod } from '#lib/constants';
import { rateLimit } from '#lib/server/rate-limit';
import {
	REVIEW_MAX_PHOTOS,
	ReviewError,
	createReview,
	getOrderReviewables
} from '#lib/server/reviews';
import { deleteImage, saveImage } from '#lib/server/upload';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	}

	const user = requireRole(locals, 'konsumen');

	// Kepemilikan: WHERE code = ? AND user_id = ? — pesanan orang lain = 404 (tidak bocorkan keberadaan)
	const findOrder = () =>
		db
			.select()
			.from(orders)
			.where(and(eq(orders.code, params.kode), eq(orders.userId, user.id)))
			.limit(1);

	let [order] = await findOrder();

	if (!order) {
		throw error(404, 'Pesanan tidak ditemukan');
	}

	// Pembayaran online yang masih menunggu dicek langsung ke Midtrans: status langsung benar saat
	// pelanggan kembali dari halaman bayar, walau notifikasi belum/tidak sampai (mis. server lokal).
	if (order.status === 'menunggu_pembayaran') {
		// baru kembali dari halaman bayar → selalu cek; refresh biasa dibatasi 1x/15 dtk agar tak menahan worker
		await syncPendingForOrder(order.id, 4_000, url.searchParams.has('bayar') ? 0 : 15_000);
		[order] = await findOrder();
	}

	const [items, paymentHistory, [shipmentRow], settings] = await Promise.all([
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

	const shipment = shipmentRow ?? null;

	// Percobaan bayar online yang masih terbuka (halaman bayar / nomor VA / kode bayar)
	const gatewayPayment =
		order.status === 'menunggu_pembayaran'
			? (paymentHistory.find((p) => p.gatewayOrderId && p.status === 'menunggu') ?? null)
			: null;
	const paymentOptions = await getPaymentOptions(settings);

	// Status pembayaran "efektif" = baris terbaru; belum ada upload → belum_bayar (BR-20)
	const payment = paymentHistory[0] ?? null;
	const cancelledBy =
		order.status === 'dibatalkan'
			? await getCancelledBy(order.id, order.userId, order.cancelReason)
			: null;
	const waOrder = toWaOrder({
		order,
		items: enrichedItems,
		payments: paymentHistory,
		shipment,
		cancelledBy
	});
	// pesan awal ke toko memuat kode, status, barang, total, dan keperluan sesuai status pesanan
	const waUrl = waLink(
		settings.whatsapp,
		messageToStore(waOrder, toWaStore(settings, ORIGIN ?? url.origin), user.name)
	);

	return {
		order,
		// Produk pada pesanan selesai yang bisa diulas (beserta ulasan yang sudah ditulis)
		reviewables: order.status === 'selesai' ? getOrderReviewables(db, order.id) : [],
		items: enrichedItems,
		payment,
		gatewayPayment,
		paymentOptions,
		simulator: gatewayMode() === 'simulator',
		paymentStatus: payment?.status ?? 'belum_bayar',
		paymentHistory,
		shipment,
		settings,
		waUrl,
		cancelledBy,
		refund: waOrder.refund,
		maxUploadMb: Number(MAX_UPLOAD_MB ?? 2),
		justCreated: url.searchParams.get('baru') === '1',
		// ?bayar=kembali (selesai di halaman Midtrans) | ?bayar=gagal (gagal membuka halaman bayar saat checkout)
		payReturn: url.searchParams.get('bayar'),
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
		// Foto opsional: file kosong (input tak diisi) diabaikan; tiap foto di-encode ulang oleh saveImage
		const files = fd.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length > REVIEW_MAX_PHOTOS) {
			return fail(400, { message: `Maksimal ${REVIEW_MAX_PHOTOS} foto per ulasan.` });
		}
		const saved: string[] = [];
		for (const f of files) {
			const up = await saveImage(f, 'reviews');
			if (!up.ok) {
				await Promise.all(saved.map(deleteImage));
				return fail(400, { message: up.message });
			}
			saved.push(up.url);
		}

		try {
			const r = await createReview({
				userId: user.id,
				orderCode: params.kode,
				productId: Number(fd.get('productId')),
				rating: Number(fd.get('rating')),
				comment: String(fd.get('comment') ?? ''),
				images: saved
			});
			return { success: true, message: `Terima kasih! Ulasan untuk "${r.productName}" tersimpan.` };
		} catch (e) {
			await Promise.all(saved.map(deleteImage)); // ulasan ditolak: jangan tinggalkan foto yatim
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

		// Cek kepemilikan & status SEBELUM dekode gambar (mahal): akun lain tak bisa memicu dekode untuk pesanan orang
		const [own] = await db
			.select({ status: orders.status })
			.from(orders)
			.where(and(eq(orders.code, params.kode), eq(orders.userId, user.id)))
			.limit(1);
		if (!own) throw error(404, 'Pesanan tidak ditemukan');
		if (own.status !== 'menunggu_pembayaran') {
			return fail(400, { message: 'Pesanan tidak dalam status menunggu pembayaran' });
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

	bayarOnline: async ({ request, params, locals }) => {
		const user = requireRole(locals, 'konsumen');
		if (rateLimit(`payonline|${user.id}`, 10, 60_000)) {
			return fail(429, { message: 'Terlalu sering. Coba lagi sebentar.' });
		}

		const method = String((await request.formData()).get('paymentMethod') ?? '');
		if (!isGatewayMethod(method)) return fail(400, { message: 'Pilih metode pembayaran online' });

		let redirectUrl: string;
		try {
			({ redirectUrl } = await startOnlinePayment(params.kode, user.id, method));
		} catch (err) {
			return orderFail(err);
		}
		throw redirect(303, redirectUrl);
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
		const reason = String(fd.get('reason') ?? '').trim() || CANCEL_REASON_BY_CUSTOMER;

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
