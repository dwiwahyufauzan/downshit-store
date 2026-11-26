/**
 * Notifikasi "stok kembali tersedia": pendaftaran (hanya varian yang habis), pengiriman email saat stok
 * kembali (sekali per permintaan), dan batas-batasnya.
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

import { eq } from 'drizzle-orm';
import { db } from './db';
import { productSizes, products, stockSubscriptions } from './db/schema';
import { setMailTransport, type Mail } from './mail';
import {
	MAX_PENDING_ALERTS,
	notifyRestocked,
	pendingAlertSizes,
	subscribeStockAlert,
	unsubscribeStockAlert
} from './stock-alerts';
import { buyerId, buyer2Id, kaosId, topiId, useOrdersFixture } from './orders.fixture';

useOrdersFixture();

let outbox: Mail[] = [];
beforeEach(() => {
	outbox = [];
	setMailTransport(async (m) => {
		outbox.push(m);
	});
});
afterEach(() => setMailTransport(null));

const setStock = (id: number, stock: number) =>
	db.update(products).set({ stock }).where(eq(products.id, id)).run();
const addSizes = (productId: number, sizes: Record<string, number>) => {
	for (const [label, stock] of Object.entries(sizes)) {
		db.insert(productSizes).values({ productId, label, stock }).run();
	}
	db.update(products)
		.set({ stock: Object.values(sizes).reduce((a, b) => a + b, 0) })
		.where(eq(products.id, productId))
		.run();
};

describe('mendaftar pengingat stok', () => {
	it('hanya varian yang sedang habis; produk tersedia ditolak', () => {
		expect(subscribeStockAlert(buyerId, kaosId, '')).toMatchObject({
			ok: false,
			message: expect.stringMatching(/masih tersedia/)
		});
		setStock(kaosId, 0);
		expect(subscribeStockAlert(buyerId, kaosId, '')).toEqual({ ok: true });
		expect(pendingAlertSizes(buyerId, kaosId)).toEqual(['']);
	});

	it('produk ber-ukuran: harus memilih ukuran yang habis; ukuran tak dikenal / masih ada stok ditolak', () => {
		addSizes(kaosId, { S: 0, M: 3 });
		expect(subscribeStockAlert(buyerId, kaosId, '').ok).toBe(false);
		expect(subscribeStockAlert(buyerId, kaosId, 'XXL').ok).toBe(false);
		expect(subscribeStockAlert(buyerId, kaosId, 'M').ok).toBe(false); // masih ada
		expect(subscribeStockAlert(buyerId, kaosId, ' s ')).toEqual({ ok: true }); // dinormalkan
		expect(pendingAlertSizes(buyerId, kaosId)).toEqual(['S']);
	});

	it('produk nonaktif / tak ada ditolak; ganda tidak membuat baris baru; batal menghapus', () => {
		setStock(kaosId, 0);
		subscribeStockAlert(buyerId, kaosId, '');
		subscribeStockAlert(buyerId, kaosId, '');
		expect(db.select().from(stockSubscriptions).all()).toHaveLength(1);
		unsubscribeStockAlert(buyerId, kaosId, '');
		expect(db.select().from(stockSubscriptions).all()).toHaveLength(0);

		db.update(products).set({ isActive: false }).where(eq(products.id, kaosId)).run();
		expect(subscribeStockAlert(buyerId, kaosId, '').ok).toBe(false);
		expect(subscribeStockAlert(buyerId, 99999, '').ok).toBe(false);
	});

	it(`maksimal ${MAX_PENDING_ALERTS} pengingat menunggu per pengguna`, () => {
		setStock(kaosId, 0);
		const sizes = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`S${i}`, 0]));
		addSizes(kaosId, sizes);
		db.insert(stockSubscriptions)
			.values(
				Array.from({ length: MAX_PENDING_ALERTS }, (_, i) => ({
					userId: buyerId,
					productId: topiId,
					size: `X${i}`
				}))
			)
			.run();
		const r = subscribeStockAlert(buyerId, kaosId, 'S0');
		expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/Maksimal/) });
		expect(subscribeStockAlert(buyer2Id, kaosId, 'S0').ok).toBe(true); // pengguna lain tidak terpengaruh
	});
});

describe('mengirim kabar saat stok kembali', () => {
	it('email terkirim sekali saat stok tersedia, lalu tidak diulang', async () => {
		setStock(kaosId, 0);
		subscribeStockAlert(buyerId, kaosId, '');
		expect(await notifyRestocked()).toBe(0); // masih habis
		expect(outbox).toHaveLength(0);

		setStock(kaosId, 4);
		expect(await notifyRestocked()).toBe(1);
		expect(outbox).toHaveLength(1);
		expect(outbox[0].to).toBe('b@x.id');
		expect(outbox[0].text).toContain('Kaos Classic - L');
		expect(outbox[0].text).toContain('/produk/kaos-classic-l');
		expect(db.select().from(stockSubscriptions).get()!.notifiedAt).not.toBeNull();

		expect(await notifyRestocked()).toBe(0);
		expect(pendingAlertSizes(buyerId, kaosId)).toEqual([]);
	});

	it('beberapa ukuran satu produk digabung jadi satu email; ukuran yang masih habis menunggu', async () => {
		addSizes(kaosId, { S: 0, M: 0, L: 0 });
		for (const s of ['S', 'M', 'L']) subscribeStockAlert(buyerId, kaosId, s);
		db.update(productSizes).set({ stock: 5 }).where(eq(productSizes.label, 'S')).run();
		db.update(productSizes).set({ stock: 2 }).where(eq(productSizes.label, 'M')).run();
		db.update(products).set({ stock: 7 }).where(eq(products.id, kaosId)).run();

		expect(await notifyRestocked()).toBe(1);
		expect(outbox[0].text).toMatch(/ukuran S, M/);
		expect(pendingAlertSizes(buyerId, kaosId)).toEqual(['L']);
	});

	it('kirim gagal → tetap menunggu dan dicoba lagi; tanpa email terkonfigurasi → tidak berbuat apa-apa', async () => {
		setStock(kaosId, 0);
		subscribeStockAlert(buyerId, kaosId, '');
		setStock(kaosId, 3);

		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		setMailTransport(async () => {
			throw new Error('mati');
		});
		expect(await notifyRestocked()).toBe(0);
		expect(pendingAlertSizes(buyerId, kaosId)).toEqual(['']);
		err.mockRestore();

		setMailTransport(null);
		expect(await notifyRestocked()).toBe(0);
		expect(pendingAlertSizes(buyerId, kaosId)).toEqual(['']);

		setMailTransport(async (m) => {
			outbox.push(m);
		});
		expect(await notifyRestocked()).toBe(1);
	});

	it('produk dinonaktifkan sebelum stok kembali → tidak ada email', async () => {
		setStock(kaosId, 0);
		subscribeStockAlert(buyerId, kaosId, '');
		setStock(kaosId, 5);
		db.update(products).set({ isActive: false }).where(eq(products.id, kaosId)).run();
		expect(await notifyRestocked()).toBe(0);
	});
});
