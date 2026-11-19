import { and, asc, count, desc, eq, exists, gt, gte, isNull, like, lte } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { categories, productSizes, products } from '#lib/server/db/schema';
import { escapeLike, pageParam, priceParam } from '#lib/server/sql';
import { compareSizes, normalizeSize } from '#lib/utils/sizes';
import { getProductStats, ratingScoreOf, soldOf } from '#lib/server/recommendations';
import { CATALOG_PAGE_SIZE } from '#lib/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const page = pageParam(url);
	const perPage = CATALOG_PAGE_SIZE;
	const q = url.searchParams.get('q')?.trim() ?? '';
	const cat = url.searchParams.get('kategori')?.trim() ?? '';
	const sort = url.searchParams.get('urut') ?? 'terbaru';

	// Filter harga: bila terbalik (min > max) ditukar, bukan menghasilkan daftar kosong
	let min = priceParam(url, 'min');
	let max = priceParam(url, 'max');
	if (min !== null && max !== null && min > max) [min, max] = [max, min];
	const ukuran = normalizeSize(url.searchParams.get('ukuran') ?? '');

	const whereConditions = [eq(products.isActive, true), isNull(products.deletedAt)];

	if (q) {
		whereConditions.push(like(products.name, `%${escapeLike(q)}%`));
	}
	if (cat) {
		whereConditions.push(eq(categories.slug, cat));
	}
	if (min !== null) whereConditions.push(gte(products.price, min));
	if (max !== null) whereConditions.push(lte(products.price, max));
	if (ukuran) {
		// hanya produk yang ukuran tersebut MASIH ADA stoknya
		whereConditions.push(
			exists(
				db
					.select({ one: productSizes.id })
					.from(productSizes)
					.where(
						and(
							eq(productSizes.productId, products.id),
							eq(productSizes.label, ukuran),
							gt(productSizes.stock, 0)
						)
					)
			)
		);
	}

	const where = and(...whereConditions);

	const order =
		sort === 'termurah'
			? asc(products.price)
			: sort === 'termahal'
				? desc(products.price)
				: sort === 'terlaris'
					? desc(soldOf(products.id))
					: sort === 'rating'
						? desc(ratingScoreOf(products.id))
						: desc(products.createdAt);

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
			.orderBy(order)
			.limit(perPage)
			.offset((page - 1) * perPage),
		db
			.select({ total: count() })
			.from(products)
			.leftJoin(categories, eq(categories.id, products.categoryId))
			.where(where),
		db.select().from(categories).orderBy(asc(categories.name))
	]);

	const totalPages = Math.max(1, Math.ceil(total / perPage));

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
	const itemsWithStats = items.map((i) => ({
		...i,
		rating: stats.get(i.id)?.rating ?? null,
		reviewCount: stats.get(i.id)?.reviewCount ?? 0,
		sold: stats.get(i.id)?.sold ?? 0
	}));

	return {
		items: itemsWithStats,
		categories: cats,
		sizeOptions,
		pagination: {
			page,
			totalPages,
			totalItems: total,
			perPage
		},
		filters: {
			q,
			kategori: cat,
			urut: sort,
			min,
			max,
			ukuran
		}
	};
};
