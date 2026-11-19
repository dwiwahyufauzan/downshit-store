import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, transact } from '$lib/server/db';
import { categories, productImages, products, stockMovements } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { parseSizeField, productCreateSchema } from '$lib/schemas/product';
import { createInitialSizes } from '$lib/server/product-sizes';
import { deleteImage, saveImage } from '$lib/server/upload';
import { slugify } from '$lib/utils/slug';
import { uniqueSlug } from '$lib/server/slug';
import { logActivity } from '$lib/server/activity';
import { INITIAL_STOCK_NOTE } from '$lib/server/product-usage';
import { dbErrno } from '$lib/server/db/retry';

export type ProductFormErrors = {
	name?: string[];
	categoryId?: string[];
	description?: string[];
	price?: string[];
	stock?: string[];
	sizes?: string[];
	image?: string[];
	isBundleable?: string[];
	isActive?: string[];
};

export const load = async ({ locals }) => {
	requireRole(locals, 'admin');

	const allCategories = await db
		.select({ id: categories.id, name: categories.name })
		.from(categories)
		.orderBy(categories.name);

	return { categories: allCategories };
};

export const actions = {
	default: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();

		const raw = {
			name: fd.get('name'),
			categoryId: fd.get('categoryId'),
			description: fd.get('description') || undefined,
			price: fd.get('price'),
			stock: fd.get('stock'),
			isBundleable: fd.get('isBundleable') === 'on',
			isActive: fd.get('isActive') === 'on'
		};
		// Ukuran (opsional): stok awal dihitung dari stok tiap ukuran, jadi field "stok awal" diabaikan
		const sizesRaw = fd.get('sizesNew');
		const values = { ...raw, sizesNew: typeof sizesRaw === 'string' ? sizesRaw : '' };
		const sizes = parseSizeField(sizesRaw);
		if (!sizes.ok) {
			return fail(400, { errors: { sizes: [sizes.message] } as ProductFormErrors, values });
		}
		const hasSizes = sizes.data.length > 0;

		const parsed = productCreateSchema.safeParse(hasSizes ? { ...raw, stock: '0' } : raw);
		if (!parsed.success) {
			const errors: ProductFormErrors = parsed.error.flatten().fieldErrors;
			return fail(400, {
				errors,
				values
			});
		}

		const d = parsed.data;

		// Kategori harus ada (cegah error foreign key = 500)
		const cat = await db
			.select({ id: categories.id })
			.from(categories)
			.where(eq(categories.id, d.categoryId))
			.get();
		if (!cat) {
			const errors: ProductFormErrors = {
				categoryId: ['Kategori tidak ditemukan. Pilih kategori yang tersedia.']
			};
			return fail(400, { errors, values });
		}

		// Upload gambar produk (mendukung multi-gambar; gambar pertama menjadi foto utama)
		const imageFiles = [
			...fd.getAll('images'),
			...fd.getAll('image')
		].filter((f): f is File => f instanceof File && f.size > 0);

		const uploadedUrls: string[] = [];
		for (const file of imageFiles) {
			const up = await saveImage(file, 'products');
			if (!up.ok) {
				for (const u of uploadedUrls) await deleteImage(u);
				const errors: ProductFormErrors = { image: [up.message] };
				return fail(400, { errors, values });
			}
			uploadedUrls.push(up.url);
		}
		const imageUrl = uploadedUrls[0] ?? null;

		// Slug unik; bila dua admin menyimpan nama sama bersamaan, indeks UNIQUE menolak yang kedua → coba slug berikutnya
		let saved = false;
		for (let attempt = 0; attempt < 3 && !saved; attempt++) {
			const slug = await uniqueSlug(products, products.slug, slugify(d.name));
			try {
				await transact((tx) => {
					const res = tx
						.insert(products)
						.values({
							name: d.name,
							slug,
							categoryId: d.categoryId,
							description: d.description ?? null,
							price: d.price,
							stock: d.stock,
							imageUrl,
							isBundleable: d.isBundleable,
							isActive: d.isActive
						})
						.returning({ id: products.id })
						.get();

					// Simpan seluruh foto ke tabel galeri produk
					for (let i = 0; i < uploadedUrls.length; i++) {
						tx.insert(productImages)
							.values({
								productId: res.id,
								imageUrl: uploadedUrls[i],
								sortOrder: i
							})
							.run();
					}

					if (hasSizes) {
						// Stok awal per ukuran (mutasi "stok awal" dibuat per ukuran) + total produk = jumlahnya
						createInitialSizes(tx, res.id, sizes.data, admin.id);
					} else if (d.stock > 0) {
						tx.insert(stockMovements)
							.values({
								productId: res.id,
								type: 'penyesuaian',
								quantityChange: d.stock,
								stockAfter: d.stock,
								referenceType: 'manual',
								note: INITIAL_STOCK_NOTE,
								createdBy: admin.id
							})
							.run();
					}

					logActivity(
						admin.id,
						'product.create',
						'product',
						res.id,
						`Produk baru dibuat: ${d.name}`,
						tx
					);
				});
				saved = true;
			} catch (e: unknown) {
				if (dbErrno(e) !== 1062 || attempt === 2) {
					for (const u of uploadedUrls) await deleteImage(u); // jangan tinggalkan file yatim
					if (dbErrno(e) === 1062) {
						const errors: ProductFormErrors = { name: ['Nama sudah dipakai, coba lagi.'] };
						return fail(400, { errors, values });
					}
					throw e;
				}
			}
		}

		throw redirect(303, '/admin/produk');
	}
};
