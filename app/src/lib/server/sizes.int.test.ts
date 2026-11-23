/**
 * Uji integrasi stok per ukuran: invarian products.stock = SUM(ukuran), keranjang, pesanan (produk &
 * bundling), pembatalan, pembelian, dan konversi produk ke ber-ukuran. DB terisolasi (salinan skema kosong).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-sizes-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads-sizes',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, transact } from './db';
import {
	activityLogs,
	bundleItems,
	bundles,
	cartItems,
	carts,
	categories,
	orderItemComponents,
	orderItems,
	orders,
	payments,
	productSizes,
	products,
	purchaseItems,
	purchases,
	shipments,
	stockMovements,
	users
} from './db/schema';
import { addToCart, availableStock, getCartDetails, updateCartItemQuantity } from './cart';
import { cancelOrder, createOrderFromCart, OrderError } from './orders';
import { createPurchase, PurchaseRuleError } from './purchase';
import { decreaseProductStock, increaseProductStock, setProductStock } from './stock';
import { applySizeEdit, createInitialSizes, SizeRuleError } from './product-sizes';
import { getSizes } from './sizes';

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
});

const SHIP = {
	recipientName: 'Budi Santoso',
	recipientPhone: '081234567890',
	shippingAddress: 'Jl. Contoh No. 1 Subang'
};
const meta = { type: 'penjualan', refType: 'order', refId: 1 } as const;

let userId: number;
let adminId: number;
let catId: number;

const stockOf = (id: number) => db.select().from(products).where(eq(products.id, id)).get()!.stock;
const sizeOf = (id: number, label: string) =>
	getSizes(db, id).find((s) => s.label === label)?.stock;
/** Invarian: total produk = jumlah semua ukuran */
const expectInvariant = (id: number) => {
	const sizes = getSizes(db, id);
	if (sizes.length > 0) {
		expect(stockOf(id)).toBe(sizes.reduce((s, r) => s + r.stock, 0));
	}
};

function newProduct(name: string, sizes: { label: string; stock: number }[] = [], stock = 0) {
	const p = db
		.insert(products)
		.values({
			name,
			slug: name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6),
			categoryId: catId,
			price: 100_000,
			stock
		})
		.returning()
		.get();
	if (sizes.length > 0) {
		db.transaction((tx) => createInitialSizes(tx, p.id, sizes, adminId), { behavior: 'immediate' });
	}
	return p.id;
}

beforeEach(() => {
	for (const t of [
		payments,
		shipments,
		orderItemComponents,
		orderItems,
		orders,
		activityLogs,
		cartItems,
		carts,
		bundleItems,
		bundles,
		purchaseItems,
		purchases,
		stockMovements,
		productSizes,
		products
	]) {
		db.delete(t).run();
	}
	db.delete(categories).run();
	db.delete(users).run();
	[{ userId }] = db
		.insert(users)
		.values({ name: 'Budi', email: 'budi@x.id', passwordHash: 'x', role: 'konsumen' })
		.returning({ userId: users.id })
		.all();
	[{ adminId }] = db
		.insert(users)
		.values({ name: 'Admin', email: 'a@x.id', passwordHash: 'x', role: 'admin' })
		.returning({ adminId: users.id })
		.all();
	[{ catId }] = db
		.insert(categories)
		.values({ name: 'Kaos', slug: 'kaos' })
		.returning({ catId: categories.id })
		.all();
});

