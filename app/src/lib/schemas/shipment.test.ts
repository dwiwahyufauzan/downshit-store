import { describe, expect, it } from 'vitest';
import { shipmentSchema } from './shipment';

describe('shipmentSchema (SRS-F-014)', () => {
	const ok = { courier: 'JNE', trackingNumber: 'JNE12345' };

	it('menerima kurir dari daftar & resi >= 5 karakter', () => {
		expect(shipmentSchema.safeParse(ok).success).toBe(true);
		expect(shipmentSchema.safeParse({ ...ok, courier: 'Gojek/Grab (Instan)' }).success).toBe(true);
	});

	it('menolak resi kosong / terlalu pendek / hanya spasi (TC-014-02)', () => {
		for (const trackingNumber of ['', '    ', 'abcd']) {
			expect(shipmentSchema.safeParse({ ...ok, trackingNumber }).success).toBe(false);
		}
	});

	it('menolak kurir di luar daftar', () => {
		expect(shipmentSchema.safeParse({ ...ok, courier: 'Kurir Ngawur' }).success).toBe(false);
		expect(shipmentSchema.safeParse({ ...ok, courier: '' }).success).toBe(false);
	});

	it('catatan opsional maksimal 255 karakter', () => {
		expect(shipmentSchema.safeParse({ ...ok, note: 'x'.repeat(255) }).success).toBe(true);
		expect(shipmentSchema.safeParse({ ...ok, note: 'x'.repeat(256) }).success).toBe(false);
	});
});
