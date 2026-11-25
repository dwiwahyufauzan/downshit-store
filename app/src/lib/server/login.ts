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
import {
	createSession,
	cookieNameOf,
	destroySession,
	homeFor,
	portalOf,
	verifyDummy,
	verifyPassword,
	type Portal
} from '#lib/server/auth';
import { safeNext } from '#lib/server/redirect';
import { loginSchema } from '#lib/schemas/auth';
import { clearFailures, clientIp, recordFailure, tooManyAttempts } from '#lib/server/rate-limit';
import { logActivity } from '#lib/server/activity';

export type { Portal };
type Role = 'owner' | 'admin' | 'konsumen';

export const LOGIN_PATH: Record<Portal, string> = {
	customer: '/login',
	staff: '/staff/login'
};

export { portalOf };

/** Halaman profil per role: staf punya halaman sendiri di dalam area admin/owner (tema & cookie staf). */
export const profilePathFor = (role: Role) =>
	role === 'admin' ? '/admin/profil' : role === 'owner' ? '/owner/profil' : '/profil';

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
	await createSession(user.id, cookies, portal);
	logActivity(user.id, 'auth.login', 'user', user.id, `${user.name} berhasil login`);

	// BR-24: password sementara wajib diganti dulu
	if (user.mustChangePassword) redirect(303, profilePathFor(user.role) + '?wajib=1');

	const next = url.searchParams.get('next');
	const allowedNext = portal === 'staff' && next && !STAFF_NEXT.test(next) ? null : next;
	redirect(303, safeNext(allowedNext, homeFor(user.role)));
}

/** Logout bersama: hanya menghapus sesi milik portal yang bersangkutan, sesi portal lain tetap utuh. */
export async function performLogout(
	event: Pick<RequestEvent, 'cookies' | 'locals'>,
	portal: Portal
): Promise<never> {
	const { cookies, locals } = event;
	if (locals.sessionId) await destroySession(locals.sessionId, cookies, portal);
	// Sesi kedaluwarsa/akun nonaktif: sessionId null, cookie basi tetap harus dibersihkan
	cookies.delete(cookieNameOf(portal), { path: '/' });
	redirect(303, LOGIN_PATH[portal]);
}
