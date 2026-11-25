import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db } from './db';

/** Produk siap tampil di kartu: rating rata-rata (null = belum ada ulasan) dan jumlah terjual. */
export type RecProduct = {
	id: number;
	name: string;
	slug: string;
	price: number;
	stock: number;
	imageUrl: string | null;
	categoryName: string | null;
	categoryId: number | null;
	rating: number | null;
	reviewCount: number;
	sold: number;
};

export type ProductStat = { rating: number | null; reviewCount: number; sold: number };

/** Hanya pesanan yang sudah dibayar yang dihitung sebagai terjual (bukan menunggu bayar / dibatalkan). */
const PAID = sql`('diproses','dikirim','selesai')`;

/** Baris (produk, jumlah) dari pesanan terbayar: produk langsung + komponen paket bundling. */
const SOLD_ROWS = sql`
	SELECT oi.product_id AS pid, oi.quantity AS q
	FROM order_items oi JOIN orders o ON o.id = oi.order_id
	WHERE oi.item_type = 'product' AND oi.product_id IS NOT NULL AND o.status IN ${PAID}
	UNION ALL
	SELECT c.product_id AS pid, c.quantity AS q
	FROM order_item_components c
	JOIN order_items oi ON oi.id = c.order_item_id
	JOIN orders o ON o.id = oi.order_id
	WHERE o.status IN ${PAID}`;

/** Satuan terjual per produk. */
const SOLD = sql`(SELECT pid, SUM(q) AS sold FROM (${SOLD_ROWS}) GROUP BY pid)`;

/** Ekspresi terkorelasi untuk ORDER BY katalog: jumlah terjual produk `idCol`. */
export const soldOf = (idCol: SQLWrapper): SQL =>
	sql`(SELECT COALESCE(SUM(q), 0) FROM (${SOLD_ROWS}) WHERE pid = ${idCol})`;

/** Ekspresi terkorelasi: skor rating berbobot (Bayesian) produk `idCol`; 0 bila belum ada ulasan. */
export const ratingScoreOf = (idCol: SQLWrapper): SQL =>
	sql`COALESCE((SELECT (COUNT(*) * AVG(rating) + 5 * 4.0) / (COUNT(*) + 5)
		FROM reviews WHERE is_visible = 1 AND product_id = ${idCol}), 0)`;

const RATING = sql`(
	SELECT product_id AS pid, AVG(rating) AS avg, COUNT(*) AS n
	FROM reviews WHERE is_visible = 1 GROUP BY product_id
)`;

type Row = {
	id: number;
	name: string;
	slug: string;
	price: number;
	stock: number;
	image_url: string | null;
	category_name: string | null;
	category_id: number | null;
	sold: number;
	avg: number | null;
	n: number;
};

const SELECT = sql`
	SELECT p.id, p.name, p.slug, p.price, p.stock, p.image_url, c.name AS category_name,
	       p.category_id, COALESCE(s.sold, 0) AS sold, r.avg AS avg, COALESCE(r.n, 0) AS n
	FROM products p
	LEFT JOIN categories c ON c.id = p.category_id
	LEFT JOIN ${SOLD} s ON s.pid = p.id
	LEFT JOIN ${RATING} r ON r.pid = p.id
	WHERE p.is_active = 1 AND p.deleted_at IS NULL AND p.stock > 0`;

const toRec = (r: Row): RecProduct => ({
	id: r.id,
	name: r.name,
	slug: r.slug,
	price: r.price,
	stock: r.stock,
	imageUrl: r.image_url,
	categoryName: r.category_name,
	categoryId: r.category_id,
	rating: r.avg === null ? null : Math.round(r.avg * 10) / 10,
	reviewCount: r.n,
	sold: r.sold
});

const idList = (ids: number[]): SQL =>
	sql.join(
		ids.map((i) => sql`${i}`),
		sql`, `
	);
const notIn = (ids: number[]): SQL => (ids.length ? sql` AND p.id NOT IN (${idList(ids)})` : sql``);

/** Rating & terjual untuk sekumpulan produk (peta id → statistik). Produk tanpa data = rating null, sold 0. */
export function getProductStats(ids: number[]): Map<number, ProductStat> {
	const out = new Map<number, ProductStat>();
	if (ids.length === 0) return out;
	const uniq = [...new Set(ids)];
	const rows = db.all<{
		id: number;
		sold: number | null;
		avg: number | null;
		n: number | null;
	}>(sql`
		SELECT p.id AS id, s.sold AS sold, r.avg AS avg, r.n AS n
		FROM products p
		LEFT JOIN ${SOLD} s ON s.pid = p.id
		LEFT JOIN ${RATING} r ON r.pid = p.id
		WHERE p.id IN (${idList(uniq)})`);
	for (const r of rows) {
		out.set(r.id, {
			rating: r.avg === null ? null : Math.round(r.avg * 10) / 10,
			reviewCount: r.n ?? 0,
			sold: r.sold ?? 0
		});
	}
	return out;
}

