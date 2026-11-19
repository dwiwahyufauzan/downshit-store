/**
 * '/uploads/products/abc.webp' → '/uploads/products/abc_t.webp' (thumbnail 400 px, NF-006).
 * URL lain (berkas lama non-webp, null) dikembalikan apa adanya. Aman dipakai di klien.
 * Bila thumbnail belum ada (berkas lama), endpoint /uploads menyajikan gambar utama sebagai cadangan.
 */
export function thumbOf(url: string | null): string | null {
	return url && /^\/uploads\/(products|bundles)\/[\w-]+\.webp$/.test(url) && !/_t\.webp$/.test(url)
		? url.replace(/\.webp$/, '_t.webp')
		: url;
}

/** Lebar maksimum (px) hasil olah gambar produk/bundling di server: thumbnail dan gambar utama (lihat upload.ts). */
export const THUMB_WIDTH = 400;
export const FULL_WIDTH = 1200;

/**
 * Nilai `srcset` untuk gambar produk/bundling hasil unggah (thumbnail 400 px + utama 1200 px), supaya layar
 * biasa memuat thumbnail yang ringan dan layar retina memuat versi tajam. `undefined` untuk URL lain
 * (berkas lama non-webp, URL eksternal, kosong) karena tidak diketahui punya dua ukuran.
 */
export function srcsetOf(url: string | null): string | undefined {
	if (!url || !/^\/uploads\/(products|bundles)\/[\w-]+\.webp$/.test(url) || /_t\.webp$/.test(url)) {
		return undefined;
	}
	return `${thumbOf(url)} ${THUMB_WIDTH}w, ${url} ${FULL_WIDTH}w`;
}
