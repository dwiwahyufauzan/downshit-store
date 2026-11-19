import { and, desc, eq, sql } from 'drizzle-orm';
import { db, transact, type Tx } from './db';
import { orderItemComponents, orderItems, orders, products, reviews, users } from './db/schema';
import { logActivity } from './activity';

type Exec = typeof db | Tx;

/** Pelanggaran aturan ulasan (bukan galat sistem): pesan aman ditampilkan ke pengguna. */
export class ReviewError extends Error {}

export const REVIEW_MAX_COMMENT = 500;

export type ReviewableProduct = {
	productId: number;
	name: string;
	slug: string;
	imageUrl: string | null;
	review: { rating: number; comment: string | null; createdAt: string } | null;
};

/** Produk dalam satu pesanan (produk langsung + komponen bundling), unik per produk. */
export function orderProducts(ex: Exec, orderId: number) {
	const direct = ex
		.select({
			productId: products.id,
			name: products.name,
			slug: products.slug,
			imageUrl: products.imageUrl
		})
		.from(orderItems)
		.innerJoin(products, eq(products.id, orderItems.productId))
		.where(and(eq(orderItems.orderId, orderId), eq(orderItems.itemType, 'product')))
		.all();
	const comps = ex
		.select({
			productId: products.id,
			name: products.name,
			slug: products.slug,
			imageUrl: products.imageUrl
		})
		.from(orderItemComponents)
		.innerJoin(orderItems, eq(orderItems.id, orderItemComponents.orderItemId))
		.innerJoin(products, eq(products.id, orderItemComponents.productId))
		.where(eq(orderItems.orderId, orderId))
		.all();
	const seen = new Map<number, (typeof direct)[number]>();
	for (const p of [...direct, ...comps]) if (!seen.has(p.productId)) seen.set(p.productId, p);
	return [...seen.values()];
}

/** Produk pada pesanan + ulasan yang sudah ditulis pembeli (null = belum). */
export function getOrderReviewables(ex: Exec, orderId: number): ReviewableProduct[] {
	const mine = new Map(
		ex
			.select({
				productId: reviews.productId,
				rating: reviews.rating,
				comment: reviews.comment,
				createdAt: reviews.createdAt
			})
			.from(reviews)
			.where(eq(reviews.orderId, orderId))
			.all()
			.map((r) => [r.productId, r])
	);
	return orderProducts(ex, orderId).map((p) => {
		const r = mine.get(p.productId);
		return {
			...p,
			review: r ? { rating: r.rating, comment: r.comment, createdAt: r.createdAt } : null
		};
	});
}

/**
 * Tulis ulasan. Aturan: pesanan milik pengguna, berstatus `selesai`, produk memang ada di pesanan itu,
 * dan belum pernah diulas untuk pesanan yang sama (indeks unik uq_review_order_product jadi pengaman akhir).
 */
export async function createReview(input: {
	userId: number;
	orderCode: string;
	productId: number;
	rating: number;
	comment?: string | null;
}) {
	const { userId, orderCode, productId, rating } = input;
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		throw new ReviewError('Rating harus 1 sampai 5 bintang.');
	}
	const comment = (input.comment ?? '').trim();
	if (comment.length > REVIEW_MAX_COMMENT) {
		throw new ReviewError(`Ulasan maksimal ${REVIEW_MAX_COMMENT} karakter.`);
	}

	return transact((tx) => {
		const order = tx.select().from(orders).where(eq(orders.code, orderCode)).get();
		if (!order || order.userId !== userId) throw new ReviewError('Pesanan tidak ditemukan.');
		if (order.status !== 'selesai') {
			throw new ReviewError('Ulasan hanya bisa ditulis setelah pesanan selesai.');
		}
		const prod = orderProducts(tx, order.id).find((p) => p.productId === productId);
		if (!prod) throw new ReviewError('Produk ini tidak ada di pesanan tersebut.');

		const exists = tx
			.select({ id: reviews.id })
			.from(reviews)
			.where(and(eq(reviews.orderId, order.id), eq(reviews.productId, productId)))
			.get();
		if (exists) throw new ReviewError('Kamu sudah mengulas produk ini untuk pesanan ini.');

		const row = tx
			.insert(reviews)
			.values({ productId, userId, orderId: order.id, rating, comment: comment || null })
			.returning({ id: reviews.id })
			.get();
		logActivity(
			userId,
			'review.create',
			'product',
			productId,
			`Ulasan ${rating} bintang untuk ${prod.name} (pesanan ${order.code})`,
			tx
		);
		return { id: row.id, productName: prod.name };
	});
}

export type ReviewSummary = {
	count: number;
	avg: number | null;
	/** jumlah ulasan per bintang, indeks 0 = 1 bintang … indeks 4 = 5 bintang */
	dist: [number, number, number, number, number];
};

/** Ringkasan rating produk (hanya ulasan yang tampil). */
export function getReviewSummary(ex: Exec, productId: number): ReviewSummary {
	const rows = ex
		.select({ rating: reviews.rating, n: sql<number>`COUNT(*)` })
		.from(reviews)
		.where(and(eq(reviews.productId, productId), eq(reviews.isVisible, true)))
		.groupBy(reviews.rating)
		.all();
	const dist: ReviewSummary['dist'] = [0, 0, 0, 0, 0];
	let sum = 0;
	let count = 0;
	for (const r of rows) {
		if (r.rating >= 1 && r.rating <= 5) {
			dist[r.rating - 1] = r.n;
			sum += r.rating * r.n;
			count += r.n;
		}
	}
	return { count, avg: count > 0 ? Math.round((sum / count) * 10) / 10 : null, dist };
}

/** "Budi Santoso" → "Budi S." (nama tidak ditampilkan penuh demi privasi). */
export function maskName(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return 'Pembeli';
	if (parts.length === 1) return parts[0];
	return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function listReviews(ex: Exec, productId: number, limit: number, offset = 0) {
	return ex
		.select({
			id: reviews.id,
			rating: reviews.rating,
			comment: reviews.comment,
			createdAt: reviews.createdAt,
			name: users.name
		})
		.from(reviews)
		.innerJoin(users, eq(users.id, reviews.userId))
		.where(and(eq(reviews.productId, productId), eq(reviews.isVisible, true)))
		.orderBy(desc(reviews.createdAt), desc(reviews.id))
		.limit(limit)
		.offset(offset)
		.all()
		.map((r) => ({ ...r, name: maskName(r.name) }));
}
