/**
 * Fixture bersama tes integrasi pesanan/katalog (berkas orders.*.int.test.ts dan catalog.int.test.ts).
 * Dimuat SETELAH `vi.mock('$app/env/private')` di tiap berkas tes, jadi `db` menunjuk DB sementara milik
 * berkas tes tersebut (tests/.tmp-orders-*.db).
 */
import { afterAll, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { DATABASE_URL, UPLOAD_DIR } from '$app/env/private';
import { and, eq } from 'drizzle-orm';
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
	paymentSimulations,
	payments,
	products,
	settings,
	shipments,
	stockMovements,
	users
} from './db/schema';
import { addToCart } from './cart';
import { createOrderFromCart } from './orders';
import { confirmPayment, submitPaymentProof } from './order-flow';

export const SHIP = {
	recipientName: 'Budi Santoso',
	recipientPhone: '081234567890',
	shippingAddress: 'Jl. Contoh No. 1 Subang'
};

export const dayMs = 86_400_000;
// PNG 1x1 yang valid (upload.ts meng-encode ulang gambar, jadi berkas palsu ditolak)
export const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

export let buyerId: number;
export let buyer2Id: number;
export let adminId: number;
export let ownerId: number;
export let catId: number;
export let kaosId: number;
export let topiId: number;
export let hoodieId: number;
export let bundleId: number;

/** Pengaman: jangan pernah menghapus data kecuali ini DB tes sementara milik berkas ini. */
export function assertTestDb() {
	if (!/\.tmp-orders-/.test(DATABASE_URL)) throw new Error('MENOLAK reset: bukan DB tes pesanan');
}

export function reset() {
	assertTestDb();
	for (const t of [
		activityLogs,
		stockMovements,
		cartItems,
		carts,
		paymentSimulations,
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

export const stockOf = (id: number) =>
	db.select().from(products).where(eq(products.id, id)).get()!.stock;
export const bundleStock = () => db.select().from(bundles).get()!.stock;
export const orderOf = (id: number) => db.select().from(orders).where(eq(orders.id, id)).get()!;
export const paysOf = (orderId: number) =>
	db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(payments.id).all();
export const logsOf = (orderId: number) =>
	db
		.select()
		.from(activityLogs)
		.where(and(eq(activityLogs.entity, 'order'), eq(activityLogs.entityId, orderId)))
		.all();
export const U = (id: number, role: 'konsumen' | 'admin' | 'owner' = 'konsumen') =>
	({
		user: { id, role, name: 'x', email: 'x@x.id', mustChangePassword: false },
		sessionId: 's'
	}) as never;
export const GUEST = { user: null, sessionId: null } as never;

export async function cartAdd(userId: number, kind: 'product' | 'bundle', id: number, qty: number) {
	const r = await addToCart(userId, kind, id, qty);
	if (!r.ok) throw new Error(r.message);
}

export async function newOrder(userId = buyerId, product = kaosId, qty = 1) {
	await cartAdd(userId, 'product', product, qty);
	return createOrderFromCart(userId, SHIP);
}

/** Pesanan sampai status `diproses` */
export async function paidOrder() {
	const o = await newOrder();
	await submitPaymentProof(o.code, buyerId, '/uploads/proofs/a.png');
	await confirmPayment(o.code, adminId);
	return o;
}

export const expireNow = (orderId: number) =>
	db
		.update(orders)
		.set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
		.where(eq(orders.id, orderId))
		.run();

export async function catchResult<T>(fn: () => Promise<T> | T) {
	try {
		return { ok: true as const, value: await fn() };
	} catch (e) {
		return { ok: false as const, error: e as { status?: number; kind?: string; message?: string } };
	}
}

/** Pasang di tingkat berkas tes: reset data sebelum tiap tes, bersihkan DB & unggahan sementara di akhir. */
export function useOrdersFixture() {
	beforeEach(reset);

	afterAll(() => {
		assertTestDb();
		db.$client.close();
		for (const ext of ['', '-wal', '-shm']) rmSync(DATABASE_URL + ext, { force: true });
		rmSync(UPLOAD_DIR!, { recursive: true, force: true });
	});
}
