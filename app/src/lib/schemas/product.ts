import { z } from 'zod';
import { intField, optionalText, textField } from './common';
import { isValidSize, normalizeSize } from '$lib/utils/sizes';

const base = {
	name: textField('Nama produk', 3, 150),
	categoryId: intField('Kategori', { min: 1, minMsg: 'Silakan pilih kategori' }),
	description: optionalText('Deskripsi', 2000),
	// BR-04: harga integer Rupiah
	price: intField('Harga', {
		min: 1000,
		max: 100_000_000,
		minMsg: 'Harga minimal Rp 1.000',
		maxMsg: 'Harga maksimal Rp 100.000.000'
	}),
	isBundleable: z.boolean().default(false),
	isActive: z.boolean().default(false)
};

/** Form tambah: stok awal hanya ada di sini */
export const productCreateSchema = z.object({
	...base,
	stock: intField('Stok awal', {
		min: 0,
		max: 100_000,
		minMsg: 'Stok tidak boleh negatif'
	})
});

/** Form ubah: TIDAK ada field stok (BR-19) — kunci `stock` yang dikirim manual dibuang oleh zod. */
export const productUpdateSchema = z.object(base);

export const productSchema = productCreateSchema;

/** Satu ukuran pada form produk: label + stok awal (untuk ukuran baru). */
export const sizeRowSchema = z.object({
	label: z
		.string({ error: 'Label ukuran wajib diisi' })
		.transform(normalizeSize)
		.refine(
			isValidSize,
			'Ukuran tidak valid (maks. 12 karakter: huruf, angka, spasi, titik, garis)'
		),
	stock: z
		.number({ error: 'Stok ukuran harus berupa angka' })
		.int('Stok ukuran harus bilangan bulat')
		.min(0, 'Stok tidak boleh negatif')
		.max(100_000, 'Stok maksimal 100.000')
});

export const sizeListSchema = z
	.array(sizeRowSchema)
	.max(20, 'Maksimal 20 ukuran per produk')
	.refine((a) => new Set(a.map((r) => r.label)).size === a.length, 'Ukuran tidak boleh ganda');

export type SizeInput = z.infer<typeof sizeRowSchema>;

/** Baca field form berisi JSON (mis. `sizesNew`): kosong → daftar kosong; JSON rusak/tak valid → pesan galat. */
export function parseSizeField(
	raw: FormDataEntryValue | null
): { ok: true; data: SizeInput[] } | { ok: false; message: string } {
	const text = typeof raw === 'string' ? raw.trim() : '';
	if (!text) return { ok: true, data: [] };
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return { ok: false, message: 'Daftar ukuran tidak valid.' };
	}
	const r = sizeListSchema.safeParse(json);
	return r.success ? { ok: true, data: r.data } : { ok: false, message: r.error.issues[0].message };
}

/** Label ukuran yang akan dihapus (JSON array string). */
export function parseRemoveField(raw: FormDataEntryValue | null): string[] {
	if (typeof raw !== 'string' || !raw.trim()) return [];
	try {
		const j = JSON.parse(raw);
		return Array.isArray(j)
			? j.filter((x): x is string => typeof x === 'string').map(normalizeSize)
			: [];
	} catch {
		return [];
	}
}