describe('stok produk per ukuran', () => {
	it('produk baru dengan ukuran: total = jumlah ukuran, mutasi stok awal tercatat per ukuran', () => {
		const id = newProduct('Kaos A', [
			{ label: 'S', stock: 3 },
			{ label: 'M', stock: 5 },
			{ label: 'L', stock: 0 }
		]);
		expect(stockOf(id)).toBe(8);
		expect(getSizes(db, id).map((s) => s.label)).toEqual(['S', 'M', 'L']);
		const moves = db.select().from(stockMovements).where(eq(stockMovements.productId, id)).all();
		expect(moves.map((m) => [m.size, m.quantityChange]).sort()).toEqual([
			['M', 5],
			['S', 3]
		]);
		expectInvariant(id);
	});

	it('decrease: memotong ukuran + total; menolak stok kurang, ukuran tak ada, dan ukuran kosong', () => {
		const id = newProduct('Kaos B', [
			{ label: 'M', stock: 4 },
			{ label: 'L', stock: 1 }
		]);
		expect(transact((tx) => decreaseProductStock(tx, id, 3, meta, 'M'))).resolves.toBe(true);
		return Promise.all([
			transact((tx) => decreaseProductStock(tx, id, 2, meta, 'L')), // stok L cuma 1
			transact((tx) => decreaseProductStock(tx, id, 1, meta, 'XL')), // ukuran tak ada
			transact((tx) => decreaseProductStock(tx, id, 1, meta)) // ukuran wajib
		]).then((r) => {
			expect(r).toEqual([false, false, false]);
			expect(sizeOf(id, 'M')).toBe(1);
			expect(sizeOf(id, 'L')).toBe(1);
			expect(stockOf(id)).toBe(2);
			expectInvariant(id);
		});
	});

	it('produk tanpa ukuran tetap bekerja seperti semula', async () => {
		const id = newProduct('Topi', [], 10);
		expect(await transact((tx) => decreaseProductStock(tx, id, 4, meta))).toBe(true);
		expect(await transact((tx) => decreaseProductStock(tx, id, 1, meta, 'M'))).toBe(false);
		expect(stockOf(id)).toBe(6);
	});

	it('increase: per ukuran; tanpa ukuran pada produk ber-ukuran → ukuran pertama; ukuran dihapus dibuat lagi', async () => {
		const id = newProduct('Kaos C', [
			{ label: 'S', stock: 0 },
			{ label: 'M', stock: 0 }
		]);
		await transact((tx) => increaseProductStock(tx, id, 2, meta, 'M'));
		await transact((tx) => increaseProductStock(tx, id, 3, meta)); // legacy: tanpa ukuran → S
		await transact((tx) => increaseProductStock(tx, id, 4, meta, 'XL')); // ukuran belum ada → dibuat
		expect(sizeOf(id, 'M')).toBe(2);
		expect(sizeOf(id, 'S')).toBe(3);
		expect(sizeOf(id, 'XL')).toBe(4);
		expect(stockOf(id)).toBe(9);
		expectInvariant(id);
	});

	it('setProductStock per ukuran menjaga invarian dan mewajibkan ukuran', async () => {
		const id = newProduct('Kaos D', [
			{ label: 'M', stock: 5 },
			{ label: 'L', stock: 5 }
		]);
		expect(await transact((tx) => setProductStock(tx, id, 12, adminId, 'opname', 'L'))).toBe(7);
		expect(stockOf(id)).toBe(17);
		expect(() => transact((tx) => setProductStock(tx, id, 1, adminId, 'x'))).rejects.toThrow(
			/ukuran/i
		);
		const last = db
			.select()
			.from(stockMovements)
			.where(eq(stockMovements.type, 'penyesuaian'))
			.all()
			.at(-1)!;
		expect(last.size).toBe('L');
		expect(last.stockAfter).toBe(12);
		expectInvariant(id);
	});
});

