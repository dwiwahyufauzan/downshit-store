import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '#lib/server/db';
import { products } from '#lib/server/db/schema';
import { addToCart } from '#lib/server/cart';
import {
	findActiveProductBySlug,
	getProductGallery,
	getProductStockInfo,
	listBundlesContaining
} from '#lib/server/catalog';
import {
	getBestSellers,
	getProductStats,
	getSimilar,
	getTopRated
} from '#lib/server/recommendations';
import { getReviewSummary, listReviews } from '#lib/server/reviews';
import { isWishlisted, toggleWishlist } from '#lib/server/wishlist';
import { rateLimit } from '#lib/server/rate-limit';
import {
	pendingAlertSizes,
	subscribeStockAlert,
	unsubscribeStockAlert
} from '#lib/server/stock-alerts';
import { mailEnabled } from '#lib/server/mail';
import type { Actions, PageServerLoad } from './$types';

const addSchema = z.object({
	qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(99, 'Jumlah maksimal 99')
});

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const prod = await findActiveProductBySlug(params.slug);
	if (!prod) throw error(404, 'Produk tidak ditemukan');

	const [relatedBundles, gallery, stockInfo] = await Promise.all([
		listBundlesContaining(prod.id),
		getProductGallery(prod.id, prod.imageUrl),
		getProductStockInfo(prod.id)
	]);

	// Ulasan pembeli + rekomendasi (serupa, terlaris, rating tertinggi); rak tidak saling mengulang
	const showAllReviews = url.searchParams.get('ulasan') === 'semua';
	const stat = getProductStats([prod.id]).get(prod.id);
	const similar = getSimilar(prod.id, 4);
	const bestSellers = getBestSellers({
		limit: 4,
		excludeIds: [prod.id, ...similar.map((p) => p.id)]
	});
	const topRated = getTopRated({
		limit: 4,
		excludeIds: [prod.id, ...similar.map((p) => p.id), ...bestSellers.map((p) => p.id)]
	});
	const konsumenId = locals.user?.role === 'konsumen' ? locals.user.id : null;

	return {
		product: prod,
		gallery,
		sold: stat?.sold ?? 0,
		reviewSummary: getReviewSummary(db, prod.id),
		reviews: listReviews(db, prod.id, showAllReviews ? 50 : 6),
		showAllReviews,
		similar,
		bestSellers,
		topRated,
		// Pilihan ukuran + stok masing-masing (kosong = produk tanpa ukuran)
		sizes: stockInfo.sizes,
		lowStock: stockInfo.lowStock,
		relatedBundles,
		isKonsumen: konsumenId !== null,
		// "kabari saya saat tersedia" hanya ditawarkan bila email terkonfigurasi
		alertsEnabled: mailEnabled(),
		alertSizes: konsumenId ? pendingAlertSizes(konsumenId, prod.id) : [],
		isWishlisted: konsumenId ? isWishlisted(konsumenId, prod.id) : false,
		user: locals.user
	};
};

export const actions: Actions = {
	/** Simpan / hapus produk dari favorit (toggle). Produk diambil dari slug halaman, bukan dari field form. */
	favorit: async ({ locals, url, params }) => {
		if (!locals.user) {
			throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
		}
		if (locals.user.role !== 'konsumen') {
			return fail(403, { message: 'Hanya akun Konsumen yang dapat menyimpan favorit.' });
		}
		if (rateLimit(`wish|${locals.user.id}`, 30, 60_000)) {
			return fail(429, { message: 'Terlalu cepat. Coba lagi sebentar.' });
		}

		const [prod] = await db
			.select({ id: products.id })
			.from(products)
			.where(eq(products.slug, params.slug))
			.limit(1);
		if (!prod) throw error(404, 'Produk tidak ditemukan');

		const r = toggleWishlist(locals.user.id, prod.id);
		if (!r.ok) return fail(r.reason === 'not_found' ? 404 : 400, { message: r.message });

		return {
			success: true,
			message: r.saved ? 'Disimpan ke favorit.' : 'Dihapus dari favorit.',
			...(r.saved && { toastAction: { href: '/favorit', label: 'Lihat favorit' } })
		};
	},

	/** Minta dikabari saat varian yang habis tersedia lagi (atau batalkan permintaan itu). */
	kabari: async ({ request, locals, url, params }) => {
		if (!locals.user) {
			throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
		}
		if (locals.user.role !== 'konsumen') {
			return fail(403, { message: 'Hanya akun Konsumen yang dapat meminta pengingat stok.' });
		}
		if (rateLimit(`stockalert|${locals.user.id}`, 20, 60_000)) {
			return fail(429, { message: 'Terlalu cepat. Coba lagi sebentar.' });
		}

		const [prod] = await db
			.select({ id: products.id })
			.from(products)
			.where(eq(products.slug, params.slug))
			.limit(1);
		if (!prod) throw error(404, 'Produk tidak ditemukan');

		const fd = await request.formData();
		const size = String(fd.get('size') ?? '');
		if (fd.get('batal') === '1') {
			unsubscribeStockAlert(locals.user.id, prod.id, size);
			return { success: true, message: 'Pengingat stok dibatalkan.' };
		}
		const r = subscribeStockAlert(locals.user.id, prod.id, size);
		if (!r.ok) return fail(400, { message: r.message });
		return { success: true, message: 'Siap! Kami kabari lewat email saat stoknya tersedia lagi.' };
	},

	tambah: async ({ request, locals, url, params }) => {
		if (!locals.user) {
			throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
		}

		if (locals.user.role !== 'konsumen') {
			return fail(403, {
				message: 'Hanya akun Konsumen yang dapat berbelanja dan menambah barang ke keranjang.'
			});
		}

		const formData = await request.formData();
		const parse = addSchema.safeParse({
			qty: formData.get('qty')
		});

		if (!parse.success) {
			return fail(400, {
				message: parse.error.issues[0]?.message ?? 'Jumlah produk tidak valid.'
			});
		}

		// produk dari slug halaman (bukan dari field form), hanya yang aktif & tidak terhapus
		const [prod] = await db
			.select({ id: products.id })
			.from(products)
			.where(
				and(eq(products.slug, params.slug), eq(products.isActive, true), isNull(products.deletedAt))
			)
			.limit(1);
		if (!prod) throw error(404, 'Produk tidak ditemukan');
		const productId = prod.id;

		const size = String(formData.get('size') ?? '');
		const result = await addToCart(locals.user.id, 'product', productId, parse.data.qty, size);

		if (!result.ok) {
			return fail(400, { message: result.message });
		}

		return {
			success: true,
			message: 'Produk berhasil ditambahkan ke keranjang belanja!',
			toastAction: { href: '/keranjang', label: 'Lihat keranjang' }
		};
	}
};
