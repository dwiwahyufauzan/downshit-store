/**
 * Uji integrasi fitur Admin (SRS-F-003, 004, 006, 007, 012 + pengaturan toko; BR-03, 05, 09, 15, 16, 19, 23).
 * Memakai DB SQLite terisolasi (salinan skema kosong dari tests/global-setup.ts).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-admin-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads-admin',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { rmSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { db, transact } from './db';
import {
	activityLogs,
	bundleItems,
	bundles,
	categories,
	cartItems,
	carts,
	orderItems,
	orders,
	products,
	purchaseItems,
	purchases,
	sessions,
	settings,
	stockMovements,
	users
} from './db/schema';
import { createPurchase, PurchaseRuleError } from './purchase';
import { productUsageIn, INITIAL_STOCK_NOTE } from './product-usage';
import { checkBundleComponents } from './bundle-validate';
import { getStockOverview } from './stock-overview';
import { setBundleStock, setProductStock } from './stock';
import { getSettings, setSettings, SETTING_KEYS } from './settings';
import { resetCustomerPassword, setCustomerActive } from './customer-admin';
import { uniqueSlug } from './slug';
import { settingsSchema } from '../schemas/settings';
import { verifyPassword } from './auth';
import * as kategori from '../../routes/admin/kategori/+page.server';

let adminId: number;
let ownerId: number;
let custId: number;
let catId: number;
let aId: number;
let bId: number;
let cId: number;

/** Pengaman: jangan pernah menghapus data kecuali ini DB tes sementara milik berkas ini. */
function assertTestDb() {
	if (!/\.tmp-admin-/.test(env.file)) throw new Error('MENOLAK reset: bukan DB tes admin');
}

function reset() {
	assertTestDb();
	for (const t of [
		activityLogs,
		stockMovements,
		cartItems,
		carts,
		orderItems,
		orders,
		purchaseItems,
		purchases,
		bundleItems,
		bundles,
		products,
		categories,
		sessions,
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
	adminId = mkUser('Admin', 'admin', 'a@x.id');
	ownerId = mkUser('Owner', 'owner', 'o@x.id');
	custId = mkUser('Cust', 'konsumen', 'c@x.id');
	catId = db
		.insert(categories)
		.values({ name: 'Kaos', slug: 'kaos' })
		.returning({ id: categories.id })
		.get().id;
	const mk = (
		name: string,
		slug: string,
		stock: number,
		extra: Partial<typeof products.$inferInsert> = {}
	) =>
		db
			.insert(products)
			.values({ name, slug, price: 100_000, stock, categoryId: catId, ...extra })
			.returning({ id: products.id })
			.get().id;
	aId = mk('Produk A', 'a', 10);
	bId = mk('Produk B', 'b', 3);
	cId = mk('Produk C', 'c', 20, { isBundleable: false });
}

const stockOf = (id: number) =>
	db.select({ s: products.stock }).from(products).where(eq(products.id, id)).get()!.s;

beforeEach(reset);
afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
});

