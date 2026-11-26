import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireRole } from '#lib/server/guards';
import {
	clearCart,
	getCartDetails,
	removeCartItem,
	setAllCartItemsSelected,
	setCartItemSelected,
	updateCartItemQuantity
} from '#lib/server/cart';
import { getSettings } from '#lib/server/settings';
import { shippingApiEnabled } from '#lib/server/shipping';
import type { Actions, PageServerLoad } from './$types';

const updateSchema = z.object({
	itemId: z.coerce.number().int().positive('ID item tidak valid'),
	qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(99, 'Jumlah maksimal 99')
});

const deleteSchema = z.object({
	itemId: z.coerce.number().int().positive('ID item tidak valid')
});

const selectSchema = z.object({
	itemId: z.coerce.number().int().positive('ID item tidak valid'),
	selected: z.enum(['1', '0'])
});

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	}

	requireRole(locals, 'konsumen');

	const [cart, settings] = await Promise.all([getCartDetails(locals.user.id), getSettings()]);

	// baris bermasalah yang TIDAK dicentang tidak menghalangi checkout
	const hasProblem = cart.items.some((item) => !item.isAvailable);
	const hasSelectedProblem = cart.items.some((item) => item.isSelected && !item.isAvailable);
	const selectedCount = cart.items.filter((item) => item.isSelected).length;
	const shippingCost = settings.shippingCost ?? 0;

	return {
		cart,
		settings,
		hasProblem,
		hasSelectedProblem,
		shippingApi: shippingApiEnabled(settings),
		selectedCount,
		shippingCost,
		estimatedTotal: cart.subtotal + (cart.selectedUnits > 0 ? shippingCost : 0)
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

	pilih: async ({ request, locals }) => {
		requireRole(locals, 'konsumen');

		const formData = await request.formData();
		const parse = selectSchema.safeParse({
			itemId: formData.get('itemId'),
			selected: formData.get('selected')
		});

		if (!parse.success) {
			return fail(400, { message: 'Pilihan item tidak valid' });
		}

		await setCartItemSelected(locals.user!.id, parse.data.itemId, parse.data.selected === '1');
		return { success: true };
	},

	pilihSemua: async ({ request, locals }) => {
		requireRole(locals, 'konsumen');

		const formData = await request.formData();
		await setAllCartItemsSelected(locals.user!.id, formData.get('selected') === '1');
		return { success: true };
	},

	kosongkan: async ({ locals }) => {
		requireRole(locals, 'konsumen');
		await clearCart(locals.user!.id);
		return { success: true, message: 'Keranjang belanja telah dikosongkan' };
	}
};
