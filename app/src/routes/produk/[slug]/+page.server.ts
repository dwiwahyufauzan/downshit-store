import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { bundleItems, bundles, categories, productImages, products } from '$lib/server/db/schema';
import { addToCart } from '$lib/server/cart';
import { getSettings } from '$lib/server/settings';
import { getSizes } from '$lib/server/sizes';
import {
	getBestSellers,
	getProductStats,
	getSimilar,
	getTopRated
} from '$lib/server/recommendations';
import { getReviewSummary, listReviews } from '$lib/server/reviews';
import type { Actions, PageServerLoad } from './$types';

const addSchema = z.object({
	qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(99, 'Jumlah maksimal 99')
});

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const slug = params.slug;

	const [prod] = await db
		.select({
			id: products.id,
			name: products.name,
			slug: products.slug,
			price: products.price,
			stock: products.stock,
			description: products.description,
			imageUrl: products.imageUrl,
			isBundleable: products.isBundleable,
			categoryId: products.categoryId,
			categoryName: categories.name,
			categorySlug: categories.slug
		})
		.from(products)
		.leftJoin(categories, eq(categories.id, products.categoryId))
		.where(and(eq(products.slug, slug), eq(products.isActive, true), isNull(products.deletedAt)))
		.limit(1);

	if (!prod) {
		throw error(404, 'Produk tidak ditemukan');
	}

	// Cari paket bundling yang menyertakan produk ini
	const relatedBundles = await db
		.select({
			id: bundles.id,
			name: bundles.name,
			slug: bundles.slug,
			price: bundles.price,
			imageUrl: bundles.imageUrl,
			stock: bundles.stock
		})
		.from(bundleItems)
		.innerJoin(bundles, eq(bundles.id, bundleItems.bundleId))
		.where(
			and(eq(bundleItems.productId, prod.id), eq(bundles.isActive, true), isNull(bundles.deletedAt))
		);

	const { lowStock } = await getSettings();

	// Galeri foto produk (mendukung banyak foto per produk)
	const productGallery = await db
		.select({
			id: productImages.id,
			imageUrl: productImages.imageUrl,
			sortOrder: productImages.sortOrder
		})
		.from(productImages)
		.where(eq(productImages.productId, prod.id))
		.orderBy(asc(productImages.sortOrder), asc(productImages.id));

	const gallery =
		productGallery.length > 0
			? productGallery
			: prod.imageUrl
				? [{ id: 0, imageUrl: prod.imageUrl, sortOrder: 0 }]
				: [];

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
		sizes: getSizes(db, prod.id),
		lowStock,
		relatedBundles,
		isKonsumen: locals.user?.role === 'konsumen',
		user: locals.user
	};
};

export const actions: Actions = {
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
			message: 'Produk berhasil ditambahkan ke keranjang belanja!'
		};
	}
};
