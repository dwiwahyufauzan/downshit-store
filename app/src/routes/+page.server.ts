import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { bundleItems, bundles, categories, products } from '#lib/server/db/schema';
import { effectiveBundleStock } from '#lib/utils/bundle';
import { getProductStats } from '#lib/server/recommendations';

export const load = async () => {
	const latestProducts = await db
		.select({
			id: products.id,
			name: products.name,
			slug: products.slug,
			price: products.price,
			stock: products.stock,
			imageUrl: products.imageUrl,
			description: products.description,
			categoryName: categories.name
		})
		.from(products)
		.leftJoin(categories, eq(categories.id, products.categoryId))
		.where(and(eq(products.isActive, true), isNull(products.deletedAt)))
		.orderBy(desc(products.id))
		.limit(8);

	const featuredBundles = await db
		.select({
			id: bundles.id,
			name: bundles.name,
			slug: bundles.slug,
			price: bundles.price,
			stock: bundles.stock,
			imageUrl: bundles.imageUrl,
			description: bundles.description
		})
		.from(bundles)
		.where(and(eq(bundles.isActive, true), isNull(bundles.deletedAt)))
		.orderBy(desc(bundles.id))
		.limit(4);

	const bundlesWithDetails = await Promise.all(
		featuredBundles.map(async (b) => {
			const items = await db
				.select({
					productId: bundleItems.productId,
					quantity: bundleItems.quantity,
					productPrice: products.price,
					productStock: products.stock,
					productActive: products.isActive,
					productDeleted: products.deletedAt
				})
				.from(bundleItems)
				.innerJoin(products, eq(products.id, bundleItems.productId))
				.where(eq(bundleItems.bundleId, b.id));

			const normalPrice = items.reduce((sum, it) => sum + it.productPrice * it.quantity, 0);
			const effectiveStock = effectiveBundleStock(
				b.stock,
				items.map((it) => ({
					stock: it.productActive && !it.productDeleted ? it.productStock : 0,
					qty: it.quantity
				}))
			);

			return {
				...b,
				itemCount: items.length,
				normalPrice,
				savings: normalPrice - b.price,
				effectiveStock
			};
		})
	);

	const stats = getProductStats(latestProducts.map((p) => p.id));

	const allCategories = await db
		.select({
			id: categories.id,
			name: categories.name,
			slug: categories.slug,
			total: count(products.id)
		})
		.from(categories)
		.leftJoin(
			products,
			and(
				eq(products.categoryId, categories.id),
				eq(products.isActive, true),
				isNull(products.deletedAt)
			)
		)
		.groupBy(categories.id)
		.orderBy(categories.name);

	return {
		products: latestProducts.map((p) => ({
			...p,
			rating: stats.get(p.id)?.rating ?? null,
			reviewCount: stats.get(p.id)?.reviewCount ?? 0
		})),
		bundles: bundlesWithDetails,
		categories: allCategories
	};
};
