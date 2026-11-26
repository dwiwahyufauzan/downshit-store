/** Alamat terstruktur: dipakai profil (default) dan checkout. Pesanan menyimpan hasil `formatAddress`. */
export type AddressParts = {
	province: string;
	city: string;
	district: string;
	village: string;
	detail: string;
	/** Kode pos 5 digit (dipakai menghitung ongkir) */
	postalCode: string;
};

/** Baris `users` yang memuat kolom alamat terstruktur. */
type AddressRow = {
	addressProvince: string | null;
	addressCity: string | null;
	addressDistrict: string | null;
	addressVillage: string | null;
	addressDetail: string | null;
	addressPostalCode: string | null;
};

/** Satu baris teks, urut dari yang paling spesifik: "Jl. A No. 1, Desa/Kel. X, Kec. Y, Kota Z, Prov 41211". */
export function formatAddress(a: AddressParts): string {
	return (
		[a.detail, `Desa/Kel. ${a.village}`, `Kec. ${a.district}`, a.city, a.province].join(', ') +
		` ${a.postalCode}`
	);
}

/** Alamat default milik pengguna, atau null bila belum lengkap (kelima kolom wajib terisi). */
export function addressOf(u: AddressRow): AddressParts | null {
	const parts = {
		province: u.addressProvince?.trim() ?? '',
		city: u.addressCity?.trim() ?? '',
		district: u.addressDistrict?.trim() ?? '',
		village: u.addressVillage?.trim() ?? '',
		detail: u.addressDetail?.trim() ?? '',
		postalCode: u.addressPostalCode?.trim() ?? ''
	};
	return Object.values(parts).every(Boolean) ? parts : null;
}

/** Nilai kolom `users` untuk alamat; `null` mengosongkan alamat default. `villageCode` = kode wilayah desa. */
export function addressColumns(a: AddressParts | null, villageCode: string | null = null) {
	return {
		address: a ? formatAddress(a) : null,
		addressProvince: a?.province ?? null,
		addressCity: a?.city ?? null,
		addressDistrict: a?.district ?? null,
		addressVillage: a?.village ?? null,
		addressDetail: a?.detail ?? null,
		addressPostalCode: a?.postalCode ?? null,
		addressVillageCode: a ? villageCode : null
	};
}
