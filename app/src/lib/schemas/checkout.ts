import { z } from 'zod';
import { PAYMENT_METHOD_KEYS } from '#lib/constants';
import { addressShape, checkAddress } from './address';

export const checkoutSchema = z
	.object({
		recipientName: z.string().trim().min(3, 'Nama penerima minimal 3 karakter').max(100),
		recipientPhone: z
			.string()
			.trim()
			.regex(/^(\+62|62|0)8[0-9]{8,12}$/, 'Nomor WhatsApp / HP tidak valid'),
		// 'profil' = pakai alamat default akun (dibaca server dari DB); 'baru' = isian di bawah
		addressMode: z.enum(['profil', 'baru']).default('baru'),
		...addressShape,
		// id layanan kirim terpilih ("jne:reg"); harga TIDAK dipercaya dari klien
		shippingOption: z.string().trim().max(60).optional(),
		// kode voucher (opsional); diperiksa & kuotanya diambil di server saat pesanan dibuat
		voucherCode: z.string().trim().toUpperCase().max(30).optional(),
		notes: z.string().trim().max(300).optional(),
		// tanpa pilihan = transfer manual (perilaku sebelum ada pembayaran online)
		paymentMethod: z
			.enum(PAYMENT_METHOD_KEYS as [string, ...string[]], {
				error: 'Metode pembayaran tidak valid'
			})
			.default('transfer_bank')
	})
	.superRefine((d, ctx) => {
		if (d.addressMode === 'baru') checkAddress(d, ctx, true);
	});
