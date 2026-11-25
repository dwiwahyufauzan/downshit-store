import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, destroySession } from '#lib/server/auth';
import { loginPathFor } from '#lib/server/login';
import type { RequestHandler } from './$types';

// Hanya POST (bukan GET) agar logout tidak bisa dipicu lewat <img src="/logout">; CSRF dijaga cek Origin.
export const POST: RequestHandler = async ({ cookies, locals }) => {
	// Staf kembali ke portal staf, pelanggan ke halaman masuk pelanggan
	const back = locals.user ? loginPathFor(locals.user.role) : '/login';
	if (locals.sessionId) {
		await destroySession(locals.sessionId, cookies);
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });
	redirect(303, back);
};
