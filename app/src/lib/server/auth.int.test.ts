/**
 * Tes integrasi autentikasi & sesi (SRS-F-001, BR-01/02/24, SRS-NF-004).
 * Memakai SALINAN DB tes milik berkas ini sendiri (tests/.tmp-test-auth-<pid>.db) supaya tidak bentrok
 * dengan tes integrasi lain yang mengosongkan tabel `users`/`sessions` di DB bersama.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const own = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { writeFileSync } = require('node:fs') as typeof import('node:fs');
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const Database = require('better-sqlite3') as typeof import('better-sqlite3');
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const path = require('node:path') as typeof import('node:path');
	const src = new Database(process.env.TEST_DB_PATH!, { readonly: true });
	const file = path.resolve(`tests/.tmp-test-auth-${process.pid}.db`);
	writeFileSync(file, src.serialize());
	src.close();
	process.env.TEST_DB_PATH = file;
	return { file };
});

import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { activityLogs, loginAttempts, sessions, users } from './db/schema';
import {
	SESSION_COOKIE,
	createSession,
	destroyAllSessions,
	destroyOtherSessions,
	destroySessionById,
	destroySession,
	hashPassword,
	homeFor,
	listActiveSessions,
	purgeExpiredSessions,
	validateSession,
	verifyDummy,
	verifyPassword
} from './auth';
import {
	clearFailures,
	clientIp,
	purgeOld,
	rateLimit,
	recordFailure,
	resetRateLimits,
	tooManyAttempts
} from './rate-limit';
import { requireRole, requireUser } from './guards';
import { loginPathFor, performLogin, type Portal } from './login';

function assertOwnDb() {
	const rows = db.all<{ file: string }>(sql`select file from pragma_database_list`);
	if (!rows.some((r) => r.file.includes('.tmp-test-auth-'))) {
		throw new Error('MENOLAK: bukan DB tes milik auth.int.test.ts');
	}
}

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(own.file + ext, { force: true });
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function fakeCookies() {
	const jar = new Map<string, { value: string; opts: Record<string, unknown> }>();
	return {
		jar,
		set: (name: string, value: string, opts: Record<string, unknown>) =>
			jar.set(name, { value, opts }),
		delete: (name: string) => jar.delete(name),
		get: (name: string) => jar.get(name)?.value
	};
}

let userId: number;

beforeEach(() => {
	assertOwnDb();
	for (const t of [activityLogs, sessions, loginAttempts, users]) db.delete(t).run();
	[{ userId }] = db
		.insert(users)
		.values({ name: 'Budi', email: 'budi@x.id', passwordHash: 'x', role: 'konsumen' })
		.returning({ userId: users.id })
		.all();
	resetRateLimits();
});

describe('hash password (Argon2id)', () => {
	it('menghasilkan hash argon2id yang bisa diverifikasi, dan menolak password salah', async () => {
		const h = await hashPassword('Rahasia123');
		expect(h.startsWith('$argon2id$')).toBe(true);
		expect(h).not.toContain('Rahasia123');
		expect(await verifyPassword(h, 'Rahasia123')).toBe(true);
		expect(await verifyPassword(h, 'rahasia123')).toBe(false);
	});
	it('verifyDummy selalu false (anti user-enumeration)', async () => {
		expect(await verifyDummy('apa-saja')).toBe(false);
	});
});

describe('sesi di database', () => {
	it('token acak 256-bit dikirim ke cookie, yang disimpan di DB hanya hash SHA-256', async () => {
		const cookies = fakeCookies();
		const token = await createSession(userId, cookies as never);
		const c = cookies.jar.get(SESSION_COOKIE)!;
		expect(c.value).toBe(token);
		expect(token.length).toBeGreaterThanOrEqual(43); // 32 byte base64url
		expect(c.opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
		const row = db.select().from(sessions).get()!;
		expect(row.id).toBe(sha256(token));
		expect(row.id).not.toBe(token);
		expect(db.select().from(sessions).where(eq(sessions.id, token)).get()).toBeUndefined();
	});

	it('validateSession: token valid → user; token asing/sampah → null', async () => {
		const token = await createSession(userId, fakeCookies() as never);
		expect(await validateSession(token)).toMatchObject({
			id: userId,
			email: 'budi@x.id',
			role: 'konsumen',
			mustChangePassword: false
		});
		expect(await validateSession('sampah')).toBeNull();
		expect(await validateSession('')).toBeNull();
	});

	it('sesi kedaluwarsa ditolak dan dibersihkan purgeExpiredSessions', async () => {
		const token = await createSession(userId, fakeCookies() as never);
		await createSession(userId, fakeCookies() as never);
		db.update(sessions)
			.set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
			.where(eq(sessions.id, sha256(token)))
			.run();
		expect(await validateSession(token)).toBeNull();
		expect(await purgeExpiredSessions()).toBe(1);
		expect(db.select().from(sessions).all()).toHaveLength(1);
	});

	it('akun dinonaktifkan → sesi langsung tidak valid', async () => {
		const token = await createSession(userId, fakeCookies() as never);
		db.update(users).set({ isActive: false }).where(eq(users.id, userId)).run();
		expect(await validateSession(token)).toBeNull();
	});

	it('flag mustChangePassword ikut dibawa ke sesi (BR-24)', async () => {
		const token = await createSession(userId, fakeCookies() as never);
		db.update(users).set({ mustChangePassword: true }).where(eq(users.id, userId)).run();
		expect((await validateSession(token))?.mustChangePassword).toBe(true);
	});

	it('destroySession menghapus satu sesi + cookie; destroyAllSessions menghapus semua milik user', async () => {
		const c1 = fakeCookies();
		const t1 = await createSession(userId, c1 as never);
		const t2 = await createSession(userId, fakeCookies() as never);
		await destroySession(t1, c1 as never);
		expect(c1.jar.has(SESSION_COOKIE)).toBe(false);
		expect(await validateSession(t1)).toBeNull();
		expect(await validateSession(t2)).not.toBeNull();
		await destroyAllSessions(userId);
		expect(await validateSession(t2)).toBeNull();
	});

	it('listActiveSessions: hanya sesi aktif milik user, menandai sesi yang sedang dipakai', async () => {
		const t1 = await createSession(userId, fakeCookies() as never);
		const t2 = await createSession(userId, fakeCookies() as never);
		const [{ otherId }] = db
			.insert(users)
			.values({ name: 'Sari', email: 'sari@x.id', passwordHash: 'x', role: 'konsumen' })
			.returning({ otherId: users.id })
			.all();
		await createSession(otherId, fakeCookies() as never);
		db.insert(sessions)
			.values({
				id: sha256('kedaluwarsa'),
				userId,
				expiresAt: new Date(Date.now() - 1000).toISOString()
			})
			.run();

		const list = await listActiveSessions(userId, t2);
		expect(list).toHaveLength(2);
		expect(list.filter((s) => s.current).map((s) => s.id)).toEqual([sha256(t2)]);
		expect(list.map((s) => s.id)).toContain(sha256(t1));
	});

	it('destroySessionById: hanya sesi lain milik user itu; sesi sendiri & milik orang lain ditolak', async () => {
		const t1 = await createSession(userId, fakeCookies() as never);
		const t2 = await createSession(userId, fakeCookies() as never);
		const [{ otherId }] = db
			.insert(users)
			.values({ name: 'Sari', email: 'sari@x.id', passwordHash: 'x', role: 'konsumen' })
			.returning({ otherId: users.id })
			.all();
		const t3 = await createSession(otherId, fakeCookies() as never);

		expect(destroySessionById(userId, sha256(t2), t2)).toBe(false); // sesi yang sedang dipakai
		expect(destroySessionById(userId, sha256(t3), t2)).toBe(false); // milik user lain
		expect(await validateSession(t3)).not.toBeNull();
		expect(destroySessionById(userId, sha256(t1), t2)).toBe(true);
		expect(await validateSession(t1)).toBeNull();
		expect(await validateSession(t2)).not.toBeNull();
	});

	it('destroyOtherSessions: menyisakan sesi sekarang dan tidak menyentuh user lain', async () => {
		await createSession(userId, fakeCookies() as never);
		await createSession(userId, fakeCookies() as never);
		const current = await createSession(userId, fakeCookies() as never);
		const [{ otherId }] = db
			.insert(users)
			.values({ name: 'Sari', email: 'sari@x.id', passwordHash: 'x', role: 'konsumen' })
			.returning({ otherId: users.id })
			.all();
		const theirs = await createSession(otherId, fakeCookies() as never);

		expect(destroyOtherSessions(userId, current)).toBe(2);
		expect(await validateSession(current)).not.toBeNull();
		expect(await validateSession(theirs)).not.toBeNull();
		expect(destroyOtherSessions(userId, current)).toBe(0);
	});
});

describe('rate limit', () => {
	it('login: 5 gagal / 15 menit untuk kunci yang sama, kunci lain tidak terpengaruh, clearFailures mereset', async () => {
		const key = 'budi@x.id|1.2.3.4';
		for (let i = 0; i < 4; i++) await recordFailure(key);
		expect(await tooManyAttempts(key)).toBe(false);
		await recordFailure(key);
		expect(await tooManyAttempts(key)).toBe(true);
		expect(await tooManyAttempts('lain@x.id|1.2.3.4')).toBe(false);
		await clearFailures(key);
		expect(await tooManyAttempts(key)).toBe(false);
	});

	it('login: percobaan di luar jendela 15 menit tidak dihitung; purgeOld menghapus > 24 jam', async () => {
		const key = 'a@x.id|1.1.1.1';
		for (let i = 0; i < 5; i++) await recordFailure(key);
		db.update(loginAttempts)
			.set({ createdAt: new Date(Date.now() - 16 * 60_000).toISOString() })
			.run();
		expect(await tooManyAttempts(key)).toBe(false);
		db.update(loginAttempts)
			.set({ createdAt: new Date(Date.now() - 25 * 3600_000).toISOString() })
			.run();
		expect(await purgeOld()).toBe(5);
	});

	it('rateLimit memori: blokir setelah max dalam jendela, kunci terpisah, longgar setelah jendela lewat', () => {
		vi.useFakeTimers();
		try {
			for (let i = 0; i < 10; i++) expect(rateLimit('register|1.1.1.1', 10, 60_000)).toBe(false);
			expect(rateLimit('register|1.1.1.1', 10, 60_000)).toBe(true); // TC-002-07: ke-11 ditolak
			expect(rateLimit('register|2.2.2.2', 10, 60_000)).toBe(false);
			vi.advanceTimersByTime(60_001);
			expect(rateLimit('register|1.1.1.1', 10, 60_000)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('clientIp tidak melempar bila getClientAddress gagal (ADDRESS_HEADER hilang)', () => {
		expect(clientIp(() => '9.9.9.9')).toBe('9.9.9.9');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(
			clientIp(() => {
				throw new Error('Address header was specified ... but is absent from request');
			})
		).toBe('unknown');
		warn.mockRestore();
	});
});

describe('guard & beranda per role', () => {
	const locals = (role: 'owner' | 'admin' | 'konsumen' | null) =>
		({
			user: role && { id: 1, name: 'x', email: 'x@x.id', role, mustChangePassword: false },
			sessionId: null
		}) as never;

	it('requireUser: tanpa login → redirect 303 /login?next=…', () => {
		let thrown: { status?: number; location?: string } = {};
		try {
			requireUser(locals(null), new URL('http://x/pesanan?a=1'));
		} catch (e) {
			thrown = e as typeof thrown;
		}
		expect(thrown.status).toBe(303);
		expect(thrown.location).toBe('/login?next=%2Fpesanan%3Fa%3D1');
	});

	it('requireRole: role salah → 403; role cocok → user', () => {
		expect(() => requireRole(locals('konsumen'), 'admin')).toThrow();
		try {
			requireRole(locals('konsumen'), 'admin', 'owner');
		} catch (e) {
			expect((e as { status: number }).status).toBe(403);
		}
		expect(requireRole(locals('admin'), 'admin').role).toBe('admin');
	});

	it('homeFor: konsumen /produk, admin /admin, owner /owner', () => {
		expect(homeFor('konsumen')).toBe('/produk');
		expect(homeFor('admin')).toBe('/admin');
		expect(homeFor('owner')).toBe('/owner');
	});
});

describe('portal login terpisah: pelanggan (/login) vs staf (/staff/login)', () => {
	const PASSWORD = 'Rahasia123';

	async function seedAccounts() {
		const passwordHash = await hashPassword(PASSWORD);
		for (const [name, email, role] of [
			['Citra', 'citra@x.id', 'konsumen'],
			['Adit', 'adit@x.id', 'admin'],
			['Olla', 'olla@x.id', 'owner']
		] as const) {
			db.insert(users).values({ name, email, passwordHash, role }).run();
		}
	}

	async function login(portal: Portal, email: string, password = PASSWORD, next?: string) {
		const cookies = fakeCookies();
		const event = {
			request: new Request('http://x/login', {
				method: 'POST',
				body: new URLSearchParams({ email, password })
			}),
			cookies,
			url: new URL(`http://x/login${next ? `?next=${encodeURIComponent(next)}` : ''}`),
			getClientAddress: () => '9.9.9.9'
		};
		try {
			const res = await performLogin(event as never, portal);
			return {
				kind: 'fail' as const,
				status: res.status,
				data: res.data as Record<string, unknown>,
				cookies
			};
		} catch (e) {
			const r = e as { status?: number; location?: string };
			if (r.location === undefined) throw e;
			return { kind: 'redirect' as const, status: r.status, location: r.location, cookies };
		}
	}

	it('pelanggan masuk lewat /login → sesi dibuat, diarahkan ke toko', async () => {
		await seedAccounts();
		const r = await login('customer', 'citra@x.id');
		expect(r).toMatchObject({ kind: 'redirect', status: 303, location: '/produk' });
		expect(r.cookies.jar.has(SESSION_COOKIE)).toBe(true);
	});

	it('akun staf di /login: ditolak (403) + petunjuk portal staf, TANPA sesi', async () => {
		await seedAccounts();
		for (const email of ['adit@x.id', 'olla@x.id']) {
			const r = await login('customer', email);
			expect(r).toMatchObject({ kind: 'fail', status: 403 });
			expect((r as { data: Record<string, unknown> }).data.wrongPortal).toBe(true);
			expect(r.cookies.jar.has(SESSION_COOKIE)).toBe(false);
		}
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});

	it('admin & owner masuk lewat /staff/login → ke dashboard masing-masing', async () => {
		await seedAccounts();
		const a = await login('staff', 'adit@x.id');
		expect(a).toMatchObject({ kind: 'redirect', status: 303, location: '/admin' });
		expect(a.cookies.jar.has(SESSION_COOKIE)).toBe(true);
		const o = await login('staff', 'olla@x.id');
		expect(o).toMatchObject({ kind: 'redirect', location: '/owner' });
	});

	it('staf: ?next ke area staf dihormati, ke halaman toko diabaikan', async () => {
		await seedAccounts();
		const ok = await login('staff', 'adit@x.id', PASSWORD, '/admin/pesanan');
		expect(ok).toMatchObject({ kind: 'redirect', location: '/admin/pesanan' });
		const toko = await login('staff', 'adit@x.id', PASSWORD, '/pesanan');
		expect(toko).toMatchObject({ kind: 'redirect', location: '/admin' });
	});

	it('akun pelanggan di /staff/login: pesan generik (tidak membocorkan akun), tanpa sesi, dihitung gagal', async () => {
		await seedAccounts();
		const r = await login('staff', 'citra@x.id');
		expect(r).toMatchObject({ kind: 'fail', status: 400 });
		expect((r as { data: Record<string, unknown> }).data).toMatchObject({
			message: 'Email atau password tidak sesuai.'
		});
		expect((r as { data: Record<string, unknown> }).data.wrongPortal).toBeUndefined();
		expect(r.cookies.jar.has(SESSION_COOKIE)).toBe(false);
		expect(await tooManyAttempts('citra@x.id|9.9.9.9', 1)).toBe(true);
	});

	it('password salah tetap ditolak di kedua portal', async () => {
		await seedAccounts();
		expect(await login('customer', 'citra@x.id', 'salah-banget1')).toMatchObject({
			kind: 'fail',
			status: 400
		});
		expect(await login('staff', 'adit@x.id', 'salah-banget1')).toMatchObject({
			kind: 'fail',
			status: 400
		});
	});

	it('loginPathFor: konsumen → /login, admin/owner → /staff/login', () => {
		expect(loginPathFor('konsumen')).toBe('/login');
		expect(loginPathFor('admin')).toBe('/staff/login');
		expect(loginPathFor('owner')).toBe('/staff/login');
	});

	it('requireRole khusus staf tanpa login → /staff/login; yang menyertakan konsumen → /login', () => {
		const nobody = { user: null, sessionId: null } as never;
		const loc = (fn: () => unknown) => {
			try {
				fn();
			} catch (e) {
				return (e as { location?: string }).location;
			}
		};
		expect(loc(() => requireRole(nobody, 'admin'))).toBe('/staff/login');
		expect(loc(() => requireRole(nobody, 'admin', 'owner'))).toBe('/staff/login');
		expect(loc(() => requireRole(nobody, 'konsumen'))).toBe('/login');
	});
});
