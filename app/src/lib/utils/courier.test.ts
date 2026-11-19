import { describe, expect, it } from 'vitest';
import { COURIERS } from '#lib/constants';
import { trackingPageFor } from './courier';

describe('trackingPageFor', () => {
	it('kurir reguler → halaman pelacakan https resmi', () => {
		for (const c of ['JNE', 'J&T', 'SiCepat', 'Pos Indonesia', 'AnterAja']) {
			const url = trackingPageFor(c);
			expect(url, c).toMatch(/^https:\/\/[a-z0-9.-]+\//);
		}
		expect(trackingPageFor('JNE')).toBe('https://jne.co.id/tracking-package');
	});

	it('kurir instan, "Lainnya", tidak dikenal, atau kosong → null', () => {
		expect(trackingPageFor('Gojek/Grab (Instan)')).toBeNull();
		expect(trackingPageFor('Lainnya')).toBeNull();
		expect(trackingPageFor('Kurir Ngawur')).toBeNull();
		expect(trackingPageFor('')).toBeNull();
		expect(trackingPageFor(null)).toBeNull();
		expect(trackingPageFor(undefined)).toBeNull();
		expect(trackingPageFor('constructor')).toBeNull(); // bukan kunci milik sendiri
	});

	it('setiap kurir di COURIERS terdaftar eksplisit (tidak ada yang terlupa saat daftar kurir bertambah)', () => {
		for (const c of COURIERS) {
			expect(trackingPageFor(c) === null || typeof trackingPageFor(c) === 'string').toBe(true);
		}
		expect(COURIERS.filter((c) => trackingPageFor(c) === null).sort()).toEqual([
			'Gojek/Grab (Instan)',
			'Lainnya'
		]);
	});
});
