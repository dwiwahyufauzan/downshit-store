import { redirect } from '@sveltejs/kit';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { requireRole } from '#lib/server/guards';
import { db } from '#lib/server/db';
import { orders } from '#lib/server/db/schema';
import { pageParam } from '#lib/server/sql';
import { getBestSellers, getForUser, getTopRated } from '#lib/server/recommendations';
import { ORDER_STATUS, type OrderStatus } from '#lib/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const user = requireRole(locals, 'konsumen');

	const page = pageParam(url);
	const perPage = 10;
	const statusParam = url.searchParams.get('status') ?? '';
	const status = (ORDER_STATUS as readonly string[]).includes(statusParam)
		? (statusParam as OrderStatus)
		: '';

	// kepemilikan: selalu WHERE user_id = pengguna login
	const where = and(eq(orders.userId, user.id), status ? eq(orders.status, status) : undefined);

	const [userOrders, [{ total }]] = await Promise.all([
		db
			.select({
				id: orders.id,
				code: orders.code,
				status: orders.status,
				total: orders.total,
				shippingCost: orders.shippingCost,
				createdAt: orders.createdAt,
				expiresAt: orders.expiresAt,
				itemCount: sql<number>`(select coalesce(sum(oi.quantity), 0) from order_items oi where oi.order_id = orders.id)`
			})
			.from(orders)
			.where(where)
			.orderBy(desc(orders.createdAt), desc(orders.id))
			.limit(perPage)
			.offset((page - 1) * perPage),
		db.select({ total: count() }).from(orders).where(where)
	]);

	const totalPages = Math.max(1, Math.ceil(total / perPage));

	// Rekomendasi: sesuai riwayat belanja, terlaris, dan rating tertinggi (rak tidak saling mengulang)
	const forYou = getForUser(user.id, 4);
	const bestSellers = getBestSellers({ limit: 4, excludeIds: forYou.map((p) => p.id) });
	const topRated = getTopRated({
		limit: 4,
		excludeIds: [...forYou, ...bestSellers].map((p) => p.id)
	});

	return {
		recs: { forYou, bestSellers, topRated },
		orders: userOrders,
		filters: { status },
		pagination: {
			page,
			totalPages,
			totalItems: total,
			perPage
		}
	};
};
