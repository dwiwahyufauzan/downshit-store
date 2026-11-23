/**
 * Uji integrasi form produk admin dengan ukuran: tambah (stok awal per ukuran), ubah (tambah/hapus ukuran,
 * konversi dari produk tanpa ukuran, rollback bila ditolak), dan daftar produk. DB terisolasi.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-produk-ukuran-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads-produk-ukuran',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import {
	activityLogs,
	categories,
	productSizes,
	products,
	stockMovements,
	users
} from '#lib/server/db/schema';
import { getSizes } from '#lib/server/sizes';
import * as baru from './baru/+page.server';
import * as edit from './[id]/edit/+page.server';
import * as daftar from './+page.server';

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
});

let adminId: number;
let catId: number;

const ADMIN = () =>
	({ user: { id: adminId, role: 'admin', name: 'Admin' }, sessionId: 't' }) as never;

function post(fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return new Request('http://x', { method: 'POST', body: fd });
}

const base = () => ({
	name: 'Kaos Uji',
	categoryId: String(catId),
	price: '120000',
	description: 'tes',
	isActive: 'on',
	isBundleable: 'on'
});

async function runCreate(fields: Record<string, string>) {
	try {
		const r = await baru.actions.default({ request: post(fields), locals: ADMIN() } as never);
		return {
			redirected: false as const,
			result: r as { status?: number; data?: Record<string, unknown> }
		};
	} catch (e) {
		if (isRedirect(e)) return { redirected: true as const, result: null };
		throw e;
	}
}

async function runEdit(id: number, fields: Record<string, string>) {
	try {
		const r = await edit.actions.default({
			params: { id: String(id) },
			request: post(fields),
			locals: ADMIN()
		} as never);
		return {
			redirected: false as const,
			result: r as { status?: number; data?: Record<string, unknown> }
		};
	} catch (e) {
		if (isRedirect(e)) return { redirected: true as const, result: null };
		throw e;
	}
}

const productByName = (name: string) =>
	db.select().from(products).where(eq(products.name, name)).get()!;

beforeEach(() => {
	for (const t of [activityLogs, stockMovements, productSizes, products, categories, users]) {
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

describe('tambah produk dengan ukuran', () => {
	it('stok awal dihitung dari stok tiap ukuran (field stok diabaikan) + mutasi stok awal per ukuran', async () => {
		const r = await runCreate({
			...base(),
			stock: '999',
			sizesNew: JSON.stringify([
				{ label: 'm', stock: 5 },
				{ label: 'L', stock: 3 },
				{ label: 'S', stock: 0 }
			])
		});
		expect(r.redirected).toBe(true);
		const p = productByName('Kaos Uji');
		expect(p.stock).toBe(8);
		expect(getSizes(db, p.id).map((s) => [s.label, s.stock])).toEqual([
			['S', 0],
			['M', 5],
			['L', 3]
		]);
		const moves = db.select().from(stockMovements).where(eq(stockMovements.productId, p.id)).all();
		expect(moves.map((m) => [m.size, m.quantityChange]).sort()).toEqual([
			['L', 3],
			['M', 5]
		]);
	});

	it('tanpa ukuran: perilaku lama (stok awal + satu mutasi tanpa ukuran)', async () => {
		const r = await runCreate({ ...base(), stock: '12' });
		expect(r.redirected).toBe(true);
		const p = productByName('Kaos Uji');
		expect(p.stock).toBe(12);
		expect(getSizes(db, p.id)).toHaveLength(0);
		const moves = db.select().from(stockMovements).where(eq(stockMovements.productId, p.id)).all();
		expect(moves).toHaveLength(1);
		expect(moves[0].size).toBeNull();
	});

	it('ukuran tidak valid / ganda ditolak dan tidak ada produk dibuat', async () => {
		for (const bad of [
			'bukan json',
			JSON.stringify([
				{ label: 'M', stock: 1 },
				{ label: 'm', stock: 2 }
			]),
			JSON.stringify([{ label: 'S;DROP', stock: 1 }]),
			JSON.stringify([{ label: 'M', stock: -1 }])
		]) {
			const r = await runCreate({ ...base(), stock: '0', sizesNew: bad });
			expect(r.redirected).toBe(false);
			expect(r.result?.status).toBe(400);
			expect((r.result?.data as { errors: { sizes: string[] } }).errors.sizes).toHaveLength(1);
		}
		expect(db.select().from(products).all()).toHaveLength(0);
	});
});

describe('ubah produk dengan ukuran', () => {
	const sized = async () => {
		await runCreate({
			...base(),
			stock: '0',
			sizesNew: JSON.stringify([
				{ label: 'S', stock: 0 },
				{ label: 'M', stock: 4 }
			])
		});
		return productByName('Kaos Uji').id;
	};

	it('menambah ukuran baru dengan stok awal; menghapus ukuran bersaldo 0; total tetap = jumlah ukuran', async () => {
		const id = await sized();
		const r = await runEdit(id, {
			...base(),
			name: 'Kaos Uji v2',
			sizesNew: JSON.stringify([{ label: 'XL', stock: 6 }]),
			sizesRemove: JSON.stringify(['S'])
		});
		expect(r.redirected).toBe(true);
		const p = db.select().from(products).where(eq(products.id, id)).get()!;
		expect(p.name).toBe('Kaos Uji v2');
		expect(getSizes(db, id).map((s) => [s.label, s.stock])).toEqual([
			['M', 4],
			['XL', 6]
		]);
		expect(p.stock).toBe(10);
	});

	it('menghapus ukuran yang masih bersaldo ditolak dan SELURUH perubahan (nama) di-rollback', async () => {
		const id = await sized();
		const r = await runEdit(id, {
			...base(),
			name: 'Nama Baru',
			sizesRemove: JSON.stringify(['M'])
		});
		expect(r.redirected).toBe(false);
		expect(r.result?.status).toBe(400);
		expect(String(r.result?.data?.message)).toMatch(/masih punya stok/);
		const p = db.select().from(products).where(eq(products.id, id)).get()!;
		expect(p.name).toBe('Kaos Uji');
		expect(getSizes(db, id).map((s) => s.label)).toEqual(['S', 'M']);
		expect(p.stock).toBe(4);
	});

	it('menambah ukuran yang sudah ada ditolak', async () => {
		const id = await sized();
		const r = await runEdit(id, {
			...base(),
			sizesNew: JSON.stringify([{ label: 'M', stock: 1 }])
		});
		expect(r.result?.status).toBe(400);
		expect(String(r.result?.data?.message)).toMatch(/sudah ada/);
	});

	it('konversi produk tanpa ukuran: stok lama dipindah ke ukuran baru, mutasi seimbang', async () => {
		await runCreate({ ...base(), stock: '10' });
		const id = productByName('Kaos Uji').id;
		const r = await runEdit(id, {
			...base(),
			sizesNew: JSON.stringify([
				{ label: 'M', stock: 6 },
				{ label: 'L', stock: 4 }
			])
		});
		expect(r.redirected).toBe(true);
		expect(db.select().from(products).where(eq(products.id, id)).get()!.stock).toBe(10);
		const moves = db.select().from(stockMovements).where(eq(stockMovements.productId, id)).all();
		expect(moves.reduce((s, m) => s + m.quantityChange, 0)).toBe(10); // awal +10, pindah −10, +6, +4
	});

	it('load ubah mengembalikan ukuran; daftar produk menyertakan ringkasan ukuran', async () => {
		const id = await sized();
		const l = (await edit.load({ params: { id: String(id) }, locals: ADMIN() } as never)) as {
			sizes: { label: string; stock: number }[];
		};
		expect(l.sizes.map((s) => s.label)).toEqual(['S', 'M']);
		const list = (await daftar.load({
			url: new URL('http://x/admin/produk'),
			locals: ADMIN()
		} as never)) as { products: { id: number; sizes: { label: string }[] }[] };
		expect(list.products.find((p) => p.id === id)?.sizes.map((s) => s.label)).toEqual(['S', 'M']);
	});
});
