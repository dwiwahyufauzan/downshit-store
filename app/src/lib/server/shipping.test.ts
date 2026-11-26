import { beforeEach, describe, expect, it, vi } from 'vitest';

const vars = vi.hoisted(() => ({ BITESHIP_API_KEY: 'bs-key' as string | undefined }));
vi.mock('./config', () => ({ envVar: (n: string) => (vars as Record<string, string>)[n] }));

import { clearShippingCache, flatOption, getShippingOptions, shippingApiEnabled } from './shipping';
import type { StoreSettings } from './settings';

const cfg = {
	shippingCost: 15000,
	shippingOriginPostal: '41211',
	shippingCouriers: 'jne,jnt'
} as StoreSettings;

const pricing = [
	{
		courier_code: 'jnt',
		courier_name: 'J&T',
		courier_service_code: 'ez',
		courier_service_name: 'EZ',
		shipment_duration_range: '2 - 3',
		shipment_duration_unit: 'days',
		price: 21000
	},
	{
		courier_code: 'jne',
		courier_name: 'JNE',
		courier_service_code: 'reg',
		courier_service_name: 'Reguler',
		duration: '1 - 2 days',
		price: 18000
	},
	{ courier_code: 'jne', courier_service_code: 'bad', price: 'x' }
];

const okFetch = () =>
	vi.fn(async (_url: string, _init?: RequestInit) => ({
		ok: true,
		status: 200,
		json: async () => ({ pricing }),
		text: async () => ''
	}));

beforeEach(() => {
	clearShippingCache();
	vars.BITESHIP_API_KEY = 'bs-key';
	vi.unstubAllGlobals();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ongkir (Biteship + cadangan flat)', () => {
	it('aktif hanya bila API key terpasang DAN kode pos asal 5 digit', () => {
		expect(shippingApiEnabled(cfg)).toBe(true);
		expect(shippingApiEnabled({ ...cfg, shippingOriginPostal: '' })).toBe(false);
		expect(shippingApiEnabled({ ...cfg, shippingOriginPostal: '4121' })).toBe(false);
		vars.BITESHIP_API_KEY = undefined;
		expect(shippingApiEnabled(cfg)).toBe(false);
	});

	it('tanpa API → satu opsi flat dan tidak memanggil jaringan', async () => {
		vars.BITESHIP_API_KEY = undefined;
		const f = okFetch();
		vi.stubGlobal('fetch', f);
		const q = await getShippingOptions(cfg, { postalCode: '40115', weightGrams: 500, value: 1 });
		expect(q).toEqual({ source: 'flat', options: [flatOption(cfg)] });
		expect(f).not.toHaveBeenCalled();
	});

	it('memetakan tarif kurir, mengurutkan termurah, membuang baris rusak, dan mengirim berat/kode pos', async () => {
		const f = okFetch();
		vi.stubGlobal('fetch', f);
		const q = await getShippingOptions(cfg, {
			postalCode: '40115',
			weightGrams: 750,
			value: 90000
		});

		expect(q.source).toBe('api');
		expect(q.options).toEqual([
			{ id: 'jne:reg', label: 'JNE Reguler', price: 18000, etd: '1-2 hari' },
			{ id: 'jnt:ez', label: 'J&T EZ', price: 21000, etd: '2-3 hari' }
		]);

		const [url, init] = f.mock.calls[0];
		expect(url).toBe('https://api.biteship.com/v1/rates/couriers');
		expect((init!.headers as Record<string, string>).authorization).toBe('bs-key');
		const body = JSON.parse(init!.body as string);
		expect(body).toMatchObject({
			origin_postal_code: 41211,
			destination_postal_code: 40115,
			couriers: 'jne,jnt',
			items: [{ weight: 750, value: 90000, quantity: 1 }]
		});
	});

	it('tarif yang sama di-cache singkat; berat berbeda memanggil ulang', async () => {
		const f = okFetch();
		vi.stubGlobal('fetch', f);
		const input = { postalCode: '40115', weightGrams: 750, value: 1 };
		await getShippingOptions(cfg, input);
		await getShippingOptions(cfg, input);
		expect(f).toHaveBeenCalledTimes(1);
		await getShippingOptions(cfg, { ...input, weightGrams: 1500 });
		expect(f).toHaveBeenCalledTimes(2);
	});

	it('API error / kosong / kode pos tak valid → ongkir flat (checkout tidak buntu)', async () => {
		const input = { postalCode: '40115', weightGrams: 500, value: 1 };

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				status: 500,
				text: async () => 'boom',
				json: async () => ({})
			}))
		);
		expect((await getShippingOptions(cfg, input)).source).toBe('flat');

		clearShippingCache();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({ pricing: [] }),
				text: async () => ''
			}))
		);
		expect((await getShippingOptions(cfg, input)).source).toBe('flat');

		clearShippingCache();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('timeout')))
		);
		expect((await getShippingOptions(cfg, input)).source).toBe('flat');

		const f = okFetch();
		vi.stubGlobal('fetch', f);
		expect((await getShippingOptions(cfg, { ...input, postalCode: '12' })).source).toBe('flat');
		expect(f).not.toHaveBeenCalled();
	});
});
