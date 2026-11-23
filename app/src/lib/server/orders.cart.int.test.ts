/**
 * Keranjang & checkout atomik (SRS-F-009; BR-06/07/08/13/17/18/20).
 * Memakai DB SQLite terisolasi (salinan skema kosong dari tests/global-setup.ts) + fixture bersama orders.fixture.ts.
 */
import { describe, expect, it, vi } from 'vitest';

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
import {
	bundles,
	cartItems,
	carts,
	orderItems,
	orders,
	products,
	settings,
	shipments,
	stockMovements,
	users
} from './db/schema';
import { addToCart, availableStock, getCartDetails, updateCartItemQuantity } from './cart';
import { cancelOrder, createOrderFromCart, OrderError } from './orders';
import { submitPaymentProof } from './order-flow';
import {
	SHIP,
	bundleId,
	bundleStock,
	buyer2Id,
	buyerId,
	cartAdd,
	hoodieId,
	kaosId,
	logsOf,
	newOrder,
	orderOf,
	paysOf,
	stockOf,
	topiId,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

/* ====================================================================== */
describe('keranjang (SRS-F-009, TC-009-01…05)', () => {
	it('item yang sama menambah qty, tidak ada baris ganda (TC-009-02)', async () => {
		await cartAdd(buyerId, 'product', kaosId, 2);
		await cartAdd(buyerId, 'product', kaosId, 3);
		const rows = db.select().from(cartItems).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].quantity).toBe(5);
	});

	it('klik ganda cepat (paralel) tidak menggandakan baris maupun melewati stok', async () => {
		const res = await Promise.all(
			Array.from({ length: 12 }, () => addToCart(buyerId, 'product', kaosId, 1))
		);
		expect(res.filter((r) => r.ok)).toHaveLength(10); // stok 10
		const rows = db.select().from(cartItems).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].quantity).toBe(10);
	});

	it('indeks unik uq_ci_product mencegah baris ganda walau lewat INSERT langsung', async () => {
		await cartAdd(buyerId, 'product', kaosId, 1);
		const cart = db.select().from(carts).get()!;
		expect(() =>
			db.insert(cartItems).values({ cartId: cart.id, productId: kaosId, quantity: 1 }).run()
		).toThrow(/UNIQUE/);
	});

	it('qty melebihi stok: pesan "Stok tersedia hanya N"; stok 0: "Stok habis" (TC-009-04)', async () => {
		const r = await addToCart(buyerId, 'product', topiId, 6);
		expect(r).toMatchObject({ ok: false, message: 'Stok tersedia hanya 5' });
		db.update(products).set({ stock: 0 }).where(eq(products.id, topiId)).run();
		expect(await addToCart(buyerId, 'product', topiId, 1)).toMatchObject({
			ok: false,
			message: 'Stok habis'
		});
		expect(db.select().from(cartItems).all()).toHaveLength(0);
	});

	it.each([0, -1, 1.5, 100, Number.NaN])('qty %s ditolak', async (qty) => {
		expect((await addToCart(buyerId, 'product', kaosId, qty)).ok).toBe(false);
		expect(db.select().from(cartItems).all()).toHaveLength(0);
	});

	it('batas 99 per baris', async () => {
		db.update(products).set({ stock: 500 }).where(eq(products.id, kaosId)).run();
		await cartAdd(buyerId, 'product', kaosId, 99);
		expect(await addToCart(buyerId, 'product', kaosId, 1)).toMatchObject({ ok: false });
		expect(db.select().from(cartItems).get()!.quantity).toBe(99);
	});

	it('produk nonaktif / terhapus tidak bisa ditambahkan', async () => {
		db.update(products).set({ isActive: false }).where(eq(products.id, topiId)).run();
		expect((await addToCart(buyerId, 'product', topiId, 1)).ok).toBe(false);
		db.update(products)
			.set({ isActive: true, deletedAt: new Date().toISOString() })
			.where(eq(products.id, topiId))
			.run();
		expect((await addToCart(buyerId, 'product', topiId, 1)).ok).toBe(false);
	});

	it('stok efektif bundling = min(kuota, ⌊stok komponen ÷ qty⌋) (TC-005-11)', async () => {
		db.update(bundles).set({ stock: 15 }).run();
		db.update(products).set({ stock: 3 }).where(eq(products.id, kaosId)).run();
		expect(await availableStock('bundle', bundleId)).toBe(3);
		expect(await addToCart(buyerId, 'bundle', bundleId, 4)).toMatchObject({
			ok: false,
			message: 'Stok tersedia hanya 3'
		});
		expect((await addToCart(buyerId, 'bundle', bundleId, 3)).ok).toBe(true);
	});

	it('bundling dengan komponen nonaktif = stok 0', async () => {
		db.update(products).set({ isActive: false }).where(eq(products.id, topiId)).run();
		expect(await availableStock('bundle', bundleId)).toBe(0);
	});

	it('ubah qty memakai nilai absolut, hanya untuk baris milik sendiri', async () => {
		await cartAdd(buyerId, 'product', kaosId, 2);
		const line = db.select().from(cartItems).get()!;
		expect((await updateCartItemQuantity(buyerId, line.id, 7)).ok).toBe(true);
		expect(db.select().from(cartItems).get()!.quantity).toBe(7);
		expect((await updateCartItemQuantity(buyerId, line.id, 7)).ok).toBe(true);
		expect(db.select().from(cartItems).get()!.quantity).toBe(7);
		expect(await updateCartItemQuantity(buyerId, line.id, 11)).toMatchObject({ ok: false });
		expect(await updateCartItemQuantity(buyer2Id, line.id, 1)).toMatchObject({
			ok: false,
			message: 'Item keranjang tidak ditemukan'
		});
	});

	it('baris bermasalah (stok berkurang / nonaktif) ditandai dan tidak masuk subtotal', async () => {
		await cartAdd(buyerId, 'product', kaosId, 5);
		await cartAdd(buyerId, 'product', topiId, 2);
		await cartAdd(buyerId, 'product', hoodieId, 1);
		db.update(products).set({ stock: 3 }).where(eq(products.id, kaosId)).run();
		db.update(products).set({ isActive: false }).where(eq(products.id, topiId)).run();
		const c = await getCartDetails(buyerId);
		const by = (id: number) => c.items.find((i) => i.productId === id)!;
		expect(by(kaosId).problem).toBe('stok');
		expect(by(topiId).problem).toBe('nonaktif');
		expect(by(hoodieId).problem).toBeNull();
		expect(c.subtotal).toBe(250_000); // hanya hoodie
	});
});

