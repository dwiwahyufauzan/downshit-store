import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Tx } from './db';
import { NOW_ISO, productSizes, products } from './db/schema';
import { compareSizes } from '$lib/utils/sizes';

type Exec = typeof db | Tx;

export type SizeRow = { id: number; label: string; stock: number };

/** Ukuran satu produk, urut menurut urutan lazim (S, M, L… / angka). Kosong = produk tanpa ukuran. */
export function getSizes(ex: Exec, productId: number): SizeRow[] {
	return ex
		.select({ id: productSizes.id, label: productSizes.label, stock: productSizes.stock })
		.from(productSizes)
		.where(eq(productSizes.productId, productId))
		.orderBy(asc(productSizes.id))
		.all()
		.sort((a, b) => compareSizes(a.label, b.label));
}

/** Ukuran banyak produk sekaligus (productId → daftar ukuran). Produk tanpa ukuran tidak punya entri. */
export function getSizesFor(ex: Exec, productIds: number[]): Map<number, SizeRow[]> {
	const map = new Map<number, SizeRow[]>();
	if (productIds.length === 0) return map;
	const rows = ex
		.select({
			productId: productSizes.productId,
			id: productSizes.id,
			label: productSizes.label,
			stock: productSizes.stock
		})
		.from(productSizes)
		.where(inArray(productSizes.productId, productIds))
		.orderBy(asc(productSizes.id))
		.all();
	for (const r of rows) {
		const list = map.get(r.productId) ?? [];
		list.push({ id: r.id, label: r.label, stock: r.stock });
		map.set(r.productId, list);
	}
	for (const list of map.values()) list.sort((a, b) => compareSizes(a.label, b.label));
	return map;
}

export function hasSizes(ex: Exec, productId: number): boolean {
	return (
		ex
			.select({ id: productSizes.id })
			.from(productSizes)
			.where(eq(productSizes.productId, productId))
			.limit(1)
			.get() !== undefined
	);
}

/** Pulihkan invarian products.stock = SUM(product_sizes.stock) (dipanggil setelah mengubah daftar ukuran). */
export function syncProductTotal(ex: Exec, productId: number): number {
	const total =
		ex
			.select({ n: sql<number>`COALESCE(SUM(${productSizes.stock}), 0)` })
			.from(productSizes)
			.where(eq(productSizes.productId, productId))
			.get()?.n ?? 0;
	ex.update(products)
		.set({ stock: total, updatedAt: NOW_ISO })
		.where(eq(products.id, productId))
		.run();
	return total;
}

/** Stok satu ukuran (undefined bila produk tidak punya ukuran itu). */
export function sizeStock(ex: Exec, productId: number, label: string): number | undefined {
	return ex
		.select({ stock: productSizes.stock })
		.from(productSizes)
		.where(and(eq(productSizes.productId, productId), eq(productSizes.label, label)))
		.get()?.stock;
}
