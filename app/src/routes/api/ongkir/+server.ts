import { error, json } from '@sveltejs/kit';
import { requireRole } from '#lib/server/guards';
import { getCartDetails } from '#lib/server/cart';
import { getSettings } from '#lib/server/settings';
import { getShippingOptions } from '#lib/server/shipping';
import { rateLimit } from '#lib/server/rate-limit';
import type { RequestHandler } from './$types';

/**
 * Pilihan layanan kirim untuk keranjang (item yang dicentang) menuju kode pos tertentu:
 *   GET /api/ongkir?postal=41211  →  { source, weightGrams, options: [{ id, label, price, etd }] }
 * Hanya untuk konsumen yang login. Harga di sini hanya tampilan: checkout menghitung ulang di server.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const user = requireRole(locals, 'konsumen');
	if (rateLimit(`ongkir|${user.id}`, 60, 60_000)) throw error(429, 'Terlalu banyak permintaan');

	const postal = url.searchParams.get('postal') ?? '';
	if (!/^[0-9]{5}$/.test(postal)) throw error(400, 'Kode pos harus 5 digit');

	const [cart, cfg] = await Promise.all([getCartDetails(user.id), getSettings()]);
	if (cart.selectedUnits === 0) throw error(400, 'Tidak ada item yang dipilih');

	const quote = await getShippingOptions(cfg, {
		postalCode: postal,
		weightGrams: cart.selectedWeight,
		value: cart.subtotal
	});
	return json(
		{ ...quote, weightGrams: cart.selectedWeight },
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
