import { inArray } from 'drizzle-orm';
import { db, type Tx } from './db';
import { products } from './db/schema';

/**
 * BR-05/BR-16: komponen bundling HARUS produk aktif, `is_bundleable`, dan belum dihapus.
 * Daftar pilihan di klien tidak dipercaya; dicek ulang di server (sinkron, boleh dipakai di dalam `transact`).
 * Mengembalikan pesan galat yang menyebut nama produk bermasalah, atau null bila semua valid.
 */
export function checkBundleComponents(
	ex: typeof db | Tx,
	productIds: number[],
	/** Komponen yang sudah ada di paket ini (saat ubah): yang sekadar nonaktif tidak memblokir penyimpanan. */
	keepIds: number[] = []
): string | null {
	const rows = ex
		.select({
			id: products.id,
			name: products.name,
			isActive: products.isActive,
			isBundleable: products.isBundleable,
			deletedAt: products.deletedAt
		})
		.from(products)
		.where(inArray(products.id, productIds))
		.all();

	const byId = new Map(rows.map((r) => [r.id, r]));
	const missing = productIds.filter((id) => !byId.has(id));
	if (missing.length > 0) return `Produk dengan ID ${missing.join(', ')} tidak ditemukan.`;

	const bad = rows.filter((r) => {
		if (r.deletedAt) return true;
		if (keepIds.includes(r.id)) return false;
		return !r.isActive || !r.isBundleable;
	});
	if (bad.length > 0) {
		return `Produk berikut tidak tersedia untuk bundling (harus aktif dan diizinkan masuk paket): ${bad.map((b) => b.name).join(', ')}.`;
	}
	return null;
}

/** Dilempar di dalam `transact` untuk membatalkan simpan (rollback) karena aturan bisnis bundling. */
export class BundleRuleError extends Error {}
