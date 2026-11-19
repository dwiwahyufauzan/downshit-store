import { and, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bundleItems, bundles, products } from '$lib/server/db/schema';
import { effectiveBundleStock } from '$lib/utils/bundle';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const urut = (url.searchParams.get('urut') ?? 'terbaru').trim();

	const conditions = [eq(bundles.isActive, true), isNull(bundles.deletedAt)];
	if (q) {
		conditions.push(or(like(bundles.name, `%${q}%`), like(bundles.description, `%${q}%`))!);
	}

	const activeBundles = await db
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

	if (activeBundles.length === 0) {
		return {
			bundles: [],
			filters: { q, urut }
		};
	}

	const bundleIds = activeBundles.map((b) => b.id);

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
		.where(inArray(bundleItems.bundleId, bundleIds));

	// Grouping komponen per bundle
	const compsByBundle = new Map<number, typeof compRows>();
	for (const comp of compRows) {
		const arr = compsByBundle.get(comp.bundleId) ?? [];
		arr.push(comp);
		compsByBundle.set(comp.bundleId, arr);
	}

	const enrichedBundles = activeBundles.map((b) => {
		const comps = compsByBundle.get(b.id) ?? [];
		const normalPrice = comps.reduce((acc, c) => acc + (c.productPrice ?? 0) * c.quantity, 0);
		const savings = Math.max(0, normalPrice - b.price);
		const totalPieces = comps.reduce((acc, c) => acc + c.quantity, 0);

		// Perhitungan stok efektif murni
		const stockComponents = comps.map((c) => ({
			stock: c.productActive ? c.productStock : 0,
			qty: c.quantity
		}));
		const effStock = effectiveBundleStock(b.stock, stockComponents);

		return {
			...b,
			normalPrice,
			savings,
			totalPieces,
			effectiveStock: effStock
		};
	});

	if (urut === 'termurah') {
		enrichedBundles.sort((a, b) => a.price - b.price);
	} else if (urut === 'termahal') {
		enrichedBundles.sort((a, b) => b.price - a.price);
	} else if (urut === 'hemat') {
		enrichedBundles.sort((a, b) => b.savings - a.savings);
	}

	return {
		bundles: enrichedBundles,
		filters: { q, urut }
	};
};
