/**
 * Uji integrasi ulasan produk & rekomendasi (terlaris, rating tertinggi, serupa, untuk pengguna).
 * DB terisolasi (salinan skema kosong).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-reviews-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads-reviews',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32)
}));

import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from './db';
import {
	activityLogs,
	bundleItems,
	bundles,
	categories,
	orderItemComponents,
	orderItems,
	orders,
	products,
	reviews,
	users
} from './db/schema';
import {
	ReviewError,
	createReview,
	getOrderReviewables,
	getReviewSummary,
	listReviews,
	maskName
} from './reviews';
import {
	getBestSellers,
	getForUser,
	getProductStats,
	getSimilar,
	getTopRated
} from './recommendations';

afterAll(() => {
	for (const ext of ['', '-wal', '-shm']) rmSync(env.file + ext, { force: true });
});

let u1: number;
let u2: number;
let kaos: number;
let hoodie: number;
let seq = 0;

function product(name: string, catId: number, price: number, stock = 10) {
	return db
		.insert(products)
		.values({
			name,
			slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${seq++}`,
			categoryId: catId,
			price,
			stock
		})
		.returning({ id: products.id })
		.get().id;
}

type Status = 'menunggu_pembayaran' | 'diproses' | 'dikirim' | 'selesai' | 'dibatalkan';
function order(userId: number, status: Status, lines: { productId: number; qty: number }[]) {
	const o = db
		.insert(orders)
		.values({
			code: `DWN-T-${seq++}`,
			userId,
			status,
			subtotal: 1000,
			total: 1000,
			recipientName: 'x',
			recipientPhone: '0812',
			shippingAddress: 'alamat'
		})
		.returning({ id: orders.id, code: orders.code })
		.get();
	for (const l of lines) {
		db.insert(orderItems)
			.values({
				orderId: o.id,
				itemType: 'product',
				productId: l.productId,
				itemName: 'x',
				unitPrice: 1000,
				quantity: l.qty,
				subtotal: 1000 * l.qty
			})
			.run();
	}
	return o;
}

function addReviews(productId: number, userId: number, orderId: number, ratings: number[]) {
	// uq_review_order_product: satu ulasan per (pesanan, produk) → tiap ulasan butuh pesanan sendiri
	for (const rating of ratings) {
		const o = order(userId, 'selesai', [{ productId, qty: 1 }]);
		db.insert(reviews).values({ productId, userId, orderId: o.id, rating }).run();
	}
	return orderId;
}

beforeEach(() => {
	for (const t of [
		reviews,
		orderItemComponents,
		orderItems,
		orders,
		bundleItems,
		bundles,
		activityLogs,
		products,
		categories,
		users
	]) {
		db.delete(t).run();
	}
	[{ u1 }, { u2 }] = [
		db
			.insert(users)
			.values({ name: 'Budi Santoso', email: 'b@x.id', passwordHash: 'x', role: 'konsumen' })
			.returning({ u1: users.id })
			.get(),
		db
			.insert(users)
			.values({ name: 'Sari', email: 's@x.id', passwordHash: 'x', role: 'konsumen' })
			.returning({ u2: users.id })
			.get()
	];
	const c1 = db
		.insert(categories)
		.values({ name: 'Kaos', slug: 'kaos' })
		.returning({ id: categories.id })
		.get().id;
	const c2 = db
		.insert(categories)
		.values({ name: 'Hoodie', slug: 'hoodie' })
		.returning({ id: categories.id })
		.get().id;
	kaos = c1;
	hoodie = c2;
});

describe('menulis ulasan', () => {
	it('hanya pemilik pesanan berstatus selesai, untuk produk di pesanan itu, sekali per pesanan+produk', async () => {
		const p = product('Tee A', kaos, 100_000);
		const other = product('Tee B', kaos, 100_000);
		const done = order(u1, 'selesai', [{ productId: p, qty: 1 }]);
		const sent = order(u1, 'dikirim', [{ productId: p, qty: 1 }]);

		await expect(
			createReview({ userId: u1, orderCode: sent.code, productId: p, rating: 5 })
		).rejects.toThrow(/selesai/);
		await expect(
			createReview({ userId: u2, orderCode: done.code, productId: p, rating: 5 })
		).rejects.toThrow(ReviewError); // pesanan orang lain = tidak ditemukan
		await expect(
			createReview({ userId: u1, orderCode: done.code, productId: other, rating: 5 })
		).rejects.toThrow(/tidak ada di pesanan/);
		await expect(
			createReview({ userId: u1, orderCode: done.code, productId: p, rating: 6 })
		).rejects.toThrow(/1 sampai 5/);

		await createReview({
			userId: u1,
			orderCode: done.code,
			productId: p,
			rating: 4,
			comment: ' bagus '
		});
		expect(db.select().from(reviews).get()).toMatchObject({ rating: 4, comment: 'bagus' });
		await expect(
			createReview({ userId: u1, orderCode: done.code, productId: p, rating: 5 })
		).rejects.toThrow(/sudah mengulas/);
		expect(
			db
				.select()
				.from(activityLogs)
				.all()
				.map((a) => a.action)
		).toContain('review.create');
	});

	it('komponen paket bundling juga bisa diulas', async () => {
		const p = product('Tee C', kaos, 100_000);
		const o = order(u1, 'selesai', []);
		const oi = db
			.insert(orderItems)
			.values({
				orderId: o.id,
				itemType: 'bundle',
				itemName: 'Paket',
				unitPrice: 1,
				quantity: 1,
				subtotal: 1
			})
			.returning({ id: orderItems.id })
			.get();
		db.insert(orderItemComponents).values({ orderItemId: oi.id, productId: p, quantity: 1 }).run();

		const list = getOrderReviewables(db, o.id);
		expect(list.map((x) => [x.productId, x.review])).toEqual([[p, null]]);
		await createReview({ userId: u1, orderCode: o.code, productId: p, rating: 5 });
		expect(getOrderReviewables(db, o.id)[0].review?.rating).toBe(5);
	});
});

describe('ringkasan & daftar ulasan', () => {
	it('rata-rata, sebaran bintang, ulasan tersembunyi tidak dihitung, nama disamarkan', () => {
		const p = product('Tee D', kaos, 100_000);
		addReviews(p, u1, 0, [5, 5, 4, 3]);
		addReviews(p, u2, 0, [1]);
		const s = getReviewSummary(db, p);
		expect(s).toMatchObject({ count: 5, avg: 3.6, dist: [1, 0, 1, 1, 2] });

		const hiddenId = db.select().from(reviews).where(eq(reviews.rating, 1)).get()!.id;
		db.update(reviews).set({ isVisible: false }).where(eq(reviews.id, hiddenId)).run();
		expect(getReviewSummary(db, p)).toMatchObject({ count: 4, avg: 4.3 });
		expect(listReviews(db, p, 10)).toHaveLength(4);
		expect(listReviews(db, p, 10)[0].name).toBe('Budi S.');
		expect(maskName('Sari')).toBe('Sari');
		expect(maskName('  ')).toBe('Pembeli');
	});
});

describe('rekomendasi', () => {
	it('terlaris: hanya pesanan terbayar, termasuk komponen bundling; habis/nonaktif tidak muncul', () => {
		const a = product('Tee A', kaos, 100_000);
		const b = product('Tee B', kaos, 100_000);
		const c = product('Tee C', kaos, 100_000);
		const soldOut = product('Tee Habis', kaos, 100_000, 0);
		order(u1, 'selesai', [
			{ productId: a, qty: 5 },
			{ productId: soldOut, qty: 50 }
		]);
		order(u1, 'dikirim', [{ productId: b, qty: 3 }]);
		order(u1, 'menunggu_pembayaran', [{ productId: c, qty: 99 }]); // belum dibayar: tidak dihitung
		order(u2, 'dibatalkan', [{ productId: c, qty: 99 }]); // dibatalkan: tidak dihitung
		const o = order(u2, 'selesai', []);
		const oi = db
			.insert(orderItems)
			.values({
				orderId: o.id,
				itemType: 'bundle',
				itemName: 'P',
				unitPrice: 1,
				quantity: 1,
				subtotal: 1
			})
			.returning({ id: orderItems.id })
			.get();
		db.insert(orderItemComponents).values({ orderItemId: oi.id, productId: b, quantity: 4 }).run();

		expect(getBestSellers({ limit: 5 }).map((p) => [p.id, p.sold])).toEqual([
			[b, 7], // 3 langsung + 4 komponen paket
			[a, 5]
		]);
		expect(getBestSellers({ excludeIds: [b] }).map((p) => p.id)).toEqual([a]);
		expect(getProductStats([a, c]).get(c)).toEqual({ rating: null, reviewCount: 0, sold: 0 });
	});

	it('rating tertinggi: minimal 3 ulasan dan rata-rata berbobot (jumlah ulasan ikut menentukan)', () => {
		const few = product('Tee Sedikit', kaos, 100_000); // 3 × 5★
		const many = product('Tee Banyak', kaos, 100_000); // 30 × 4,9★
		const low = product('Tee Biasa', kaos, 100_000); // 10 × 3★
		const none = product('Tee Dua', kaos, 100_000); // 2 ulasan: belum cukup
		addReviews(few, u1, 0, [5, 5, 5]);
		addReviews(many, u1, 0, [...Array(27).fill(5), ...Array(3).fill(4)]);
		addReviews(low, u2, 0, Array(10).fill(3));
		addReviews(none, u2, 0, [5, 5]);

		const top = getTopRated({ limit: 5 });
		expect(top.map((p) => p.id)).toEqual([many, few, low]);
		expect(top[0]).toMatchObject({ rating: 4.9, reviewCount: 30 });
		expect(getTopRated({ minReviews: 10 }).map((p) => p.id)).toEqual([many, low]);
	});

	it('serupa: satu kategori dengan harga terdekat; kurang dilengkapi terlaris', () => {
		const me = product('Tee Utama', kaos, 100_000);
		const near = product('Tee Dekat', kaos, 105_000);
		const far = product('Tee Jauh', kaos, 300_000);
		const hood = product('Hoodie X', hoodie, 250_000);
		order(u1, 'selesai', [{ productId: hood, qty: 9 }]);

		expect(getSimilar(me, 2).map((p) => p.id)).toEqual([near, far]);
		// limit 3: dua kaos + 1 pelengkap dari kategori lain (terlaris)
		expect(getSimilar(me, 3).map((p) => p.id)).toEqual([near, far, hood]);
		expect(getSimilar(me, 3).every((p) => p.id !== me)).toBe(true);
	});

	it('untuk pengguna: kategori yang sering dibeli, tidak mengulang yang sudah dibeli; tanpa riwayat → terlaris', () => {
		const k1 = product('Kaos 1', kaos, 100_000);
		const k2 = product('Kaos 2', kaos, 100_000);
		const k3 = product('Kaos 3', kaos, 100_000);
		const h1 = product('Hoodie 1', hoodie, 250_000);
		order(u1, 'selesai', [{ productId: k1, qty: 1 }]);
		order(u2, 'selesai', [
			{ productId: h1, qty: 7 },
			{ productId: k3, qty: 3 }
		]);

		const forU1 = getForUser(u1, 3).map((p) => p.id);
		expect(forU1).not.toContain(k1); // sudah dibeli
		expect(forU1.slice(0, 2)).toEqual([k3, k2]); // satu kategori (kaos), terlaris dulu
		expect(forU1).toContain(h1); // dilengkapi terlaris
		const fresh = db
			.insert(users)
			.values({ name: 'Baru', email: 'n@x.id', passwordHash: 'x', role: 'konsumen' })
			.returning({ id: users.id })
			.get().id;
		expect(getForUser(fresh, 2).map((p) => p.id)).toEqual([h1, k3]);
	});
});
