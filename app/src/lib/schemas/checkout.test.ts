import { describe, expect, it } from 'vitest';
import { checkoutSchema } from './checkout';

describe('checkoutSchema', () => {
	it('validates correct recipient details and Indonesian phone numbers', () => {
		const validList = [
			{
				recipientName: 'Budi Santoso',
				recipientPhone: '081234567890',
				province: 'Jawa Barat',
				city: 'Kabupaten Subang',
				district: 'Subang',
				village: 'Soklat',
				addressDetail: 'Jl. Otto Iskandardinata No. 45',
				postalCode: '41211'
			},
			{
				recipientName: 'Siti Aminah',
				recipientPhone: '+628987654321',
				province: 'Jawa Barat',
				city: 'Kabupaten Subang',
				district: 'Subang',
				village: 'Soklat',
				addressDetail: 'Jl. Otto Iskandardinata No. 45',
				postalCode: '41211',
				notes: 'Tolong titip di pos satpam jika tidak ada orang'
			},
			{
				recipientName: 'Ahmad Fauzi',
				recipientPhone: '6285211223344',
				province: 'Jawa Barat',
				city: 'Kabupaten Subang',
				district: 'Subang',
				village: 'Soklat',
				addressDetail: 'Jl. Otto Iskandardinata No. 45',
				postalCode: '41211'
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
				province: 'Jawa Barat',
				city: 'Kabupaten Subang',
				district: 'Subang',
				village: 'Soklat',
				addressDetail: 'Jl. Otto Iskandardinata No. 45',
				postalCode: '41211'
			});
			expect(result.success).toBe(false);
		}
	});

	const base = {
		recipientName: 'Budi Santoso',
		recipientPhone: '081234567890'
	};
	const fullAddress = {
		province: 'Jawa Barat',
		city: 'Kabupaten Subang',
		district: 'Subang',
		village: 'Soklat',
		addressDetail: 'Jl. Otto No. 45',
		postalCode: '41211'
	};

	it('alamat baru: kelima kolom wajib diisi', () => {
		for (const key of Object.keys(fullAddress)) {
			const result = checkoutSchema.safeParse({
				...base,
				...fullAddress,
				addressMode: 'baru',
				[key]: ''
			});
			expect(result.success).toBe(false);
			expect(result.error?.issues[0].path).toEqual([key]);
		}
	});

	it('menolak alamat detail terlalu singkat', () => {
		const result = checkoutSchema.safeParse({ ...base, ...fullAddress, addressDetail: 'Jl.' });
		expect(result.success).toBe(false);
	});

	it('alamat profil: kolom alamat boleh kosong (dibaca server dari akun)', () => {
		expect(checkoutSchema.safeParse({ ...base, addressMode: 'profil' }).success).toBe(true);
	});

	it('mode tidak dikenal ditolak', () => {
		expect(checkoutSchema.safeParse({ ...base, ...fullAddress, addressMode: 'lain' }).success).toBe(
			false
		);
	});
});
