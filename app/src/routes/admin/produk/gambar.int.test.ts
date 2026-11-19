/**
 * Uji integrasi multi-gambar produk:
 *  - Tambah produk dengan lebih dari 1 gambar (multi-upload)
 *  - Foto pertama otomatis menjadi foto utama katalog
 *  - Tabel product_images terisi sesuai urutan
 *  - Halaman produk publik (/produk/[slug]) menyajikan galeri lengkap
 *  - Halaman edit (/admin/produk/[id]/edit) mendukung tambah foto baru, ganti foto utama, dan hapus foto
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-produk-gambar-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file, uploadDir: `./tests/.tmp-uploads-produk-gambar-${rand}` };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: env.uploadDir,
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32)
}));

import { asc, eq } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { categories, productImages, products, users } from '#lib/server/db/schema';
import * as baru from './baru/+page.server';
import * as edit from './[id]/edit/+page.server';
import * as detail from '../../produk/[slug]/+page.server';

const ROOT = path.resolve(env.uploadDir);

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
	rmSync(ROOT, { recursive: true, force: true });
});

let adminId: number;
let catId: number;

async function makeImage(color = '#111'): Promise<File> {
	const buf = await sharp({
		create: { width: 400, height: 400, channels: 3, background: color }
	})
		.jpeg()
		.toBuffer();
	return new File([new Uint8Array(buf)], 'foto.jpg', { type: 'image/jpeg' });
}

beforeEach(() => {
	db.delete(productImages).run();
	db.delete(products).run();
	db.delete(categories).run();
	db.delete(users).run();

	adminId = db
		.insert(users)
		.values({
			name: 'Admin Toko',
			email: 'admin-gambar@downshit.test',
			passwordHash: 'dummy',
			role: 'admin'
		})
		.returning({ id: users.id })
		.get().id;

	catId = db
		.insert(categories)
		.values({ name: 'T-Shirt', slug: 't-shirt' })
		.returning({ id: categories.id })
		.get().id;
});

describe('Multi-gambar produk (tambah, edit, dan galeri detail)', () => {
	it('menambah produk baru dengan 3 gambar: foto 1 jadi foto utama & semua tersimpan di galeri', async () => {
		const img1 = await makeImage('#111111');
		const img2 = await makeImage('#222222');
		const img3 = await makeImage('#333333');

		const fd = new FormData();
		fd.set('name', 'Oversized Tee Multi');
		fd.set('categoryId', String(catId));
		fd.set('price', '150000');
		fd.set('stock', '20');
		fd.set('isBundleable', 'on');
		fd.set('isActive', 'on');

		// 3 file gambar
		fd.append('images', img1);
		fd.append('images', img2);
		fd.append('images', img3);

		try {
			await baru.actions.default({
				request: new Request('http://localhost', { method: 'POST', body: fd }),
				locals: { user: { id: adminId, role: 'admin' } }
			} as any);
			expect.unreachable('harus redirect ke /admin/produk');
		} catch (e) {
			expect(isRedirect(e)).toBe(true);
		}

		// Verifikasi produk
		const [prod] = db.select().from(products).where(eq(products.name, 'Oversized Tee Multi')).all();
		expect(prod).toBeTruthy();
		expect(prod.imageUrl).toBeTruthy();

		// Verifikasi galeri foto di tabel product_images
		const gallery = db
			.select()
			.from(productImages)
			.where(eq(productImages.productId, prod.id))
			.orderBy(asc(productImages.sortOrder))
			.all();

		expect(gallery.length).toBe(3);
		expect(gallery[0].imageUrl).toBe(prod.imageUrl); // Foto pertama adalah foto utama
		expect(gallery[0].sortOrder).toBe(0);
		expect(gallery[1].sortOrder).toBe(1);
		expect(gallery[2].sortOrder).toBe(2);

		// Verifikasi halaman detail konsumen (/produk/[slug])
		const detailData: any = await detail.load({
			params: { slug: prod.slug },
			locals: { user: null },
			url: new URL(`http://localhost/produk/${prod.slug}`)
		} as any);

		expect(detailData.product.id).toBe(prod.id);
		expect(detailData.gallery.length).toBe(3);
		expect(detailData.gallery[0].imageUrl).toBe(prod.imageUrl);
	});

	it('mengubah produk: menambah gambar baru, mengganti foto utama, dan menghapus foto lama', async () => {
		// 1. Buat produk awal dengan 2 gambar
		const img1 = await makeImage('#ff0000');
		const img2 = await makeImage('#00ff00');

		const fdCreate = new FormData();
		fdCreate.set('name', 'Boxy Hoodie Multi');
		fdCreate.set('categoryId', String(catId));
		fdCreate.set('price', '300000');
		fdCreate.set('stock', '15');
		fdCreate.append('images', img1);
		fdCreate.append('images', img2);

		try {
			await baru.actions.default({
				request: new Request('http://localhost', { method: 'POST', body: fdCreate }),
				locals: { user: { id: adminId, role: 'admin' } }
			} as any);
		} catch (e) {
			expect(isRedirect(e)).toBe(true);
		}

		const [prod] = db.select().from(products).where(eq(products.name, 'Boxy Hoodie Multi')).all();
		const initialGallery = db
			.select()
			.from(productImages)
			.where(eq(productImages.productId, prod.id))
			.orderBy(asc(productImages.sortOrder))
			.all();
		expect(initialGallery.length).toBe(2);

		const firstImgId = initialGallery[0].id;
		const secondImgUrl = initialGallery[1].imageUrl;

		// 2. Edit produk:
		// - Hapus foto pertama (firstImgId)
		// - Jadikan foto kedua sebagai foto utama (primaryImageUrl = secondImgUrl)
		// - Tambahkan 1 foto baru (img3)
		const img3 = await makeImage('#0000ff');
		const fdEdit = new FormData();
		fdEdit.set('name', 'Boxy Hoodie Multi V2');
		fdEdit.set('categoryId', String(catId));
		fdEdit.set('price', '320000');
		fdEdit.append('deleteImageIds', String(firstImgId));
		fdEdit.set('primaryImageUrl', secondImgUrl);
		fdEdit.append('images', img3);

		try {
			await edit.actions.default({
				params: { id: String(prod.id) },
				request: new Request('http://localhost', { method: 'POST', body: fdEdit }),
				locals: { user: { id: adminId, role: 'admin' } }
			} as any);
		} catch (e) {
			expect(isRedirect(e)).toBe(true);
		}

		// 3. Verifikasi hasil edit
		const [updatedProd] = db.select().from(products).where(eq(products.id, prod.id)).all();
		expect(updatedProd.name).toBe('Boxy Hoodie Multi V2');
		expect(updatedProd.imageUrl).toBe(secondImgUrl); // Foto kedua sekarang jadi utama

		const updatedGallery = db
			.select()
			.from(productImages)
			.where(eq(productImages.productId, prod.id))
			.all();

		// Foto 1 sudah terhapus, foto 2 tetap ada, foto 3 baru bertambah -> total 2 foto
		expect(updatedGallery.length).toBe(2);
		expect(updatedGallery.some((g) => g.id === firstImgId)).toBe(false);
		expect(updatedGallery.some((g) => g.imageUrl === secondImgUrl)).toBe(true);
	});
});
