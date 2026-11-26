import { z } from 'zod';
import type { AddressParts } from '#lib/utils/address';

/** Nama kolom form alamat (`detail` dipakai sebagai `addressDetail` agar tidak ambigu di form). */
export const ADDRESS_FIELDS = [
	'province',
	'city',
	'district',
	'village',
	'addressDetail',
	'postalCode'
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

const LABEL: Record<AddressField, string> = {
	province: 'Provinsi',
	city: 'Kota/Kabupaten',
	district: 'Kecamatan',
	village: 'Desa/Kelurahan',
	addressDetail: 'Alamat detail',
	postalCode: 'Kode pos'
};

const MAX: Record<AddressField, number> = {
	province: 60,
	city: 80,
	district: 80,
	village: 80,
	addressDetail: 250,
	postalCode: 5
};

const field = (name: AddressField) =>
	z.string().trim().max(MAX[name], `${LABEL[name]} maksimal ${MAX[name]} karakter`).optional();

/** Bentuk mentah form: semua opsional di sini, kewajibannya diperiksa `checkAddress`. */
export const addressShape = {
	province: field('province'),
	city: field('city'),
	district: field('district'),
	village: field('village'),
	addressDetail: field('addressDetail'),
	postalCode: field('postalCode')
};

type Raw = Partial<Record<AddressField, string | undefined>>;

/**
 * `required`: kelima kolom wajib. Bila tidak, boleh kosong semua (hapus alamat), tapi tidak boleh sebagian.
 */
export function checkAddress(d: Raw, ctx: z.RefinementCtx, required: boolean) {
	if (!required && ADDRESS_FIELDS.every((f) => !d[f])) return;

	for (const f of ADDRESS_FIELDS) {
		if (!d[f]) ctx.addIssue({ code: 'custom', path: [f], message: `${LABEL[f]} wajib diisi` });
	}
	if (d.postalCode && !/^[0-9]{5}$/.test(d.postalCode)) {
		ctx.addIssue({
			code: 'custom',
			path: ['postalCode'],
			message: 'Kode pos harus 5 digit angka'
		});
	}
	if (d.addressDetail && d.addressDetail.length < 5) {
		ctx.addIssue({
			code: 'custom',
			path: ['addressDetail'],
			message: 'Alamat detail terlalu singkat (jalan, nomor rumah, RT/RW)'
		});
	}
}

/** Alamat dari data form yang sudah lolos `checkAddress`; null bila kosong. */
export function partsOf(d: Raw): AddressParts | null {
	if (ADDRESS_FIELDS.some((f) => !d[f])) return null;
	return {
		province: d.province!,
		city: d.city!,
		district: d.district!,
		village: d.village!,
		detail: d.addressDetail!,
		postalCode: d.postalCode!
	};
}
