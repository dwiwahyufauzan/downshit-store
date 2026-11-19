import { fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db, transact } from '$lib/server/db';
import { bundleItems, bundles, products, stockMovements } from '$lib/server/db/schema';
import { dbErrno } from '$lib/server/db/retry';
import { BundleRuleError, checkBundleComponents } from '$lib/server/bundle-validate';
import { requireRole } from '$lib/server/guards';
import { bundleCreateSchema } from '$lib/schemas/bundle';
import { deleteImage, saveImage } from '$lib/server/upload';
import { slugify } from '$lib/utils/slug';
import { uniqueSlug } from '$lib/server/slug';
import { logActivity } from '$lib/server/activity';
import { INITIAL_BUNDLE_STOCK_NOTE } from '$lib/server/product-usage';

export type BundleFormErrors = {
	name?: string[];
	description?: string[];
	price?: string[];
	stock?: string[];
	items?: string[];
	image?: string[];
	isActive?: string[];
};

export const load = async ({ locals }) => {
	requireRole(locals, 'admin');

	const availableProducts = await db
		.select({
			id: products.id,
			name: products.name,
			price: products.price,
			stock: products.stock
		})
		.from(products)
		.where(
			and(eq(products.isBundleable, true), eq(products.isActive, true), isNull(products.deletedAt))
		)
		.orderBy(products.name);

	return { products: availableProducts };
};

export const actions = {
	default: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();

		let rawItems: unknown = [];
		try {
			const itemsJson = fd.get('items')?.toString();
			if (itemsJson) rawItems = JSON.parse(itemsJson);
		} catch {
			return fail(400, { message: 'Format komponen paket tidak valid' });
		}

		const raw = {
			name: fd.get('name'),
			description: fd.get('description') || undefined,
			price: fd.get('price'),
			stock: fd.get('stock'),
			isActive: fd.get('isActive') === 'on',
			items: rawItems
		};

		const parsed = bundleCreateSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: BundleFormErrors = parsed.error.flatten().fieldErrors as BundleFormErrors;
			return fail(400, {
				errors,
				values: raw
			});
		}

		const d = parsed.data;

		// Validasi bisnis di server: jangan percaya daftar pilihan klien (TC-004-04, TC-004-08)
		const bad = checkBundleComponents(
			db,
			d.items.map((i) => i.productId)
		);
		if (bad) return fail(400, { message: bad, values: raw });

		let imageUrl: string | null = null;
		const file = fd.get('image');
		if (file instanceof File && file.size > 0) {
			const up = await saveImage(file, 'bundles');
			if (!up.ok) {
				const errors: BundleFormErrors = { image: [up.message] };
				return fail(400, { errors, values: raw });
			}
			imageUrl = up.url;
		}

		let saved = false;
		for (let attempt = 0; attempt < 3 && !saved; attempt++) {
			const slug = await uniqueSlug(bundles, bundles.slug, slugify(d.name));
			try {
				await transact((tx) => {
					// cek ulang di dalam transaksi (produk bisa berubah antara cek awal dan simpan)
					const again = checkBundleComponents(
						tx,
						d.items.map((i) => i.productId)
					);
					if (again) throw new BundleRuleError(again);

					const res = tx
						.insert(bundles)
						.values({
							name: d.name,
							slug,
							description: d.description ?? null,
							price: d.price,
							stock: d.stock,
							imageUrl,
							isActive: d.isActive
						})
						.returning({ id: bundles.id })
						.get();

					tx.insert(bundleItems)
						.values(
							d.items.map((it) => ({
								bundleId: res.id,
								productId: it.productId,
								quantity: it.quantity
							}))
						)
						.run();

					if (d.stock > 0) {
						tx.insert(stockMovements)
							.values({
								bundleId: res.id,
								type: 'penyesuaian',
								quantityChange: d.stock,
								stockAfter: d.stock,
								referenceType: 'manual',
								note: INITIAL_BUNDLE_STOCK_NOTE,
								createdBy: admin.id
							})
							.run();
					}

					logActivity(
						admin.id,
						'bundle.create',
						'bundle',
						res.id,
						`Paket bundling dibuat: ${d.name} (${d.items.length} item)`,
						tx
					);
				});
				saved = true;
			} catch (e: unknown) {
				if (e instanceof BundleRuleError) {
					if (imageUrl) await deleteImage(imageUrl);
					return fail(400, { message: e.message, values: raw });
				}
				if (dbErrno(e) === 1062 && attempt < 2) continue; // slug bentrok (dua admin bersamaan)
				if (imageUrl) await deleteImage(imageUrl); // jangan tinggalkan file yatim
				if (dbErrno(e) === 1062) {
					const errors: BundleFormErrors = { name: ['Nama paket sudah dipakai, coba lagi.'] };
					return fail(400, { errors, values: raw });
				}
				throw e;
			}
		}

		throw redirect(303, '/admin/bundling');
	}
};
