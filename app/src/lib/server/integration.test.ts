import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import {
	activityLogs,
	bundleItems,
	bundles,
	cartItems,
	carts,
	loginAttempts,
	orders,
	payments,
	products,
	sessions,
	settings,
	stockMovements,
	users
} from './db/schema';
import { cancelOrder, createOrderFromCart, expireUnpaidOrders, OrderError } from './orders';
import {
	confirmPayment,
	rejectPayment,
	submitPaymentProof,
	shipOrder,
	completeOrder
} from './order-flow';
import { tooManyAttempts, recordFailure } from './rate-limit';
import { safeNext } from './redirect';

const SHIP = {
	recipientName: 'Budi',
	recipientPhone: '081234567890',
	shippingAddress: 'Jl. Contoh No. 1 Subang'
};

let buyerId: number;
let adminId: number;
let kaosId: number;
let topiId: number;
let bundleId: number;

/** Pengaman: jangan pernah menghapus data kecuali ini DB tes sementara. */
function assertTestDb() {
	const rows = db.all<{ file: string }>(sql`select file from pragma_database_list`);
	if (!rows.some((r) => /tests\/\.tmp-test-\d+\.db$/.test(r.file))) {
		throw new Error(`MENOLAK reset: bukan DB tes (${rows.map((r) => r.file).join(', ')})`);
	}
}

function reset() {
	assertTestDb();
	for (const t of [
		activityLogs,
		stockMovements,
		cartItems,
		carts,
		payments,
		orders,
		bundleItems,
		bundles,
		products,
		sessions,
		loginAttempts,
		settings,
		users
	]) {
		db.delete(t).run();
	}
	[{ id: buyerId }] = db
		.insert(users)
		.values({ name: 'Buyer', email: 'b@x.id', passwordHash: 'x', role: 'konsumen' })
		.returning({ id: users.id })
		.all();
	[{ id: adminId }] = db
		.insert(users)
		.values({ name: 'Admin', email: 'a@x.id', passwordHash: 'x', role: 'admin' })
		.returning({ id: users.id })
		.all();
	[{ id: kaosId }] = db
		.insert(products)
		.values({ name: 'Kaos', slug: 'kaos', price: 100_000, stock: 10 })
		.returning({ id: products.id })
		.all();
	[{ id: topiId }] = db
		.insert(products)
		.values({ name: 'Topi', slug: 'topi', price: 50_000, stock: 5 })
		.returning({ id: products.id })
		.all();
	[{ id: bundleId }] = db
		.insert(bundles)
		.values({ name: 'Paket', slug: 'paket', price: 130_000, stock: 3 })
		.returning({ id: bundles.id })
		.all();
	db.insert(bundleItems)
		.values([
			{ bundleId, productId: kaosId, quantity: 1 },
			{ bundleId, productId: topiId, quantity: 1 }
		])
		.run();
}

function addToCart(
	userId: number,
	line: { productId?: number; bundleId?: number; quantity: number }
) {
	let cart = db.select().from(carts).where(eq(carts.userId, userId)).get();
	cart ??= db.insert(carts).values({ userId }).returning().get();
	db.insert(cartItems)
		.values({ cartId: cart.id, ...line })
		.run();
}

const stockOf = (id: number) => db.select().from(products).where(eq(products.id, id)).get()!.stock;
const orderOf = (id: number) => db.select().from(orders).where(eq(orders.id, id)).get()!;

beforeEach(reset);

describe('checkout (transaksi atomik)', () => {
	it('membuat pesanan, mengurangi stok, mengosongkan keranjang', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 2 });
		const { orderId, code } = await createOrderFromCart(buyerId, SHIP);

		expect(code).toMatch(/^DWN-\d{6}-[0-9A-F]{6}$/);
		expect(stockOf(kaosId)).toBe(8);
		const o = orderOf(orderId);
		expect(o.subtotal).toBe(200_000);
		expect(o.total).toBe(o.subtotal + o.shippingCost);
		expect(db.select().from(cartItems).all()).toHaveLength(0);
		expect(db.select().from(stockMovements).all()).toHaveLength(1);
	});

	it('bundling mengurangi stok paket DAN semua komponen (BR-06)', async () => {
		addToCart(buyerId, { bundleId, quantity: 2 });
		await createOrderFromCart(buyerId, SHIP);
		expect(stockOf(kaosId)).toBe(8);
		expect(stockOf(topiId)).toBe(3);
		expect(db.select().from(bundles).get()!.stock).toBe(1);
	});

	it('stok kurang -> semua perubahan di-rollback (tidak ada pesanan setengah jadi)', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 3 });
		addToCart(buyerId, { productId: topiId, quantity: 99 });
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toBeInstanceOf(OrderError);

		expect(stockOf(kaosId)).toBe(10); // pengurangan kaos ikut dibatalkan
		expect(db.select().from(orders).all()).toHaveLength(0);
		expect(db.select().from(stockMovements).all()).toHaveLength(0);
		expect(db.select().from(cartItems).all()).toHaveLength(2); // keranjang tetap
	});

	it('dua checkout bersamaan untuk stok terakhir: hanya satu berhasil, stok tidak negatif', async () => {
		db.update(products).set({ stock: 1 }).where(eq(products.id, kaosId)).run();
		const other = db
			.insert(users)
			.values({ name: 'B2', email: 'b2@x.id', passwordHash: 'x' })
			.returning({ id: users.id })
			.get().id;
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		addToCart(other, { productId: kaosId, quantity: 1 });

		const res = await Promise.allSettled([
			createOrderFromCart(buyerId, SHIP),
			createOrderFromCart(other, SHIP)
		]);
		expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(stockOf(kaosId)).toBe(0);
	});

	it('menolak pesanan baru bila sudah mencapai batas pesanan belum bayar (BR-18)', async () => {
		for (let i = 0; i < 3; i++) {
			addToCart(buyerId, { productId: kaosId, quantity: 1 });
			await createOrderFromCart(buyerId, SHIP);
		}
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toThrow(/belum dibayar/);
	});
});

