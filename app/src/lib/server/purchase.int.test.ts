/**
 * Uji integrasi status pembelian: dipesan → diterima (stok naik), pembatalan (stok ditarik kembali / ditolak
 * bila sebagian terjual). DB terisolasi (salinan skema kosong).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-purchase-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads-purchase',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32)
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
import { cancelPurchase, createPurchase, PurchaseRuleError, receivePurchase } from './purchase';
import { decreaseProductStock } from './stock';
import { createInitialSizes } from './product-sizes';
import { getSizes } from './sizes';

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
});

const meta = { type: 'penjualan', refType: 'order', refId: 1 } as const;

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

const BASE = { purchaseDate: '2026-11-01', supplierName: 'CV Tekstil' };

describe('status pembelian', () => {
	it('bawaan: diterima → stok langsung naik + mutasi pembelian', async () => {
		const id = newProduct('Kaos A', [], 5);
		const r = await createPurchase(adminId, {
			...BASE,
			items: [{ productId: id, quantity: 10, unitCost: 40_000 }]
		});
		const p = db.select().from(purchases).where(eq(purchases.id, r.id)).get()!;
		expect(p.status).toBe('diterima');
		expect(p.receivedAt).not.toBeNull();
		expect(stockOf(id)).toBe(15);
	});

	it('dipesan: stok TIDAK naik, tidak ada mutasi; diterima → stok naik per ukuran', async () => {
		const id = newProduct('Kaos B', [
			{ label: 'M', stock: 2 },
			{ label: 'L', stock: 3 }
		]);
		const r = await createPurchase(adminId, {
			...BASE,
			status: 'dipesan',
			items: [
				{ productId: id, size: 'M', quantity: 4, unitCost: 40_000 },
				{ productId: id, size: 'L', quantity: 6, unitCost: 40_000 }
			]
		});
		expect(db.select().from(purchases).where(eq(purchases.id, r.id)).get()!.status).toBe('dipesan');
		expect(stockOf(id)).toBe(5);
		expect(
			db.select().from(stockMovements).where(eq(stockMovements.type, 'pembelian')).all()
		).toHaveLength(0);

		await receivePurchase(adminId, r.id);
		expect(sizeOf(id, 'M')).toBe(6);
		expect(sizeOf(id, 'L')).toBe(9);
		expectInvariant(id);
		const p = db.select().from(purchases).where(eq(purchases.id, r.id)).get()!;
		expect(p.status).toBe('diterima');
		expect(p.receivedAt).not.toBeNull();
		expect(
			db.select().from(stockMovements).where(eq(stockMovements.type, 'pembelian')).all()
		).toHaveLength(2);
	});

	it('tidak bisa diterima dua kali (stok tidak dobel) dan tidak bisa diterima setelah batal', async () => {
		const id = newProduct('Kaos C', [], 0);
		const r = await createPurchase(adminId, {
			...BASE,
			status: 'dipesan',
			items: [{ productId: id, quantity: 5, unitCost: 1 }]
		});
		await receivePurchase(adminId, r.id);
		await expect(receivePurchase(adminId, r.id)).rejects.toThrow(PurchaseRuleError);
		expect(stockOf(id)).toBe(5);

		const r2 = await createPurchase(adminId, {
			...BASE,
			status: 'dipesan',
			items: [{ productId: id, quantity: 5, unitCost: 1 }]
		});
		await cancelPurchase(adminId, r2.id, 'supplier batal');
		await expect(receivePurchase(adminId, r2.id)).rejects.toThrow(PurchaseRuleError);
		expect(stockOf(id)).toBe(5);
	});
});

describe('pembatalan pembelian', () => {
	it('berstatus dipesan: hanya status berubah, stok tidak disentuh', async () => {
		const id = newProduct('Kaos D', [], 7);
		const r = await createPurchase(adminId, {
			...BASE,
			status: 'dipesan',
			items: [{ productId: id, quantity: 5, unitCost: 1 }]
		});
		const res = await cancelPurchase(adminId, r.id, '  salah input ');
		expect(res.reversed).toBe(false);
		expect(stockOf(id)).toBe(7);
		const p = db.select().from(purchases).where(eq(purchases.id, r.id)).get()!;
		expect(p.status).toBe('dibatalkan');
		expect(p.cancelNote).toBe('salah input');
	});

	it('berstatus diterima: stok per ukuran ditarik kembali + mutasi tercatat', async () => {
		const id = newProduct('Kaos E', [
			{ label: 'M', stock: 1 },
			{ label: 'L', stock: 1 }
		]);
		const r = await createPurchase(adminId, {
			...BASE,
			items: [
				{ productId: id, size: 'M', quantity: 4, unitCost: 1 },
				{ productId: id, size: 'L', quantity: 6, unitCost: 1 }
			]
		});
		expect(stockOf(id)).toBe(12);
		const res = await cancelPurchase(adminId, r.id);
		expect(res.reversed).toBe(true);
		expect(sizeOf(id, 'M')).toBe(1);
		expect(sizeOf(id, 'L')).toBe(1);
		expect(stockOf(id)).toBe(2);
		expectInvariant(id);
		const mv = db
			.select()
			.from(stockMovements)
			.where(eq(stockMovements.referenceType, 'purchase'))
			.all();
		expect(mv.filter((m) => m.quantityChange < 0)).toHaveLength(2);
		await expect(cancelPurchase(adminId, r.id)).rejects.toThrow(PurchaseRuleError);
	});

	it('sebagian sudah terjual → ditolak total, tidak ada yang berubah (rollback)', async () => {
		const id = newProduct('Kaos F', [
			{ label: 'M', stock: 0 },
			{ label: 'L', stock: 0 }
		]);
		const r = await createPurchase(adminId, {
			...BASE,
			items: [
				{ productId: id, size: 'L', quantity: 5, unitCost: 1 },
				{ productId: id, size: 'M', quantity: 5, unitCost: 1 }
			]
		});
		// 3 pcs ukuran M terjual
		db.transaction(
			(tx) => {
				expect(decreaseProductStock(tx, id, 3, meta, 'M')).toBe(true);
			},
			{ behavior: 'immediate' }
		);
		await expect(cancelPurchase(adminId, r.id)).rejects.toThrow(/sebagian sudah terjual/);
		expect(sizeOf(id, 'L')).toBe(5);
		expect(sizeOf(id, 'M')).toBe(2);
		expectInvariant(id);
		expect(db.select().from(purchases).where(eq(purchases.id, r.id)).get()!.status).toBe(
			'diterima'
		);
	});

	it('produk sudah dinonaktifkan tetap bisa ditarik stoknya', async () => {
		const id = newProduct('Kaos G', [], 0);
		const r = await createPurchase(adminId, {
			...BASE,
			items: [{ productId: id, quantity: 5, unitCost: 1 }]
		});
		db.update(products).set({ isActive: false }).where(eq(products.id, id)).run();
		await cancelPurchase(adminId, r.id);
		expect(stockOf(id)).toBe(0);
	});
});
