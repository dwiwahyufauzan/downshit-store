import { fail } from '@sveltejs/kit';
import { requireUser } from '#lib/server/guards';
import { destroyOtherSessions, destroySessionById, listActiveSessions } from '#lib/server/auth';
import { logActivity } from '#lib/server/activity';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	return { sessions: await listActiveSessions(user.id, locals.sessionId) };
};

export const actions: Actions = {
	// Akhiri satu sesi lain (bukan yang sedang dipakai)
	akhiri: async ({ request, locals }) => {
		const user = requireUser(locals);
		const id = String((await request.formData()).get('id') ?? '');
		if (!/^[a-f0-9]{64}$/.test(id)) return fail(400, { message: 'Sesi tidak valid.' });

		if (!destroySessionById(user.id, id, locals.sessionId)) {
			return fail(404, { message: 'Sesi tidak ditemukan atau sedang kamu pakai.' });
		}
		await logActivity(
			user.id,
			'user.revoke_session',
			'user',
			user.id,
			'Mengakhiri satu sesi login'
		);
		return { success: true, message: 'Sesi berhasil diakhiri.' };
	},

	// Akhiri semua sesi lain; sesi sekarang tetap aktif
	akhiriLain: async ({ locals }) => {
		const user = requireUser(locals);
		if (!locals.sessionId) return fail(400, { message: 'Sesi tidak valid.' });

		const n = destroyOtherSessions(user.id, locals.sessionId);
		if (n > 0) {
			await logActivity(
				user.id,
				'user.revoke_other_sessions',
				'user',
				user.id,
				`Mengakhiri ${n} sesi login lain`
			);
		}
		return { success: true, message: n > 0 ? `${n} sesi lain diakhiri.` : 'Tidak ada sesi lain.' };
	}
};
