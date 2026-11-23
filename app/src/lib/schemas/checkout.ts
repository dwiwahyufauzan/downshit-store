import { z } from 'zod';
import { PAYMENT_METHOD_KEYS } from '#lib/constants';

export const checkoutSchema = z.object({
	recipientName: z.string().trim().min(3, 'Nama penerima minimal 3 karakter').max(100),
	recipientPhone: z
		.string()
		.trim()
		.regex(/^(\+62|62|0)8[0-9]{8,12}$/, 'Nomor WhatsApp / HP tidak valid'),
	shippingAddress: z
		.string()
		.trim()
		.min(10, 'Alamat pengiriman terlalu singkat, mohon tuliskan alamat lengkap')
		.max(500),
	notes: z.string().trim().max(300).optional(),
	// tanpa pilihan = transfer manual (perilaku sebelum ada pembayaran online)
	paymentMethod: z
		.enum(PAYMENT_METHOD_KEYS as [string, ...string[]], { error: 'Metode pembayaran tidak valid' })
		.default('transfer_bank')
});
