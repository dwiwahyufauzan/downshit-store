/**
 * Logika login bersama untuk DUA pintu masuk yang terpisah:
 *  - `customer` → `/login`        (hanya akun role `konsumen`)
 *  - `staff`    → `/staff/login`  (hanya akun role `admin` & `owner`)
 *
 * Kedua pintu memakai pemeriksaan yang sama (rate limit, Argon2 dummy anti user-enumeration, sesi),
 * tetapi sesi TIDAK dibuat bila akun masuk lewat pintu yang salah.
 */
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { users } from '#lib/server/db/schema';
import { createSession, homeFor, verifyDummy, verifyPassword } from '#lib/server/auth';
import { safeNext } from '#lib/server/redirect';
import { loginSchema } from '#lib/schemas/auth';
import { clearFailures, clientIp, recordFailure, tooManyAttempts } from '#lib/server/rate-limit';
import { logActivity } from '#lib/server/activity';

export type Portal = 'customer' | 'staff';
type Role = 'owner' | 'admin' | 'konsumen';

export const LOGIN_PATH: Record<Portal, string> = {
	customer: '/login',
	staff: '/staff/login'
};

/** Pintu masuk yang benar untuk sebuah role. */
export const portalOf = (role: Role): Portal => (role === 'konsumen' ? 'customer' : 'staff');

/** Halaman login tempat pengguna dengan role ini seharusnya masuk (dipakai redirect & logout). */
export const loginPathFor = (role: Role) => LOGIN_PATH[portalOf(role)];

// Staf hanya boleh diarahkan kembali ke area stafnya, bukan ke halaman toko
const STAFF_NEXT = /^\/(admin|owner)(\/|\?|#|$)/;

export async function performLogin(
	event: Pick<RequestEvent, 'request' | 'cookies' | 'url' | 'getClientAddress'>,
	portal: Portal
) {
	const { request, cookies, url, getClientAddress } = event;
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

	// Kredensial benar, tetapi lewat pintu yang salah → tidak ada sesi yang dibuat
	if (portalOf(user.role) !== portal) {
		if (portal === 'staff') {
			// Portal staf tidak boleh membocorkan bahwa email itu akun pelanggan → pesan generik + dihitung gagal
			await recordFailure(rateLimitKey);
			await recordFailure(ipKey);
			return fail(400, { message: 'Email atau password tidak sesuai.', email });
		}
		return fail(403, {
			message: 'Akun staf tidak dapat masuk lewat halaman pelanggan. Silakan gunakan portal staf.',
			wrongPortal: true,
			email
		});
	}

	await clearFailures(rateLimitKey);
	await createSession(user.id, cookies);
	logActivity(user.id, 'auth.login', 'user', user.id, `${user.name} berhasil login`);

	// BR-24: password sementara wajib diganti dulu
	if (user.mustChangePassword) redirect(303, '/profil?wajib=1');

	const next = url.searchParams.get('next');
	const allowedNext = portal === 'staff' && next && !STAFF_NEXT.test(next) ? null : next;
	redirect(303, safeNext(allowedNext, homeFor(user.role)));
}
