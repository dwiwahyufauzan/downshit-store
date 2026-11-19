import { fail } from '@sveltejs/kit';
import { and, asc, count, desc, eq, isNull, like, lte } from 'drizzle-orm';
import { db, transact } from '$lib/server/db';
import { cartItems, categories, products, stockMovements } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { escapeLike, idParam, pageParam } from '$lib/server/sql';
import { getSettings } from '$lib/server/settings';
import { getSizesFor } from '$lib/server/sizes';
import { productUsageIn } from '$lib/server/product-usage';
import { deleteImageIfUnused } from '$lib/server/image-refs';
import { logActivity } from '$lib/server/activity';

const PER_PAGE = 15;

export const load = async ({ url, locals }) => {
	requireRole(locals, 'admin');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const categoryId = idParam(url.searchParams.get('cat') ?? undefined);
	const lowOnly = url.searchParams.get('low') === 'true';

	const { lowStock } = await getSettings();

	const whereConditions = and(
		isNull(products.deletedAt),
		q ? like(products.name, `%${escapeLike(q)}%`) : undefined,
		categoryId ? eq(products.categoryId, categoryId) : undefined,
		lowOnly ? lte(products.stock, lowStock) : undefined
	);

	const [totalCountRow] = await db.select({ count: count() }).from(products).where(whereConditions);

	const totalItems = totalCountRow?.count ?? 0;
	const totalPages = Math.ceil(totalItems / PER_PAGE);
	const page = Math.min(pageParam(url), Math.max(1, totalPages)); // ?page=999 → halaman terakhir

	const rows = await db
		.select({
			id: products.id,
			name: products.name,
			slug: products.slug,
			price: products.price,
			stock: products.stock,
			imageUrl: products.imageUrl,
			isBundleable: products.isBundleable,
			isActive: products.isActive,
			categoryName: categories.name
		})
		.from(products)
		.leftJoin(categories, eq(categories.id, products.categoryId))
		.where(whereConditions)
		.orderBy(asc(products.stock), desc(products.id))
		.limit(PER_PAGE)
		.offset((page - 1) * PER_PAGE);

	const allCategories = await db
		.select({ id: categories.id, name: categories.name })
		.from(categories)
		.orderBy(categories.name);

	// Ringkasan stok per ukuran (produk tanpa ukuran → daftar kosong)
	const sizesOf = getSizesFor(
		db,
		rows.map((r) => r.id)
	);

	const [anyRow] = await db.select({ n: count() }).from(products).where(isNull(products.deletedAt));

	return {
		products: rows.map((r) => ({ ...r, sizes: sizesOf.get(r.id) ?? [] })),
		totalAll: anyRow?.n ?? 0,
		categories: allCategories,
		lowStock,
		pagination: {
			page,
			perPage: PER_PAGE,
			totalItems,
			totalPages
		},
		filters: {
			q,
			categoryId,
			lowOnly
		}
	};
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
				return { ok: true as const, mode: 'soft' as const, name: prod.name, imageUrl: null };
			}

			// Tanpa riwayat nyata: hapus permanen beserta mutasi "stok awal" otomatisnya
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
			return { ok: true as const, mode: 'hard' as const, name: prod.name, imageUrl: prod.imageUrl };
		});

		if (!result.ok) return fail(result.status, { message: result.error });

		// File gambar (+ thumbnail) hanya dibuang untuk hapus permanen, setelah DB berhasil
		if (result.imageUrl) await deleteImageIfUnused(result.imageUrl);

		return {
			success: true,
			message:
				result.mode === 'hard'
					? `Produk "${result.name}" dihapus permanen.`
					: `Produk "${result.name}" sudah pernah dipakai di pesanan/pembelian, jadi dinonaktifkan dan disembunyikan (riwayat tetap aman).`
		};
	}
};
