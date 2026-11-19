/**
 * Uji integrasi konsumen, pesanan, pembayaran & pengiriman (SRS-F-005, 008, 009, 010, 014;
 * BR-06…08, 10, 11, 13, 17, 18, 20, 22). Memakai DB SQLite terisolasi (salinan skema kosong
 * dari tests/global-setup.ts) sehingga aman dijalankan paralel dengan tes lain.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
	CRON_SECRET: 'x'.repeat(32)
}));

import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { and, count, eq } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import { db } from './db';
import {
	activityLogs,
	bundleItems,
	bundles,
	cartItems,
	carts,
	categories,
	orderItems,
	orders,
	payments,
	products,
	settings,
	shipments,
	stockMovements,
	users
} from './db/schema';
import { addToCart, availableStock, getCartDetails, updateCartItemQuantity } from './cart';
import { cancelOrder, createOrderFromCart, expireUnpaidOrders, OrderError } from './orders';
import {
	autoCompleteShippedOrders,
	completeOrder,
	runLightMaintenance,
	confirmPayment,
	rejectPayment,
	shipOrder,
	submitPaymentProof,
	updateShipment
} from './order-flow';
import { allowedNext, canCancel } from './order-status';
import * as detail from '../../routes/pesanan/[kode]/+page.server';
import * as riwayat from '../../routes/pesanan/+page.server';
import * as katalog from '../../routes/produk/+page.server';
import * as produkDetail from '../../routes/produk/[slug]/+page.server';
import * as bundleDetail from '../../routes/bundling/[slug]/+page.server';
import * as adminList from '../../routes/admin/pesanan/+page.server';
import * as adminDetail from '../../routes/admin/pesanan/[kode]/+page.server';
import * as keranjang from '../../routes/keranjang/+page.server';
import * as checkout from '../../routes/checkout/+page.server';
import * as uploads from '../../routes/uploads/[...path]/+server';
import * as maintenance from '../../routes/internal/maintenance/+server';
import { CATALOG_PAGE_SIZE } from '../constants';

const SHIP = {
	recipientName: 'Budi Santoso',
	recipientPhone: '081234567890',
	shippingAddress: 'Jl. Contoh No. 1 Subang'
};

const dayMs = 86_400_000;
// PNG 1x1 yang valid (upload.ts meng-encode ulang gambar, jadi berkas palsu ditolak)
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

let buyerId: number;
let buyer2Id: number;
let adminId: number;
let ownerId: number;
let catId: number;
let kaosId: number;
let topiId: number;
let hoodieId: number;
let bundleId: number;

/** Pengaman: jangan pernah menghapus data kecuali ini DB tes sementara milik berkas ini. */
function assertTestDb() {
	if (!/\.tmp-orders-/.test(env.file)) throw new Error('MENOLAK reset: bukan DB tes pesanan');
}

function reset() {
	assertTestDb();
	for (const t of [
		activityLogs,
		stockMovements,
		cartItems,
		carts,
		payments,
		shipments,
		orderItems,
		orders,
		bundleItems,
		bundles,
		products,
		categories,
		settings,
		users
	]) {
		db.delete(t).run();
	}
	const mkUser = (name: string, role: 'konsumen' | 'admin' | 'owner', email: string) =>
		db
			.insert(users)
			.values({ name, email, passwordHash: 'x', role })
			.returning({ id: users.id })
			.get().id;
	buyerId = mkUser('Buyer', 'konsumen', 'b@x.id');
	buyer2Id = mkUser('Buyer Dua', 'konsumen', 'b2@x.id');
	adminId = mkUser('Admin', 'admin', 'a@x.id');
	ownerId = mkUser('Owner', 'owner', 'o@x.id');
	catId = db
		.insert(categories)
		.values({ name: 'Kaos', slug: 'kaos' })
		.returning({ id: categories.id })
		.get().id;
	const mkProd = (name: string, slug: string, price: number, stock: number, categoryId?: number) =>
		db
			.insert(products)
			.values({ name, slug, price, stock, categoryId })
			.returning({ id: products.id })
			.get().id;
	kaosId = mkProd('Kaos Classic - L', 'kaos-classic-l', 100_000, 10, catId);
	topiId = mkProd('Topi', 'topi', 50_000, 5);
	hoodieId = mkProd('Hoodie', 'hoodie', 250_000, 4);
	bundleId = db
		.insert(bundles)
		.values({ name: 'Paket Hemat', slug: 'paket-hemat', price: 130_000, stock: 3 })
		.returning({ id: bundles.id })
		.get().id;
	db.insert(bundleItems)
		.values([
			{ bundleId, productId: kaosId, quantity: 1 },
			{ bundleId, productId: topiId, quantity: 1 }
		])
		.run();
}

const stockOf = (id: number) => db.select().from(products).where(eq(products.id, id)).get()!.stock;
const bundleStock = () => db.select().from(bundles).get()!.stock;
const orderOf = (id: number) => db.select().from(orders).where(eq(orders.id, id)).get()!;
const paysOf = (orderId: number) =>
	db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(payments.id).all();
const logsOf = (orderId: number) =>
	db
		.select()
		.from(activityLogs)
		.where(and(eq(activityLogs.entity, 'order'), eq(activityLogs.entityId, orderId)))
		.all();
const U = (id: number, role: 'konsumen' | 'admin' | 'owner' = 'konsumen') =>
	({
		user: { id, role, name: 'x', email: 'x@x.id', mustChangePassword: false },
		sessionId: 's'
	}) as never;
const GUEST = { user: null, sessionId: null } as never;

async function cartAdd(userId: number, kind: 'product' | 'bundle', id: number, qty: number) {
	const r = await addToCart(userId, kind, id, qty);
	if (!r.ok) throw new Error(r.message);
}

async function newOrder(userId = buyerId, product = kaosId, qty = 1) {
	await cartAdd(userId, 'product', product, qty);
	return createOrderFromCart(userId, SHIP);
}

