import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from './db';
import { bundles, orderItemComponents, orderItems, orders, products, users } from './db/schema';
import { PAID_STATUSES } from '#lib/constants';

export const STATUS_FILTERS = ['semua', ...PAID_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Whitelist: nilai di luar daftar -> 'semua' */
export const parseStatus = (v: string | null): StatusFilter =>
	(STATUS_FILTERS as readonly string[]).includes(v ?? '') ? (v as StatusFilter) : 'semua';

/**
 * Pesanan yang dananya sudah dikembalikan PENUH (ada pembayaran `dikembalikan`, tak ada yang `dikonfirmasi`)
 * bukan penjualan lagi, walau status pesanannya belum diubah admin.
 */
const notFullyRefunded = sql`NOT (
	EXISTS (SELECT 1 FROM payments p WHERE p.order_id = ${orders.id} AND p.status = 'dikembalikan')
	AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = ${orders.id} AND p.status = 'dikonfirmasi')
)`;

const cond = (from: Date, to: Date, status: StatusFilter = 'semua') => {
	const fromIso = from.toISOString();
	const toIso = to.toISOString();
	return and(
		notFullyRefunded,
		status === 'semua' ? inArray(orders.status, [...PAID_STATUSES]) : eq(orders.status, status),
		gte(orders.createdAt, fromIso),
		lte(orders.createdAt, toIso)
	);
};

const n = (v: unknown) => Number(v ?? 0);

/** Ringkasan periode: revenue = Σ (subtotal − diskon voucher), tanpa ongkir; gross = Σ total (omzet) */
export async function salesSummary(from: Date, to: Date, status: StatusFilter = 'semua') {
	const [r] = await db
		.select({
			revenue: sql<number>`COALESCE(SUM(${orders.subtotal} - ${orders.discount}), 0)`,
			shipping: sql<number>`COALESCE(SUM(${orders.shippingCost}), 0)`,
			gross: sql<number>`COALESCE(SUM(${orders.total}), 0)`,
			orders: sql<number>`COUNT(*)`
		})
		.from(orders)
		.where(cond(from, to, status));

	const revenue = n(r?.revenue);
	const count_ = n(r?.orders);

	return {
		revenue,
		shipping: n(r?.shipping),
		gross: n(r?.gross),
		orders: count_,
		avg: count_ ? Math.round(revenue / count_) : 0
	};
}

/** Total unit item terjual (paket bundling dihitung 1 unit) */
export async function itemsSold(from: Date, to: Date, status: StatusFilter = 'semua') {
	const [r] = await db
		.select({ q: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)` })
		.from(orderItems)
		.innerJoin(orders, eq(orders.id, orderItems.orderId))
		.where(cond(from, to, status));
	return n(r?.q);
}

/** Pendapatan penjualan per hari (hanya hari yang punya transaksi) */
export async function dailyRevenue(from: Date, to: Date, status: StatusFilter = 'semua') {
	const day = sql<string>`date(${orders.createdAt}, '+7 hours')`;
	const rows = await db
		.select({
			day,
			revenue: sql<number>`SUM(${orders.subtotal} - ${orders.discount})`,
			orders: sql<number>`COUNT(*)`
		})
		.from(orders)
		.where(cond(from, to, status))
		.groupBy(day)
		.orderBy(day);

	return rows.map((r) => ({ day: r.day, revenue: n(r.revenue), orders: n(r.orders) }));
}

/** Isi hari tanpa transaksi dengan 0 agar grafik tidak melompat */
export function fillDays(
	rows: { day: string; revenue: number; orders: number }[],
	dari: string,
	sampai: string
) {
	const byDay = new Map(rows.map((r) => [r.day, r]));
	const out: { day: string; revenue: number; orders: number }[] = [];
	for (
		let t = Date.parse(`${dari}T00:00:00Z`);
		t <= Date.parse(`${sampai}T00:00:00Z`);
		t += 86_400_000
	) {
		const day = new Date(t).toISOString().slice(0, 10);
		out.push(byDay.get(day) ?? { day, revenue: 0, orders: 0 });
	}
	return out;
}

/** Produk/paket terlaris. Dikelompokkan per (item_type, product_id, bundle_id) */
export async function topItems(from: Date, to: Date, limit = 10, status: StatusFilter = 'semua') {
	const qty = sql<number>`SUM(${orderItems.quantity})`;
	const revenue = sql<number>`SUM(${orderItems.subtotal})`;

	const rows = await db
		.select({
			type: orderItems.itemType,
			productId: orderItems.productId,
			bundleId: orderItems.bundleId,
			name: sql<string>`COALESCE(MAX(${products.name}), MAX(${bundles.name}), MAX(${orderItems.itemName}))`,
			qty,
			revenue
		})
		.from(orderItems)
		.innerJoin(orders, eq(orders.id, orderItems.orderId))
		.leftJoin(products, eq(products.id, orderItems.productId))
		.leftJoin(bundles, eq(bundles.id, orderItems.bundleId))
		.where(cond(from, to, status))
		.groupBy(orderItems.itemType, orderItems.productId, orderItems.bundleId)
		.orderBy(desc(qty), desc(revenue))
		.limit(limit);

	return rows.map((r) => ({ ...r, qty: n(r.qty), revenue: n(r.revenue) }));
}

/** Bundling vs satuan: unit & pendapatan per jenis + persentase share */
export async function bundleVsSingle(from: Date, to: Date, status: StatusFilter = 'semua') {
	const rows = await db
		.select({
			type: orderItems.itemType,
			qty: sql<number>`SUM(${orderItems.quantity})`,
			revenue: sql<number>`SUM(${orderItems.subtotal})`
		})
		.from(orderItems)
		.innerJoin(orders, eq(orders.id, orderItems.orderId))
		.where(cond(from, to, status))
		.groupBy(orderItems.itemType);

	const total = rows.reduce((s, r) => s + n(r.revenue), 0);
	return rows.map((r) => ({
		type: r.type,
		qty: n(r.qty),
		revenue: n(r.revenue),
		share: total ? Math.round((n(r.revenue) / total) * 1000) / 10 : 0
	}));
}

/** Unit produk fisik yang keluar LEWAT paket bundling */
export async function bundleComponentUnits(from: Date, to: Date, status: StatusFilter = 'semua') {
	const units = sql<number>`SUM(${orderItemComponents.quantity})`;
	const rows = await db
		.select({
			productId: orderItemComponents.productId,
			name: sql<string>`MAX(${products.name})`,
			units
		})
		.from(orderItemComponents)
		.innerJoin(orderItems, eq(orderItems.id, orderItemComponents.orderItemId))
		.innerJoin(orders, eq(orders.id, orderItems.orderId))
		.innerJoin(products, eq(products.id, orderItemComponents.productId))
		.where(cond(from, to, status))
		.groupBy(orderItemComponents.productId)
		.orderBy(desc(units));

	const list = rows.map((r) => ({ ...r, units: n(r.units) }));
	return { rows: list, total: list.reduce((s, r) => s + r.units, 0) };
}

/** Daftar transaksi penjualan untuk halaman dan ekspor CSV */
export async function salesList(
	from: Date,
	to: Date,
	status: StatusFilter = 'semua',
	opts?: { page: number; perPage: number }
) {
	const q = db
		.select({
			code: orders.code,
			createdAt: orders.createdAt,
			customer: users.name,
			status: orders.status,
			subtotal: orders.subtotal,
			discount: orders.discount,
			shipping: orders.shippingCost,
			total: orders.total
		})
		.from(orders)
		.innerJoin(users, eq(users.id, orders.userId))
		.where(cond(from, to, status))
		.orderBy(desc(orders.createdAt), desc(orders.id))
		.$dynamic();

	const [rows, [{ total }]] = await Promise.all([
		opts ? q.limit(opts.perPage).offset((opts.page - 1) * opts.perPage) : q,
		db
			.select({ total: count() })
			.from(orders)
			.where(cond(from, to, status))
	]);

	return { rows, total };
}
