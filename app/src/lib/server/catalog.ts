/**
 * Kueri katalog publik (produk & paket bundling): daftar + filter, detail, dan data halaman detail.
 * Controller (`routes/produk`, `routes/bundling`) hanya membaca parameter URL, memanggil fungsi di sini,
 * lalu memutuskan respons HTTP (404 / redirect).
 */
import { and, asc, count, desc, eq, exists, gt, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from './db';
import {
	bundleItems,
	bundles,
	categories,
	productImages,
	productSizes,
	products
} from './db/schema';
import { contains } from './sql';
import { getProductStats, ratingScoreOf, soldOf } from './recommendations';
import { getSizes } from './sizes';
import { getSettings } from './settings';
import { compareSizes } from '#lib/utils/sizes';
import { effectiveBundleStock } from '#lib/utils/bundle';

/* ---------------------------------------------------------------- daftar produk */

export type CatalogParams = {
	page: number;
	perPage: number;
	q: string;
	/** slug kategori */
	cat: string;
	sort: string;
	min: number | null;
	max: number | null;
	/** label ukuran (sudah dinormalkan) */
	ukuran: string;
};

const orderFor = (sort: string) =>
	sort === 'termurah'
		? asc(products.price)
		: sort === 'termahal'
			? desc(products.price)
			: sort === 'terlaris'
				? desc(soldOf(products.id))
				: sort === 'rating'
					? desc(ratingScoreOf(products.id))
					: desc(products.createdAt);

/** Produk aktif sesuai filter + kategori + pilihan ukuran untuk filter, satu halaman. */
export async function listCatalog(p: CatalogParams) {
	const conditions = [eq(products.isActive, true), isNull(products.deletedAt)];
	if (p.q) conditions.push(contains(products.name, p.q));
	if (p.cat) conditions.push(eq(categories.slug, p.cat));
	if (p.min !== null) conditions.push(gte(products.price, p.min));
	if (p.max !== null) conditions.push(lte(products.price, p.max));
	if (p.ukuran) {
		// hanya produk yang ukuran tersebut MASIH ADA stoknya
		conditions.push(
			exists(
				db
					.select({ one: productSizes.id })
					.from(productSizes)
					.where(
						and(
							eq(productSizes.productId, products.id),
							eq(productSizes.label, p.ukuran),
							gt(productSizes.stock, 0)
						)
					)
			)
		);
	}
	const where = and(...conditions);

	const [items, [{ total }], cats] = await Promise.all([
		db
			.select({
				id: products.id,
				name: products.name,
				slug: products.slug,
				price: products.price,
				stock: products.stock,
				imageUrl: products.imageUrl,
				categoryName: categories.name,
				categorySlug: categories.slug
			})
			.from(products)
			.leftJoin(categories, eq(categories.id, products.categoryId))
			.where(where)
			// id sebagai penentu kedua: nilai urut yang sama tidak boleh membuat produk dobel/terlewat antar halaman
			.orderBy(orderFor(p.sort), desc(products.id))
			.limit(p.perPage)
			.offset((p.page - 1) * p.perPage),
		db
			.select({ total: count() })
			.from(products)
			.leftJoin(categories, eq(categories.id, products.categoryId))
			.where(where),
		db.select().from(categories).orderBy(asc(categories.name))
	]);

	// Pilihan ukuran di filter: hanya ukuran yang stoknya masih ada pada produk aktif, urut S → XXL / angka naik
	const sizeOptions = db
		.selectDistinct({ label: productSizes.label })
		.from(productSizes)
		.innerJoin(products, eq(products.id, productSizes.productId))
		.where(and(eq(products.isActive, true), isNull(products.deletedAt), gt(productSizes.stock, 0)))
		.all()
		.map((r) => r.label)
		.sort(compareSizes);

	// Rating & jumlah ulasan untuk kartu produk
	const stats = getProductStats(items.map((i) => i.id));
	return {
		items: items.map((i) => ({
			...i,
			rating: stats.get(i.id)?.rating ?? null,
			reviewCount: stats.get(i.id)?.reviewCount ?? 0,
			sold: stats.get(i.id)?.sold ?? 0
		})),
		total,
		categories: cats,
		sizeOptions
	};
}

/* ---------------------------------------------------------------- detail produk */

/** Produk aktif & belum dihapus menurut slug (null = tidak ada). */
export async function findActiveProductBySlug(slug: string) {
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
	return prod ?? null;
}

/** Paket bundling aktif yang menyertakan produk ini. */
export function listBundlesContaining(productId: number) {
	return db
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
			and(
				eq(bundleItems.productId, productId),
				eq(bundles.isActive, true),
				isNull(bundles.deletedAt)
			)
		);
}