/** Pesanan sampai status `diproses` */
async function paidOrder() {
	const o = await newOrder();
	await submitPaymentProof(o.code, buyerId, '/uploads/proofs/a.png');
	await confirmPayment(o.code, adminId);
	return o;
}

const expireNow = (orderId: number) =>
	db
		.update(orders)
		.set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
		.where(eq(orders.id, orderId))
		.run();

async function catchResult<T>(fn: () => Promise<T> | T) {
	try {
		return { ok: true as const, value: await fn() };
	} catch (e) {
		return { ok: false as const, error: e as { status?: number; kind?: string; message?: string } };
	}
}

beforeEach(reset);

afterAll(() => {
	assertTestDb();
	db.$client.close();
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
	rmSync(env.uploads, { recursive: true, force: true });
});

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

/* ====================================================================== */
describe('pembayaran: satu baris per unggahan (BR-20, TC-008-*, TC-010-08)', () => {
	it('unggah bukti membuat 1 baris menunggu; status pesanan menunggu_konfirmasi', async () => {
		const { orderId, code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		const pays = paysOf(orderId);
		expect(pays).toHaveLength(1);
		expect(pays[0]).toMatchObject({
			status: 'menunggu',
			proofUrl: '/uploads/proofs/a.png',
			amount: 115_000
		});
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
		expect(logsOf(orderId).map((l) => l.action)).toContain('payment.proof');
	});

	it('tolak → ditolak+alasan, pesanan kembali menunggu_pembayaran, batas bayar diperpanjang; unggah ulang = baris ke-2 (TC-008-05/10)', async () => {
		const { orderId, code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		const short = new Date(Date.now() + 60_000).toISOString();
		db.update(orders).set({ expiresAt: short }).where(eq(orders.id, orderId)).run();

		await rejectPayment(code, adminId, 'Nominal tidak sesuai');
		let o = orderOf(orderId);
		expect(o.status).toBe('menunggu_pembayaran');
		expect(Date.parse(o.expiresAt!)).toBeGreaterThan(Date.now() + 23 * 3_600_000);

		await submitPaymentProof(code, buyerId, '/uploads/proofs/b.png');
		o = orderOf(orderId);
		expect(o.status).toBe('menunggu_konfirmasi');
		const pays = paysOf(orderId);
		expect(pays.map((p) => p.status)).toEqual(['ditolak', 'menunggu']);
		expect(pays[0].note).toBe('Nominal tidak sesuai');
		expect(pays[0].proofUrl).toBe('/uploads/proofs/a.png');
		expect(pays[0].confirmedBy).toBe(adminId);
	});

	it('tolak tanpa alasan / alasan < 5 karakter ditolak (TC-008-04)', async () => {
		const { orderId, code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		for (const reason of ['', '   ', 'abc']) {
			await expect(rejectPayment(code, adminId, reason)).rejects.toThrow(/Alasan/);
		}
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
		expect(paysOf(orderId)[0].status).toBe('menunggu');
	});

	it('konfirmasi tanpa bukti ditolak (TC-008-06); konfirmasi mencatat admin & waktu (TC-008-03)', async () => {
		const { orderId, code } = await newOrder();
		await expect(confirmPayment(code, adminId)).rejects.toBeInstanceOf(OrderError);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
		expect(paysOf(orderId)).toHaveLength(0);

		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		const p = paysOf(orderId)[0];
		expect(p).toMatchObject({ status: 'dikonfirmasi', confirmedBy: adminId });
		expect(p.confirmedAt).toBeTruthy();
		expect(orderOf(orderId).status).toBe('diproses');
	});

	it('unggah oleh pemilik lain = tidak ditemukan; unggah ke pesanan non-menunggu_pembayaran ditolak', async () => {
		const { code, orderId } = await newOrder();
		await expect(submitPaymentProof(code, buyer2Id, '/uploads/proofs/a.png')).rejects.toMatchObject(
			{ kind: 'not_found' }
		);
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await expect(submitPaymentProof(code, buyerId, '/uploads/proofs/b.png')).rejects.toThrow(
			/menunggu pembayaran/
		);
		expect(paysOf(orderId)).toHaveLength(1);
	});

	it('unggah pada pesanan yang sudah lewat batas bayar ditolak (TC-010-13)', async () => {
		const { code, orderId } = await newOrder();
		expireNow(orderId);
		await expect(submitPaymentProof(code, buyerId, '/uploads/proofs/a.png')).rejects.toThrow(
			/Batas waktu/
		);
		expect(paysOf(orderId)).toHaveLength(0);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});
});

/* ====================================================================== */
describe('pembatalan (BR-10, BR-20, TC-010-04…07, TC-008-09)', () => {
	it('konsumen batal saat menunggu_pembayaran: stok produk, paket & komponen kembali (TC-010-04/07)', async () => {
		await cartAdd(buyerId, 'bundle', bundleId, 2);
		await cartAdd(buyerId, 'product', kaosId, 1);
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'Salah pilih');
		expect(stockOf(kaosId)).toBe(10);
		expect(stockOf(topiId)).toBe(5);
		expect(bundleStock()).toBe(3);
		const o = orderOf(orderId);
		expect(o).toMatchObject({ status: 'dibatalkan', cancelReason: 'Salah pilih' });
		expect(o.cancelledAt).toBeTruthy();
		expect(logsOf(orderId).map((l) => l.action)).toContain('order.cancel');
	});

	it('konsumen batal saat menunggu_konfirmasi: stok kembali, bukti menunggu → ditolak "Pesanan dibatalkan" (TC-010-05)', async () => {
		const { orderId, code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'Batal');
		expect(stockOf(kaosId)).toBe(10);
		const p = paysOf(orderId);
		expect(p).toHaveLength(1);
		expect(p[0]).toMatchObject({ status: 'ditolak', note: 'Pesanan dibatalkan' });
	});

	it('konsumen tidak bisa batal saat diproses (TC-010-06); admin bisa → payment dikembalikan (TC-008-09)', async () => {
		const { orderId } = await paidOrder();
		await expect(cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x')).rejects.toThrow(
			'Pesanan sudah diproses dan tidak dapat dibatalkan'
		);
		expect(stockOf(kaosId)).toBe(9);

		await cancelOrder(orderId, { id: adminId, role: 'admin' }, 'Barang cacat saat packing');
		expect(stockOf(kaosId)).toBe(10);
		expect(paysOf(orderId)[0].status).toBe('dikembalikan');
		expect(paysOf(orderId)[0].note).toMatch(/Pesanan dibatalkan/);
		expect(orderOf(orderId).status).toBe('dibatalkan');
	});

	it('admin wajib beri alasan ≥ 5 karakter; tanpa itu tidak ada perubahan', async () => {
		const { orderId } = await paidOrder();
		for (const reason of ['', '  ', 'abc']) {
			await expect(cancelOrder(orderId, { id: adminId, role: 'admin' }, reason)).rejects.toThrow(
				/Alasan pembatalan wajib/
			);
		}
		expect(orderOf(orderId).status).toBe('diproses');
		expect(stockOf(kaosId)).toBe(9);
		expect(paysOf(orderId)[0].status).toBe('dikonfirmasi');
	});

	it('tidak ada yang bisa membatalkan pesanan dikirim/selesai/dibatalkan', async () => {
		const { orderId, code } = await paidOrder();
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });
		for (const role of ['konsumen', 'admin'] as const) {
			await expect(
				cancelOrder(orderId, { id: role === 'admin' ? adminId : buyerId, role }, 'alasan jelas')
			).rejects.toBeInstanceOf(OrderError);
		}
		await completeOrder(code, { id: buyerId, role: 'konsumen' });
		await expect(
			cancelOrder(orderId, { id: adminId, role: 'admin' }, 'alasan jelas')
		).rejects.toBeInstanceOf(OrderError);
		expect(orderOf(orderId).status).toBe('selesai');
	});

	it('pembatalan ganda tidak menggandakan stok', async () => {
		const { orderId } = await newOrder(buyerId, kaosId, 3);
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x');
		await expect(
			cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x')
		).rejects.toBeInstanceOf(OrderError);
		await expect(
			cancelOrder(orderId, { id: adminId, role: 'admin' }, 'alasan jelas')
		).rejects.toBeInstanceOf(OrderError);
		expect(stockOf(kaosId)).toBe(10);
	});

	it('konsumen lain → not_found; aturan CANCELLABLE_BY terpusat', async () => {
		const { orderId } = await newOrder();
		await expect(
			cancelOrder(orderId, { id: buyer2Id, role: 'konsumen' }, 'x')
		).rejects.toMatchObject({ kind: 'not_found' });
		expect(canCancel('konsumen', 'diproses')).toBe(false);
		expect(canCancel('admin', 'diproses')).toBe(true);
		expect(canCancel('system', 'menunggu_konfirmasi')).toBe(false);
		expect(canCancel('system', 'menunggu_pembayaran')).toBe(true);
		expect(allowedNext('selesai')).toEqual([]);
	});

	it('balapan batal vs unggah bukti: selalu dibatalkan, stok kembali tepat sekali (TC-010-12)', async () => {
		for (let i = 0; i < 12; i++) {
			const { orderId, code } = await newOrder(buyerId, kaosId, 2);
			const stockWhileHeld = stockOf(kaosId);
			const jobs = [
				() => cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'Batal'),
				() => submitPaymentProof(code, buyerId, `/uploads/proofs/r${i}.png`)
			];
			if (i % 2) jobs.reverse();
			await Promise.allSettled(jobs.map((j) => j()));

			expect(orderOf(orderId).status).toBe('dibatalkan');
			expect(stockOf(kaosId)).toBe(stockWhileHeld + 2); // kembali sekali, bukan dua kali
			expect(paysOf(orderId).every((p) => p.status !== 'menunggu')).toBe(true);
			// reset stok untuk iterasi berikut
			db.update(products).set({ stock: 10 }).where(eq(products.id, kaosId)).run();
		}
	});
});

