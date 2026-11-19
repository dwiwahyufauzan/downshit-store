import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '#lib/server/db';
import { bundleItems, bundles, products } from '#lib/server/db/schema';
import { addToCart } from '#lib/server/cart';
import { getSettings } from '#lib/server/settings';
import { getSizes } from '#lib/server/sizes';
import { effectiveBundleStock } from '#lib/utils/bundle';
import type { Actions, PageServerLoad } from './$types';

const addSchema = z.object({
	qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(99, 'Jumlah maksimal 99')
});

export const load: PageServerLoad = async ({ params, locals }) => {
	const slug = params.slug;

	const [b] = await db
		.select({
			id: bundles.id,
			name: bundles.name,
			slug: bundles.slug,
			price: bundles.price,
			stock: bundles.stock,
			description: bundles.description,
			imageUrl: bundles.imageUrl,
			isActive: bundles.isActive
		})
		.from(bundles)
		.where(and(eq(bundles.slug, slug), eq(bundles.isActive, true), isNull(bundles.deletedAt)))
		.limit(1);

	if (!b) {
		throw error(404, 'Paket bundling tidak ditemukan');
	}

	const comps = await db
		.select({
			id: bundleItems.id,
			quantity: bundleItems.quantity,
			productId: products.id,
			productName: products.name,
			productSlug: products.slug,
			productPrice: products.price,
			productStock: products.stock,
			productImage: products.imageUrl,
			productActive: products.isActive
		})
		.from(bundleItems)
		.innerJoin(products, eq(products.id, bundleItems.productId))
		.where(eq(bundleItems.bundleId, b.id));

	const normalPrice = comps.reduce((acc, c) => acc + (c.productPrice ?? 0) * c.quantity, 0);
	const savings = Math.max(0, normalPrice - b.price);

	const stockComponents = comps.map((c) => ({
		stock: c.productActive ? c.productStock : 0,
		qty: c.quantity
	}));
	const effStock = effectiveBundleStock(b.stock, stockComponents);

	const { lowStock } = await getSettings();

	// Komponen ber-ukuran: pelanggan wajib memilih ukuran tiap komponen (stok per ukuran)
	const components = comps.map((c) => ({ ...c, sizes: getSizes(db, c.productId) }));

	return {
		bundle: b,
		lowStock,
		components,
		normalPrice,
		savings,
		effectiveStock: effStock,
		isKonsumen: locals.user?.role === 'konsumen',
		user: locals.user
	};
};

export const actions: Actions = {
	tambah: async ({ request, locals, url, params }) => {
		if (!locals.user) {
			throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
		}

		if (locals.user.role !== 'konsumen') {
			return fail(403, {
				message: 'Hanya akun Konsumen yang dapat berbelanja dan menambah barang ke keranjang.'
			});
		}

		const formData = await request.formData();
		const parse = addSchema.safeParse({
			qty: formData.get('qty')
		});

		if (!parse.success) {
			return fail(400, {
				message: parse.error.issues[0]?.message ?? 'Jumlah tidak valid.'
			});
		}

		// paket dari slug halaman (bukan dari field form), hanya yang aktif & tidak terhapus
		const [bun] = await db
			.select({ id: bundles.id })
			.from(bundles)
			.where(
				and(eq(bundles.slug, params.slug), eq(bundles.isActive, true), isNull(bundles.deletedAt))
			)
			.limit(1);
		if (!bun) throw error(404, 'Paket bundling tidak ditemukan');
		const bundleId = bun.id;

		// Pilihan ukuran komponen "idProduk:UKURAN|idProduk:UKURAN"; divalidasi ulang di addToCart
		const sizes = String(formData.get('sizes') ?? '');
		const result = await addToCart(locals.user.id, 'bundle', bundleId, parse.data.qty, sizes);

		if (!result.ok) {
			return fail(400, { message: result.message });
		}

		return {
			success: true,
			message: 'Paket bundling berhasil ditambahkan ke keranjang belanja!',
			toastAction: { href: '/keranjang', label: 'Lihat keranjang' }
		};
	}
};