/** Galeri foto produk; produk lama tanpa galeri memakai foto utamanya. */
export async function getProductGallery(productId: number, mainImage: string | null) {
	const rows = await db
		.select({
			id: productImages.id,
			imageUrl: productImages.imageUrl,
			sortOrder: productImages.sortOrder
		})
		.from(productImages)
		.where(eq(productImages.productId, productId))
		.orderBy(asc(productImages.sortOrder), asc(productImages.id));
	if (rows.length > 0) return rows;
	return mainImage ? [{ id: 0, imageUrl: mainImage, sortOrder: 0 }] : [];
}

/** Ambang stok menipis (pengaturan toko) + pilihan ukuran produk dengan stoknya. */
export async function getProductStockInfo(productId: number) {
	const { lowStock } = await getSettings();
	return { lowStock, sizes: getSizes(db, productId) };
}

/* ---------------------------------------------------------------- bundling */

const comparePrice = (a: { price: number }, b: { price: number }) => a.price - b.price;

/** Paket bundling aktif (opsional dicari) lengkap dengan harga normal, hemat, dan stok efektif. */
export async function listBundles(opts: { q: string; urut: string }) {
	const conditions = [eq(bundles.isActive, true), isNull(bundles.deletedAt)];
	if (opts.q) {
		conditions.push(or(contains(bundles.name, opts.q), contains(bundles.description, opts.q))!);
	}

	const active = await db
		.select({
			id: bundles.id,
			name: bundles.name,
			slug: bundles.slug,
			price: bundles.price,
			stock: bundles.stock,
			description: bundles.description,
			imageUrl: bundles.imageUrl,
			createdAt: bundles.createdAt
		})
		.from(bundles)
		.where(and(...conditions))
		.orderBy(desc(bundles.createdAt));
	if (active.length === 0) return [];

	// Muat seluruh komponen untuk bundle aktif
	const compRows = await db
		.select({
			bundleId: bundleItems.bundleId,
			quantity: bundleItems.quantity,
			productId: products.id,
			productName: products.name,
			productPrice: products.price,
			productStock: products.stock,
			productActive: products.isActive
		})
		.from(bundleItems)
		.innerJoin(products, eq(products.id, bundleItems.productId))
		.where(
			inArray(
				bundleItems.bundleId,
				active.map((b) => b.id)
			)
		);

	const compsByBundle = new Map<number, typeof compRows>();
	for (const comp of compRows) {
		compsByBundle.set(comp.bundleId, [...(compsByBundle.get(comp.bundleId) ?? []), comp]);
	}

	const enriched = active.map((b) => {
		const comps = compsByBundle.get(b.id) ?? [];
		const normalPrice = comps.reduce((acc, c) => acc + (c.productPrice ?? 0) * c.quantity, 0);
		return {
			...b,
			normalPrice,
			savings: Math.max(0, normalPrice - b.price),
			totalPieces: comps.reduce((acc, c) => acc + c.quantity, 0),
			effectiveStock: effectiveBundleStock(
				b.stock,
				comps.map((c) => ({ stock: c.productActive ? c.productStock : 0, qty: c.quantity }))
			)
		};
	});

	if (opts.urut === 'termurah') enriched.sort(comparePrice);
	else if (opts.urut === 'termahal') enriched.sort((a, b) => comparePrice(b, a));
	else if (opts.urut === 'hemat') enriched.sort((a, b) => b.savings - a.savings);
	return enriched;
}

/** Detail satu paket bundling aktif beserta komponen (+ pilihan ukuran tiap komponen); null = tidak ada. */
export async function getBundleDetail(slug: string) {
	const [b] = await db
		.select({
			id: bundles.id,
			name: bundles.name,
			slug: bundles.slug,
			price: bundles.price,
			stock: bundles.stock,
			description: bundles.description,
			imageUrl: bundles.imageUrl,
			isActive: bundles.isActive
		})
		.from(bundles)
		.where(and(eq(bundles.slug, slug), eq(bundles.isActive, true), isNull(bundles.deletedAt)))
		.limit(1);
	if (!b) return null;

	const comps = await db
		.select({
			id: bundleItems.id,
			quantity: bundleItems.quantity,
			productId: products.id,
			productName: products.name,
			productSlug: products.slug,
			productPrice: products.price,
			productStock: products.stock,
			productImage: products.imageUrl,
			productActive: products.isActive
		})
		.from(bundleItems)
		.innerJoin(products, eq(products.id, bundleItems.productId))
		.where(eq(bundleItems.bundleId, b.id));

	const normalPrice = comps.reduce((acc, c) => acc + (c.productPrice ?? 0) * c.quantity, 0);
	const { lowStock } = await getSettings();

	return {
		bundle: b,
		lowStock,
		// Komponen ber-ukuran: pelanggan wajib memilih ukuran tiap komponen (stok per ukuran)
		components: comps.map((c) => ({ ...c, sizes: getSizes(db, c.productId) })),
		normalPrice,
		savings: Math.max(0, normalPrice - b.price),
		effectiveStock: effectiveBundleStock(
			b.stock,
			comps.map((c) => ({ stock: c.productActive ? c.productStock : 0, qty: c.quantity }))
		)
	};
}
