import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { createSession, hashPassword, homeFor } from '$lib/server/auth';
import { registerSchema } from '$lib/schemas/auth';
import { logActivity } from '$lib/server/activity';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

type RegisterFieldErrors = {
	name?: string[];
	email?: string[];
	phone?: string[];
	password?: string[];
	confirmPassword?: string[];
};

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) {
		redirect(303, homeFor(locals.user.role));
	}
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const raw = Object.fromEntries(await request.formData());
		const values = {
			name: String(raw.name ?? ''),
			email: String(raw.email ?? ''),
			phone: String(raw.phone ?? '')
		};

		// Batasi pendaftaran massal: 10 permintaan per IP per menit (TC-002-07; di memori)
		if (rateLimit(`register|${clientIp(getClientAddress)}`, 10, 60_000)) {
			return fail(429, {
				errors: {} as RegisterFieldErrors,
				values,
				message: 'Terlalu banyak permintaan dari jaringan ini. Coba lagi sebentar lagi.'
			});
		}

		// Field `role` dari klien diabaikan: tidak ada di skema (BR-02)
		const parsed = registerSchema.safeParse(raw);

		if (!parsed.success) {
			const errors: RegisterFieldErrors = parsed.error.flatten().fieldErrors;
			return fail(400, {
				errors,
				values
			});
		}

		const { name, email, phone, password } = parsed.data;

		// Periksa apakah email sudah terdaftar
		const [exists] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		if (exists) {
			const errors: RegisterFieldErrors = {
				email: ['Email sudah terdaftar']
			};
			return fail(400, {
				errors,
				values
			});
		}

		const passwordHash = await hashPassword(password);

		let newUser: typeof users.$inferSelect;
		try {
			[newUser] = await db
				.insert(users)
				.values({
					name,
					email,
					phone: phone || null,
					passwordHash,
					role: 'konsumen'
				})
				.returning();
		} catch (e) {
			// Dua pendaftaran bersamaan dengan email sama: indeks unik menang
			if ((e as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) {
				const errors: RegisterFieldErrors = { email: ['Email sudah terdaftar'] };
				return fail(400, { errors, values });
			}
			throw e;
		}

		await logActivity(
			newUser.id,
			'auth.register',
			'user',
			newUser.id,
			`Pendaftaran konsumen baru: ${name}`
		);

		await createSession(newUser.id, cookies);

		redirect(303, '/produk');
	}
};
