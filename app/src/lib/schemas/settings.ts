import { z } from 'zod';
import { intField, textField } from './common';

/** Kotak centang form: "on"/"true" = aktif, kosong = nonaktif */
const toggle = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const settingsSchema = z
	.object({
		storeName: textField('Nama toko', 2, 100),
		whatsapp: z
			.string({ error: 'Nomor WhatsApp wajib diisi' })
			.trim()
			.regex(/^62[0-9]{8,13}$/, 'Format: 62812xxxxxxx (awali 62, tanpa + atau 0, hanya angka)'),
		shippingCost: intField('Ongkir', {
			min: 0,
			max: 500_000,
			minMsg: 'Ongkir tidak boleh negatif',
			maxMsg: 'Ongkir maksimal Rp 500.000'
		}),
		shippingOriginPostal: z
			.string()
			.trim()
			.regex(/^([0-9]{5})?$/, 'Kode pos asal harus 5 digit angka (kosongkan untuk ongkir flat)')
			.default(''),
		shippingCouriers: z
			.string()
			.trim()
			.toLowerCase()
			.regex(/^[a-z0-9]+(,[a-z0-9]+)*$/, 'Kode kurir dipisah koma, mis. jne,jnt,sicepat')
			.default('jne,jnt,sicepat,anteraja'),
		bankName: textField('Nama bank', 2, 50),
		bankNumber: z
			.string({ error: 'Nomor rekening wajib diisi' })
			.trim()
			.regex(/^[0-9]{5,30}$/, 'Nomor rekening hanya boleh angka (5-30 digit)'),
		bankHolder: textField('Nama pemilik rekening', 2, 100),
		lowStock: intField('Ambang stok menipis', { min: 0, max: 1000 }),
		paymentDeadlineHours: intField('Batas waktu bayar', {
			min: 1,
			max: 168,
			minMsg: 'Batas waktu bayar minimal 1 jam',
			maxMsg: 'Batas waktu bayar maksimal 168 jam (7 hari)'
		}),
		maxUnpaidOrders: intField('Maks. pesanan belum bayar', { min: 1, max: 20 }),
		autoCompleteDays: intField('Auto-selesai', {
			min: 1,
			max: 60,
			minMsg: 'Auto-selesai minimal 1 hari',
			maxMsg: 'Auto-selesai maksimal 60 hari'
		}),
		payTransfer: toggle,
		payEwallet: toggle,
		payQris: toggle,
		payVa: toggle,
		payMinimarket: toggle
	})
	.refine((v) => v.payTransfer || v.payEwallet || v.payQris || v.payVa || v.payMinimarket, {
		path: ['payTransfer'],
		message: 'Aktifkan minimal satu metode pembayaran'
	});

export type SettingsInput = z.infer<typeof settingsSchema>;
