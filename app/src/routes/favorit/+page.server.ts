import { fail } from '@sveltejs/kit';
import { requireRole } from '#lib/server/guards';
import { idParam } from '#lib/server/sql';
import { listWishlist, removeFromWishlist } from '#lib/server/wishlist';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = requireRole(locals, 'konsumen');
	return { items: listWishlist(user.id) };
};

export const actions: Actions = {
	hapus: async ({ request, locals }) => {
		const user = requireRole(locals, 'konsumen');
		const fd = await request.formData();
		const productId = idParam(String(fd.get('productId') ?? ''));
		if (!productId) return fail(400, { message: 'Produk tidak valid.' });

		// Hanya baris milik pengguna ini yang bisa terhapus (id produk dari form dicocokkan dengan user_id)
		removeFromWishlist(user.id, productId);
		return { success: true, message: 'Dihapus dari favorit.' };
	}
};
