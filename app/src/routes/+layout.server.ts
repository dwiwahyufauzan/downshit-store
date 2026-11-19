import { ORIGIN } from '$app/env/private';
import { db } from '#lib/server/db';
import { cartItems, carts } from '#lib/server/db/schema';
import { count, eq } from 'drizzle-orm';
import { getSettings } from '#lib/server/settings';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	let cartCount = 0;

	if (locals.user && locals.user.role === 'konsumen') {
		const [userCart] = await db
			.select({ id: carts.id })
			.from(carts)
			.where(eq(carts.userId, locals.user.id))
			.limit(1);

		if (userCart) {
			const [res] = await db
				.select({ total: count() })
				.from(cartItems)
				.where(eq(cartItems.cartId, userCart.id));
			cartCount = res?.total ?? 0;
		}
	}

	// Data toko untuk navbar & footer (bar pengumuman, kontak WhatsApp, rekening)
	const s = await getSettings();

	return {
		user: locals.user,
		// URL publik situs, dipakai untuk tautan kanonik & Open Graph (harus absolut)
		origin: ORIGIN ?? null,
		cartCount,
		store: {
			name: s.storeName,
			whatsapp: s.whatsapp,
			shippingCost: s.shippingCost,
			bankName: s.bankName
		}
	};
};