describe('pembatalan & kedaluwarsa', () => {
	it('konsumen membatalkan: stok produk, paket, dan komponen kembali', async () => {
		addToCart(buyerId, { bundleId, quantity: 2 });
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'Salah pilih');

		expect(stockOf(kaosId)).toBe(10);
		expect(stockOf(topiId)).toBe(5);
		expect(db.select().from(bundles).get()!.stock).toBe(3);
		expect(orderOf(orderId).status).toBe('dibatalkan');
	});

	it('konsumen lain tidak bisa membatalkan (dianggap tidak ditemukan)', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		await expect(
			cancelOrder(orderId, { id: adminId, role: 'konsumen' }, 'x')
		).rejects.toMatchObject({ kind: 'not_found' });
	});

	it('pesanan kedaluwarsa dibatalkan sistem, stok kembali, tanpa error foreign key', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 4 });
		const { orderId } = await createOrderFromCart(buyerId, SHIP);
		db.update(orders)
			.set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
			.where(eq(orders.id, orderId))
			.run();

		expect(await expireUnpaidOrders()).toBe(1);
		expect(orderOf(orderId).status).toBe('dibatalkan');
		expect(stockOf(kaosId)).toBe(10);
	});

	it('sistem TIDAK membatalkan pesanan yang sudah ada bukti bayar', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		const { orderId, code } = await createOrderFromCart(buyerId, SHIP);
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		db.update(orders)
			.set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
			.where(eq(orders.id, orderId))
			.run();

		expect(await expireUnpaidOrders()).toBe(0);
		await expect(cancelOrder(orderId, { id: null, role: 'system' }, 'x')).rejects.toBeInstanceOf(
			OrderError
		);
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
	});

	it('admin membatalkan pesanan terbayar: pembayaran dicatat dikembalikan (BR-20)', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		const { orderId, code } = await createOrderFromCart(buyerId, SHIP);
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		await cancelOrder(orderId, { id: adminId, role: 'admin' }, 'Stok rusak');

		const statuses = db
			.select()
			.from(payments)
			.where(eq(payments.orderId, orderId))
			.all()
			.map((p) => p.status);
		expect(statuses).toContain('dikembalikan');
		expect(stockOf(kaosId)).toBe(10);
	});

	it('konsumen tidak bisa membatalkan pesanan yang sudah diproses', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		const { orderId, code } = await createOrderFromCart(buyerId, SHIP);
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		await expect(cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'x')).rejects.toThrow(
			/tidak dapat dibatalkan/
		);
	});
});

describe('alur pembayaran & pengiriman', () => {
	it('bayar -> konfirmasi -> kirim -> selesai', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		const { orderId, code } = await createOrderFromCart(buyerId, SHIP);
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
		await confirmPayment(code, adminId);
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE123' });
		await completeOrder(code, { id: buyerId, role: 'konsumen' });
		expect(orderOf(orderId).status).toBe('selesai');
	});

	it('tolak bukti: kembali menunggu_pembayaran, bukti lama tetap tercatat', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		const { orderId, code } = await createOrderFromCart(buyerId, SHIP);
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await rejectPayment(code, adminId, 'Nominal tidak sesuai');
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
		await submitPaymentProof(code, buyerId, '/uploads/proofs/b.png');
		const proofs = db
			.select()
			.from(payments)
			.where(eq(payments.orderId, orderId))
			.all()
			.filter((p) => p.proofUrl);
		expect(proofs.map((p) => p.status)).toEqual(['ditolak', 'menunggu']);
	});

	it('tidak bisa lompat status (kirim sebelum dikonfirmasi)', async () => {
		addToCart(buyerId, { productId: kaosId, quantity: 1 });
		const { code } = await createOrderFromCart(buyerId, SHIP);
		await expect(
			shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'X' })
		).rejects.toBeInstanceOf(OrderError);
	});
});

describe('keamanan & format waktu', () => {
	it('rate limit login benar-benar menahan setelah 5 gagal pada hari yang sama', async () => {
		for (let i = 0; i < 5; i++) await recordFailure('a@x.id|1.1.1.1');
		expect(await tooManyAttempts('a@x.id|1.1.1.1')).toBe(true);
		expect(await tooManyAttempts('lain@x.id|1.1.1.1')).toBe(false);
	});

	it('timestamp default berformat ISO-UTC yang bisa dibandingkan dengan toISOString()', () => {
		const o = db
			.insert(users)
			.values({ name: 'T', email: 't@x.id', passwordHash: 'x' })
			.returning()
			.get();
		expect(o.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(Math.abs(Date.parse(o.createdAt) - Date.now())).toBeLessThan(5000);
	});

	it.each([
		['/admin', '/admin'],
		['/produk?page=2', '/produk?page=2'],
		['//evil.com', '/'],
		['/\\evil.com', '/'],
		['/\t/evil.com', '/'],
		['https://evil.com', '/'],
		['javascript:alert(1)', '/'],
		['/.//evil.com', '/.//evil.com'.startsWith('//') ? '/' : expect.stringMatching(/^\//)],
		[null, '/']
	])('safeNext(%j)', (input, expected) => {
		expect(safeNext(input as string | null, '/')).toEqual(expected);
	});
});
