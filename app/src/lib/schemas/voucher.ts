import { z } from 'zod';
import { intField, optionalText } from './common';

const toggle = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
/** Isian angka opsional: kosong → undefined (tanpa batas). */
const optionalInt = (label: string, max: number) =>
	z.preprocess(
		(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
		intField(label, { min: 1, max }).optional()
	);
/** Tanggal kalender (WIB) opsional, format YYYY-MM-DD. */
const optionalDate = z.preprocess(
	(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
	z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal tidak valid')
		.refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00+07:00`)), 'Tanggal tidak valid')
		.optional()
);

export const voucherSchema = z
	.object({
		code: z
			.string({ error: 'Kode voucher wajib diisi' })
			.trim()
			.toUpperCase()
			.regex(/^[A-Z0-9_-]{3,20}$/, 'Kode 3–20 karakter: huruf, angka, strip, atau garis bawah'),
		description: optionalText('Keterangan', 200),
		type: z.enum(['percent', 'fixed'], { error: 'Pilih jenis potongan' }),
		value: intField('Nilai potongan', { min: 1, max: 100_000_000 }),
		minSubtotal: intField('Minimal belanja', { min: 0, max: 100_000_000 }),
		maxDiscount: optionalInt('Batas potongan', 100_000_000),
		startsOn: optionalDate,
		endsOn: optionalDate,
		usageLimit: optionalInt('Kuota total', 1_000_000),
		perUserLimit: intField('Batas per pelanggan', { min: 1, max: 100 }),
		isActive: toggle,
		showOnHome: toggle
	})
	.superRefine((d, ctx) => {
		if (d.type === 'percent' && d.value > 100) {
			ctx.addIssue({ code: 'custom', path: ['value'], message: 'Persen maksimal 100' });
		}
		if (d.type === 'fixed' && d.maxDiscount !== undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['maxDiscount'],
				message: 'Batas potongan hanya untuk voucher persen'
			});
		}
		if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) {
			ctx.addIssue({
				code: 'custom',
				path: ['endsOn'],
				message: 'Tanggal berakhir tidak boleh sebelum tanggal mulai'
			});
		}
	});

export type VoucherInput = z.infer<typeof voucherSchema>;
