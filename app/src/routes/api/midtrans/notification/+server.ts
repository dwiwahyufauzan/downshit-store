import { error, json } from '@sveltejs/kit';
import { applyGatewayStatus } from '#lib/server/gateway-payments';
import {
	getTransactionStatus,
	isGatewayConfigured,
	verifySignature,
	type MidtransStatus
} from '#lib/server/midtrans';
import type { RequestHandler } from './$types';

/**
 * Notifikasi HTTP Midtrans (Settings → Configuration → Payment Notification URL):
 *   https://<domain>/api/midtrans/notification
 *
 * 1) tanda tangan SHA512 diverifikasi (hanya Midtrans yang tahu Server Key), lalu
 * 2) status DIAMBIL ULANG dari Status API dan itu yang diterapkan, bukan isi notifikasi.
 * Balasan 200 menghentikan percobaan ulang Midtrans; 5xx membuat Midtrans mencoba lagi.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isGatewayConfigured()) throw error(404, 'Not found');

	let body: Partial<MidtransStatus>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Body bukan JSON');
	}

	// Body harus objek dengan order_id string; selain itu 400 (bukan 500 karena TypeError)
	if (!body || typeof body !== 'object' || typeof body.order_id !== 'string') {
		throw error(400, 'Body notifikasi tidak valid');
	}
	if (!body.order_id || !verifySignature(body)) {
		throw error(403, 'Tanda tangan tidak valid');
	}

	let status: MidtransStatus | null;
	try {
		status = await getTransactionStatus(body.order_id);
	} catch (e) {
		console.error('[midtrans] gagal membaca status', body.order_id, (e as Error).message);
		throw error(503, 'Gagal memverifikasi status, coba lagi'); // Midtrans akan mengirim ulang
	}
	if (!status) return json({ ok: true, ignored: 'transaksi tidak ditemukan' });

	const result = await applyGatewayStatus(status);
	return json({ ok: true, result });
};
