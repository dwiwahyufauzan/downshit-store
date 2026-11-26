import { users } from './db/schema';

/** Kolom `users` yang membentuk alamat default (dipakai profil & checkout). */
export const userAddressColumns = {
	address: users.address,
	addressProvince: users.addressProvince,
	addressCity: users.addressCity,
	addressDistrict: users.addressDistrict,
	addressVillage: users.addressVillage,
	addressDetail: users.addressDetail,
	addressPostalCode: users.addressPostalCode,
	addressVillageCode: users.addressVillageCode
};
