import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '#lib/server/db';
import { bundles } from '#lib/server/db/schema';
import { addToCart } from '#lib/server/cart';
import { getBundleDetail } from '#lib/server/catalog';
import type { Actions, PageServerLoad } from './$types';

const addSchema = z.object({
	qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(99, 'Jumlah maksimal 99')
});

export const load: PageServerLoad = async ({ params, locals }) => {
	const detail = await getBundleDetail(params.slug);
	if (!detail) throw error(404, 'Paket bundling tidak ditemukan');

	return { ...detail, isKonsumen: locals.user?.role === 'konsumen', user: locals.user };
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