/* ====================================================================== */
describe('kedaluwarsa & auto-selesai (BR-17, BR-22, TC-010-13/14)', () => {
	it('expireUnpaidOrders: batal oleh sistem, stok kembali, log tanpa pelaku, alasan standar', async () => {
		const { orderId } = await newOrder(buyerId, kaosId, 4);
		expireNow(orderId);
		expect(await expireUnpaidOrders()).toBe(1);
		const o = orderOf(orderId);
		expect(o.status).toBe('dibatalkan');
		expect(o.cancelReason).toBe('Melewati batas waktu pembayaran');
		expect(stockOf(kaosId)).toBe(10);
		const log = logsOf(orderId).find((l) => l.action === 'order.cancel')!;
		expect(log.userId).toBeNull();
		expect(await expireUnpaidOrders()).toBe(0); // tidak diproses dua kali
		expect(stockOf(kaosId)).toBe(10);
	});

	it('belum lewat batas bayar tidak dibatalkan; menunggu_konfirmasi tidak disentuh', async () => {
		const a = await newOrder();
		const b = await newOrder();
		await submitPaymentProof(b.code, buyerId, '/uploads/proofs/a.png');
		expireNow(b.orderId); // sudah ada bukti → tidak boleh kedaluwarsa
		expect(await expireUnpaidOrders()).toBe(0);
		expect(orderOf(a.orderId).status).toBe('menunggu_pembayaran');
		expect(orderOf(b.orderId).status).toBe('menunggu_konfirmasi');
		// pengaman di cancelOrder: sistem menolak pesanan yang belum kedaluwarsa
		await expect(
			cancelOrder(a.orderId, { id: null, role: 'system' }, 'Melewati batas waktu pembayaran')
		).rejects.toThrow(/Belum melewati/);
	});

	it('kedaluwarsa bundling mengembalikan stok paket & komponen', async () => {
		await cartAdd(buyerId, 'bundle', bundleId, 3);
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		expect(bundleStock()).toBe(0);
		expireNow(orderId);
		await expireUnpaidOrders();
		expect(bundleStock()).toBe(3);
		expect(stockOf(kaosId)).toBe(10);
		expect(stockOf(topiId)).toBe(5);
	});

	it('auto-selesai: dikirim > 7 hari → selesai & diterima; < 7 hari tidak berubah', async () => {
		const old = await newOrder(buyerId, kaosId, 1);
		const fresh = await newOrder(buyerId, topiId, 1);
		for (const o of [old, fresh]) {
			await submitPaymentProof(o.code, buyerId, '/uploads/proofs/a.png');
			await confirmPayment(o.code, adminId);
			await shipOrder(o.code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });
		}
		db.update(shipments)
			.set({ shippedAt: new Date(Date.now() - 8 * dayMs).toISOString() })
			.where(eq(shipments.orderId, old.orderId))
			.run();
		db.update(shipments)
			.set({ shippedAt: new Date(Date.now() - 3 * dayMs).toISOString() })
			.where(eq(shipments.orderId, fresh.orderId))
			.run();

		expect(await autoCompleteShippedOrders()).toBe(1);
		expect(orderOf(old.orderId).status).toBe('selesai');
		expect(orderOf(fresh.orderId).status).toBe('dikirim');
		const sh = db.select().from(shipments).where(eq(shipments.orderId, old.orderId)).get()!;
		expect(sh.status).toBe('diterima');
		expect(sh.deliveredAt).toBeTruthy();
		const log = logsOf(old.orderId).find((l) => l.action === 'order.complete')!;
		expect(log.userId).toBeNull();
	});

	it('cadangan tanpa cron: runLightMaintenance (dashboard admin) membatalkan kedaluwarsa & menyelesaikan', async () => {
		const exp = await newOrder();
		expireNow(exp.orderId);
		const shipped = await paidOrder();
		await shipOrder(shipped.code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });
		db.update(shipments)
			.set({ shippedAt: new Date(Date.now() - 9 * dayMs).toISOString() })
			.where(eq(shipments.orderId, shipped.orderId))
			.run();
		await runLightMaintenance();
		expect(orderOf(exp.orderId).status).toBe('dibatalkan');
		expect(orderOf(shipped.orderId).status).toBe('selesai');
	});

	it('endpoint /internal/maintenance: tanpa rahasia 404; dengan rahasia menjalankan kedaluwarsa & auto-selesai', async () => {
		const { orderId } = await newOrder();
		expireNow(orderId);
		const mk = (token?: string) =>
			({
				request: new Request('http://x/internal/maintenance', {
					method: 'POST',
					headers: token ? { authorization: `Bearer ${token}` } : {}
				})
			}) as never;
		const bad = await catchResult(() => maintenance.POST(mk()));
		expect(bad.ok === false && bad.error.status).toBe(404);
		const bad2 = await catchResult(() => maintenance.POST(mk('salah'.repeat(10))));
		expect(bad2.ok === false && bad2.error.status).toBe(404);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');

		const res = await maintenance.POST(mk('x'.repeat(32)));
		const body = await res.json();
		expect(body.expiredOrders).toBe(1);
		expect(orderOf(orderId).status).toBe('dibatalkan');
	});
});

