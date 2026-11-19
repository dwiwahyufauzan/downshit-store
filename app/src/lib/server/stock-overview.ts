import { asc, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { bundleItems, bundles, categories, products } from './db/schema';
import { effectiveBundleStock } from '../utils/bundle';
import { getSettings } from './settings';
import { getSizesFor, type SizeRow } from './sizes';

export async function getStockOverview(opts: { q?: string; lowOnly?: boolean } = {}) {
	const { lowStock } = await getSettings();

	const all = await db
		.select({
			id: products.id,
			name: products.name,
			slug: products.slug,
			category: categories.name,
			stock: products.stock,
			price: products.price,
			isActive: products.isActive
		})
		.from(products)
		.leftJoin(categories, eq(categories.id, products.categoryId))
		.where(isNull(products.deletedAt))
		.orderBy(asc(products.stock), asc(products.name));

	const bundleRows = await db
		.select({
			id: bundles.id,
			name: bundles.name,
			slug: bundles.slug,
			stock: bundles.stock,
			price: bundles.price,
			isActive: bundles.isActive
		})
		.from(bundles)
		.where(isNull(bundles.deletedAt))
		.orderBy(asc(bundles.stock));

	// Stok efektif paket = min(kuota, min(floor(stok komponen / qty))) — komponen nonaktif/terhapus = tak bisa dibeli
	const comps = await db
		.select({
			bundleId: bundleItems.bundleId,
			qty: bundleItems.quantity,
			stock: products.stock,
			active: products.isActive,
			deleted: products.deletedAt
		})
		.from(bundleItems)
		.innerJoin(products, eq(products.id, bundleItems.productId));
	const bundlesWithEffective = bundleRows.map((b) => {
		const mine = comps.filter((c) => c.bundleId === b.id);
		const blocked = mine.some((c) => !c.active || c.deleted);
		return {
			...b,
			effectiveStock: blocked
				? 0
				: effectiveBundleStock(
						b.stock,
						mine.map((c) => ({ stock: c.stock, qty: c.qty }))
					),
			blocked
		};
	});

	const q = opts.q?.trim().toLowerCase();
	// Rincian per ukuran (produk tanpa ukuran → daftar kosong)
	const sizesOf = getSizesFor(
		db,
		all.map((r) => r.id)
	);
	const rows: ((typeof all)[number] & { sizes: SizeRow[] })[] = all
		.filter(
			(r) => (!q || r.name.toLowerCase().includes(q)) && (!opts.lowOnly || r.stock <= lowStock)
		)
		.map((r) => ({ ...r, sizes: sizesOf.get(r.id) ?? [] }));

	return {
		lowStock,
		products: rows,
		bundles: bundlesWithEffective,
		summary: {
			total: all.length,
			empty: all.filter((r) => r.stock === 0).length,
			low: all.filter((r) => r.stock > 0 && r.stock <= lowStock).length,
			inventoryValue: all.reduce((s, r) => s + r.price * r.stock, 0)
		}
	};
}