/* ====================================================================== */
describe('checkout atomik (SRS-F-009, BR-06/07/08/13/17/18/20)', () => {
	it('membuat pesanan: kode, expires_at, stok berkurang, keranjang kosong (TC-009-06)', async () => {
		await cartAdd(buyerId, 'product', kaosId, 2);
		const { orderId, code } = await createOrderFromCart(buyerId, SHIP);
		expect(code).toMatch(/^DWN-\d{6}-[0-9A-F]{6}$/);
		const o = orderOf(orderId);
		expect(o.status).toBe('menunggu_pembayaran');
		expect(o.subtotal).toBe(200_000);
		expect(o.shippingCost).toBe(15_000);
		expect(o.total).toBe(215_000);
		const hours = (Date.parse(o.expiresAt!) - Date.now()) / 3_600_000;
		expect(hours).toBeGreaterThan(23.9);
		expect(hours).toBeLessThan(24.1);
		expect(stockOf(kaosId)).toBe(8);
		expect(db.select().from(cartItems).all()).toHaveLength(0);
		expect(logsOf(orderId).map((l) => l.action)).toContain('order.create');
	});

	it('KNOWN ISSUE: checkout TIDAK membuat baris payments (BR-20); baris pengiriman awal ada', async () => {
		const { orderId } = await newOrder();
		expect(paysOf(orderId)).toHaveLength(0);
		const sh = db.select().from(shipments).where(eq(shipments.orderId, orderId)).get()!;
		expect(sh.status).toBe('belum_dikirim');
		expect(sh.courier).toBeNull();
		expect(sh.trackingNumber).toBeNull();
	});

	it('bundling: stok paket DAN komponen berkurang, snapshot komponen tersimpan (BR-06, TC-009-10)', async () => {
		await cartAdd(buyerId, 'bundle', bundleId, 2);
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		expect(bundleStock()).toBe(1);
		expect(stockOf(kaosId)).toBe(8);
		expect(stockOf(topiId)).toBe(3);
		const item = db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).get()!;
		expect(item.itemType).toBe('bundle');
		expect(item.itemName).toBe('Paket Hemat');
		expect(item.unitPrice).toBe(130_000);
	});

	it('snapshot nama & harga tidak berubah saat produk diubah (BR-13)', async () => {
		const { orderId } = await newOrder(buyerId, kaosId, 2);
		db.update(products)
			.set({ price: 999_999, name: 'Nama Baru' })
			.where(eq(products.id, kaosId))
			.run();
		const it = db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).get()!;
		expect(it.itemName).toBe('Kaos Classic - L');
		expect(it.unitPrice).toBe(100_000);
		expect(orderOf(orderId).total).toBe(215_000);
	});

	it('total dihitung dari harga DB saat checkout (harga di keranjang/klien diabaikan, TC-009-12)', async () => {
		await cartAdd(buyerId, 'product', kaosId, 1);
		db.update(products).set({ price: 120_000 }).where(eq(products.id, kaosId)).run();
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		expect(orderOf(orderId).subtotal).toBe(120_000);
	});

	it('ongkir flat & batas bayar mengikuti pengaturan toko (BR-15, BR-17)', async () => {
		db.insert(settings)
			.values([
				{ key: 'shipping_flat_cost', value: '20000' },
				{ key: 'payment_deadline_hours', value: '2' }
			])
			.run();
		const { orderId } = await newOrder();
		const o = orderOf(orderId);
		expect(o.shippingCost).toBe(20_000);
		expect(o.total).toBe(120_000);
		const hours = (Date.parse(o.expiresAt!) - Date.now()) / 3_600_000;
		expect(hours).toBeGreaterThan(1.9);
		expect(hours).toBeLessThan(2.1);
	});

	it('alamat disimpan ke profil hanya bila diminta', async () => {
		await newOrder();
		expect(db.select().from(users).where(eq(users.id, buyerId)).get()!.address).toBeNull();
		await cartAdd(buyerId, 'product', kaosId, 1);
		await createOrderFromCart(buyerId, { ...SHIP, saveToProfile: true });
		const u = db.select().from(users).where(eq(users.id, buyerId)).get()!;
		expect(u.address).toBe(SHIP.shippingAddress);
		expect(u.phone).toBe(SHIP.recipientPhone);
	});

	it('keranjang kosong ditolak (TC-009-08)', async () => {
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toThrow(/kosong/i);
	});

	it('stok kurang di item kedua → rollback total, keranjang & stok utuh (TC-009-09)', async () => {
		await cartAdd(buyerId, 'product', kaosId, 3);
		await cartAdd(buyerId, 'product', topiId, 5);
		db.update(products).set({ stock: 2 }).where(eq(products.id, topiId)).run();
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toBeInstanceOf(OrderError);
		expect(stockOf(kaosId)).toBe(10);
		expect(stockOf(topiId)).toBe(2);
		expect(db.select().from(orders).all()).toHaveLength(0);
		expect(db.select().from(orderItems).all()).toHaveLength(0);
		expect(db.select().from(stockMovements).all()).toHaveLength(0);
		expect(db.select().from(cartItems).all()).toHaveLength(2);
	});

	it('produk langsung + komponen bundling yang sama dihitung bersama (stok tidak boleh negatif)', async () => {
		// topi stok 5: 3 langsung + 3 paket (1 topi/paket) = 6 > 5
		await cartAdd(buyerId, 'product', topiId, 3);
		await cartAdd(buyerId, 'bundle', bundleId, 3);
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toBeInstanceOf(OrderError);
		expect(stockOf(topiId)).toBe(5);
		expect(stockOf(kaosId)).toBe(10);
		expect(bundleStock()).toBe(3);
		expect(db.select().from(orders).all()).toHaveLength(0);
	});

	it('produk dinonaktifkan setelah masuk keranjang → checkout ditolak, tanpa efek samping', async () => {
		await cartAdd(buyerId, 'product', kaosId, 1);
		await cartAdd(buyerId, 'product', topiId, 1);
		db.update(products).set({ isActive: false }).where(eq(products.id, topiId)).run();
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toBeInstanceOf(OrderError);
		expect(stockOf(kaosId)).toBe(10);
		expect(db.select().from(orders).all()).toHaveLength(0);
	});

	it('komponen bundling nonaktif → checkout ditolak', async () => {
		await cartAdd(buyerId, 'bundle', bundleId, 1);
		db.update(products).set({ isActive: false }).where(eq(products.id, topiId)).run();
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toBeInstanceOf(OrderError);
		expect(bundleStock()).toBe(3);
		expect(stockOf(kaosId)).toBe(10);
	});

	it('batas pesanan belum bayar (BR-18, TC-009-14): ditolak, lalu bisa lagi setelah dibatalkan', async () => {
		const first = await newOrder();
		await newOrder();
		await newOrder();
		await cartAdd(buyerId, 'product', kaosId, 1);
		const stockBefore = stockOf(kaosId);
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toThrow(/belum dibayar/);
		expect(stockOf(kaosId)).toBe(stockBefore);
		expect(db.select().from(cartItems).all()).toHaveLength(1);

		await cancelOrder(first.orderId, { id: buyerId, role: 'konsumen' }, 'x');
		await expect(createOrderFromCart(buyerId, SHIP)).resolves.toBeTruthy();
	});

	it('pesanan menunggu_konfirmasi tidak dihitung ke batas pesanan belum bayar', async () => {
		db.insert(settings).values({ key: 'max_unpaid_orders', value: '1' }).run();
		const o = await newOrder();
		await submitPaymentProof(o.code, buyerId, '/uploads/proofs/a.png');
		await expect(newOrder()).resolves.toBeTruthy();
	});

	it('dua checkout bersamaan untuk stok terakhir: satu berhasil, stok tidak negatif (TC-009-11)', async () => {
		db.update(products).set({ stock: 1 }).where(eq(products.id, kaosId)).run();
		await cartAdd(buyerId, 'product', kaosId, 1);
		db.insert(cartItems)
			.values({
				cartId: db.insert(carts).values({ userId: buyer2Id }).returning().get().id,
				productId: kaosId,
				quantity: 1
			})
			.run();
		const res = await Promise.allSettled([
			createOrderFromCart(buyerId, SHIP),
			createOrderFromCart(buyer2Id, SHIP)
		]);
		expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(stockOf(kaosId)).toBe(0);
		expect(db.select().from(orders).all()).toHaveLength(1);
	});

	it('checkout paralel dengan urutan item berlawanan: keduanya berhasil, tanpa deadlock (TC-009-15)', async () => {
		db.update(products).set({ stock: 20 }).run();
		await cartAdd(buyerId, 'product', kaosId, 2);
		await cartAdd(buyerId, 'product', topiId, 2);
		await cartAdd(buyer2Id, 'product', topiId, 3);
		await cartAdd(buyer2Id, 'product', kaosId, 3);
		const res = await Promise.allSettled([
			createOrderFromCart(buyerId, SHIP),
			createOrderFromCart(buyer2Id, SHIP)
		]);
		expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
		expect(stockOf(kaosId)).toBe(15);
		expect(stockOf(topiId)).toBe(15);
	});
});
