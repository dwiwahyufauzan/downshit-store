import { fail, redirect } from '@sveltejs/kit';
import { homeFor } from '#lib/server/auth';
import { forgotPasswordSchema } from '#lib/schemas/auth';
import { mailEnabled } from '#lib/server/mail';
import { requestPasswordReset } from '#lib/server/password-reset';
import { clientIp, rateLimit } from '#lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, homeFor(locals.user.role));
	// tanpa email terkonfigurasi, halaman menunjukkan jalur cadangan (hubungi admin)
	return { mailEnabled: mailEnabled() };
};

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Email tidak valid' });
		}
		const { email } = parsed.data;

		// per jaringan DAN per email: mencegah banjir email ke satu korban maupun pemindaian massal
		if (
			rateLimit(`forgot-ip|${clientIp(getClientAddress)}`, 10, 15 * 60_000) ||
			rateLimit(`forgot-mail|${email}`, 3, 15 * 60_000)
		) {
			return fail(429, { error: 'Terlalu banyak permintaan. Coba lagi dalam 15 menit.', email });
		}

		await requestPasswordReset(email);
		// pesan sama untuk email terdaftar maupun tidak (tidak membocorkan daftar akun)
		return { sent: true, email };
	}
};
