import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { products, wishlists } from './db/schema';

/** Batas favorit per pengguna: mencegah tabel membengkak oleh skrip/klik berulang. */
export const MAX_WISHLIST = 200;

export type ToggleResult =
	{ ok: true; saved: boolean } | { ok: false; reason: 'not_found' | 'limit'; message: string };

/**
 * Simpan produk ke favorit bila belum ada, hapus bila sudah. Hanya produk aktif yang bisa DITAMBAHKAN;
 * produk yang sudah tidak tersedia tetap bisa dihapus dari daftar.
 */
export function toggleWishlist(userId: number, productId: number): ToggleResult {
	return db.transaction((tx) => {
		const existing = tx
			.select({ id: wishlists.id })
			.from(wishlists)
			.where(and(eq(wishlists.userId, userId), eq(wishlists.productId, productId)))
			.get();
		if (existing) {
			tx.delete(wishlists).where(eq(wishlists.id, existing.id)).run();
			return { ok: true, saved: false } as const;
		}

		const prod = tx
			.select({ id: products.id })
			.from(products)
			.where(
				and(eq(products.id, productId), eq(products.isActive, true), isNull(products.deletedAt))
			)
			.get();
		if (!prod) {
			return { ok: false, reason: 'not_found', message: 'Produk tidak tersedia.' } as const;
		}

		const n = tx
			.select({ n: sql<number>`count(*)` })
			.from(wishlists)
			.where(eq(wishlists.userId, userId))
			.get()?.n;
		if ((n ?? 0) >= MAX_WISHLIST) {
			return {
				ok: false,
				reason: 'limit',
				message: `Favorit penuh (maksimal ${MAX_WISHLIST} produk). Hapus beberapa dulu.`
			} as const;
		}

		tx.insert(wishlists).values({ userId, productId }).run();
		return { ok: true, saved: true } as const;
	});
}

export function removeFromWishlist(userId: number, productId: number): boolean {
	return (
		db
			.delete(wishlists)
			.where(and(eq(wishlists.userId, userId), eq(wishlists.productId, productId)))
			.run().changes > 0
	);
}

export function isWishlisted(userId: number, productId: number): boolean {
	return !!db
		.select({ id: wishlists.id })
		.from(wishlists)
		.where(and(eq(wishlists.userId, userId), eq(wishlists.productId, productId)))
		.get();
}

/** Produk favorit (terbaru disimpan dulu); produk nonaktif/terhapus tidak ditampilkan. */
export function listWishlist(userId: number) {
	return db
		.select({
			id: products.id,
			name: products.name,
			slug: products.slug,
			price: products.price,
			stock: products.stock,
			imageUrl: products.imageUrl,
			savedAt: wishlists.createdAt
		})
		.from(wishlists)
		.innerJoin(products, eq(products.id, wishlists.productId))
		.where(
			and(eq(wishlists.userId, userId), eq(products.isActive, true), isNull(products.deletedAt))
		)
		.orderBy(desc(wishlists.createdAt), desc(wishlists.id))
		.all();
}
