import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { transact } from '#lib/server/db';
import { cartItems, productImages, products, stockMovements } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { idParam, pageParam } from '#lib/server/sql';
import { listAdminProducts } from '#lib/server/admin-lists';
import { productUsageIn } from '#lib/server/product-usage';
import { deleteImageIfUnused } from '#lib/server/image-refs';
import { logActivity } from '#lib/server/activity';

export const load = async ({ url, locals }) => {
	requireRole(locals, 'admin');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const categoryId = idParam(url.searchParams.get('cat') ?? undefined);
	const lowOnly = url.searchParams.get('low') === 'true';

	const data = await listAdminProducts({ q, categoryId, lowOnly, page: pageParam(url) });
	return { ...data, filters: { q, categoryId, lowOnly } };
};

export const actions = {
	delete: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());

		if (!id) return fail(400, { message: 'ID produk tidak valid' });

		// Pemeriksaan pemakaian + penghapusan dalam SATU transaksi (tanpa celah balapan dengan checkout/bundling)
		const result = await transact((tx) => {
			const prod = tx.select().from(products).where(eq(products.id, id)).get();
			if (!prod || prod.deletedAt)
				return {
					ok: false as const,
					error: 'Produk tidak ditemukan atau sudah dihapus.',
					status: 404
				};

			const u = productUsageIn(tx, id);
			if (u.inActiveBundle) {
				return {
					ok: false as const,
					error: `Produk "${prod.name}" masih menjadi komponen bundling: ${u.activeBundleNames.join(', ')}. Lepaskan dulu dari bundling tersebut.`,
					status: 400
				};
			}

			if (u.hasHistory) {
				// Soft delete: riwayat pesanan/pembelian/mutasi tetap utuh (BR-03)
				tx.update(products)
					.set({ isActive: false, isBundleable: false, deletedAt: new Date().toISOString() })
					.where(eq(products.id, id))
					.run();
				tx.delete(cartItems).where(eq(cartItems.productId, id)).run(); // bersihkan dari semua keranjang
				logActivity(
					admin.id,
					'product.delete',
					'product',
					id,
					`Produk dinonaktifkan (punya riwayat): ${prod.name}`,
					tx
				);
				return {
					ok: true as const,
					mode: 'soft' as const,
					name: prod.name,
					imageUrls: [] as string[]
				};
			}

			// Tanpa riwayat nyata: hapus permanen beserta mutasi "stok awal" otomatisnya
			// Baris galeri ikut terhapus (cascade): catat dulu semua file-nya agar tidak jadi file yatim
			const gallery = tx
				.select({ url: productImages.imageUrl })
				.from(productImages)
				.where(eq(productImages.productId, id))
				.all()
				.map((r) => r.url);
			tx.delete(stockMovements).where(eq(stockMovements.productId, id)).run();
			tx.delete(products).where(eq(products.id, id)).run();
			logActivity(
				admin.id,
				'product.delete',
				'product',
				id,
				`Produk dihapus permanen: ${prod.name}`,
				tx
			);
			return {
				ok: true as const,
				mode: 'hard' as const,
				name: prod.name,
				imageUrls: [...new Set([prod.imageUrl, ...gallery].filter((u): u is string => !!u))]
			};
		});

		if (!result.ok) return fail(result.status, { message: result.error });

		// File gambar (+ thumbnail) hanya dibuang untuk hapus permanen, setelah DB berhasil
		for (const u of result.imageUrls) await deleteImageIfUnused(u);

		return {
			success: true,
			message:
				result.mode === 'hard'
					? `Produk "${result.name}" dihapus permanen.`
					: `Produk "${result.name}" sudah pernah dipakai di pesanan/pembelian, jadi dinonaktifkan dan disembunyikan (riwayat tetap aman).`
		};
	}
};
