import { and, asc, count, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { orders, products, users } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { getSettings } from '#lib/server/settings';
import { getSizesFor } from '#lib/server/sizes';
import { runLightMaintenance } from '#lib/server/order-flow';
import { todayWib, wibStart } from '#lib/server/time';

export const load = async ({ locals }) => {
	requireRole(locals, 'admin');
	void runLightMaintenance();

	const { lowStock } = await getSettings();

	const [toConfirmRow] = await db
		.select({ n: count() })
		.from(orders)
		.where(eq(orders.status, 'menunggu_konfirmasi'));

	const [toShipRow] = await db
		.select({ n: count() })
		.from(orders)
		.where(eq(orders.status, 'diproses'));

	const todayStart = wibStart(todayWib()).toISOString();
	const [todayOrdersRow] = await db
		.select({ n: count() })
		.from(orders)
		.where(gte(orders.createdAt, todayStart));

	const [emptyRow] = await db
		.select({ n: count() })
		.from(products)
		.where(and(isNull(products.deletedAt), eq(products.stock, 0)));

	const [lowRow] = await db
		.select({ n: count() })
		.from(products)
		.where(and(isNull(products.deletedAt), gte(products.stock, 1), lte(products.stock, lowStock)));

	const recent = await db
		.select({
			id: orders.id,
			code: orders.code,
			status: orders.status,
			total: orders.total,
			createdAt: orders.createdAt,
			customer: users.name
		})
		.from(orders)
		.innerJoin(users, eq(users.id, orders.userId))
		.orderBy(desc(orders.id))
		.limit(5);

	const lowest = await db
		.select({
			id: products.id,
			name: products.name,
			stock: products.stock,
			price: products.price
		})
		.from(products)
		.where(isNull(products.deletedAt))
		.orderBy(asc(products.stock))
		.limit(5);

	// Ringkasan per ukuran: ukuran yang habis / menipis pada produk-produk ini (produk tanpa ukuran → kosong)
	const sizesOf = getSizesFor(
		db,
		lowest.map((p) => p.id)
	);
	const lowestWithSizes = lowest.map((p) => {
		const sizes = sizesOf.get(p.id) ?? [];
		return {
			...p,
			soldOutSizes: sizes.filter((s) => s.stock <= 0).map((s) => s.label),
			lowSizes: sizes
				.filter((s) => s.stock > 0 && s.stock <= lowStock)
				.map((s) => ({ label: s.label, stock: s.stock }))
		};
	});

	return {
		metrics: {
			toConfirm: toConfirmRow?.n ?? 0,
			toShip: toShipRow?.n ?? 0,
			today: todayOrdersRow?.n ?? 0,
			empty: emptyRow?.n ?? 0,
			low: lowRow?.n ?? 0
		},
		recent,
		lowest: lowestWithSizes,
		lowStock
	};
};
