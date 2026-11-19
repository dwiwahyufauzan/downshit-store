/**
 * Uji integrasi action `adjust` (stock opname) di admin/stok, termasuk penyesuaian per ukuran.
 * DB terisolasi (salinan skema kosong dari tests/global-setup.ts).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-stokadj-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads-stokadj',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32)
}));

import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	activityLogs,
	bundleItems,
	bundles,
	categories,
	productSizes,
	products,
	stockMovements,
	users
} from '$lib/server/db/schema';
import { createInitialSizes } from '$lib/server/product-sizes';
import { getSizes } from '$lib/server/sizes';
import * as stok from './+page.server';

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
});

let adminId: number;
let catId: number;

const locals = () =>
	({
		user: { id: adminId, name: 'Admin', email: 'a@x.id', role: 'admin', mustChangePassword: false },
		sessionId: null
	}) as never;

/** Panggil action `adjust` dengan isian form; hasil `fail()` dikembalikan sebagai { status, data }. */
async function adjust(fields: Record<string, string | number | null>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) if (v !== null) fd.set(k, String(v));
	const request = new Request('http://localhost/admin/stok?/adjust', { method: 'POST', body: fd });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await stok.actions.adjust({ request, locals: locals() } as any)) as any;
}

const stockOf = (id: number) => db.select().from(products).where(eq(products.id, id)).get()!.stock;
const sizeOf = (id: number, label: string) =>
	getSizes(db, id).find((s) => s.label === label)?.stock;

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
		activityLogs,
		bundleItems,
		bundles,
		stockMovements,
		productSizes,
		products,
		categories,
		users
	]) {
		db.delete(t).run();
	}
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

describe('admin/stok — action adjust', () => {
	it('produk tanpa ukuran: menyesuaikan stok dan mencatat mutasi tanpa ukuran', async () => {
		const id = newProduct('Topi', [], 10);
		const r = await adjust({ kind: 'product', id, newStock: 7, note: 'opname bulanan' });
		expect(r.success).toBe(true);
		expect(stockOf(id)).toBe(7);
		const m = db.select().from(stockMovements).where(eq(stockMovements.productId, id)).get()!;
		expect([m.size, m.quantityChange, m.stockAfter, m.type]).toEqual([null, -3, 7, 'penyesuaian']);
	});

	it('produk ber-ukuran: menyesuaikan satu ukuran, total ikut, mutasi + log memuat ukuran', async () => {
		const id = newProduct('Kaos A', [
			{ label: 'M', stock: 5 },
			{ label: 'L', stock: 5 }
		]);
		const r = await adjust({ kind: 'product', id, size: 'l', newStock: 12, note: 'hitung fisik' });
		expect(r.success).toBe(true);
		expect(r.message).toContain('Kaos A (L)');
		expect(sizeOf(id, 'L')).toBe(12);
		expect(sizeOf(id, 'M')).toBe(5);
		expect(stockOf(id)).toBe(17);

		const m = db
			.select()
			.from(stockMovements)
			.where(eq(stockMovements.type, 'penyesuaian'))
			.all()
			.at(-1)!;
		expect([m.size, m.quantityChange, m.stockAfter]).toEqual(['L', 7, 12]);
		const log = db
			.select()
			.from(activityLogs)
			.where(eq(activityLogs.action, 'stock.adjust'))
			.get()!;
		expect(log.description).toContain('Kaos A (L) disesuaikan 5 → 12');
	});

	it('produk ber-ukuran tanpa ukuran, ukuran tak dikenal → 400 dan stok tidak berubah', async () => {
		const id = newProduct('Kaos B', [{ label: 'M', stock: 5 }]);
		const noSize = await adjust({ kind: 'product', id, newStock: 1, note: 'tanpa ukuran' });
		const badSize = await adjust({
			kind: 'product',
			id,
			size: 'XL',
			newStock: 1,
			note: 'ukuran ngawur'
		});
		for (const r of [noSize, badSize]) {
			expect(r.status).toBe(400);
			expect(r.data.message).toMatch(/ukuran/i);
		}
		expect(sizeOf(id, 'M')).toBe(5);
		expect(stockOf(id)).toBe(5);
		expect(db.select().from(stockMovements).all()).toHaveLength(1); // hanya stok awal
	});

	it('produk tanpa ukuran menolak pilihan ukuran; bundling juga', async () => {
		const id = newProduct('Topi 2', [], 4);
		const r = await adjust({ kind: 'product', id, size: 'M', newStock: 2, note: 'salah ukuran' });
		expect(r.status).toBe(400);
		expect(stockOf(id)).toBe(4);

		const b = db
			.insert(bundles)
			.values({ name: 'Paket', slug: 'paket', price: 1000, stock: 5 })
			.returning()
			.get();
		db.insert(bundleItems).values({ bundleId: b.id, productId: id, quantity: 1 }).run();
		const ok = await adjust({ kind: 'bundle', id: b.id, newStock: 9, note: 'kuota baru' });
		expect(ok.success).toBe(true);
		expect(db.select().from(bundles).get()!.stock).toBe(9);
		const bad = await adjust({
			kind: 'bundle',
			id: b.id,
			size: 'M',
			newStock: 3,
			note: 'kuota ngawur'
		});
		expect(bad.status).toBe(400);
	});

	it('load: ringkasan memuat ukuran per produk dan riwayat mutasi memuat kolom ukuran', async () => {
		const id = newProduct('Kaos C', [
			{ label: 'S', stock: 2 },
			{ label: 'M', stock: 8 }
		]);
		await adjust({ kind: 'product', id, size: 'S', newStock: 4, note: 'tambah S' });
		const loaded = await stok.load({
			url: new URL('http://localhost/admin/stok'),
			locals: locals()
		} as never);
		const data = loaded as unknown as {
			overview: {
				products: { id: number; stock: number; sizes: { label: string; stock: number }[] }[];
			};
			movements: { size: string | null }[];
		};
		const row = data.overview.products.find((p) => p.id === id)!;
		expect(row.sizes.map((s) => [s.label, s.stock])).toEqual([
			['S', 4],
			['M', 8]
		]);
		expect(row.stock).toBe(12);
		expect(data.movements.map((m) => m.size)).toContain('S');
	});
});
