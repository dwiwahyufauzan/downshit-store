import { z } from 'zod';
import { intField, optionalText } from './common';
import { normalizeSize } from '$lib/utils/sizes';

/** true bila `YYYY-MM-DD` adalah tanggal kalender nyata (menolak 2026-02-31 dan tanggal kosong). */
const isRealDate = (s: string) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return false;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const t = new Date(Date.UTC(y, mo - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

export const purchaseSchema = z.object({
	supplierName: optionalText('Nama supplier', 120),
	purchaseDate: z
		.string({ error: 'Tanggal pembelian wajib diisi' })
		.trim()
		.min(1, 'Tanggal pembelian wajib diisi')
		.refine(isRealDate, 'Tanggal tidak valid (format YYYY-MM-DD dan harus ada di kalender)'),
	note: optionalText('Catatan', 255),
	/** diterima = stok langsung bertambah; dipesan = baru dipesan, stok bertambah saat ditandai diterima */
	status: z.enum(['dipesan', 'diterima']).default('diterima'),
	items: z
		.array(
			z.object({
				productId: intField('Produk', { min: 1, minMsg: 'Produk wajib dipilih' }),
				// Wajib untuk produk ber-ukuran (dicek di server); kosong untuk produk tanpa ukuran
				size: z.string().max(12, 'Ukuran terlalu panjang').default('').transform(normalizeSize),
				quantity: intField('Jumlah', {
					min: 1,
					max: 100_000,
					minMsg: 'Jumlah minimal 1',
					maxMsg: 'Jumlah maksimal 100.000'
				}),
				unitCost: intField('Harga kulak', {
					min: 0,
					max: 100_000_000,
					minMsg: 'Harga kulak tidak boleh negatif'
				})
			}),
			{ error: 'Daftar produk pembelian tidak valid' }
		)
		.min(1, 'Pilih minimal 1 produk untuk pembelian')
		.refine(
			(a) => new Set(a.map((i) => `${i.productId}|${i.size}`)).size === a.length,
			'Produk (dan ukuran) di dalam transaksi pembelian tidak boleh duplikat'
		)
});
