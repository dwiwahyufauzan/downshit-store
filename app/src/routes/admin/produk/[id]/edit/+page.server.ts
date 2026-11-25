import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, transact } from '#lib/server/db';
import { categories, productImages, products } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { parseRemoveField, parseSizeField, productUpdateSchema } from '#lib/schemas/product';
import { SizeRuleError, applySizeEdit } from '#lib/server/product-sizes';
import { getSizes } from '#lib/server/sizes';
import { getSettings } from '#lib/server/settings';
import { deleteImage, saveImage } from '#lib/server/upload';
import { deleteImageIfUnused } from '#lib/server/image-refs';
import { idParam } from '#lib/server/sql';
import { productUsageIn } from '#lib/server/product-usage';
import { logActivity } from '#lib/server/activity';

export type ProductEditFormErrors = {
	name?: string[];
	categoryId?: string[];
	description?: string[];
	price?: string[];
	sizes?: string[];
	image?: string[];
	isBundleable?: string[];
	isActive?: string[];
};

export const load = async ({ params, locals }) => {
	requireRole(locals, 'admin');
	const id = idParam(params.id);
	if (!id) throw error(404, 'Produk tidak ditemukan');

	const [prod] = await db.select().from(products).where(eq(products.id, id)).limit(1);
	if (!prod || prod.deletedAt) throw error(404, 'Produk tidak ditemukan');

	const allCategories = await db
		.select({ id: categories.id, name: categories.name })
		.from(categories)
		.orderBy(categories.name);

	const { lowStock } = await getSettings();

	const existingImages = await db
		.select({
			id: productImages.id,
			imageUrl: productImages.imageUrl,
			sortOrder: productImages.sortOrder
		})
		.from(productImages)
		.where(eq(productImages.productId, id))
		.orderBy(asc(productImages.sortOrder), asc(productImages.id));

	// Kompatibilitas data lama jika produk memiliki imageUrl tetapi belum ada di tabel productImages
	const images =
		existingImages.length > 0
			? existingImages
			: prod.imageUrl
				? [{ id: -1, imageUrl: prod.imageUrl, sortOrder: 0 }]
				: [];

	return {
		product: prod,
		categories: allCategories,
		images,
		// Ukuran + stok saat ini (kosong = produk tanpa ukuran)
		sizes: getSizes(db, id),
		lowStock
	};
};

