import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { db, type Tx } from './db';
import {
	bundleItems,
	bundles,
	orderItemComponents,
	orderItems,
	purchaseItems,
	stockMovements
} from './db/schema';

type Exec = typeof db | Tx;

/** Catatan mutasi otomatis saat produk dibuat dengan stok awal (lihat admin/produk/baru). */
export const INITIAL_STOCK_NOTE = 'Stok awal produk baru';
export const INITIAL_BUNDLE_STOCK_NOTE = 'Stok awal kuota bundling';

export type ProductUsage = {
	/** Masih jadi komponen bundling yang belum dihapus → produk tidak boleh dihapus (BR-03). */
	inActiveBundle: boolean;
	/** Nama bundling aktif yang memakai produk ini (untuk pesan galat). */
	activeBundleNames: string[];
	/** Punya riwayat apa pun (bundling, pesanan, pembelian, mutasi stok) → hanya soft delete. */
	hasHistory: boolean;
};

/**
 * Pemakaian produk (plan/06 §3.6): memeriksa keenam tabel yang punya FK RESTRICT/jejak ke produk.
 * SINKRON agar bisa dipanggil di dalam `transact()` (pemeriksaan + hapus satu transaksi, tanpa celah balapan).
 */
export function productUsageIn(ex: Exec, productId: number): ProductUsage {
	const has = (q: { get: () => unknown }) => q.get() !== undefined;

	const activeBundles = ex
		.select({ name: bundles.name })
		.from(bundleItems)
		.innerJoin(bundles, eq(bundles.id, bundleItems.bundleId))
		.where(and(eq(bundleItems.productId, productId), isNull(bundles.deletedAt)))
		.all();

	const anyBundle = has(
		ex
			.select({ id: bundleItems.id })
			.from(bundleItems)
			.where(eq(bundleItems.productId, productId))
			.limit(1)
	);
	const ordered = has(
		ex
			.select({ id: orderItems.id })
			.from(orderItems)
			.where(eq(orderItems.productId, productId))
			.limit(1)
	);
	const asComponent = has(
		ex
			.select({ id: orderItemComponents.id })
			.from(orderItemComponents)
			.where(eq(orderItemComponents.productId, productId))
			.limit(1)
	);
	const purchased = has(
		ex
			.select({ id: purchaseItems.id })
			.from(purchaseItems)
			.where(eq(purchaseItems.productId, productId))
			.limit(1)
	);
	// Mutasi "Stok awal" (dibuat otomatis saat produk ditambah) bukan riwayat nyata: ikut dihapus bila produk
	// belum pernah dipakai apa pun, sehingga TC-003-08 (hapus permanen) tetap mungkin untuk produk ber-stok awal.
	const moved = has(
		ex
			.select({ id: stockMovements.id })
			.from(stockMovements)
			.where(
				and(
					eq(stockMovements.productId, productId),
					or(
						ne(stockMovements.type, 'penyesuaian'),
						ne(stockMovements.note, INITIAL_STOCK_NOTE),
						isNull(stockMovements.note)
					)
				)
			)
			.limit(1)
	);

	return {
		inActiveBundle: activeBundles.length > 0,
		activeBundleNames: activeBundles.map((b) => b.name),
		hasHistory: anyBundle || ordered || asComponent || purchased || moved
	};
}

export async function productUsage(productId: number): Promise<ProductUsage> {
	return productUsageIn(db, productId);
}
