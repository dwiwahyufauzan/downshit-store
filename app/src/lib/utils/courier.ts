import type { COURIERS } from '#lib/constants';

type Courier = (typeof COURIERS)[number];

/**
 * Halaman pelacakan resmi tiap kurir. Tidak ada parameter resi: pola tautan langsung (deep link) tidak
 * dapat diverifikasi dan sering berubah, jadi pengguna menyalin resi (tombol "Salin resi") lalu menempelkannya.
 * Alamat diperiksa 19 Nov 2026; bila kurir memindahkan halamannya, cukup ubah di sini.
 * `null` = tidak ada halaman pelacakan (kurir instan / tidak terdaftar).
 */
const TRACKING_PAGE: Record<Courier, string | null> = {
	JNE: 'https://jne.co.id/tracking-package',
	'J&T': 'https://jet.co.id/track',
	SiCepat: 'https://www.sicepat.com/',
	'Pos Indonesia': 'https://www.posindonesia.co.id/id/tracking',
	AnterAja: 'https://anteraja.id/tracking',
	'Gojek/Grab (Instan)': null,
	Lainnya: null
};

export function trackingPageFor(courier: string | null | undefined): string | null {
	if (!courier || !Object.hasOwn(TRACKING_PAGE, courier)) return null;
	return TRACKING_PAGE[courier as Courier];
}