export const actions = {
	default: async ({ params, request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const id = idParam(params.id);
		if (!id) throw error(404, 'Produk tidak ditemukan');

		const [prod] = await db.select().from(products).where(eq(products.id, id)).limit(1);
		if (!prod || prod.deletedAt) throw error(404, 'Produk tidak ditemukan');

		const fd = await request.formData();
		const raw = {
			name: fd.get('name'),
			categoryId: fd.get('categoryId'),
			description: fd.get('description') || undefined,
			price: fd.get('price'),
			isBundleable: fd.get('isBundleable') === 'on',
			isActive: fd.get('isActive') === 'on'
		};
		// Perubahan ukuran: tambah (dengan stok awal) & hapus (hanya yang stoknya 0)
		const sizesRaw = fd.get('sizesNew');
		const removeRaw = fd.get('sizesRemove');
		const values = {
			...raw,
			sizesNew: typeof sizesRaw === 'string' ? sizesRaw : '',
			sizesRemove: typeof removeRaw === 'string' ? removeRaw : ''
		};
		const sizeAdd = parseSizeField(sizesRaw);
		if (!sizeAdd.ok) {
			return fail(400, { errors: { sizes: [sizeAdd.message] } as ProductEditFormErrors, values });
		}
		const sizeRemove = parseRemoveField(removeRaw);

		const parsed = productUpdateSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: ProductEditFormErrors = parsed.error.flatten().fieldErrors;
			return fail(400, {
				errors,
				values
			});
		}

		const d = parsed.data;

		const cat = db
			.select({ id: categories.id })
			.from(categories)
			.where(eq(categories.id, d.categoryId))
			.get();
		if (!cat) {
			const errors: ProductEditFormErrors = {
				categoryId: ['Kategori tidak ditemukan. Pilih kategori yang tersedia.']
			};
			return fail(400, { errors, values });
		}

		// Mematikan isBundleable ditolak selama produk masih komponen bundling aktif (BR-16, TC-003-13)
		if (!d.isBundleable && prod.isBundleable) {
			const u = productUsageIn(db, id);
			if (u.inActiveBundle) {
				return fail(400, {
					message: `Produk masih dipakai dalam bundling: ${u.activeBundleNames.join(', ')}. Lepaskan dulu dari bundling tersebut.`,
					values
				});
			}
		}

		// Hapus gambar lama yang ditandai hapus
		const deleteImageIds = fd
			.getAll('deleteImageIds')
			.map((x) => Number(x))
			.filter((num) => !isNaN(num) && num > 0);
		const removeLegacy =
			fd.getAll('deleteImageIds').includes('-1') || fd.get('removeImage') === 'on';

		// Upload gambar-gambar baru (mendukung multi-gambar)
		const imageFiles = [...fd.getAll('images'), ...fd.getAll('image')].filter(
			(f): f is File => f instanceof File && f.size > 0
		);

		const uploadedUrls: string[] = [];
		for (const file of imageFiles) {
			const up = await saveImage(file, 'products');
			if (!up.ok) {
				for (const u of uploadedUrls) await deleteImage(u);
				const errors: ProductEditFormErrors = { image: [up.message] };
				return fail(400, { errors, values });
			}
			uploadedUrls.push(up.url);
		}

		const imagesToDeleteFiles: string[] = [];
		let primaryImageUrl = (fd.get('primaryImageUrl') as string | null) || null;
		// Foto utama dipilih dari foto baru: petakan urutannya ke URL hasil unggah
		const newIdx = String(fd.get('primaryNewIndex') ?? '');
		if (/^\d+$/.test(newIdx) && uploadedUrls[Number(newIdx)]) {
			primaryImageUrl = uploadedUrls[Number(newIdx)];
		}

		try {
			await transact((tx) => {
				// 1. Ambil data gambar yang ada saat ini
				const currentImages = tx
					.select()
					.from(productImages)
					.where(eq(productImages.productId, id))
					.orderBy(asc(productImages.sortOrder), asc(productImages.id))
					.all();

				// Jika produk lama punya imageUrl tapi belum ada baris di productImages, buatkan barisnya
				if (currentImages.length === 0 && prod.imageUrl && !removeLegacy) {
					const [newRow] = tx
						.insert(productImages)
						.values({
							productId: id,
							imageUrl: prod.imageUrl,
							sortOrder: 0
						})
						.returning()
						.all();
					if (newRow) currentImages.push(newRow);
				}

				// 2. Hapus baris yang diminta
				if (deleteImageIds.length > 0) {
					for (const row of currentImages) {
						if (deleteImageIds.includes(row.id)) {
							imagesToDeleteFiles.push(row.imageUrl);
						}
					}
					tx.delete(productImages)
						.where(and(eq(productImages.productId, id), inArray(productImages.id, deleteImageIds)))
						.run();
				}

				if (removeLegacy && prod.imageUrl) {
					imagesToDeleteFiles.push(prod.imageUrl);
				}

				// 3. Masukkan gambar baru
				let sortIndex = currentImages.length;
				for (const url of uploadedUrls) {
					tx.insert(productImages)
						.values({
							productId: id,
							imageUrl: url,
							sortOrder: sortIndex++
						})
						.run();
				}

				// 4. Tentukan foto utama (products.imageUrl)
				const remainingImages = tx
					.select()
					.from(productImages)
					.where(eq(productImages.productId, id))
					.orderBy(asc(productImages.sortOrder), asc(productImages.id))
					.all();

				let finalPrimaryUrl: string | null = null;
				if (remainingImages.length > 0) {
					const matched = remainingImages.find((img) => img.imageUrl === primaryImageUrl);
					finalPrimaryUrl = matched ? matched.imageUrl : remainingImages[0].imageUrl;
				}

				// Stok sengaja TIDAK diubah di sini (BR-19); slug tetap agar URL stabil
				tx.update(products)
					.set({
						name: d.name,
						categoryId: d.categoryId,
						description: d.description ?? null,
						price: d.price,
						imageUrl: finalPrimaryUrl,
						isBundleable: d.isBundleable,
						isActive: d.isActive
					})
					.where(eq(products.id, id))
					.run();

				// Ukuran diubah di transaksi yang sama: gagal di sini = seluruh perubahan produk di-rollback
				const sz = applySizeEdit(tx, id, admin.id, sizeAdd.data, sizeRemove);
				logActivity(
					admin.id,
					'product.update',
					'product',
					id,
					`Produk diubah: ${d.name}${sz.added || sz.removed ? ` (ukuran +${sz.added} / −${sz.removed})` : ''}`,
					tx
				);
			});
		} catch (e) {
			for (const u of uploadedUrls) await deleteImage(u); // update gagal → gambar baru jangan jadi file yatim
			if (e instanceof SizeRuleError) return fail(400, { message: e.message, values });
			throw e;
		}

		// Gambar lama dibuang SETELAH DB berhasil (urutan ini mencegah gambar hilang bila update gagal)
		for (const u of imagesToDeleteFiles) {
			await deleteImageIfUnused(u);
		}

		throw redirect(303, '/admin/produk');
	}
};
