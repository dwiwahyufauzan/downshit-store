import { fail } from '@sveltejs/kit';
import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { db, transact } from '$lib/server/db';
import {
	bundleItems,
	bundles,
	cartItems,
	orderItems,
	products,
	stockMovements
} from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { idParam } from '$lib/server/sql';
import { deleteImageIfUnused } from '$lib/server/image-refs';
import { logActivity } from '$lib/server/activity';
import { INITIAL_BUNDLE_STOCK_NOTE } from '$lib/server/product-usage';
import { effectiveBundleStock } from '$lib/utils/bundle';

export const load = async ({ locals }) => {
	requireRole(locals, 'admin');

	const bundleRows = await db
		.select({
			id: bundles.id,
			name: bundles.name,
			slug: bundles.slug,
			price: bundles.price,
			stock: bundles.stock,
			imageUrl: bundles.imageUrl,
			isActive: bundles.isActive
		})
		.from(bundles)
		.where(isNull(bundles.deletedAt))
		.orderBy(desc(bundles.id));

	// Ambil komponen untuk setiap bundling untuk menghitung harga normal & stok efektif
	const bundlesWithDetails = await Promise.all(
		bundleRows.map(async (b) => {
			const items = await db
				.select({
					productId: bundleItems.productId,
					quantity: bundleItems.quantity,
					productName: products.name,
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
				items.map((it) => ({ stock: it.productStock, qty: it.quantity }))
			);

			// Komponen nonaktif/terhapus → paket tidak bisa dibeli konsumen (stok komponen tak bisa dikurangi)
			const unavailable = items.filter((it) => !it.productActive || it.productDeleted);

			return {
				...b,
				items,
				unavailable: unavailable.map((it) => it.productName),
				normalPrice,
				savings: normalPrice - b.price,
				effectiveStock
			};
		})
	);

	return { bundles: bundlesWithDetails };
};

export const actions = {
	delete: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());

		if (!id) return fail(400, { message: 'ID bundling tidak valid' });

		const result = await transact((tx) => {
			const b = tx.select().from(bundles).where(eq(bundles.id, id)).get();
			if (!b || b.deletedAt) return { error: 'Paket bundling tidak ditemukan atau sudah dihapus.' };

			// Pernah dipesan atau punya jejak mutasi stok → soft delete (riwayat aman); selain itu hapus permanen
			const ordered = tx
				.select({ id: orderItems.id })
				.from(orderItems)
				.where(eq(orderItems.bundleId, id))
				.limit(1)
				.get();
			// mutasi "stok awal" otomatis bukan riwayat nyata (ikut terhapus bila paket belum pernah dipakai)
			const moved = tx
				.select({ id: stockMovements.id })
				.from(stockMovements)
				.where(
					and(
						eq(stockMovements.bundleId, id),
						or(
							ne(stockMovements.type, 'penyesuaian'),
							ne(stockMovements.note, INITIAL_BUNDLE_STOCK_NOTE),
							isNull(stockMovements.note)
						)
					)
				)
				.limit(1)
				.get();

			if (ordered || moved) {
				tx.update(bundles)
					.set({ isActive: false, deletedAt: new Date().toISOString() })
					.where(eq(bundles.id, id))
					.run();
				tx.delete(cartItems).where(eq(cartItems.bundleId, id)).run();
				logActivity(
					admin.id,
					'bundle.delete',
					'bundle',
					id,
					`Paket bundling dinonaktifkan (punya riwayat): ${b.name}`,
					tx
				);
				return { ok: true as const, mode: 'soft' as const, name: b.name, imageUrl: null };
			}

			tx.delete(stockMovements).where(eq(stockMovements.bundleId, id)).run();
			tx.delete(bundleItems).where(eq(bundleItems.bundleId, id)).run();
			tx.delete(bundles).where(eq(bundles.id, id)).run();
			logActivity(
				admin.id,
				'bundle.delete',
				'bundle',
				id,
				`Paket bundling dihapus permanen: ${b.name}`,
				tx
			);
			return { ok: true as const, mode: 'hard' as const, name: b.name, imageUrl: b.imageUrl };
		});

		if ('error' in result) return fail(404, { message: result.error });
		if (result.imageUrl) await deleteImageIfUnused(result.imageUrl);

		return {
			success: true,
			message:
				result.mode === 'hard'
					? `Paket "${result.name}" dihapus permanen.`
					: `Paket "${result.name}" sudah punya riwayat (pesanan/mutasi stok), jadi dinonaktifkan dan disembunyikan.`
		};
	}
};
