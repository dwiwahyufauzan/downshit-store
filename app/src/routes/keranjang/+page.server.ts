import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireRole } from '#lib/server/guards';
import {
	clearCart,
	getCartDetails,
	removeCartItem,
	updateCartItemQuantity
} from '#lib/server/cart';
import { getSettings } from '#lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

const updateSchema = z.object({
	itemId: z.coerce.number().int().positive('ID item tidak valid'),
	qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(99, 'Jumlah maksimal 99')
});

const deleteSchema = z.object({
	itemId: z.coerce.number().int().positive('ID item tidak valid')
});

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	}

	requireRole(locals, 'konsumen');

	const [cart, settings] = await Promise.all([getCartDetails(locals.user.id), getSettings()]);

	const hasProblem = cart.items.some((item) => !item.isAvailable);
	const shippingCost = settings.shippingCost ?? 0;

	return {
		cart,
		settings,
		hasProblem,
		shippingCost,
		estimatedTotal: cart.subtotal + (cart.items.length > 0 ? shippingCost : 0)
	};
};

export const actions: Actions = {
	ubah: async ({ request, locals }) => {
		requireRole(locals, 'konsumen');

		const formData = await request.formData();
		const parse = updateSchema.safeParse({
			itemId: formData.get('itemId'),
			qty: formData.get('qty')
		});

		if (!parse.success) {
			return fail(400, {
				message: parse.error.issues[0]?.message ?? 'Input tidak valid.'
			});
		}

		const result = await updateCartItemQuantity(locals.user!.id, parse.data.itemId, parse.data.qty);

		if (!result.ok) {
			return fail(400, { message: result.message });
		}

		return { success: true, message: 'Jumlah keranjang berhasil diperbarui' };
	},

	hapus: async ({ request, locals }) => {
		requireRole(locals, 'konsumen');

		const formData = await request.formData();
		const parse = deleteSchema.safeParse({
			itemId: formData.get('itemId')
		});

		if (!parse.success) {
			return fail(400, { message: 'ID item tidak valid' });
		}

		await removeCartItem(locals.user!.id, parse.data.itemId);
		return { success: true, message: 'Item berhasil dihapus dari keranjang' };
	},

	kosongkan: async ({ locals }) => {
		requireRole(locals, 'konsumen');
		await clearCart(locals.user!.id);
		return { success: true, message: 'Keranjang belanja telah dikosongkan' };
	}
};