describe('keranjang & pesanan per ukuran', () => {
	it('wajib pilih ukuran; stok dibatasi per ukuran; ukuran berbeda = baris berbeda', async () => {
		const id = newProduct('Kaos E', [
			{ label: 'M', stock: 2 },
			{ label: 'L', stock: 5 }
		]);
		expect(await addToCart(userId, 'product', id, 1)).toMatchObject({ ok: false });
		expect(await addToCart(userId, 'product', id, 1, 'XL')).toMatchObject({ ok: false });
		expect(await addToCart(userId, 'product', id, 3, 'M')).toMatchObject({ ok: false }); // stok M = 2
		expect(await addToCart(userId, 'product', id, 2, 'm')).toEqual({ ok: true }); // dinormalkan
		expect(await addToCart(userId, 'product', id, 1, 'M')).toMatchObject({ ok: false }); // sudah 2
		expect(await addToCart(userId, 'product', id, 4, 'L')).toEqual({ ok: true });
		const cart = await getCartDetails(userId);
		expect(cart.items.map((i) => [i.size, i.quantity, i.maxStock]).sort()).toEqual([
			['L', 4, 5],
			['M', 2, 2]
		]);
		expect(await availableStock('product', id, 'L')).toBe(5);
	});

	it('produk tanpa ukuran menolak pilihan ukuran', async () => {
		const id = newProduct('Topi', [], 5);
		expect(await addToCart(userId, 'product', id, 1, 'M')).toMatchObject({ ok: false });
		expect(await addToCart(userId, 'product', id, 1)).toEqual({ ok: true });
	});

	it('checkout memotong stok ukuran terpilih, menyimpan ukuran di item; batal mengembalikannya', async () => {
		const id = newProduct('Kaos F', [
			{ label: 'M', stock: 5 },
			{ label: 'L', stock: 5 }
		]);
		await addToCart(userId, 'product', id, 2, 'M');
		await addToCart(userId, 'product', id, 1, 'L');
		const { orderId } = await createOrderFromCart(userId, SHIP);
		expect(sizeOf(id, 'M')).toBe(3);
		expect(sizeOf(id, 'L')).toBe(4);
		expect(stockOf(id)).toBe(7);
		const items = db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();
		expect(items.map((i) => [i.size, i.quantity]).sort()).toEqual([
			['L', 1],
			['M', 2]
		]);
		await cancelOrder(orderId, { id: userId, role: 'konsumen' }, 'batal');
		expect(sizeOf(id, 'M')).toBe(5);
		expect(sizeOf(id, 'L')).toBe(5);
		expect(stockOf(id)).toBe(10);
		expectInvariant(id);
	});

	it('stok ukuran habis saat checkout → pesanan ditolak dan tidak ada yang berubah', async () => {
		const id = newProduct('Kaos G', [{ label: 'M', stock: 2 }]);
		await addToCart(userId, 'product', id, 2, 'M');
		db.update(productSizes).set({ stock: 1 }).where(eq(productSizes.productId, id)).run();
		db.update(products).set({ stock: 1 }).where(eq(products.id, id)).run();
		await expect(createOrderFromCart(userId, SHIP)).rejects.toThrow(OrderError);
		expect(sizeOf(id, 'M')).toBe(1);
		expectInvariant(id);
	});

	it('legacy: baris keranjang tanpa ukuran pada produk yang kini ber-ukuran → masalah "ukuran"', async () => {
		const id = newProduct('Kaos H', [], 5);
		await addToCart(userId, 'product', id, 1);
		await transact((tx) => applySizeEdit(tx, id, adminId, [{ label: 'M', stock: 5 }], []));
		const cart = await getCartDetails(userId);
		expect(cart.items[0].problem).toBe('ukuran');
		expect(cart.subtotal).toBe(0);
		expect(await updateCartItemQuantity(userId, cart.items[0].id, 1)).toMatchObject({ ok: false });
	});
});

describe('bundling dengan komponen ber-ukuran', () => {
	function newBundle(componentIds: number[]) {
		const b = db
			.insert(bundles)
			.values({
				name: 'Paket',
				slug: 'paket-' + Math.random().toString(36).slice(2, 6),
				price: 150_000,
				stock: 10
			})
			.returning()
			.get();
		for (const pid of componentIds) {
			db.insert(bundleItems).values({ bundleId: b.id, productId: pid, quantity: 1 }).run();
		}
		return b.id;
	}

	it('wajib memilih ukuran tiap komponen ber-ukuran; stok memakai ukuran terpilih', async () => {
		const kaos = newProduct('Kaos I', [
			{ label: 'M', stock: 2 },
			{ label: 'L', stock: 0 }
		]);
		const topi = newProduct('Topi I', [], 5);
		const b = newBundle([kaos, topi]);

		expect(await addToCart(userId, 'bundle', b, 1)).toMatchObject({ ok: false });
		expect(await addToCart(userId, 'bundle', b, 1, `${kaos}:XL`)).toMatchObject({ ok: false });
		expect(await addToCart(userId, 'bundle', b, 1, `${kaos}:L`)).toMatchObject({ ok: false }); // L habis
		expect(await addToCart(userId, 'bundle', b, 3, `${kaos}:M`)).toMatchObject({ ok: false }); // M cuma 2
		expect(await addToCart(userId, 'bundle', b, 2, `${kaos}:M`)).toEqual({ ok: true });
		const cart = await getCartDetails(userId);
		expect(cart.items[0].sizeParts).toEqual([{ name: 'Kaos I', size: 'M' }]);
	});

	it('pesanan bundling memotong ukuran komponen, mencatat ukuran di snapshot, dan batal mengembalikannya', async () => {
		const kaos = newProduct('Kaos J', [
			{ label: 'M', stock: 4 },
			{ label: 'L', stock: 4 }
		]);
		const topi = newProduct('Topi J', [], 6);
		const b = newBundle([kaos, topi]);
		await addToCart(userId, 'bundle', b, 2, `${kaos}:L`);
		const { orderId } = await createOrderFromCart(userId, SHIP);

		expect(sizeOf(kaos, 'L')).toBe(2);
		expect(sizeOf(kaos, 'M')).toBe(4);
		expect(stockOf(topi)).toBe(4);
		const comps = db.select().from(orderItemComponents).all();
		expect(comps.map((c) => [c.productId, c.size, c.quantity]).sort()).toEqual(
			[
				[kaos, 'L', 2],
				[topi, '', 2]
			].sort()
		);

		await cancelOrder(orderId, { id: userId, role: 'konsumen' }, 'batal');
		expect(sizeOf(kaos, 'L')).toBe(4);
		expect(stockOf(kaos)).toBe(8);
		expect(stockOf(topi)).toBe(6);
		expectInvariant(kaos);
	});
});

