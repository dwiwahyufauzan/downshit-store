import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { createSession, homeFor, verifyDummy, verifyPassword } from '$lib/server/auth';
import { safeNext } from '$lib/server/redirect';
import { loginSchema } from '$lib/schemas/auth';
import { clearFailures, clientIp, recordFailure, tooManyAttempts } from '$lib/server/rate-limit';
import { logActivity } from '$lib/server/activity';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) {
		redirect(303, homeFor(locals.user.role));
	}
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const formData = await request.formData();
		const raw = Object.fromEntries(formData);
		const parsed = loginSchema.safeParse(raw);

		if (!parsed.success) {
			return fail(400, {
				errors: parsed.error.flatten().fieldErrors,
				email: String(raw.email ?? '')
			});
		}

		const { email, password } = parsed.data;
		const ip = clientIp(getClientAddress);
		const rateLimitKey = `${email}|${ip}`;
		const ipKey = `ip|${ip}`;

		// 5 gagal per email+IP, atau 20 gagal per IP (menebak banyak email) dalam 15 menit
		if ((await tooManyAttempts(rateLimitKey)) || (await tooManyAttempts(ipKey, 20))) {
			return fail(429, {
				message: 'Terlalu banyak percobaan gagal. Silakan tunggu 15 menit lagi.',
				email
			});
		}

		const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

		// Akun nonaktif / email tak dikenal tetap menjalankan 1x verifikasi Argon2 (dummy) agar
		// waktu respons sama dan tidak membocorkan keberadaan akun (TC-001-14).
		const isValid =
			user && user.isActive
				? await verifyPassword(user.passwordHash, password)
				: await verifyDummy(password);

		if (!isValid) {
			await recordFailure(rateLimitKey);
			await recordFailure(ipKey);
			return fail(400, {
				message: 'Email atau password tidak sesuai.',
				email
			});
		}

		await clearFailures(rateLimitKey);
		await createSession(user.id, cookies);
		logActivity(user.id, 'auth.login', 'user', user.id, `${user.name} berhasil login`);

		// BR-24: password sementara wajib diganti dulu
		if (user.mustChangePassword) redirect(303, '/profil?wajib=1');

		redirect(303, safeNext(url.searchParams.get('next'), homeFor(user.role)));
	}
};
