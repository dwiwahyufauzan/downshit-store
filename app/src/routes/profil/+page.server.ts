import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/guards';
import {
	createSession,
	destroyAllSessions,
	hashPassword,
	homeFor,
	verifyPassword
} from '$lib/server/auth';
import { changePasswordSchema, profileSchema } from '$lib/schemas/auth';
import { rateLimit } from '$lib/server/rate-limit';
import { logActivity } from '$lib/server/activity';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const sessionUser = requireUser(locals);

	const [userData] = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			phone: users.phone,
			address: users.address,
			role: users.role,
			mustChangePassword: users.mustChangePassword,
			createdAt: users.createdAt
		})
		.from(users)
		.where(eq(users.id, sessionUser.id))
		.limit(1);

	return {
		profile: userData
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const sessionUser = requireUser(locals);
		const parsed = profileSchema.safeParse(Object.fromEntries(await request.formData()));

		if (!parsed.success) {
			const profileErrors = parsed.error.flatten().fieldErrors;
			return fail(400, {
				profileErrors,
				profileError: Object.values(profileErrors).flat()[0] ?? 'Data profil tidak valid'
			});
		}

		const { name, phone, address } = parsed.data;

		await db
			.update(users)
			.set({
				name,
				phone: phone || null,
				address: address || null,
				updatedAt: new Date().toISOString()
			})
			.where(eq(users.id, sessionUser.id));

		await logActivity(
			sessionUser.id,
			'user.update_profile',
			'user',
			sessionUser.id,
			`Pembaruan profil oleh ${name}`
		);

		return { profileSuccess: true };
	},

	updatePassword: async ({ request, locals, cookies }) => {
		const sessionUser = requireUser(locals);
		if (rateLimit(`pwd|${sessionUser.id}`, 5, 15 * 60_000)) {
			return fail(429, {
				passwordError: 'Terlalu banyak percobaan ganti password. Coba lagi dalam 15 menit.'
			});
		}

		const raw = Object.fromEntries(await request.formData());
		const parsed = changePasswordSchema.safeParse(raw);

		if (!parsed.success) {
			return fail(400, {
				passwordErrors: parsed.error.flatten().fieldErrors
			});
		}

		const [userRecord] = await db
			.select({ passwordHash: users.passwordHash })
			.from(users)
			.where(eq(users.id, sessionUser.id))
			.limit(1);

		const validOld = await verifyPassword(userRecord.passwordHash, parsed.data.currentPassword);

		if (!validOld) {
			return fail(400, {
				passwordError: 'Password saat ini yang Anda masukkan salah'
			});
		}

		const newHash = await hashPassword(parsed.data.newPassword);

		await db
			.update(users)
			.set({
				passwordHash: newHash,
				mustChangePassword: false,
				updatedAt: new Date().toISOString()
			})
			.where(eq(users.id, sessionUser.id));

		// Revoke semua sesi lama dan terbitkan sesi baru
		await destroyAllSessions(sessionUser.id);
		await createSession(sessionUser.id, cookies);

		await logActivity(
			sessionUser.id,
			'auth.change_password',
			'user',
			sessionUser.id,
			'Password berhasil diubah'
		);

		// Password sementara sudah diganti → lanjut ke beranda sesuai role (BR-24)
		if (sessionUser.mustChangePassword) redirect(303, homeFor(sessionUser.role));

		return { passwordSuccess: true };
	}
};
