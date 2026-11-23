/**
 * Favorit (wishlist): toggle, batas, produk nonaktif, kepemilikan, dan route terkait.
 * Memakai salinan DB tes milik berkas ini sendiri (tests/.tmp-wishlist-*.db).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-wishlist-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads-wishlist',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import { db } from './db';
import { products, users, wishlists } from './db/schema';
import {
	MAX_WISHLIST,
	isWishlisted,
	listWishlist,
	removeFromWishlist,
	toggleWishlist
} from './wishlist';
import { resetRateLimits } from './rate-limit';
import * as produkDetail from '../../routes/produk/[slug]/+page.server';
import * as favorit from '../../routes/favorit/+page.server';

let aId: number; // konsumen A
let bId: number; // konsumen B
let adminId: number;
let kaosId: number;
let topiId: number;
let matiId: number; // nonaktif

function assertTestDb() {
	if (!/\.tmp-wishlist-/.test(env.file)) throw new Error('MENOLAK reset: bukan DB tes favorit');
}

beforeEach(() => {
	assertTestDb();
	resetRateLimits();
	db.delete(wishlists).run();
	db.delete(products).run();
	db.delete(users).run();
	const mkUser = (name: string, role: 'konsumen' | 'admin', email: string) =>
		db
			.insert(users)
			.values({ name, email, passwordHash: 'x', role })
			.returning({ id: users.id })
			.get().id;
	aId = mkUser('A', 'konsumen', 'a@x.id');
	bId = mkUser('B', 'konsumen', 'b@x.id');
	adminId = mkUser('Admin', 'admin', 'adm@x.id');
	const mk = (name: string, slug: string, extra: Partial<typeof products.$inferInsert> = {}) =>
		db
			.insert(products)
			.values({ name, slug, price: 100_000, stock: 5, ...extra })
			.returning({ id: products.id })
			.get().id;
	kaosId = mk('Kaos', 'kaos');
	topiId = mk('Topi', 'topi');
	matiId = mk('Mati', 'mati', { isActive: false });
});

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
});

const countOf = (uid: number) =>
	db.select().from(wishlists).where(eq(wishlists.userId, uid)).all().length;

describe('toggleWishlist', () => {
	it('menyimpan lalu menghapus (toggle), satu baris per pengguna+produk', () => {
		expect(toggleWishlist(aId, kaosId)).toEqual({ ok: true, saved: true });
		expect(isWishlisted(aId, kaosId)).toBe(true);
		expect(countOf(aId)).toBe(1);

		expect(toggleWishlist(aId, kaosId)).toEqual({ ok: true, saved: false });
		expect(isWishlisted(aId, kaosId)).toBe(false);
		expect(countOf(aId)).toBe(0);
	});

	it('favorit tiap pengguna terpisah', () => {
		toggleWishlist(aId, kaosId);
		expect(isWishlisted(bId, kaosId)).toBe(false);
		toggleWishlist(bId, kaosId);
		toggleWishlist(bId, kaosId); // B menghapus miliknya
		expect(isWishlisted(aId, kaosId)).toBe(true); // milik A tidak terpengaruh
	});

	it('produk nonaktif / terhapus / tidak ada tidak bisa ditambahkan', () => {
		expect(toggleWishlist(aId, matiId)).toMatchObject({ ok: false, reason: 'not_found' });
		db.update(products)
			.set({ deletedAt: '2026-01-01T00:00:00.000Z' })
			.where(eq(products.id, topiId))
			.run();
		expect(toggleWishlist(aId, topiId)).toMatchObject({ ok: false, reason: 'not_found' });
		expect(toggleWishlist(aId, 99_999)).toMatchObject({ ok: false, reason: 'not_found' });
		expect(countOf(aId)).toBe(0);
	});

	it('produk yang kemudian dinonaktifkan masih bisa dihapus dari daftar', () => {
		toggleWishlist(aId, kaosId);
		db.update(products).set({ isActive: false }).where(eq(products.id, kaosId)).run();
		expect(toggleWishlist(aId, kaosId)).toEqual({ ok: true, saved: false });
		expect(countOf(aId)).toBe(0);
	});

	it(`batas ${MAX_WISHLIST} favorit per pengguna`, () => {
		const rows = Array.from({ length: MAX_WISHLIST }, (_, i) => ({
			name: `P${i}`,
			slug: `p-${i}`,
			price: 1000,
			stock: 1
		}));
		const ids = db.insert(products).values(rows).returning({ id: products.id }).all();
		db.insert(wishlists)
			.values(ids.map((r) => ({ userId: aId, productId: r.id })))
			.run();

		expect(toggleWishlist(aId, kaosId)).toMatchObject({ ok: false, reason: 'limit' });
		expect(countOf(aId)).toBe(MAX_WISHLIST);
		// menghapus tetap bisa saat penuh
		expect(toggleWishlist(aId, ids[0].id)).toEqual({ ok: true, saved: false });
	});
});

describe('listWishlist & removeFromWishlist', () => {
	it('terbaru disimpan tampil dulu; produk nonaktif/terhapus tidak tampil', () => {
		db.insert(wishlists)
			.values([
				{ userId: aId, productId: kaosId, createdAt: '2026-11-01T00:00:00.000Z' },
				{ userId: aId, productId: topiId, createdAt: '2026-11-02T00:00:00.000Z' },
				{ userId: aId, productId: matiId, createdAt: '2026-11-03T00:00:00.000Z' } // nonaktif
			])
			.run();
		expect(listWishlist(aId).map((p) => p.name)).toEqual(['Topi', 'Kaos']);
		expect(listWishlist(bId)).toEqual([]);
	});

	it('removeFromWishlist hanya menghapus milik pengguna itu', () => {
		toggleWishlist(aId, kaosId);
		toggleWishlist(bId, kaosId);
		expect(removeFromWishlist(aId, kaosId)).toBe(true);
		expect(removeFromWishlist(aId, kaosId)).toBe(false);
		expect(isWishlisted(bId, kaosId)).toBe(true);
	});

	it('terhapus otomatis bersama produk dan bersama pengguna (cascade)', () => {
		toggleWishlist(aId, kaosId);
		toggleWishlist(aId, topiId);
		toggleWishlist(bId, topiId);
		db.delete(products).where(eq(products.id, kaosId)).run();
		expect(countOf(aId)).toBe(1);
		db.delete(users).where(eq(users.id, aId)).run();
		expect(countOf(aId)).toBe(0);
		expect(countOf(bId)).toBe(1);
	});
});

const U = (id: number, role: 'konsumen' | 'admin' = 'konsumen') =>
	({
		user: { id, role, name: 'x', email: 'x@x.id', mustChangePassword: false },
		sessionId: 's'
	}) as never;
const GUEST = { user: null, sessionId: null } as never;
const post = (qs: string, fields: Record<string, string> = {}) => {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return new Request(`http://x/produk/kaos${qs}`, { method: 'POST', body: fd });
};

describe('route: aksi ?/favorit di halaman produk', () => {
	const act = (locals: never, slug = 'kaos') =>
		produkDetail.actions.favorit({
			locals,
			params: { slug },
			url: new URL(`http://x/produk/${slug}`),
			request: post('')
		} as never) as Promise<{
			success?: boolean;
			message?: string;
			toastAction?: unknown;
			status?: number;
			data?: { message: string };
		}>;

	it('konsumen: simpan (dengan tautan "Lihat favorit") lalu hapus', async () => {
		const r1 = await act(U(aId));
		expect(r1).toMatchObject({
			success: true,
			message: 'Disimpan ke favorit.',
			toastAction: { href: '/favorit', label: 'Lihat favorit' }
		});
		expect(isWishlisted(aId, kaosId)).toBe(true);

		const r2 = await act(U(aId));
		expect(r2).toMatchObject({ success: true, message: 'Dihapus dari favorit.' });
		expect(r2.toastAction).toBeUndefined();
		expect(isWishlisted(aId, kaosId)).toBe(false);
	});

	it('tanpa login diarahkan ke login; admin ditolak 403; slug tak ada 404; produk nonaktif ditolak', async () => {
		await expect(act(GUEST)).rejects.toSatisfy((e) => isRedirect(e));
		expect(await act(U(adminId, 'admin'))).toMatchObject({ status: 403 });
		await expect(act(U(aId), 'tidak-ada')).rejects.toMatchObject({ status: 404 });
		expect(await act(U(aId), 'mati')).toMatchObject({ status: 404 });
		expect(countOf(aId)).toBe(0);
	});

	it('dibatasi 30 kali per menit per pengguna', async () => {
		for (let i = 0; i < 30; i++) await act(U(aId));
		expect(await act(U(aId))).toMatchObject({ status: 429 });
	});

	it('load detail: isWishlisted hanya untuk konsumen yang menyimpannya', async () => {
		toggleWishlist(aId, kaosId);
		const load = async (locals: never) =>
			(await produkDetail.load({
				params: { slug: 'kaos' },
				locals,
				url: new URL('http://x/produk/kaos')
			} as never)) as unknown as { isWishlisted: boolean };
		expect((await load(U(aId))).isWishlisted).toBe(true);
		expect((await load(U(bId))).isWishlisted).toBe(false);
		expect((await load(GUEST)).isWishlisted).toBe(false);
		expect((await load(U(adminId, 'admin'))).isWishlisted).toBe(false);
	});
});

describe('route: /favorit', () => {
	it('load: hanya konsumen; berisi favorit miliknya saja', async () => {
		toggleWishlist(aId, kaosId);
		toggleWishlist(bId, topiId);
		const r = (await favorit.load({ locals: U(aId) } as never)) as { items: { name: string }[] };
		expect(r.items.map((i) => i.name)).toEqual(['Kaos']);

		expect(() => favorit.load({ locals: GUEST } as never)).toThrow();
		try {
			favorit.load({ locals: GUEST } as never);
		} catch (e) {
			expect(isRedirect(e)).toBe(true);
		}
		expect(() => favorit.load({ locals: U(adminId, 'admin') } as never)).toThrowError(
			expect.objectContaining({ status: 403 })
		);
	});

	it('aksi hapus: menghapus milik sendiri; productId milik pengguna lain tidak berpengaruh; input rusak 400', async () => {
		toggleWishlist(aId, kaosId);
		toggleWishlist(bId, kaosId);
		const hapus = (uid: number, productId: string) =>
			favorit.actions.hapus({
				locals: U(uid),
				request: post('', { productId })
			} as never) as Promise<{ success?: boolean; status?: number }>;

		expect(await hapus(aId, String(kaosId))).toMatchObject({ success: true });
		expect(isWishlisted(aId, kaosId)).toBe(false);
		expect(isWishlisted(bId, kaosId)).toBe(true); // milik B utuh

		for (const bad of ['', 'abc', '-1', '1.5', '0']) {
			expect(await hapus(bId, bad)).toMatchObject({ status: 400 });
		}
		expect(isWishlisted(bId, kaosId)).toBe(true);
	});
});