describe('pembelian (restock) per ukuran', () => {
	const input = (items: { productId: number; size?: string; quantity: number }[]) => ({
		purchaseDate: '2026-11-16',
		items: items.map((i) => ({ unitCost: 50_000, ...i }))
	});

	it('menambah stok ukuran yang dipilih dan menyimpan ukuran di baris pembelian', async () => {
		const id = newProduct('Kaos K', [
			{ label: 'M', stock: 1 },
			{ label: 'L', stock: 1 }
		]);
		await createPurchase(adminId, input([{ productId: id, size: 'L', quantity: 10 }]));
		expect(sizeOf(id, 'L')).toBe(11);
		expect(sizeOf(id, 'M')).toBe(1);
		expect(stockOf(id)).toBe(12);
		expect(db.select().from(purchaseItems).get()?.size).toBe('L');
		expectInvariant(id);
	});

	it('menolak: ukuran kosong pada produk ber-ukuran, ukuran tak dikenal, ukuran pada produk tanpa ukuran', async () => {
		const sized = newProduct('Kaos L', [{ label: 'M', stock: 1 }]);
		const plain = newProduct('Topi L', [], 1);
		const bad = (items: Parameters<typeof input>[0]) =>
			expect(createPurchase(adminId, input(items))).rejects.toThrow(PurchaseRuleError);
		await bad([{ productId: sized, quantity: 1 }]);
		await bad([{ productId: sized, size: 'XL', quantity: 1 }]);
		await bad([{ productId: plain, size: 'M', quantity: 1 }]);
		// gagal = rollback total
		expect(stockOf(sized)).toBe(1);
		expect(stockOf(plain)).toBe(1);
	});
});

describe('ubah daftar ukuran produk', () => {
	it('konversi produk tanpa ukuran: stok lama dipindah ke ukuran, mutasi tercatat, total = jumlah ukuran', async () => {
		const id = newProduct('Kaos M', [], 10);
		await transact((tx) =>
			applySizeEdit(
				tx,
				id,
				adminId,
				[
					{ label: 'M', stock: 6 },
					{ label: 'L', stock: 4 }
				],
				[]
			)
		);
		expect(stockOf(id)).toBe(10);
		expectInvariant(id);
		const moves = db.select().from(stockMovements).where(eq(stockMovements.productId, id)).all();
		// -10 (stok lama dipindah) + 6 + 4 → mutasi seimbang, selisih total = 0
		expect(moves.map((m) => [m.size, m.quantityChange]).sort()).toEqual([
			[null, -10],
			['L', 4],
			['M', 6]
		]);
	});

	it('hapus ukuran hanya bila stoknya 0; tambah ukuran yang sudah ada ditolak', async () => {
		const id = newProduct('Kaos N', [
			{ label: 'S', stock: 0 },
			{ label: 'M', stock: 3 }
		]);
		await expect(transact((tx) => applySizeEdit(tx, id, adminId, [], ['M']))).rejects.toThrow(
			SizeRuleError
		);
		await expect(
			transact((tx) => applySizeEdit(tx, id, adminId, [{ label: 'M', stock: 0 }], []))
		).rejects.toThrow(SizeRuleError);
		await transact((tx) => applySizeEdit(tx, id, adminId, [{ label: 'XL', stock: 2 }], ['S']));
		expect(getSizes(db, id).map((s) => s.label)).toEqual(['M', 'XL']);
		expect(stockOf(id)).toBe(5);
		expectInvariant(id);
	});
});
