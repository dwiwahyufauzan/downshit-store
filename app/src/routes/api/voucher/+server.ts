import { error, json } from '@sveltejs/kit';
import { requireRole } from '#lib/server/guards';
import { db } from '#lib/server/db';
import { getCartDetails } from '#lib/server/cart';
import { checkVoucher } from '#lib/server/vouchers';
import { rateLimit } from '#lib/server/rate-limit';
import type { RequestHandler } from './$types';

/**
 * Pratinjau potongan voucher untuk item keranjang yang dicentang:
 *   GET /api/voucher?code=HEMAT10 → { ok, code?, discount?, message? }
 * Hanya tampilan; checkout memeriksa ulang dan mengambil kuota di dalam transaksi pesanan.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const user = requireRole(locals, 'konsumen');
	// dibatasi agar kode voucher tidak bisa ditebak lewat skrip
	if (rateLimit(`voucher|${user.id}`, 20, 60_000)) throw error(429, 'Terlalu banyak percobaan');

	const code = url.searchParams.get('code') ?? '';
	const cart = await getCartDetails(user.id);
	const r = checkVoucher(db, code, user.id, cart.subtotal);
	return json(
		r.ok
			? { ok: true, code: r.voucher.code, discount: r.discount, description: r.voucher.description }
			: { ok: false, message: r.message },
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
