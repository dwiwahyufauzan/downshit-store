import { defineEnvVars } from '@sveltejs/kit/env';

/** Variabel opsional: kosong/tidak diset → undefined (kode memakai nilai bawaan). */
const optional = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/** Bilangan bulat positif opsional; nilai aneh membuat aplikasi gagal start (fail-fast), bukan jalan setengah rusak. */
const optionalPositiveInt = (name: string) => (value: string | undefined) => {
	const v = optional(value);
	if (v === undefined) return undefined;
	if (!/^[1-9][0-9]*$/.test(v)) throw new Error(`${name} harus bilangan bulat positif`);
	return v;
};

// Catatan: SEED_* dan variabel khusus adapter-node (BODY_SIZE_LIMIT, ADDRESS_HEADER, XFF_DEPTH, HOST, PORT)
// sengaja TIDAK dideklarasikan di sini: seed membacanya lewat process.env, dan SEED_DEFAULT_PASSWORD
// harus boleh dihapus dari .env server setelah go-live (plan/10 §8) tanpa membuat aplikasi gagal start.
export const variables = defineEnvVars({
	DATABASE_URL: { description: 'Path atau URL database' },
	ORIGIN: {
		description: 'Base URL origin aplikasi (produksi: https://domain, tanpa slash akhir)',
		schema: optional
	},
	CATALOG_REQUIRES_LOGIN: {
		description: 'Apakah katalog wajib login ("true"/"false")',
		schema: optional
	},
	SESSION_DAYS: {
		description: 'Masa berlaku sesi login dalam hari (bawaan 30)',
		schema: optionalPositiveInt('SESSION_DAYS')
	},
	UPLOAD_DIR: { description: 'Direktori upload file (bawaan ./uploads)', schema: optional },
	MAX_UPLOAD_MB: {
		description: 'Ukuran maksimal upload dalam MB (bawaan 2)',
		schema: optionalPositiveInt('MAX_UPLOAD_MB')
	},
	CRON_SECRET: {
		description:
			'Token rahasia maintenance cron job (>= 32 karakter; kosong = endpoint menolak semua)',
		schema: optional
	},
	MIDTRANS_SERVER_KEY: {
		description:
			'Server Key Midtrans (Settings → Access Keys). Kosong = pembayaran online nonaktif, hanya transfer manual',
		schema: optional
	},
	MIDTRANS_IS_PRODUCTION: {
		description: '"true" = Midtrans produksi; selain itu memakai Sandbox (bawaan)',
		schema: optional
	},
	PAYMENT_SIMULATOR: {
		description:
			'"true" = payment gateway SIMULASI (mirip Midtrans, tanpa akun & tanpa uang sungguhan) untuk demo/pengujian. Diabaikan bila MIDTRANS_SERVER_KEY terisi',
		schema: optional
	},
	PUBLIC_APP_NAME: { description: 'Nama aplikasi', public: true, schema: optional }
});
