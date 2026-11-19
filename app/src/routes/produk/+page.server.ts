import { and, asc, count, desc, eq, isNull, like } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { categories, products } from '$lib/server/db/schema';
import { escapeLike, pageParam } from '$lib/server/sql';
import { getProductStats, ratingScoreOf, soldOf } from '$lib/server/recommendations';
import { CATALOG_PAGE_SIZE } from '$lib/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const page = pageParam(url);
	const perPage = CATALOG_PAGE_SIZE;
	const q = url.searchParams.get('q')?.trim() ?? '';
	const cat = url.searchParams.get('kategori')?.trim() ?? '';
	const sort = url.searchParams.get('urut') ?? 'terbaru';

	const whereConditions = [eq(products.isActive, true), isNull(products.deletedAt)];

	if (q) {
		whereConditions.push(like(products.name, `%${escapeLike(q)}%`));
	}
	if (cat) {
		whereConditions.push(eq(categories.slug, cat));
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
		pagination: {
			page,
			totalPages,
			totalItems: total,
			perPage
		},
		filters: {
			q,
			kategori: cat,
			urut: sort
		}
	};
};
