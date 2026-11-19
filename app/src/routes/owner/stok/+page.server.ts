import { count, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bundles, products, stockMovements, users } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { getSettings } from '$lib/server/settings';
import { pageParam } from '$lib/server/sql';
import { getStockOverview } from '$lib/server/stock-overview';
import type { PageServerLoad } from './$types';

const PER_PAGE = 20;

// Owner HANYA membaca: file ini sengaja tidak punya `actions` (POST ke /owner/stok -> 405).
export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole(locals, 'owner');
	const q = url.searchParams.get('q')?.trim() ?? '';
	const lowOnly = url.searchParams.get('low') === 'true' || url.searchParams.get('menipis') === '1';
	const page = pageParam(url);

	const [cfg, overview, [{ total }], movements] = await Promise.all([
		getSettings(),
		getStockOverview({ q: q || undefined, lowOnly }),
		db.select({ total: count() }).from(stockMovements),
		db
			.select({
				id: stockMovements.id,
				productId: stockMovements.productId,
				bundleId: stockMovements.bundleId,
				type: stockMovements.type,
				size: stockMovements.size,
				quantityChange: stockMovements.quantityChange,
				stockAfter: stockMovements.stockAfter,
				note: stockMovements.note,
				createdAt: stockMovements.createdAt,
				actor: users.name,
				productName: products.name,
				bundleName: bundles.name
			})
			.from(stockMovements)
			.leftJoin(users, eq(users.id, stockMovements.createdBy))
			.leftJoin(products, eq(products.id, stockMovements.productId))
			.leftJoin(bundles, eq(bundles.id, stockMovements.bundleId))
			.orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
			.limit(PER_PAGE)
			.offset((page - 1) * PER_PAGE)
	]);

	return {
		...overview,
		threshold: cfg.lowStock,
		filters: { q, lowOnly },
		movements,
		page,
		perPage: PER_PAGE,
		totalMovements: total,
		totalPages: Math.max(1, Math.ceil(total / PER_PAGE))
	};
};
