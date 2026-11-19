import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { bundles, productImages, products } from './db/schema';
import { deleteImage } from './upload';

/** Apakah file gambar ini masih dipakai produk / foto galeri / paket bundling yang aktif? */
export async function isImageInUse(url: string): Promise<boolean> {
	const [asProduct] = await db
		.select({ id: products.id })
		.from(products)
		.where(and(eq(products.imageUrl, url), isNull(products.deletedAt)))
		.limit(1);
	if (asProduct) return true;

	const [asGallery] = await db
		.select({ id: productImages.id })
		.from(productImages)
		.innerJoin(products, eq(products.id, productImages.productId))
		.where(and(eq(productImages.imageUrl, url), isNull(products.deletedAt)))
		.limit(1);
	if (asGallery) return true;

	const [asBundle] = await db
		.select({ id: bundles.id })
		.from(bundles)
		.where(and(eq(bundles.imageUrl, url), isNull(bundles.deletedAt)))
		.limit(1);
	return Boolean(asBundle);
}

/**
 * Hapus file gambar lama HANYA bila tidak ada lagi yang memakainya. Satu file bisa dipakai bersama
 * beberapa produk/paket (mis. foto contoh); menghapusnya begitu saja membuat gambar lain jadi rusak.
 * Panggil setelah DB berhasil diubah.
 */
export async function deleteImageIfUnused(url: string | null | undefined) {
	if (!url || (await isImageInUse(url))) return;
	await deleteImage(url);
}