/** Produk terlaris (jumlah terjual terbanyak), hanya yang aktif dan masih ada stok. */
export function getBestSellers(opts: { limit?: number; excludeIds?: number[] } = {}): RecProduct[] {
	const { limit = 4, excludeIds = [] } = opts;
	return db
		.all<Row>(
			sql`${SELECT}${notIn(excludeIds)} AND COALESCE(s.sold, 0) > 0
			ORDER BY sold DESC, n DESC, p.id DESC LIMIT ${limit}`
		)
		.map(toRec);
}

/**
 * Rating tertinggi. Memakai rata-rata berbobot (Bayesian) agar produk dengan 3 ulasan 5★ tidak otomatis
 * mengalahkan produk dengan 40 ulasan 4,9★; hanya produk dengan ≥ `minReviews` ulasan yang ikut.
 */
export function getTopRated(
	opts: { limit?: number; excludeIds?: number[]; minReviews?: number } = {}
): RecProduct[] {
	const { limit = 4, excludeIds = [], minReviews = 3 } = opts;
	return db
		.all<Row>(
			sql`${SELECT}${notIn(excludeIds)} AND COALESCE(r.n, 0) >= ${minReviews}
			-- prior sama dengan ratingScoreOf (4.0) agar rak "Rating tertinggi" & ?urut=rating tak berbeda urutan
			ORDER BY (r.n * r.avg + 5 * 4.0) / (r.n + 5) DESC,
			         r.n DESC, p.id DESC
			LIMIT ${limit}`
		)
		.map(toRec);
}

/** Produk serupa: satu kategori, harga terdekat, lalu terlaris; kurang dari `limit` → dilengkapi terlaris. */
export function getSimilar(productId: number, limit = 4): RecProduct[] {
	const me = db.get<{ category_id: number | null; price: number }>(
		sql`SELECT category_id, price FROM products WHERE id = ${productId}`
	);
	if (!me) return [];
	const same =
		me.category_id === null
			? []
			: db
					.all<Row>(
						sql`${SELECT}${notIn([productId])} AND p.category_id = ${me.category_id}
						ORDER BY ABS(p.price - ${me.price}) ASC, sold DESC, p.id DESC LIMIT ${limit}`
					)
					.map(toRec);
	if (same.length >= limit) return same;
	const fill = getBestSellers({
		limit: limit - same.length,
		excludeIds: [productId, ...same.map((p) => p.id)]
	});
	return [...same, ...fill];
}

/**
 * Rekomendasi pribadi: produk di kategori yang paling sering dibeli pengguna (belum pernah dibeli),
 * diurutkan menurut terlaris; kurang → dilengkapi produk terlaris.
 */
export function getForUser(userId: number, limit = 4): RecProduct[] {
	const bought = db.all<{ pid: number; category_id: number | null }>(sql`
		SELECT DISTINCT x.pid AS pid, p.category_id AS category_id FROM (
			SELECT oi.product_id AS pid FROM order_items oi JOIN orders o ON o.id = oi.order_id
			WHERE o.user_id = ${userId} AND o.status != 'dibatalkan' AND oi.product_id IS NOT NULL
			UNION
			SELECT c.product_id FROM order_item_components c
			JOIN order_items oi ON oi.id = c.order_item_id JOIN orders o ON o.id = oi.order_id
			WHERE o.user_id = ${userId} AND o.status != 'dibatalkan'
		) x JOIN products p ON p.id = x.pid`);
	const boughtIds = bought.map((b) => b.pid);
	const catCount = new Map<number, number>();
	for (const b of bought) {
		if (b.category_id !== null) catCount.set(b.category_id, (catCount.get(b.category_id) ?? 0) + 1);
	}
	const cats = [...catCount.keys()];
	const mine =
		cats.length === 0
			? []
			: db
					.all<Row>(
						sql`${SELECT}${notIn(boughtIds)} AND p.category_id IN (${idList(cats)})
						ORDER BY sold DESC, n DESC, p.id DESC LIMIT ${limit * 3}`
					)
					.map(toRec)
					// kategori yang paling sering dibeli tampil lebih dulu, urutan terlaris dipertahankan di dalamnya
					.sort(
						(a, b) =>
							(catCount.get(b.categoryId ?? 0) ?? 0) - (catCount.get(a.categoryId ?? 0) ?? 0)
					)
					.slice(0, limit);
	if (mine.length >= limit) return mine;
	return [
		...mine,
		...getBestSellers({
			limit: limit - mine.length,
			excludeIds: [...boughtIds, ...mine.map((p) => p.id)]
		})
	];
}
