import { z } from 'zod';
import { intField, optionalText, textField } from './common';

const items = z
	.array(
		z.object({
			productId: intField('Produk', { min: 1, minMsg: 'Produk tidak valid' }),
			quantity: intField('Jumlah', {
				min: 1,
				max: 20,
				minMsg: 'Jumlah per produk minimal 1',
				maxMsg: 'Jumlah maksimal 20 per produk'
			})
		}),
		{ error: 'Komponen paket tidak valid' }
	)
	.min(2, 'Paket bundling minimal harus terdiri dari 2 produk berbeda')
	.refine(
		(arr) => new Set(arr.map((i) => i.productId)).size === arr.length,
		'Tidak boleh ada produk duplikat di dalam satu paket bundling'
	);

const base = {
	name: textField('Nama paket bundling', 3, 150),
	description: optionalText('Deskripsi', 2000),
	price: intField('Harga paket', {
		min: 1000,
		max: 100_000_000,
		minMsg: 'Harga paket minimal Rp 1.000',
		maxMsg: 'Harga paket maksimal Rp 100.000.000'
	}),
	isActive: z.boolean().default(false),
	items
};

export const bundleCreateSchema = z.object({
	...base,
	stock: intField('Kuota paket', { min: 0, max: 100_000, minMsg: 'Kuota tidak boleh negatif' })
});

/** Stok/kuota bundling diubah lewat /admin/stok (BR-19) */
export const bundleUpdateSchema = z.object(base);

export const bundleSchema = bundleCreateSchema;
