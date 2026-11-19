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
