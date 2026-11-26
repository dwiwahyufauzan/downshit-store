/**
 * Ongkir otomatis di checkout: tarif kurir (Biteship, di-stub), harga dihitung ulang di server,
 * cadangan flat, berat keranjang, dan endpoint /api/ongkir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-orders-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file, uploads: `./tests/.tmp-uploads-orders-${rand}` };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: env.uploads,
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

vi.mock('./config', () => ({
	envVar: (n: string) =>
		({ BITESHIP_API_KEY: 'bs-key', ORIGIN: 'http://localhost:5173' })[n as 'ORIGIN']
}));

import { isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { orders, products, settings, users } from './db/schema';
import { getCartDetails } from './cart';
import { clearShippingCache } from './shipping';
import * as checkout from '../../routes/checkout/+page.server';
import * as ongkir from '../../routes/api/ongkir/+server';
import {
	U,
	bundleId,
	buyerId,
	cartAdd,
	catchResult,
	kaosId,
	topiId,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

const pricing = [
	{
		courier_code: 'jne',
		courier_name: 'JNE',
		courier_service_code: 'reg',
		courier_service_name: 'Reguler',
		shipment_duration_range: '2 - 3',
		shipment_duration_unit: 'days',
		price: 18000
	},
	{
		courier_code: 'jnt',
		courier_name: 'J&T',
		courier_service_code: 'ez',
		courier_service_name: 'EZ',
		price: 21000
	}
];

let rateCalls: { weight: number; dest: number }[] = [];
const stubApi = (mode: 'ok' | 'down' = 'ok') =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_u: string, init: RequestInit) => {
			const b = JSON.parse(init.body as string);
			rateCalls.push({ weight: b.items[0].weight, dest: b.destination_postal_code });
			return mode === 'ok'
				? { ok: true, status: 200, json: async () => ({ pricing }), text: async () => '' }
				: { ok: false, status: 503, json: async () => ({}), text: async () => 'down' };
		})
	);

const ADDR = {
	addressMode: 'baru',
	recipientName: 'Budi Santoso',
	recipientPhone: '081234567890',
	province: 'Jawa Barat',
	city: 'Kabupaten Subang',
	district: 'Subang',
	village: 'Soklat',
	addressDetail: 'Jl. Contoh No. 1',
	postalCode: '41211'
};

const form = (fields: Record<string, string>) => {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		locals: U(buyerId),
		request: new Request('http://x', { method: 'POST', body: fd })
	} as never;
};
type ActionFail = { status: number; data: { errors: Record<string, string[]> } };
const failOf = (r: unknown) => (r as { value: ActionFail }).value;
const submit = (fields: Record<string, string>) =>
	catchResult(() => checkout.actions.default(form(fields)));

beforeEach(() => {
	rateCalls = [];
	clearShippingCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	db.insert(settings)
		.values([
			{ key: 'shipping_origin_postal', value: '40115' },
			{ key: 'shipping_flat_cost', value: '15000' }
		])
		.run();
});
afterEach(() => vi.unstubAllGlobals());

describe('berat keranjang', () => {
	it('jumlah berat × qty untuk produk dan paket bundling (jumlah berat komponen); hanya yang dicentang', async () => {
		db.update(products).set({ weightGrams: 400 }).where(eq(products.id, kaosId)).run();
		db.update(products).set({ weightGrams: 100 }).where(eq(products.id, topiId)).run();
		await cartAdd(buyerId, 'product', kaosId, 2); // 800
		await cartAdd(buyerId, 'bundle', bundleId, 1); // kaos 400 + topi 100 = 500
		let c = await getCartDetails(buyerId);
		expect(c.selectedWeight).toBe(1300);
		expect(c.items.find((i) => i.bundleId)!.unitWeight).toBe(500);

		const kaosLine = c.items.find((i) => i.productId === kaosId)!;
		const { setCartItemSelected } = await import('./cart');
		await setCartItemSelected(buyerId, kaosLine.id, false);
		c = await getCartDetails(buyerId);
		expect(c.selectedWeight).toBe(500);
	});
});

describe('checkout dengan tarif kurir', () => {
	it('opsi dipilih → ongkir & layanan dari server tersimpan di pesanan; kode wilayah & pos tersimpan', async () => {
		stubApi();
		await cartAdd(buyerId, 'product', kaosId, 1);
		const r = await submit({ ...ADDR, shippingOption: 'jne:reg', shippingCost: '1' });
		expect(!r.ok && isRedirect(r.error)).toBe(true);

		const o = db.select().from(orders).get()!;
		expect(o.shippingCost).toBe(18000);
		expect(o.total).toBe(100_000 + 18000);
		expect(o.shippingService).toBe('JNE Reguler');
		expect(o.shippingEtd).toBe('2-3 hari');
		expect(o.shippingPostalCode).toBe('41211');
		expect(o.shippingVillageCode).toMatch(/^32\.13\.03\./);
		expect(rateCalls).toEqual([{ weight: 300, dest: 41211 }]);
	});

	it('tarif kurir tersedia tapi layanan tidak dipilih / id tak dikenal → ditolak, tanpa pesanan', async () => {
		stubApi();
		await cartAdd(buyerId, 'product', kaosId, 1);
		for (const extra of [{}, { shippingOption: 'sicepat:halu' }] as Record<string, string>[]) {
			const r = await submit({ ...ADDR, ...extra });
			expect(r.ok).toBe(true);
			const v = failOf(r);
			expect(v.status).toBe(400);
			expect(v.data.errors.shippingOption?.length).toBeGreaterThan(0);
		}
		expect(db.select().from(orders).all()).toHaveLength(0);
	});

	it('API kurir mati → ongkir flat otomatis, checkout tetap jalan', async () => {
		stubApi('down');
		await cartAdd(buyerId, 'product', kaosId, 1);
		const r = await submit({ ...ADDR });
		expect(!r.ok && isRedirect(r.error)).toBe(true);
		const o = db.select().from(orders).get()!;
		expect(o.shippingCost).toBe(15000);
		expect(o.shippingService).toBeNull();
	});

	it('tanpa kode pos asal toko → ongkir flat dan API tidak dipanggil', async () => {
		db.delete(settings).where(eq(settings.key, 'shipping_origin_postal')).run();
		stubApi();
		await cartAdd(buyerId, 'product', kaosId, 1);
		await submit({ ...ADDR });
		expect(rateCalls).toHaveLength(0);
		expect(db.select().from(orders).get()!.shippingCost).toBe(15000);
	});

	it('simpan ke profil menyertakan kode pos & kode desa', async () => {
		stubApi();
		await cartAdd(buyerId, 'product', kaosId, 1);
		await submit({ ...ADDR, shippingOption: 'jnt:ez', saveToProfile: 'on' });
		const u = db.select().from(users).where(eq(users.id, buyerId)).get()!;
		expect(u.addressPostalCode).toBe('41211');
		expect(u.addressVillageCode).toMatch(/^32\.13\.03\./);
	});

	it('kode pos wajib 5 digit pada alamat baru', async () => {
		await cartAdd(buyerId, 'product', kaosId, 1);
		const r = await submit({ ...ADDR, postalCode: '123' });
		const v = failOf(r);
		expect(v.status).toBe(400);
		expect(v.data.errors.postalCode?.length).toBeGreaterThan(0);
	});
});

describe('GET /api/ongkir', () => {
	const call = (qs: string, user = true) =>
		catchResult(
			() =>
				ongkir.GET({
					locals: user ? U(buyerId) : { user: null, sessionId: null },
					url: new URL(`http://x/api/ongkir?${qs}`)
				} as never) as Promise<Response>
		);

	it('mengembalikan opsi + berat untuk item yang dicentang', async () => {
		stubApi();
		await cartAdd(buyerId, 'product', kaosId, 2);
		const r = await call('postal=40115');
		expect(r.ok).toBe(true);
		const body = await (r as unknown as { value: Response }).value.json();
		expect(body.source).toBe('api');
		expect(body.weightGrams).toBe(600);
		expect(body.options.map((o: { id: string }) => o.id)).toEqual(['jne:reg', 'jnt:ez']);
	});

	it('harus login, kode pos 5 digit, dan ada item terpilih', async () => {
		stubApi();
		const guest = await call('postal=40115', false);
		expect(!guest.ok && isRedirect(guest.error)).toBe(true);

		await cartAdd(buyerId, 'product', kaosId, 1);
		const bad = await call('postal=12');
		expect(!bad.ok && bad.error.status).toBe(400);

		const { setAllCartItemsSelected } = await import('./cart');
		await setAllCartItemsSelected(buyerId, false);
		const none = await call('postal=40115');
		expect(!none.ok && none.error.status).toBe(400);
	});
});
