import { fail, redirect } from '@sveltejs/kit';
import { homeFor } from '#lib/server/auth';
import { resetPasswordSchema } from '#lib/schemas/auth';
import { isResetTokenValid, resetPasswordWithToken } from '#lib/server/password-reset';
import { clientIp, rateLimit } from '#lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	if (locals.user) redirect(303, homeFor(locals.user.role));
	return { valid: isResetTokenValid(params.token) };
};

export const actions: Actions = {
	default: async ({ request, params, getClientAddress }) => {
		// token 256-bit tidak bisa ditebak; batas ini hanya meredam skrip yang menghujani endpoint
		if (rateLimit(`reset|${clientIp(getClientAddress)}`, 10, 15 * 60_000)) {
			return fail(429, { error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
		}

		const parsed = resetPasswordSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) {
			return fail(400, { errors: parsed.error.flatten().fieldErrors });
		}

		const ok = await resetPasswordWithToken(params.token, parsed.data.password);
		if (!ok) {
			return fail(400, { error: 'Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.' });
		}
		redirect(303, '/login?reset=1');
	}
};
