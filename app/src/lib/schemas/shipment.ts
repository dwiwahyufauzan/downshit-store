import { z } from 'zod';
import { COURIERS } from '#lib/constants';

export const shipmentSchema = z.object({
	courier: z.enum(COURIERS, { error: 'Pilih kurir dari daftar' }),
	trackingNumber: z.string().trim().min(5, 'Nomor resi minimal 5 karakter').max(80),
	note: z.string().trim().max(255).optional()
});
