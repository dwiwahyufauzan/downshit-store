import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, desc, eq, gt, lt, ne } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { ORIGIN, SESSION_DAYS } from '$app/env/private';
import { db } from './db';
import { sessions, users } from './db/schema';
import type { SessionUser } from '../../app';

/**
 * Dua cookie sesi TERPISAH agar login pelanggan dan staf di peramban yang sama (mis. dua window)
 * tidak saling menimpa: pelanggan → `dws_session`, staf (admin/owner) → `dws_staff_session`.
 */
export type Portal = 'customer' | 'staff';
export const SESSION_COOKIE = 'dws_session';
export const STAFF_SESSION_COOKIE = 'dws_staff_session';
export const cookieNameOf = (portal: Portal) =>
	portal === 'staff' ? STAFF_SESSION_COOKIE : SESSION_COOKIE;

/** Pintu masuk yang benar untuk sebuah role. */
export const portalOf = (role: 'owner' | 'admin' | 'konsumen'): Portal =>
	role === 'konsumen' ? 'customer' : 'staff';

/** Area staf memakai cookie staf; seluruh halaman lain memakai cookie pelanggan. */
const STAFF_PATH = /^\/(admin|owner|staff)(\/|$)/;
export const portalOfPath = (path: string): Portal =>
	STAFF_PATH.test(path) ? 'staff' : 'customer';
const getDays = () => Number(SESSION_DAYS ?? 30);
/** Sesi staf (admin/owner) jauh lebih pendek daripada pelanggan: akun berhak akses besar & tanpa idle timeout. */
const STAFF_SESSION_HOURS = 12;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const hashPassword = (p: string) =>
	hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

export const verifyPassword = (hashed: string, p: string) => verify(hashed, p);

// Verifikasi palsu agar waktu respons login sama baik email terdaftar, akun nonaktif, maupun email asing
// (anti user-enumeration). Hash dihitung SEKALI saat modul dimuat, bukan saat login pertama.
const dummyHash: Promise<string> = hashPassword(randomBytes(16).toString('hex'));
export async function verifyDummy(p: string): Promise<false> {
	await verify(await dummyHash, p).catch(() => false);
	return false;
}

export async function createSession(userId: number, cookies: Cookies, portal: Portal = 'customer') {
	const token = randomBytes(32).toString('base64url');
	const lifetimeMs = portal === 'staff' ? STAFF_SESSION_HOURS * 3_600_000 : getDays() * 86_400_000;
	const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();

	await db.insert(sessions).values({
		id: sha256(token),
		userId,
		expiresAt
	});

	cookies.set(cookieNameOf(portal), token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: ORIGIN?.startsWith('https') ?? false,
		expires: new Date(expiresAt)
	});

	return token;
}

export async function validateSession(token: string): Promise<SessionUser | null> {
	const now = new Date().toISOString();
	const [row] = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			role: users.role,
			mustChangePassword: users.mustChangePassword,
			isActive: users.isActive
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now)))
		.limit(1);

	if (!row || !row.isActive) return null;

	const { isActive: _isActive, ...user } = row;
	return user as SessionUser;
}

export async function destroySession(token: string, cookies: Cookies, portal: Portal = 'customer') {
	await db.delete(sessions).where(eq(sessions.id, sha256(token)));
	cookies.delete(cookieNameOf(portal), { path: '/' });
}

export async function destroyAllSessions(userId: number) {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}

export type ActiveSession = { id: string; createdAt: string; expiresAt: string; current: boolean };

/** Sesi aktif milik pengguna (terbaru dulu). `current` menandai sesi pada token yang sedang dipakai. */
export async function listActiveSessions(
	userId: number,
	currentToken: string | null
): Promise<ActiveSession[]> {
	const now = new Date().toISOString();
	const rows = await db
		.select({ id: sessions.id, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
		.from(sessions)
		.where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
		.orderBy(desc(sessions.createdAt));
	const current = currentToken ? sha256(currentToken) : null;
	return rows.map((r) => ({ ...r, current: r.id === current }));
}

/** Akhiri satu sesi milik `userId`. Sesi yang sedang dipakai tidak bisa diakhiri di sini (pakai logout). */
export function destroySessionById(userId: number, id: string, currentToken: string | null) {
	if (currentToken && id === sha256(currentToken)) return false;
	const { changes } = db
		.delete(sessions)
		.where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
		.run();
	return changes > 0;
}

/** Akhiri semua sesi milik `userId` kecuali yang sedang dipakai. Mengembalikan jumlah sesi yang dihapus. */
export function destroyOtherSessions(userId: number, currentToken: string): number {
	return db
		.delete(sessions)
		.where(and(eq(sessions.userId, userId), ne(sessions.id, sha256(currentToken))))
		.run().changes;
}

export async function purgeExpiredSessions(): Promise<number> {
	const now = new Date().toISOString();
	return db.delete(sessions).where(lt(sessions.expiresAt, now)).run().changes;
}

export const homeFor = (role: 'owner' | 'admin' | 'konsumen') => {
	switch (role) {
		case 'admin':
			return '/admin';
		case 'owner':
			return '/owner';
		case 'konsumen':
		default:
			return '/produk';
	}
};