/* ====================================================================== */
describe('pengiriman & transisi status (SRS-F-014, BR-11, TC-008-07, TC-014-*)', () => {
	it('alur lengkap: kirim → koreksi resi (status tetap) → diterima (TC-014-01/06, TC-010-10)', async () => {
		const { orderId, code } = await paidOrder();
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345', note: 'Fragile' });
		let sh = db.select().from(shipments).where(eq(shipments.orderId, orderId)).get()!;
		expect(sh).toMatchObject({ courier: 'JNE', trackingNumber: 'JNE12345', status: 'dikirim' });
		expect(sh.shippedAt).toBeTruthy();
		expect(orderOf(orderId).status).toBe('dikirim');

		await updateShipment(code, adminId, { courier: 'J&T', trackingNumber: 'JT999999' });
		sh = db.select().from(shipments).where(eq(shipments.orderId, orderId)).get()!;
		expect(sh).toMatchObject({ courier: 'J&T', trackingNumber: 'JT999999', status: 'dikirim' });
		expect(orderOf(orderId).status).toBe('dikirim');

		await completeOrder(code, { id: buyerId, role: 'konsumen' });
		sh = db.select().from(shipments).where(eq(shipments.orderId, orderId)).get()!;
		expect(sh.status).toBe('diterima');
		expect(sh.deliveredAt).toBeTruthy();
		expect(orderOf(orderId).status).toBe('selesai');

		// TC-014-07: koreksi resi pada pesanan selesai ditolak
		await expect(
			updateShipment(code, adminId, { courier: 'JNE', trackingNumber: 'JNE00000' })
		).rejects.toThrow(/berstatus dikirim/);
		const actions = logsOf(orderId).map((l) => l.action);
		for (const a of [
			'order.create',
			'payment.proof',
			'payment.confirm',
			'shipment.send',
			'shipment.update',
			'order.complete'
		])
			expect(actions).toContain(a);
	});

	it('kirim sebelum diproses ditolak (TC-014-03); transisi ilegal ditolak (TC-008-07)', async () => {
		const { orderId, code } = await newOrder();
		await expect(
			shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' })
		).rejects.toBeInstanceOf(OrderError);
		await expect(completeOrder(code, { id: buyerId, role: 'konsumen' })).rejects.toBeInstanceOf(
			OrderError
		);
		await expect(confirmPayment(code, adminId)).rejects.toBeInstanceOf(OrderError);
		await expect(
			updateShipment(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' })
		).rejects.toBeInstanceOf(OrderError);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');

		// diproses → selesai langsung ditolak
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		await expect(completeOrder(code, { id: buyerId, role: 'konsumen' })).rejects.toBeInstanceOf(
			OrderError
		);
		await expect(completeOrder(code, { id: null, role: 'system' })).rejects.toBeInstanceOf(
			OrderError
		);
		expect(orderOf(orderId).status).toBe('diproses');
	});

	it('pesanan dibatalkan tidak bisa dikonfirmasi/dikirim/diunggah', async () => {
		const { orderId, code } = await newOrder();
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x');
		await expect(submitPaymentProof(code, buyerId, '/uploads/proofs/a.png')).rejects.toBeInstanceOf(
			OrderError
		);
		await expect(confirmPayment(code, adminId)).rejects.toBeInstanceOf(OrderError);
		await expect(rejectPayment(code, adminId, 'alasan jelas')).rejects.toBeInstanceOf(OrderError);
		await expect(
			shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' })
		).rejects.toBeInstanceOf(OrderError);
		expect(orderOf(orderId).status).toBe('dibatalkan');
		expect(paysOf(orderId)).toHaveLength(0);
	});

	it('hanya pemilik yang menandai diterima (milik orang lain = not_found)', async () => {
		const { code } = await paidOrder();
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE12345' });
		await expect(completeOrder(code, { id: buyer2Id, role: 'konsumen' })).rejects.toMatchObject({
			kind: 'not_found'
		});
	});
});

/* ====================================================================== */
describe('halaman konsumen: kepemilikan, upload bukti, pembatalan (route)', () => {
	const detailEvent = (code: string, uid: number | null) =>
		({
			params: { kode: code },
			locals: uid ? U(uid) : GUEST,
			url: new URL(`http://x/pesanan/${code}`)
		}) as never;

	const bayarEvent = (code: string, uid: number, file?: File | string) => {
		const fd = new FormData();
		if (file !== undefined) fd.set('proofImage', file);
		return {
			params: { kode: code },
			locals: U(uid),
			request: new Request('http://x', { method: 'POST', body: fd })
		} as never;
	};
	const proofFiles = () =>
		existsSync(path.join(env.uploads, 'proofs'))
			? readdirSync(path.join(env.uploads, 'proofs'))
			: [];

	it('pesanan orang lain → 404; tanpa login → redirect; admin → 403 (TC-010-03)', async () => {
		const { code } = await newOrder();
		const other = await catchResult(() => detail.load(detailEvent(code, buyer2Id)));
		expect(!other.ok && other.error.status).toBe(404);
		const guest = await catchResult(() => detail.load(detailEvent(code, null)));
		expect(!guest.ok && isRedirect(guest.error)).toBe(true);
		const adm = await catchResult(() =>
			detail.load({
				params: { kode: code },
				locals: U(adminId, 'admin'),
				url: new URL('http://x/pesanan/x')
			} as never)
		);
		expect(!adm.ok && adm.error.status).toBe(403);
		const mine = (await detail.load(detailEvent(code, buyerId))) as Record<string, unknown>;
		expect(mine.paymentStatus).toBe('belum_bayar');
		expect(mine.canUploadPayment).toBe(true);
		expect(mine.canCancel).toBe(true);
		expect(mine.shipment).toMatchObject({ status: 'belum_dikirim', trackingNumber: null });
	});

	it('aksi bayar/batal/diterima milik orang lain → 404', async () => {
		const { code } = await newOrder();
		const bad = await catchResult(() =>
			detail.actions.bayar(
				bayarEvent(code, buyer2Id, new File([PNG], 'a.png', { type: 'image/png' }))
			)
		);
		expect(!bad.ok && bad.error.status).toBe(404);
		const cancel = await catchResult(() =>
			detail.actions.batal({
				params: { kode: code },
				locals: U(buyer2Id),
				request: new Request('http://x', { method: 'POST', body: new FormData() })
			} as never)
		);
		expect(!cancel.ok && cancel.error.status).toBe(404);
		const recv = await catchResult(() =>
			detail.actions.diterima({ params: { kode: code }, locals: U(buyer2Id) } as never)
		);
		expect(!recv.ok && recv.error.status).toBe(404);
	});

	it('upload bukti: bukan gambar ditolak (TC-010-09); gambar valid → menunggu_konfirmasi', async () => {
		const { code, orderId } = await newOrder();
		const before = proofFiles().length;

		const none = (await detail.actions.bayar(bayarEvent(code, buyerId))) as { status: number };
		expect(none.status).toBe(400);
		const txt = (await detail.actions.bayar(
			bayarEvent(
				code,
				buyerId,
				new File(['bukan gambar apa pun, hanya teks biasa'], 'a.png', { type: 'image/png' })
			)
		)) as { status: number; data: { message: string } };
		expect(txt.status).toBe(400);
		expect(txt.data.message).toMatch(/Format file/);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
		expect(proofFiles().length).toBe(before);

		const ok = (await detail.actions.bayar(
			bayarEvent(code, buyerId, new File([PNG], 'a.png', { type: 'image/png' }))
		)) as { success: boolean };
		expect(ok.success).toBe(true);
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
		expect(paysOf(orderId)).toHaveLength(1);
		expect(proofFiles().length).toBe(before + 1);
	});

	it('upload gagal (pesanan sudah dibatalkan) menghapus berkas yang sudah tersimpan', async () => {
		const { code, orderId } = await newOrder();
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x');
		const before = proofFiles().length;
		const r = (await detail.actions.bayar(
			bayarEvent(code, buyerId, new File([PNG], 'a.png', { type: 'image/png' }))
		)) as { status: number; data: { message: string } };
		expect(r.status).toBe(400);
		expect(r.data.message).toMatch(/menunggu pembayaran/);
		expect(proofFiles().length).toBe(before);
		expect(paysOf(orderId)).toHaveLength(0);
	});

	it('batal oleh konsumen via route: alasan default; saat diproses ditolak dengan pesan yang benar', async () => {
		const a = await newOrder();
		const res = (await detail.actions.batal({
			params: { kode: a.code },
			locals: U(buyerId),
			request: new Request('http://x', { method: 'POST', body: new FormData() })
		} as never)) as { success: boolean };
		expect(res.success).toBe(true);
		expect(orderOf(a.orderId).cancelReason).toBe('Dibatalkan oleh pembeli');

		const p = await paidOrder();
		const refused = (await detail.actions.batal({
			params: { kode: p.code },
			locals: U(buyerId),
			request: new Request('http://x', { method: 'POST', body: new FormData() })
		} as never)) as { status: number; data: { message: string } };
		expect(refused.status).toBe(400);
		expect(refused.data.message).toBe('Pesanan sudah diproses dan tidak dapat dibatalkan');
	});

	it('riwayat hanya milik sendiri, filter status, paginasi, "Belum ada pesanan" (TC-010-01/11)', async () => {
		const empty = (await riwayat.load({
			locals: U(buyerId),
			url: new URL('http://x/pesanan')
		} as never)) as { orders: unknown[] };
		expect(empty.orders).toHaveLength(0);

		await newOrder(buyerId, kaosId, 2);
		const b = await newOrder(buyerId, topiId, 1);
		await newOrder(buyer2Id, kaosId, 1);
		await cancelOrder(b.orderId, { id: buyerId, role: 'konsumen' }, 'x');

		const all = (await riwayat.load({
			locals: U(buyerId),
			url: new URL('http://x/pesanan')
		} as never)) as { orders: { code: string; itemCount: number; status: string }[] };
		expect(all.orders).toHaveLength(2);
		expect(all.orders.find((o) => o.status === 'menunggu_pembayaran')!.itemCount).toBe(2);

		const cancelled = (await riwayat.load({
			locals: U(buyerId),
			url: new URL('http://x/pesanan?status=dibatalkan')
		} as never)) as { orders: { status: string }[] };
		expect(cancelled.orders.map((o) => o.status)).toEqual(['dibatalkan']);
	});
});

/* ====================================================================== */
describe('bukti pembayaran: akses (TC-010-03, TC-017-01)', () => {
	it('hanya pemilik, admin, owner; tanpa login 401; konsumen lain 404', async () => {
		const { code } = await newOrder();
		const fd = new FormData();
		fd.set('proofImage', new File([PNG], 'a.png', { type: 'image/png' }));
		await detail.actions.bayar({
			params: { kode: code },
			locals: U(buyerId),
			request: new Request('http://x', { method: 'POST', body: fd })
		} as never);
		const url = db.select().from(payments).get()!.proofUrl!;
		const rel = url.replace('/uploads/', '');
		const get = (locals: unknown) =>
			catchResult(() => uploads.GET({ params: { path: rel }, locals } as never));

		const guest = await get(GUEST);
		expect(!guest.ok && guest.error.status).toBe(401);
		const other = await get(U(buyer2Id));
		expect(!other.ok && other.error.status).toBe(404);
		for (const loc of [U(buyerId), U(adminId, 'admin'), U(ownerId, 'owner')]) {
			const r = await get(loc);
			expect(r.ok && (r.value as Response).status).toBe(200);
		}
	});
});

/* ====================================================================== */
describe('katalog & detail (SRS-F-005, TC-005-*)', () => {
	const url = (qs = '') => new URL(`http://x/produk${qs}`);

	it('hanya produk aktif & tidak terhapus; cari, kategori, urutan (TC-005-01/03/04)', async () => {
		db.update(products).set({ isActive: false }).where(eq(products.id, hoodieId)).run();
		const all = (await katalog.load({ url: url() } as never)) as {
			items: { name: string }[];
			pagination: { totalItems: number };
		};
		expect(all.items.map((i) => i.name).sort()).toEqual(['Kaos Classic - L', 'Topi']);

		const q = (await katalog.load({ url: url('?q=kaos') } as never)) as {
			items: { name: string }[];
		};
		expect(q.items.map((i) => i.name)).toEqual(['Kaos Classic - L']);

		const cat = (await katalog.load({ url: url('?kategori=kaos') } as never)) as {
			items: { name: string }[];
		};
		expect(cat.items).toHaveLength(1);

		const asc = (await katalog.load({ url: url('?urut=termurah') } as never)) as {
			items: { price: number }[];
		};
		expect(asc.items.map((i) => i.price)).toEqual([50_000, 100_000]);
		const desc = (await katalog.load({ url: url('?urut=termahal') } as never)) as {
			items: { price: number }[];
		};
		expect(desc.items.map((i) => i.price)).toEqual([100_000, 50_000]);
	});

	it('karakter % dan _ pada pencarian tidak menjadi wildcard', async () => {
		for (const q of ['%', '_', 'k_os', '%%%']) {
			const r = (await katalog.load({ url: url(`?q=${encodeURIComponent(q)}`) } as never)) as {
				items: unknown[];
			};
			expect(r.items).toHaveLength(0);
		}
	});

	it('paginasi sesuai CATALOG_PAGE_SIZE', async () => {
		// isi sampai tepat (satu halaman penuh + 5 produk) tanpa bergantung pada data awal tes lain
		const existing = db.select({ n: count() }).from(products).get()?.n ?? 0;
		const extra = 5;
		for (let i = 0; i < CATALOG_PAGE_SIZE + extra - existing; i++)
			db.insert(products)
				.values({ name: `Produk ${i}`, slug: `produk-${i}`, price: 1000 + i, stock: 1 })
				.run();
		const p1 = (await katalog.load({ url: url() } as never)) as {
			items: unknown[];
			pagination: { totalPages: number };
		};
		expect(p1.items).toHaveLength(CATALOG_PAGE_SIZE);
		expect(p1.pagination.totalPages).toBe(2);
		const p2 = (await katalog.load({ url: url('?page=2') } as never)) as { items: unknown[] };
		expect(p2.items).toHaveLength(extra);
		const bad = (await katalog.load({ url: url('?page=-4') } as never)) as {
			pagination: { page: number };
		};
		expect(bad.pagination.page).toBe(1);
	});

	it('detail: slug tidak ada / nonaktif / terhapus → 404 (TC-005-08/09)', async () => {
		const ev = (slug: string) =>
			({ params: { slug }, locals: GUEST, url: new URL('http://x/produk') }) as never;
		const missing = await catchResult(() => produkDetail.load(ev('xxx')));
		expect(!missing.ok && missing.error.status).toBe(404);
		db.update(products).set({ isActive: false }).where(eq(products.id, topiId)).run();
		const off = await catchResult(() => produkDetail.load(ev('topi')));
		expect(!off.ok && off.error.status).toBe(404);
		db.update(products)
			.set({ isActive: true, deletedAt: new Date().toISOString() })
			.where(eq(products.id, topiId))
			.run();
		const del = await catchResult(() => produkDetail.load(ev('topi')));
		expect(!del.ok && del.error.status).toBe(404);

		db.update(bundles).set({ isActive: false }).run();
		const b = await catchResult(() => bundleDetail.load(ev('paket-hemat')));
		expect(!b.ok && b.error.status).toBe(404);
	});

	it('detail produk memuat paket terkait (hanya bundling aktif) dan isKonsumen', async () => {
		const ev = (uid: number | null, role: 'konsumen' | 'admin' = 'konsumen') =>
			({
				params: { slug: 'kaos-classic-l' },
				locals: uid ? U(uid, role) : GUEST,
				url: new URL('http://x/produk/kaos-classic-l')
			}) as never;
		const r = (await produkDetail.load(ev(buyerId))) as {
			relatedBundles: { slug: string }[];
			isKonsumen: boolean;
		};
		expect(r.relatedBundles.map((b) => b.slug)).toEqual(['paket-hemat']);
		expect(r.isKonsumen).toBe(true);
		expect(
			((await produkDetail.load(ev(adminId, 'admin'))) as { isKonsumen: boolean }).isKonsumen
		).toBe(false);
		db.update(bundles).set({ isActive: false }).run();
		expect(
			((await produkDetail.load(ev(buyerId))) as { relatedBundles: unknown[] }).relatedBundles
		).toHaveLength(0);
	});

	it('detail bundling: stok efektif, harga normal & hemat (TC-005-07/11)', async () => {
		db.update(bundles).set({ stock: 15 }).run();
		db.update(products).set({ stock: 3 }).where(eq(products.id, kaosId)).run();
		const r = (await bundleDetail.load({
			params: { slug: 'paket-hemat' },
			locals: GUEST
		} as never)) as {
			effectiveStock: number;
			normalPrice: number;
			savings: number;
			components: unknown[];
		};
		expect(r.effectiveStock).toBe(3);
		expect(r.normalPrice).toBe(150_000);
		expect(r.savings).toBe(20_000);
		expect(r.components).toHaveLength(2);
	});

	it('?/tambah: admin → 403, tamu → redirect login, konsumen → masuk keranjang (TC-005-10, TC-009-13)', async () => {
		const ev = (locals: unknown, qty: string, slug = 'kaos-classic-l') => {
			const fd = new FormData();
			fd.set('qty', qty);
			return {
				params: { slug },
				locals,
				url: new URL(`http://x/produk/${slug}`),
				request: new Request('http://x', { method: 'POST', body: fd })
			} as never;
		};
		const adm = (await produkDetail.actions.tambah(ev(U(adminId, 'admin'), '1'))) as {
			status: number;
		};
		expect(adm.status).toBe(403);
		const own = (await bundleDetail.actions.tambah(
			ev(U(ownerId, 'owner'), '1', 'paket-hemat')
		)) as {
			status: number;
		};
		expect(own.status).toBe(403);
		const guest = await catchResult(() => produkDetail.actions.tambah(ev(GUEST, '1')));
		expect(!guest.ok && isRedirect(guest.error)).toBe(true);
		expect(db.select().from(cartItems).all()).toHaveLength(0);

		const badQty = (await produkDetail.actions.tambah(ev(U(buyerId), '0'))) as { status: number };
		expect(badQty.status).toBe(400);
		const frac = (await produkDetail.actions.tambah(ev(U(buyerId), '1.5'))) as { status: number };
		expect(frac.status).toBe(400);
		const ok = (await produkDetail.actions.tambah(ev(U(buyerId), '2'))) as { success: boolean };
		expect(ok.success).toBe(true);
		const okB = (await bundleDetail.actions.tambah(ev(U(buyerId), '1', 'paket-hemat'))) as {
			success: boolean;
		};
		expect(okB.success).toBe(true);
		expect(db.select().from(cartItems).all()).toHaveLength(2);
	});

	it('admin/owner tidak bisa memakai keranjang & checkout (TC-009-13)', async () => {
		for (const role of ['admin', 'owner'] as const) {
			const loc = U(role === 'admin' ? adminId : ownerId, role);
			const ev = { locals: loc, url: new URL('http://x/keranjang') } as never;
			const c = await catchResult(() => keranjang.load(ev));
			expect(!c.ok && c.error.status).toBe(403);
			const k = await catchResult(() => checkout.load(ev));
			expect(!k.ok && k.error.status).toBe(403);
			const post = await catchResult(() =>
				checkout.actions.default({
					locals: loc,
					request: new Request('http://x', { method: 'POST', body: new FormData() })
				} as never)
			);
			expect(!post.ok && post.error.status).toBe(403);
		}
	});

	it('checkout action: validasi alamat (TC-009-07), sukses → redirect ke pesanan, harga form diabaikan', async () => {
		await cartAdd(buyerId, 'product', kaosId, 1);
		const ev = (fields: Record<string, string>) => {
			const fd = new FormData();
			for (const [k, v] of Object.entries(fields)) fd.set(k, v);
			return {
				locals: U(buyerId),
				request: new Request('http://x', { method: 'POST', body: fd })
			} as never;
		};
		const bad = (await checkout.actions.default(
			ev({ recipientName: 'Budi', recipientPhone: '081234567890', shippingAddress: '' })
		)) as { status: number; data: { errors: Record<string, string[]> } };
		expect(bad.status).toBe(400);
		expect(bad.data.errors.shippingAddress?.length).toBeGreaterThan(0);
		expect(db.select().from(orders).all()).toHaveLength(0);

		const r = await catchResult(() =>
			checkout.actions.default(
				ev({ ...SHIP, total: '1', subtotal: '1', price: '1', saveToProfile: 'on' })
			)
		);
		expect(!r.ok && isRedirect(r.error)).toBe(true);
		const o = db.select().from(orders).get()!;
		expect(o.total).toBe(115_000);
		expect(db.select().from(users).where(eq(users.id, buyerId)).get()!.address).toBe(
			SHIP.shippingAddress
		);
	});
});

/* ====================================================================== */
describe('admin kelola transaksi (SRS-F-008, TC-008-01/08)', () => {
	const listEv = (qs = '', uid = adminId, role: 'admin' | 'konsumen' = 'admin') =>
		({ url: new URL(`http://x/admin/pesanan${qs}`), locals: U(uid, role) }) as never;
	type Row = { code: string; status: string; paymentStatus: string };
	const rows = async (qs = '') =>
		((await adminList.load(listEv(qs))) as unknown as { orders: Row[] }).orders;

	it('status pembayaran belum_bayar bila belum ada unggahan; menunggu_konfirmasi paling atas', async () => {
		const a = await newOrder(buyerId, kaosId, 1);
		const b = await newOrder(buyerId, topiId, 1);
		await submitPaymentProof(b.code, buyerId, '/uploads/proofs/a.png');
		const c = await newOrder(buyerId, hoodieId, 1);
		const list = await rows();
		expect(list.map((r) => r.code)[0]).toBe(b.code);
		expect(list.find((r) => r.code === a.code)!.paymentStatus).toBe('belum_bayar');
		expect(list.find((r) => r.code === b.code)!.paymentStatus).toBe('menunggu');
		expect(list.find((r) => r.code === c.code)!.paymentStatus).toBe('belum_bayar');
	});

	it('filter status, cari kode/nama (karakter wildcard aman), rentang tanggal', async () => {
		const a = await newOrder();
		const b = await newOrder();
		await cancelOrder(b.orderId, { id: buyerId, role: 'konsumen' }, 'x');
		expect((await rows('?status=dibatalkan')).map((r) => r.code)).toEqual([b.code]);
		expect((await rows('?status=ngawur')).length).toBe(2); // status tak valid diabaikan
		expect((await rows(`?q=${a.code}`)).map((r) => r.code)).toEqual([a.code]);
		expect(await rows('?q=%25')).toHaveLength(0);
		expect(await rows('?q=Buyer')).toHaveLength(2);

		db.update(orders)
			.set({ createdAt: '2026-10-31T16:30:00.000Z' }) // 31 Okt 23:30 WIB
			.where(eq(orders.id, a.orderId))
			.run();
		expect((await rows('?dari=2026-10-31&sampai=2026-10-31')).map((r) => r.code)).toEqual([a.code]);
		expect((await rows('?dari=2026-11-01')).map((r) => r.code)).toEqual([b.code]);
		expect(await rows('?dari=salah&sampai=2026-13-45')).toHaveLength(2);
	});

	it('hanya admin; konsumen 403', async () => {
		const r = await catchResult(() => adminList.load(listEv('', buyerId, 'konsumen')));
		expect(!r.ok && r.error.status).toBe(403);
	});

	it('detail admin: riwayat pembayaran lengkap, log hanya milik pesanan, WA dengan encodeURIComponent', async () => {
		const a = await newOrder();
		const other = await newOrder(buyer2Id, topiId, 1);
		await submitPaymentProof(a.code, buyerId, '/uploads/proofs/a.png');
		await rejectPayment(a.code, adminId, 'Nominal tidak sesuai');
		await submitPaymentProof(a.code, buyerId, '/uploads/proofs/b.png');
		const d = (await adminDetail.load({
			params: { kode: a.code },
			locals: U(adminId, 'admin')
		} as never)) as {
			payments: { status: string; note: string | null }[];
			logs: { description: string }[];
			paymentStatus: string;
			waUrl: string;
			bisaBatal: boolean;
		};
		expect(d.payments.map((p) => p.status)).toEqual(['menunggu', 'ditolak']);
		expect(d.payments[1].note).toBe('Nominal tidak sesuai');
		expect(d.paymentStatus).toBe('menunggu');
		expect(d.logs.every((l) => !l.description.includes(other.code))).toBe(true);
		expect(d.logs.length).toBeGreaterThanOrEqual(4);
		expect(d.waUrl).toContain('https://wa.me/6281234567890?text=');
		expect(d.waUrl).not.toContain(' ');
		expect(d.bisaBatal).toBe(true);
	});

	it('aksi admin: kirim memvalidasi resi & kurir; batal wajib alasan; tolak wajib alasan', async () => {
		const { code, orderId } = await paidOrder();
		const act = (name: keyof typeof adminDetail.actions, fields: Record<string, string>) => {
			const fd = new FormData();
			for (const [k, v] of Object.entries(fields)) fd.set(k, v);
			return (adminDetail.actions[name] as (e: never) => Promise<unknown>)({
				params: { kode: code },
				locals: U(adminId, 'admin'),
				request: new Request('http://x', { method: 'POST', body: fd })
			} as never) as Promise<{ status?: number; success?: boolean; data?: { message?: string } }>;
		};
		expect((await act('kirim', { courier: 'JNE', trackingNumber: '' }))!.status).toBe(400); // TC-014-02
		expect(
			(await act('kirim', { courier: 'Kurir Ngawur', trackingNumber: 'ABC12345' }))!.status
		).toBe(400);
		expect(orderOf(orderId).status).toBe('diproses');
		const batal = await act('batal', { reason: 'ab' });
		expect(batal.status).toBe(400);
		expect(orderOf(orderId).status).toBe('diproses');
		expect((await act('kirim', { courier: 'JNE', trackingNumber: 'JNE12345' }))!.success).toBe(
			true
		);
		expect(orderOf(orderId).status).toBe('dikirim');
		const koreksi = await act('koreksiResi', { courier: 'SiCepat', trackingNumber: 'SC1234567' });
		expect(koreksi.success).toBe(true);
		expect(db.select().from(shipments).get()!.courier).toBe('SiCepat');
	});
});
