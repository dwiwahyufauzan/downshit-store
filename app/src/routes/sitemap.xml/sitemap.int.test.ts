/**
 * Sitemap & robots.txt: hanya halaman publik yang aktif; katalog privat tidak didaftarkan.
 * Memakai salinan DB tes milik berkas ini sendiri (tests/.tmp-seo-*.db).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-seo-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	// objek ini sengaja dapat diubah per tes (mock dibaca saat diakses, bukan saat impor)
	return { file, ORIGIN: 'https://toko.id' as string | undefined, CATALOG_REQUIRES_LOGIN: 'false' };
});

vi.mock('$app/env/private', () => ({
	get DATABASE_URL() {
		return env.file;
	},
	get ORIGIN() {
		return env.ORIGIN;
	},
	get CATALOG_REQUIRES_LOGIN() {
		return env.CATALOG_REQUIRES_LOGIN;
	},
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads-seo',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { rmSync } from 'node:fs';
import { db } from '#lib/server/db';
import { bundles, products } from '#lib/server/db/schema';
import { GET as sitemap } from './+server';
import { GET as robots } from '../robots.txt/+server';

function assertTestDb() {
	if (!/\.tmp-seo-/.test(env.file)) throw new Error('MENOLAK reset: bukan DB tes SEO');
}

beforeEach(() => {
	assertTestDb();
	env.ORIGIN = 'https://toko.id';
	env.CATALOG_REQUIRES_LOGIN = 'false';
	db.delete(bundles).run();
	db.delete(products).run();
	db.insert(products)
		.values([
			{
				name: 'Aktif',
				slug: 'aktif',
				price: 1000,
				stock: 1,
				updatedAt: '2026-11-01T00:00:00.000Z'
			},
			{ name: 'Nonaktif', slug: 'nonaktif', price: 1000, stock: 1, isActive: false },
			{
				name: 'Terhapus',
				slug: 'terhapus',
				price: 1000,
				stock: 1,
				deletedAt: '2026-10-01T00:00:00.000Z'
			},
			{ name: 'Slug unik', slug: 'kaos-a-b', price: 1000, stock: 1 }
		])
		.run();
	db.insert(bundles)
		.values([
			{ name: 'Paket Aktif', slug: 'paket-aktif', price: 5000, stock: 1 },
			{ name: 'Paket Mati', slug: 'paket-mati', price: 5000, stock: 1, isActive: false }
		])
		.run();
});

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
});

const call = (h: (e: never) => unknown, origin = 'http://localhost:5173') =>
	h({ url: new URL(origin + '/x') } as never) as Response;

describe('GET /sitemap.xml', () => {
	it('memuat halaman statis, produk & bundling aktif; tanpa nonaktif/terhapus', async () => {
		const res = call(sitemap);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toMatch(/application\/xml/);
		const xml = await res.text();

		for (const path of ['/', '/produk', '/bundling', '/kebijakan-privasi']) {
			expect(xml).toContain(`<loc>https://toko.id${path}</loc>`);
		}
		expect(xml).toContain(
			'<loc>https://toko.id/produk/aktif</loc><lastmod>2026-11-01T00:00:00.000Z</lastmod>'
		);
		expect(xml).toContain('<loc>https://toko.id/produk/kaos-a-b</loc>');
		expect(xml).toContain('<loc>https://toko.id/bundling/paket-aktif</loc>');
		expect(xml).not.toContain('nonaktif');
		expect(xml).not.toContain('terhapus');
		expect(xml).not.toContain('paket-mati');
	});

	it('tanpa ORIGIN memakai origin permintaan', async () => {
		env.ORIGIN = undefined;
		const xml = await call(sitemap, 'http://localhost:5173').text();
		expect(xml).toContain('<loc>http://localhost:5173/produk/aktif</loc>');
	});

	it('katalog wajib login → hanya halaman publik non-katalog', async () => {
		env.CATALOG_REQUIRES_LOGIN = 'true';
		const xml = await call(sitemap).text();
		expect(xml).toContain('<loc>https://toko.id/</loc>');
		expect(xml).not.toContain('/produk');
		expect(xml).not.toContain('/bundling');
	});
});

describe('GET /robots.txt', () => {
	it('menutup area privat dan menunjuk sitemap absolut', async () => {
		const res = call(robots);
		expect(res.headers.get('content-type')).toMatch(/text\/plain/);
		const t = await res.text();
		expect(t).toContain('Disallow: /admin');
		expect(t).toContain('Disallow: /uploads/proofs/');
		expect(t).toContain('Sitemap: https://toko.id/sitemap.xml');
		expect(t).not.toContain('Disallow: /produk');
	});

	it('katalog wajib login → /produk ikut ditutup', async () => {
		env.CATALOG_REQUIRES_LOGIN = 'true';
		expect(await call(robots).text()).toContain('Disallow: /produk');
	});
});
