import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, transact } from '$lib/server/db';
import { bundleItems, bundles, products } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { bundleUpdateSchema } from '$lib/schemas/bundle';
import { deleteImage, saveImage } from '$lib/server/upload';
import { deleteImageIfUnused } from '$lib/server/image-refs';
import { idParam } from '$lib/server/sql';
import { logActivity } from '$lib/server/activity';
import { BundleRuleError, checkBundleComponents } from '$lib/server/bundle-validate';

export type BundleEditFormErrors = {
	name?: string[];
	description?: string[];
	price?: string[];
	items?: string[];
	image?: string[];
	isActive?: string[];
};

export const load = async ({ params, locals }) => {
	requireRole(locals, 'admin');
	const id = idParam(params.id);
	if (!id) throw error(404, 'Paket bundling tidak ditemukan');

	const [b] = await db.select().from(bundles).where(eq(bundles.id, id)).limit(1);
	if (!b || b.deletedAt) throw error(404, 'Paket bundling tidak ditemukan');

	const items = await db
		.select({
			productId: bundleItems.productId,
			quantity: bundleItems.quantity
		})
		.from(bundleItems)
		.where(eq(bundleItems.bundleId, id));

	// Pilihan = produk bundleable aktif + komponen yang sudah ada (walau kini nonaktif, supaya pilihan tidak kosong)
	const currentIds = items.map((i) => i.productId);
	const availableProducts = (
		await db
			.select({
				id: products.id,
				name: products.name,
				price: products.price,
				stock: products.stock,
				isActive: products.isActive,
				isBundleable: products.isBundleable
			})
			.from(products)
			.where(
				and(
					isNull(products.deletedAt),
					or(
						and(eq(products.isBundleable, true), eq(products.isActive, true)),
						currentIds.length ? inArray(products.id, currentIds) : undefined
					)
				)
			)
			.orderBy(products.name)
	).map((p) => ({ ...p, available: p.isActive && p.isBundleable }));

	return {
		bundle: b,
		bundleItems: items,
		products: availableProducts
	};
};

export const actions = {
	default: async ({ params, request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const id = idParam(params.id);
		if (!id) throw error(404, 'Paket bundling tidak ditemukan');

		const [b] = await db.select().from(bundles).where(eq(bundles.id, id)).limit(1);
		if (!b || b.deletedAt) throw error(404, 'Paket bundling tidak ditemukan');

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
			isActive: fd.get('isActive') === 'on',
			items: rawItems
		};

		const parsed = bundleUpdateSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: BundleEditFormErrors = parsed.error.flatten()
				.fieldErrors as BundleEditFormErrors;
			return fail(400, {
				errors,
				values: raw
			});
		}

		const d = parsed.data;

		const existingIds = db
			.select({ productId: bundleItems.productId })
			.from(bundleItems)
			.where(eq(bundleItems.bundleId, id))
			.all()
			.map((r) => r.productId);

		const bad = checkBundleComponents(
			db,
			d.items.map((i) => i.productId),
			existingIds
		);
		if (bad) return fail(400, { message: bad, values: raw });

		let newImageUrl: string | null = b.imageUrl;
		let oldImageToDelete: string | null = null;
		let uploadedUrl: string | null = null;

		const file = fd.get('image');
		if (file instanceof File && file.size > 0) {
			const up = await saveImage(file, 'bundles');
			if (!up.ok) {
				const errors: BundleEditFormErrors = { image: [up.message] };
				return fail(400, { errors, values: raw });
			}
			newImageUrl = up.url;
			uploadedUrl = up.url;
			oldImageToDelete = b.imageUrl;
		} else if (fd.get('removeImage') === 'on' && b.imageUrl) {
			newImageUrl = null;
			oldImageToDelete = b.imageUrl;
		}

		try {
			// Atomik: ubah paket + ganti komponen (stok/kuota TIDAK disentuh, BR-19)
			await transact((tx) => {
				const again = checkBundleComponents(
					tx,
					d.items.map((i) => i.productId),
					existingIds
				);
				if (again) throw new BundleRuleError(again);

				tx.update(bundles)
					.set({
						name: d.name,
						description: d.description ?? null,
						price: d.price,
						imageUrl: newImageUrl,
						isActive: d.isActive
					})
					.where(eq(bundles.id, id))
					.run();

				tx.delete(bundleItems).where(eq(bundleItems.bundleId, id)).run();
				tx.insert(bundleItems)
					.values(
						d.items.map((it) => ({
							bundleId: id,
							productId: it.productId,
							quantity: it.quantity
						}))
					)
					.run();

				logActivity(
					admin.id,
					'bundle.update',
					'bundle',
					id,
					`Paket bundling diubah: ${d.name} (${d.items.length} item)`,
					tx
				);
			});
		} catch (e: unknown) {
			if (uploadedUrl) await deleteImage(uploadedUrl);
			if (e instanceof BundleRuleError) return fail(400, { message: e.message, values: raw });
			throw e;
		}

		// Foto lama dibuang setelah DB berhasil
		if (oldImageToDelete) await deleteImageIfUnused(oldImageToDelete);

		throw redirect(303, '/admin/bundling');
	}
};