describe('Pembelian / restock (BR-09, TC-006)', () => {
	it('menambah stok, mencatat mutasi pembelian, kode PBL berurutan (TC-006-01, 02, 06)', async () => {
		const r1 = await createPurchase(adminId, {
			supplierName: 'CV X',
			purchaseDate: '2026-11-14',
			items: [
				{ productId: aId, quantity: 10, unitCost: 5000 },
				{ productId: bId, quantity: 4, unitCost: 7000 }
			]
		});
		expect(stockOf(aId)).toBe(20);
		expect(stockOf(bId)).toBe(7);
		expect(r1.total).toBe(10 * 5000 + 4 * 7000);
		expect(r1.code).toMatch(/^PBL-\d{6}-001$/);

		const r2 = await createPurchase(adminId, {
			purchaseDate: '2026-11-14',
			items: [{ productId: aId, quantity: 1, unitCost: 0 }]
		});
		expect(r2.code).toMatch(/^PBL-\d{6}-002$/);

		const mv = db.select().from(stockMovements).where(eq(stockMovements.type, 'pembelian')).all();
		expect(mv).toHaveLength(3);
		expect(mv.every((m) => m.referenceType === 'purchase' && m.createdBy === adminId)).toBe(true);
		const mA = mv.find((m) => m.productId === aId && m.quantityChange === 10)!;
		expect(mA.stockAfter).toBe(20);
		expect(
			db.select().from(activityLogs).where(eq(activityLogs.action, 'purchase.create')).all()
		).toHaveLength(2);
	});

	it('gagal di tengah → rollback total: stok tak berubah, tak ada purchases/mutasi/log (TC-006-05)', async () => {
		// Trigger memaksa kegagalan di LANGKAH TERAKHIR (log), setelah semua stok sudah dinaikkan & baris dibuat
		db.run(sql`CREATE TRIGGER t_fail_purchase_log BEFORE INSERT ON activity_logs
			WHEN NEW.action = 'purchase.create' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
		try {
			await expect(
				createPurchase(adminId, {
					purchaseDate: '2026-11-14',
					items: [
						{ productId: aId, quantity: 5, unitCost: 1000 },
						{ productId: bId, quantity: 5, unitCost: 2000 }
					]
				})
			).rejects.toThrow('boom');
		} finally {
			db.run(sql`DROP TRIGGER t_fail_purchase_log`);
		}

		expect(stockOf(aId)).toBe(10);
		expect(stockOf(bId)).toBe(3);
		expect(db.select().from(purchases).all()).toHaveLength(0);
		expect(db.select().from(purchaseItems).all()).toHaveLength(0);
		expect(db.select().from(stockMovements).all()).toHaveLength(0);
		expect(db.select().from(activityLogs).all()).toHaveLength(0);

		// setelah rollback, pembelian berikutnya tetap bisa dan kode kembali -001 (tidak ada lubang)
		const ok = await createPurchase(adminId, {
			purchaseDate: '2026-11-14',
			items: [{ productId: aId, quantity: 1, unitCost: 1 }]
		});
		expect(ok.code).toMatch(/-001$/);
	});

	it('menolak produk tidak ada / sudah dihapus tanpa mengubah apa pun', async () => {
		db.update(products)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(products.id, bId))
			.run();
		await expect(
			createPurchase(adminId, {
				purchaseDate: '2026-11-14',
				items: [
					{ productId: aId, quantity: 5, unitCost: 1 },
					{ productId: bId, quantity: 5, unitCost: 1 }
				]
			})
		).rejects.toBeInstanceOf(PurchaseRuleError);
		await expect(
			createPurchase(adminId, {
				purchaseDate: '2026-11-14',
				items: [{ productId: 99999, quantity: 1, unitCost: 1 }]
			})
		).rejects.toBeInstanceOf(PurchaseRuleError);
		expect(stockOf(aId)).toBe(10);
		expect(db.select().from(purchases).all()).toHaveLength(0);
	});
});

describe('Pemakaian produk & hapus (BR-03, TC-003-08/09/10)', () => {
	it('produk baru ber-stok awal tanpa riwayat nyata → boleh hapus permanen', () => {
		db.insert(stockMovements)
			.values({
				productId: aId,
				type: 'penyesuaian',
				quantityChange: 10,
				stockAfter: 10,
				referenceType: 'manual',
				note: INITIAL_STOCK_NOTE
			})
			.run();
		const u = productUsageIn(db, aId);
		expect(u).toMatchObject({ inActiveBundle: false, hasHistory: false });
	});

	it('pembelian / opname → hasHistory', async () => {
		await createPurchase(adminId, {
			purchaseDate: '2026-11-14',
			items: [{ productId: aId, quantity: 1, unitCost: 1 }]
		});
		expect(productUsageIn(db, aId).hasHistory).toBe(true);

		await transact((tx) => setProductStock(tx, bId, 5, adminId, 'opname uji'));
		expect(productUsageIn(db, bId).hasHistory).toBe(true);
	});

	it('komponen bundling aktif memblokir hapus; bundling terhapus tidak memblokir tetapi tetap riwayat', () => {
		const bundleId = db
			.insert(bundles)
			.values({ name: 'Paket', slug: 'paket', price: 150_000, stock: 5 })
			.returning({ id: bundles.id })
			.get().id;
		db.insert(bundleItems)
			.values([
				{ bundleId, productId: aId, quantity: 1 },
				{ bundleId, productId: bId, quantity: 1 }
			])
			.run();
		let u = productUsageIn(db, aId);
		expect(u.inActiveBundle).toBe(true);
		expect(u.activeBundleNames).toEqual(['Paket']);

		db.update(bundles)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(bundles.id, bundleId))
			.run();
		u = productUsageIn(db, aId);
		expect(u.inActiveBundle).toBe(false);
		expect(u.hasHistory).toBe(true); // bundle_items masih menunjuk produk (FK RESTRICT) → hanya soft delete
	});
});

describe('Komponen bundling (BR-05/16, TC-004-04/08)', () => {
	it('hanya produk aktif + bundleable + belum dihapus', () => {
		expect(checkBundleComponents(db, [aId, bId])).toBeNull();
		expect(checkBundleComponents(db, [aId, cId])).toContain('Produk C'); // non-bundleable
		db.update(products).set({ isActive: false }).where(eq(products.id, bId)).run();
		expect(checkBundleComponents(db, [aId, bId])).toContain('Produk B');
		expect(checkBundleComponents(db, [aId, bId], [bId])).toBeNull(); // komponen lama yang sekadar nonaktif ditoleransi saat ubah
		expect(checkBundleComponents(db, [aId, 424242])).toContain('424242');
	});

	it('stok efektif = min(kuota, floor(stok komponen / qty)) di ikhtisar stok (TC-005-11)', async () => {
		const bundleId = db
			.insert(bundles)
			.values({ name: 'Paket', slug: 'paket', price: 150_000, stock: 15 })
			.returning({ id: bundles.id })
			.get().id;
		db.insert(bundleItems)
			.values([
				{ bundleId, productId: aId, quantity: 1 }, // 10
				{ bundleId, productId: bId, quantity: 1 } // 3  → efektif 3
			])
			.run();
		const ov = await getStockOverview();
		expect(ov.bundles[0].effectiveStock).toBe(3);
		expect(ov.bundles[0].blocked).toBe(false);

		db.update(products).set({ isActive: false }).where(eq(products.id, aId)).run();
		const ov2 = await getStockOverview();
		expect(ov2.bundles[0]).toMatchObject({ effectiveStock: 0, blocked: true });
	});
});

describe('Stok & penyesuaian (SRS-F-012, BR-19, TC-012)', () => {
	it('setProductStock / setBundleStock mencatat selisih; selisih 0 tidak mencatat apa pun', async () => {
		const diff = await transact((tx) => setProductStock(tx, aId, 4, adminId, 'opname mingguan'));
		expect(diff).toBe(-6);
		expect(stockOf(aId)).toBe(4);
		const mv = db.select().from(stockMovements).all();
		expect(mv).toHaveLength(1);
		expect(mv[0]).toMatchObject({
			type: 'penyesuaian',
			quantityChange: -6,
			stockAfter: 4,
			referenceType: 'manual',
			note: 'opname mingguan',
			createdBy: adminId
		});
		expect(await transact((tx) => setProductStock(tx, aId, 4, adminId, 'tidak berubah'))).toBe(0);
		expect(db.select().from(stockMovements).all()).toHaveLength(1);

		const bid = db
			.insert(bundles)
			.values({ name: 'Paket', slug: 'paket', price: 1000, stock: 2 })
			.returning({ id: bundles.id })
			.get().id;
		expect(await transact((tx) => setBundleStock(tx, bid, 9, adminId, 'tambah kuota'))).toBe(7);
		await expect(
			transact((tx) => setProductStock(tx, 99999, 1, adminId, 'tak ada'))
		).rejects.toThrow('tidak ditemukan');
	});

	it('ikhtisar: habis / menipis mengikuti ambang pengaturan (TC-012-05, 07) & nilai persediaan hanya produk', async () => {
		let ov = await getStockOverview();
		expect(ov.lowStock).toBe(5);
		expect(ov.summary).toMatchObject({ total: 3, empty: 0, low: 1 }); // B stok 3
		expect(ov.summary.inventoryValue).toBe(100_000 * (10 + 3 + 20));

		db.insert(settings).values({ key: 'low_stock_threshold', value: '10' }).run();
		ov = await getStockOverview();
		expect(ov.lowStock).toBe(10);
		expect(ov.summary.low).toBe(2); // A (10) dan B (3)
		const lowOnly = await getStockOverview({ lowOnly: true });
		expect(lowOnly.products.map((p) => p.name).sort()).toEqual(['Produk A', 'Produk B']);
		expect(lowOnly.summary.total).toBe(3); // ringkasan tidak ikut tersaring
	});
});

describe('Pelanggan (SRS-F-007, TC-007)', () => {
	it('nonaktifkan → sesi berakhir & tidak valid; aktifkan kembali; admin/owner tak tersentuh (TC-007-04/05/06)', async () => {
		db.insert(sessions)
			.values({ id: 's1', userId: custId, expiresAt: '2999-01-01T00:00:00.000Z' })
			.run();
		const r = await setCustomerActive(adminId, custId, false);
		expect(r).toMatchObject({ ok: true, isActive: false });
		expect(db.select().from(sessions).where(eq(sessions.userId, custId)).all()).toHaveLength(0);
		expect(db.select().from(users).where(eq(users.id, custId)).get()!.isActive).toBe(false);

		expect(await setCustomerActive(adminId, custId, true)).toMatchObject({
			ok: true,
			isActive: true
		});
		// tanpa `to` → dibalik
		expect(await setCustomerActive(adminId, custId)).toMatchObject({ ok: true, isActive: false });

		for (const id of [adminId, ownerId]) {
			expect(await setCustomerActive(adminId, id, false)).toMatchObject({ ok: false, status: 404 });
			expect(await resetCustomerPassword(adminId, id)).toMatchObject({ ok: false, status: 404 });
			expect(db.select().from(users).where(eq(users.id, id)).get()!.isActive).toBe(true);
		}
		expect(
			db.select().from(activityLogs).where(eq(activityLogs.action, 'user.deactivate')).all()
		).toHaveLength(2);
	});

	it('reset password: sementara acak, must_change_password, sesi lama dihapus, tidak ada di log (TC-007-07)', async () => {
		db.insert(sessions)
			.values({ id: 's2', userId: custId, expiresAt: '2999-01-01T00:00:00.000Z' })
			.run();
		const r = await resetCustomerPassword(adminId, custId);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.tempPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
		const u = db.select().from(users).where(eq(users.id, custId)).get()!;
		expect(u.mustChangePassword).toBe(true);
		expect(await verifyPassword(u.passwordHash, r.tempPassword!)).toBe(true);
		expect(db.select().from(sessions).where(eq(sessions.userId, custId)).all()).toHaveLength(0);
		const logs = db.select().from(activityLogs).all();
		expect(logs.some((l) => l.description.includes(r.tempPassword!))).toBe(false);
		// reset kedua menghasilkan password berbeda
		const r2 = await resetCustomerPassword(adminId, custId);
		expect(r2.ok && r2.tempPassword).not.toBe(r.tempPassword);
	});
});

describe('Pengaturan toko (BR-15, BR-23, TC-016)', () => {
	const valid = {
		storeName: 'Toko Uji',
		whatsapp: '6281299998888',
		shippingCost: '20000',
		bankName: 'BNI',
		bankNumber: '0123456789',
		bankHolder: 'Uji',
		lowStock: '8',
		paymentDeadlineHours: '12',
		maxUnpaidOrders: '2',
		autoCompleteDays: '5',
		payTransfer: 'on',
		payQris: 'on'
	};

	it('menyimpan SEMUA 15 kunci dan terbaca kembali', async () => {
		const parsed = settingsSchema.parse(valid);
		await transact((tx) => setSettings(tx, parsed));
		const rows = Object.fromEntries(
			db
				.select()
				.from(settings)
				.all()
				.map((r) => [r.key, r.value])
		);
		expect(Object.keys(rows).sort()).toEqual(Object.values(SETTING_KEYS).sort());
		expect(rows.shipping_flat_cost).toBe('20000');
		const cfg = await getSettings();
		expect(cfg).toEqual({
			storeName: 'Toko Uji',
			whatsapp: '6281299998888',
			shippingCost: 20000,
			bankName: 'BNI',
			bankNumber: '0123456789',
			bankHolder: 'Uji',
			lowStock: 8,
			paymentDeadlineHours: 12,
			maxUnpaidOrders: 2,
			autoCompleteDays: 5,
			payTransfer: true,
			payEwallet: false,
			payQris: true,
			payVa: false,
			payMinimarket: false
		});
		// simpan ulang (upsert) tidak menggandakan baris
		await transact((tx) => setSettings(tx, { ...parsed, shippingCost: 25000 }));
		expect(db.select().from(settings).all()).toHaveLength(15);
		expect((await getSettings()).shippingCost).toBe(25000);
	});

	it('nilai rusak di DB jatuh ke default (bukan NaN)', async () => {
		db.insert(settings).values({ key: 'shipping_flat_cost', value: 'abc' }).run();
		db.insert(settings).values({ key: 'low_stock_threshold', value: '' }).run();
		const cfg = await getSettings();
		expect(cfg.shippingCost).toBe(15000);
		expect(cfg.lowStock).toBe(5);
	});
});

describe('Kategori & slug', () => {
	it('uniqueSlug: bentrok → -2, -3; nama tanpa huruf/angka → item, item-2', async () => {
		expect(await uniqueSlug(categories, categories.slug, 'kaos')).toBe('kaos-2');
		db.insert(categories).values({ name: 'Kaos 2', slug: 'kaos-2' }).run();
		expect(await uniqueSlug(categories, categories.slug, 'kaos')).toBe('kaos-3');
		expect(await uniqueSlug(categories, categories.slug, '')).toBe('item');
		db.insert(categories).values({ name: '!!!', slug: 'item' }).run();
		expect(await uniqueSlug(categories, categories.slug, '')).toBe('item-2');
	});

	const call = (
		action: 'create' | 'update' | 'delete',
		fields: Record<string, string>,
		user = adminId
	) => {
		const fd = new FormData();
		for (const [k, v] of Object.entries(fields)) fd.set(k, v);
		const role = user === adminId ? 'admin' : 'konsumen';
		return (kategori.actions[action] as (e: unknown) => Promise<Record<string, unknown>>)({
			request: { formData: async () => fd },
			locals: { user: { id: user, role, name: 'x', email: 'x', mustChangePassword: false } }
		});
	};

	it('hapus kategori: ditolak bila dipakai produk (pesan jumlah), boleh bila kosong (TC-003-11)', async () => {
		const r = (await call('delete', { id: String(catId) })) as { data: { message: string } };
		expect(r.data.message).toContain('masih dipakai 3 produk');
		expect(db.select().from(categories).all()).toHaveLength(1);

		const empty = db
			.insert(categories)
			.values({ name: 'Kosong', slug: 'kosong' })
			.returning({ id: categories.id })
			.get().id;
		const ok = (await call('delete', { id: String(empty) })) as { success?: boolean };
		expect(ok.success).toBe(true);
		const gone = (await call('delete', { id: String(empty) })) as { status: number };
		expect(gone.status).toBe(404);
	});

	it('nama kategori unik (tanpa beda huruf besar/kecil) & hanya admin yang boleh (TC-003-12)', async () => {
		const dup = (await call('create', { name: 'kaos' })) as {
			status: number;
			data: { errors: { name: string[] } };
		};
		expect(dup.status).toBe(400);
		expect(dup.data.errors.name[0]).toContain('sudah dipakai');
		await expect(call('create', { name: 'Hoodie' }, custId)).rejects.toMatchObject({ status: 403 });
	});
});
