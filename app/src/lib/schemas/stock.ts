import { z } from 'zod';
import { intField, textField } from './common';
import { normalizeSize } from '#lib/utils/sizes';

export const adjustSchema = z.object({
	kind: z.enum(['product', 'bundle'], { error: 'Jenis item tidak valid' }),
	id: intField('ID item', { min: 1, minMsg: 'ID tidak valid' }),
	// Wajib untuk produk ber-ukuran (dicek di action); kosong untuk produk tanpa ukuran & bundling
	size: z
		.string()
		.max(12, 'Ukuran terlalu panjang')
		.nullish()
		.transform((v) => normalizeSize(v ?? '')),
	newStock: intField('Stok baru', {
		min: 0,
		max: 100_000,
		minMsg: 'Stok tidak boleh negatif',
		maxMsg: 'Stok maksimal 100.000'
	}),
	note: textField('Catatan', 5, 200)
});

export type AdjustInput = z.infer<typeof adjustSchema>;
