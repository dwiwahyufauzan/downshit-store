import { json } from '@sveltejs/kit';
import { reportError } from '#lib/server/error-report';
import { clientIp, rateLimit } from '#lib/server/rate-limit';
import type { RequestHandler } from './$types';

const MAX_BODY = 4096;

/**
 * Galat JavaScript di peramban pengguna (dikirim hooks.client.ts lewat sendBeacon) diteruskan ke
 * log/Sentry server. Dibatasi ketat: tanpa login, jadi tiap bidang dipotong dan per IP maks. 10/menit.
 */
export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	if (rateLimit(`clienterr|${clientIp(getClientAddress)}`, 10, 60_000)) {
		return json({ ok: false }, { status: 429 });
	}
	const raw = await request.text();
	if (raw.length > MAX_BODY) return json({ ok: false }, { status: 413 });

	let body: { message?: unknown; stack?: unknown; path?: unknown };
	try {
		body = JSON.parse(raw);
	} catch {
		return json({ ok: false }, { status: 400 });
	}
	const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
	const err = new Error(cut(body.message, 300) || 'Galat klien tanpa pesan');
	err.name = 'ClientError';
	err.stack = cut(body.stack, 2000) || err.stack;

	// path saja: query string bisa memuat token/data pribadi
	const path = cut(body.path, 200).split('?')[0];
	void reportError(err, {
		source: 'client',
		path,
		requestId: locals.requestId,
		userId: locals.user?.id
	});
	return json({ ok: true }, { status: 202 });
};
