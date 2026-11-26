/**
 * Kueri daftar halaman admin (produk & pesanan): filter, urutan, dan paginasi.
 * Controller hanya membaca parameter URL dan memanggil fungsi di sini.
 */
import { and, asc, count, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from './db';
import { categories, orders, products, users } from './db/schema';
import { contains } from './sql';
import { getSettings } from './settings';
import { getSizesFor } from './sizes';
import { wibEnd, wibStart } from './time';
import type { OrderStatus } from '#lib/constants';

export const ADMIN_PER_PAGE = 15;

/* ---------------------------------------------------------------- produk */

export type AdminProductFilters = {
	q: string;
	categoryId: number | null | undefined;
	lowOnly: boolean;
	/** halaman diminta (boleh melebihi halaman terakhir → dijepit) */
	page: number;
};

export async function listAdminProducts(f: AdminProductFilters) {
	const { lowStock } = await getSettings();

	const where = and(
		isNull(products.deletedAt),
		f.q ? contains(products.name, f.q) : undefined,
		f.categoryId ? eq(products.categoryId, f.categoryId) : undefined,
		f.lowOnly ? lte(products.stock, lowStock) : undefined
	);

	const [totalRow] = await db.select({ count: count() }).from(products).where(where);
	const totalItems = totalRow?.count ?? 0;
	const totalPages = Math.ceil(totalItems / ADMIN_PER_PAGE);
	const page = Math.min(f.page, Math.max(1, totalPages)); // ?page=999 → halaman terakhir

	const rows = await db
		.select({
			id: products.id,
			name: products.name,
			slug: products.slug,
			price: products.price,
			stock: products.stock,
			imageUrl: products.imageUrl,
			isBundleable: products.isBundleable,
			isActive: products.isActive,
			categoryName: categories.name
		})
		.from(products)
		.leftJoin(categories, eq(categories.id, products.categoryId))
		.where(where)
		.orderBy(asc(products.stock), desc(products.id))
		.limit(ADMIN_PER_PAGE)
		.offset((page - 1) * ADMIN_PER_PAGE);

	const allCategories = await db
		.select({ id: categories.id, name: categories.name })
		.from(categories)
		.orderBy(categories.name);

	// Ringkasan stok per ukuran (produk tanpa ukuran → daftar kosong)
	const sizesOf = getSizesFor(
		db,
		rows.map((r) => r.id)
	);
	const [anyRow] = await db.select({ n: count() }).from(products).where(isNull(products.deletedAt));

	return {
		products: rows.map((r) => ({ ...r, sizes: sizesOf.get(r.id) ?? [] })),
		totalAll: anyRow?.n ?? 0,
		categories: allCategories,
		lowStock,
		pagination: { page, perPage: ADMIN_PER_PAGE, totalItems, totalPages }
	};
}

/* ---------------------------------------------------------------- pesanan */

/** Status pembayaran "efektif" = baris payments terbaru (NULL = belum ada unggahan → belum_bayar) */
const latestPay = sql<
	string | null
>`(select p.status from payments p where p.order_id = ${orders.id} order by p.id desc limit 1)`;
const latestProof = sql<
	string | null
>`(select p.proof_url from payments p where p.order_id = ${orders.id} order by p.id desc limit 1)`;

export type AdminOrderFilters = {
	page: number;
	q: string;
	status: OrderStatus | undefined;
	/** rentang tanggal WIB (YYYY-MM-DD); '' = tanpa batas */
	dari: string;
	sampai: string;
};

export async function listAdminOrders(f: AdminOrderFilters) {
	const where = and(
		f.status ? eq(orders.status, f.status) : undefined,
		f.dari ? gte(orders.createdAt, wibStart(f.dari).toISOString()) : undefined,
		f.sampai ? lte(orders.createdAt, wibEnd(f.sampai).toISOString()) : undefined,
		f.q
			? or(
					contains(orders.code, f.q),
					contains(users.name, f.q),
					contains(orders.recipientName, f.q)
				)
			: undefined
	);

	const [totalRow] = await db
		.select({ count: count() })
		.from(orders)
		.innerJoin(users, eq(users.id, orders.userId))
		.where(where);
	const totalItems = totalRow?.count ?? 0;
	const totalPages = Math.max(1, Math.ceil(totalItems / ADMIN_PER_PAGE));

	const rows = await db
		.select({
			id: orders.id,
			code: orders.code,
			createdAt: orders.createdAt,
			customerName: users.name,
			recipientName: orders.recipientName,
			total: orders.total,
			status: orders.status,
			payStatus: latestPay,
			proofUrl: latestProof
		})
		.from(orders)
		.innerJoin(users, eq(users.id, orders.userId))
		.where(where)
		// Prioritaskan status menunggu_konfirmasi di paling atas
		.orderBy(
			sql`CASE WHEN ${orders.status} = 'menunggu_konfirmasi' THEN 0 ELSE 1 END`,
			desc(orders.createdAt),
			desc(orders.id)
		)
		.limit(ADMIN_PER_PAGE)
		.offset((f.page - 1) * ADMIN_PER_PAGE);

	return {
		orders: rows.map(({ payStatus, proofUrl, ...o }) => ({
			...o,
			paymentStatus: payStatus ?? 'belum_bayar',
			hasProof: !!proofUrl
		})),
		pagination: { page: f.page, perPage: ADMIN_PER_PAGE, totalItems, totalPages }
	};
}
