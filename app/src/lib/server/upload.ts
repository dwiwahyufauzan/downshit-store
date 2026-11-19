import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_UPLOAD_MB, UPLOAD_DIR } from '$app/env/private';

const MAX = Number(MAX_UPLOAD_MB ?? 2) * 1024 * 1024;
const ROOT = path.resolve(UPLOAD_DIR ?? './uploads');
const LIMIT_PIXELS = 40_000_000; // cegah "decompression bomb"

const FOLDERS = {
	products: { max: 1200, thumb: 400 },
	bundles: { max: 1200, thumb: 400 },
	proofs: { max: 1600, thumb: 0 }
} as const;
type Folder = keyof typeof FOLDERS;

/** Cek magic bytes sebelum diserahkan ke sharp (menolak file yang menyamar sebagai gambar). */
function looksLikeImage(buf: Buffer): boolean {
	const jpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
	const png =
		buf.length > 8 &&
		buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	const webp =
		buf.length > 12 &&
		buf.subarray(0, 4).toString() === 'RIFF' &&
		buf.subarray(8, 12).toString() === 'WEBP';
	return jpeg || png || webp;
}

/** `thumbUrl` hanya ada untuk folder yang punya thumbnail (products, bundles). */
export type UploadResult =
	{ ok: true; url: string; thumbUrl?: string } | { ok: false; message: string };

/**
 * Simpan gambar: validasi ukuran + magic bytes, lalu RE-ENCODE ke WebP lewat sharp
 * (file palsu gagal didekode, EXIF/GPS dibuang, orientasi diperbaiki, ukuran dikecilkan).
 * Nama file acak UUID; ekstensi selalu `.webp`. Produk/bundling juga mendapat `<nama>_t.webp` (400x400).
 */
export async function saveImage(file: File, folder: Folder): Promise<UploadResult> {
	if (!file || typeof file.arrayBuffer !== 'function' || file.size === 0)
		return { ok: false, message: 'File gambar belum dipilih' };
	if (file.size > MAX)
		return { ok: false, message: `Ukuran maksimal file adalah ${MAX / 1024 / 1024} MB` };
	const cfg = FOLDERS[folder];
	if (!cfg) return { ok: false, message: 'Folder tujuan tidak valid' };

	const buf = Buffer.from(await file.arrayBuffer());
	if (!looksLikeImage(buf))
		return { ok: false, message: 'Format file tidak didukung. Gunakan JPG, PNG, atau WEBP' };

	const id = randomUUID(); // nama asli dari pengguna TIDAK dipakai
	const dir = path.join(ROOT, folder);
	const mainPath = path.join(dir, `${id}.webp`);
	const thumbPath = path.join(dir, `${id}_t.webp`);

	try {
		// .rotate() menerapkan orientasi EXIF; metadata lain dibuang (sharp tidak menyalinnya secara default)
		const img = sharp(buf, { limitInputPixels: LIMIT_PIXELS, failOn: 'error' }).rotate();
		const main = await img
			.clone()
			.resize({ width: cfg.max, height: cfg.max, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: 80 })
			.toBuffer();
		const thumb = cfg.thumb
			? await img
					.clone()
					.resize({ width: cfg.thumb, height: cfg.thumb, fit: 'cover' })
					.webp({ quality: 75 })
					.toBuffer()
			: null;

		await mkdir(dir, { recursive: true });
		await writeFile(mainPath, main);
		if (thumb) await writeFile(thumbPath, thumb);
	} catch {
		await unlink(mainPath).catch(() => {});
		await unlink(thumbPath).catch(() => {}); // jangan tinggalkan berkas yatim
		return {
			ok: false,
			message: 'Gambar tidak dapat diproses. Pastikan file JPG, PNG, atau WEBP yang valid'
		};
	}

	const url = `/uploads/${folder}/${id}.webp`;
	return cfg.thumb
		? { ok: true, url, thumbUrl: `/uploads/${folder}/${id}_t.webp` }
		: { ok: true, url };
}

/** Hapus file beserta thumbnail-nya. Aman terhadap path traversal; berkas yang tidak ada diabaikan. */
export async function deleteImage(url: string | null | undefined) {
	if (!url || !url.startsWith('/uploads/')) return;
	const full = path.resolve(ROOT, url.slice('/uploads/'.length));
	if (!full.startsWith(ROOT + path.sep)) return; // Cegah path traversal
	await unlink(full).catch(() => {});
	// thumbnail (hanya ada untuk products/bundles); berkas lama non-webp tidak punya thumbnail
	if (/\.webp$/.test(full) && !/_t\.webp$/.test(full))
		await unlink(full.replace(/\.webp$/, '_t.webp')).catch(() => {});
}
