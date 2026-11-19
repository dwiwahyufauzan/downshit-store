/**
 * Ukuran produk. Label disimpan huruf besar (mis. "M", "XL", "30"); '' berarti produk tanpa ukuran.
 * Modul murni (tanpa DB) agar dipakai server, form admin, dan halaman pelanggan.
 */

export const SIZE_PRESETS = {
	Pakaian: ['S', 'M', 'L', 'XL', 'XXL'],
	Celana: ['28', '30', '32', '34', '36'],
	Lainnya: ['ALL SIZE']
} as const;

const ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'ALL SIZE'];

/** Huruf besar, spasi dirapikan, maks 12 karakter. */
export const normalizeSize = (s: string): string => s.trim().replace(/\s+/g, ' ').toUpperCase();

export const SIZE_LABEL_RE = /^[A-Z0-9][A-Z0-9 ./-]{0,11}$/;
export const isValidSize = (s: string): boolean => SIZE_LABEL_RE.test(s);

/** Urutan tampil: ukuran huruf menurut urutan lazim, angka menurut nilainya, lainnya alfabetis. */
export function compareSizes(a: string, b: string): number {
	const ia = ORDER.indexOf(a);
	const ib = ORDER.indexOf(b);
	if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
	const na = Number(a);
	const nb = Number(b);
	if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
	return a.localeCompare(b);
}

/* ---------- Pilihan ukuran pada paket bundling ---------- */
/** productId → label. Hanya komponen ber-ukuran yang punya entri. */
export type SizeSelection = Record<number, string>;

/** "12:L|15:M" — terurut menurut productId agar baris keranjang yang sama selalu bernilai sama. */
export function encodeSelection(sel: SizeSelection): string {
	return Object.entries(sel)
		.map(([id, label]) => [Number(id), label] as const)
		.sort((a, b) => a[0] - b[0])
		.map(([id, label]) => `${id}:${label}`)
		.join('|');
}

export function decodeSelection(s: string): SizeSelection {
	const out: SizeSelection = {};
	for (const part of s.split('|')) {
		const i = part.indexOf(':');
		if (i < 1) continue;
		const id = Number(part.slice(0, i));
		const label = part.slice(i + 1);
		if (Number.isInteger(id) && id > 0 && label) out[id] = label;
	}
	return out;
}
