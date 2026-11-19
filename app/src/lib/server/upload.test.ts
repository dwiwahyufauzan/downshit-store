import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { deleteImage, saveImage } from './upload';

// UPLOAD_DIR di-mock ke ./tests/.tmp-uploads (tests/setup.ts)
const ROOT = path.resolve('./tests/.tmp-uploads');
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const abs = (url: string) => path.join(ROOT, url.replace('/uploads/', ''));
const fileOf = (buf: Buffer, name = 'foto.jpg', type = 'image/jpeg') =>
	new File([new Uint8Array(buf)], name, { type });

/** JPEG berukuran 3000x2000 dengan EXIF (GPS-like tag, orientasi 6 = putar 90°). */
async function jpegWithExif() {
	return sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#c33' } })
		.jpeg()
		.withMetadata({ orientation: 6 })
		.withExif({ IFD0: { Copyright: 'RAHASIA-LOKASI' } })
		.toBuffer();
}

describe('saveImage (sharp: re-encode WebP, thumbnail, buang EXIF)', () => {
	it('produk: hasil .webp + thumbnail 400x400, EXIF hilang, sisi terpanjang <= 1200', async () => {
		const src = await jpegWithExif();
		expect((await sharp(src).metadata()).exif).toBeTruthy(); // sumber memang berEXIF

		const r = await saveImage(fileOf(src), 'products');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.url).toMatch(/^\/uploads\/products\/[0-9a-f-]{36}\.webp$/);
		expect(r.thumbUrl).toBe(r.url.replace(/\.webp$/, '_t.webp'));

		const main = readFileSync(abs(r.url));
		const meta = await sharp(main).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.exif).toBeUndefined();
		expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1200);
		expect(main.includes(Buffer.from('RAHASIA-LOKASI'))).toBe(false);
		// orientasi EXIF diterapkan (3000x2000 diputar 90° → tinggi > lebar)
		expect(meta.height!).toBeGreaterThan(meta.width!);

		const tm = await sharp(readFileSync(abs(r.thumbUrl!))).metadata();
		expect([tm.width, tm.height, tm.format]).toEqual([400, 400, 'webp']);
	});

	it('bukti bayar (proofs): maks 1600 px, tanpa thumbnail', async () => {
		const src = await sharp({
			create: { width: 2400, height: 1800, channels: 3, background: '#333' }
		})
			.png()
			.toBuffer();
		const r = await saveImage(fileOf(src, 'bukti.png', 'image/png'), 'proofs');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.thumbUrl).toBeUndefined();
		const meta = await sharp(readFileSync(abs(r.url))).metadata();
		expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1600);
		expect(existsSync(abs(r.url.replace(/\.webp$/, '_t.webp')))).toBe(false);
	});

	it('gambar kecil tidak diperbesar', async () => {
		const src = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#fff' } })
			.webp()
			.toBuffer();
		const r = await saveImage(fileOf(src, 'x.webp', 'image/webp'), 'bundles');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const meta = await sharp(readFileSync(abs(r.url))).metadata();
		expect([meta.width, meta.height]).toEqual([100, 80]);
	});

	it('menolak file palsu (isi bukan gambar) walau bernama .jpg / bertipe image/jpeg', async () => {
		const php = Buffer.from('<?php system($_GET["c"]); ?>');
		const r = await saveImage(fileOf(php, 'shell.jpg'), 'products');
		expect(r).toMatchObject({ ok: false });
	});

	it('menolak .exe yang menyamar (magic bytes MZ)', async () => {
		const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
		expect(await saveImage(fileOf(exe, 'a.jpg'), 'products')).toMatchObject({ ok: false });
	});

	it('magic bytes JPEG tetapi isi rusak → gagal didekode, tanpa berkas yatim', async () => {
		const bad = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
		const r = await saveImage(fileOf(bad), 'products');
		expect(r).toMatchObject({ ok: false });
		const dir = path.join(ROOT, 'products');
		const before = existsSync(dir) ? (await import('node:fs')).readdirSync(dir).length : 0;
		// setiap berkas di folder harus punya pasangan lengkap (utama + thumbnail) → rusak tidak menambah apa pun
		const r2 = await saveImage(fileOf(bad), 'products');
		expect(r2.ok).toBe(false);
		const after = existsSync(dir) ? (await import('node:fs')).readdirSync(dir).length : 0;
		expect(after).toBe(before);
	});

	it('menolak berkas > batas ukuran (2 MB) dan berkas kosong', async () => {
		const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'besar.jpg', {
			type: 'image/jpeg'
		});
		const r = await saveImage(big, 'products');
		expect(r).toMatchObject({ ok: false });
		expect((r as { message: string }).message).toMatch(/2 MB/);
		expect(await saveImage(new File([], 'kosong.jpg'), 'products')).toMatchObject({ ok: false });
	});

	it('menolak folder tidak dikenal (cegah path traversal lewat folder)', async () => {
		const src = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
			.png()
			.toBuffer();
		const r = await saveImage(fileOf(src), '../etc' as never);
		expect(r.ok).toBe(false);
	});

	it('nama file acak UUID (nama asli pengguna tidak dipakai)', async () => {
		const src = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
			.png()
			.toBuffer();
		const r = await saveImage(fileOf(src, '../../evil name.png', 'image/png'), 'products');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.url).not.toMatch(/evil/);
	});
});

describe('deleteImage', () => {
	it('menghapus berkas utama beserta thumbnail', async () => {
		const src = await sharp({
			create: { width: 500, height: 500, channels: 3, background: '#fff' }
		})
			.png()
			.toBuffer();
		const r = await saveImage(fileOf(src, 'a.png', 'image/png'), 'products');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(existsSync(abs(r.url))).toBe(true);
		expect(existsSync(abs(r.thumbUrl!))).toBe(true);
		await deleteImage(r.url);
		expect(existsSync(abs(r.url))).toBe(false);
		expect(existsSync(abs(r.thumbUrl!))).toBe(false);
	});

	it('aman: null, URL asing, path traversal, dan berkas yang tidak ada tidak melempar', async () => {
		await deleteImage(null);
		await deleteImage(undefined);
		await deleteImage('https://evil.com/x.webp');
		await deleteImage('/uploads/../../package.json');
		await deleteImage('/uploads/products/tidak-ada.webp');
		expect(existsSync(path.resolve('package.json'))).toBe(true);
	});
});
