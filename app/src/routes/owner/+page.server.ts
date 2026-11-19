import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { orders, productSizes, products, users } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { getSettings } from '#lib/server/settings';
import { parseRange } from '#lib/server/time';
import {
	bundleVsSingle,
	dailyRevenue,
	fillDays,
	itemsSold,
	salesSummary,
	topItems
} from '#lib/server/reports';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole(locals, 'owner');
	const r = parseRange(url);
	const cfg = await getSettings();

	const [summary, units, daily, top, split, [waiting], [stock], [sizeOut], recent] =
		await Promise.all([
			salesSummary(r.from, r.to),
			itemsSold(r.from, r.to),
			dailyRevenue(r.from, r.to),
			topItems(r.from, r.to, 5),
			bundleVsSingle(r.from, r.to),
			db
				.select({ n: count() })
				.from(orders)
				.where(inArray(orders.status, ['menunggu_pembayaran', 'menunggu_konfirmasi'])),
			db
				.select({
					habis: sql<number>`COALESCE(SUM(CASE WHEN ${products.stock} = 0 THEN 1 ELSE 0 END), 0)`,
					menipis: sql<number>`COALESCE(SUM(CASE WHEN ${products.stock} BETWEEN 1 AND ${cfg.lowStock} THEN 1 ELSE 0 END), 0)`
				})
				.from(products)
				.where(isNull(products.deletedAt)),
			// Ukuran yang habis pada produk yang total stoknya masih ada (info tambahan; kartu stok tetap berbasis total)
			db
				.select({ n: count() })
				.from(productSizes)
				.innerJoin(products, eq(products.id, productSizes.productId))
				.where(and(isNull(products.deletedAt), eq(productSizes.stock, 0), gt(products.stock, 0))),
			db
				.select({
					code: orders.code,
					createdAt: orders.createdAt,
					status: orders.status,
					total: orders.total,
					customer: users.name
				})
				.from(orders)
				.innerJoin(users, eq(users.id, orders.userId))
				.orderBy(desc(orders.createdAt), desc(orders.id))
				.limit(5)
		]);

	return {
		range: { dari: r.dari, sampai: r.sampai, error: r.error ?? null },
		summary,
		units,
		top,
		split,
		recent,
		daily: fillDays(daily, r.dari, r.sampai),
		waiting: Number(waiting?.n ?? 0),
		stock: {
			habis: Number(stock?.habis ?? 0),
			menipis: Number(stock?.menipis ?? 0),
			threshold: cfg.lowStock,
			ukuranHabis: Number(sizeOut?.n ?? 0)
		}
	};
};
