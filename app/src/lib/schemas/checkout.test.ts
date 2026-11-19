import { describe, expect, it } from 'vitest';
import { checkoutSchema } from './checkout';

describe('checkoutSchema', () => {
	it('validates correct recipient details and Indonesian phone numbers', () => {
		const validList = [
			{
				recipientName: 'Budi Santoso',
				recipientPhone: '081234567890',
				shippingAddress: 'Jl. Otto Iskandardinata No. 45, Subang, Jawa Barat'
			},
			{
				recipientName: 'Siti Aminah',
				recipientPhone: '+628987654321',
				shippingAddress: 'Komplek Perumahan Subang Asri Blok B No. 12',
				notes: 'Tolong titip di pos satpam jika tidak ada orang'
			},
			{
				recipientName: 'Ahmad Fauzi',
				recipientPhone: '6285211223344',
				shippingAddress: 'Kp. Sukaresmi RT 02 RW 04, Pagaden, Subang'
			}
		];

		for (const data of validList) {
			const result = checkoutSchema.safeParse(data);
			expect(result.success).toBe(true);
		}
	});

	it('rejects invalid phone numbers', () => {
		const invalidPhones = ['12345', '0711123456', 'abcdefghijk', '08123', '08999999999999999999'];

		for (const phone of invalidPhones) {
			const result = checkoutSchema.safeParse({
				recipientName: 'Budi Santoso',
				recipientPhone: phone,
				shippingAddress: 'Jl. Otto Iskandardinata No. 45, Subang, Jawa Barat'
			});
			expect(result.success).toBe(false);
		}
	});

	it('rejects too short shipping address', () => {
		const result = checkoutSchema.safeParse({
			recipientName: 'Budi Santoso',
			recipientPhone: '081234567890',
			shippingAddress: 'Subang' // < 10 chars
		});
		expect(result.success).toBe(false);
	});
});
