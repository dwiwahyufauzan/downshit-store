import { count, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { purchases, users } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { pageParam } from '$lib/server/sql';

const PER_PAGE = 15;

export const load = async ({ url, locals }) => {
	requireRole(locals, 'admin');

	const [totalCountRow] = await db.select({ count: count() }).from(purchases);
	const totalItems = totalCountRow?.count ?? 0;
	const totalPages = Math.ceil(totalItems / PER_PAGE);
	const page = Math.min(pageParam(url), Math.max(1, totalPages));

	const rows = await db
		.select({
			id: purchases.id,
			code: purchases.code,
			supplierName: purchases.supplierName,
			purchaseDate: purchases.purchaseDate,
			totalCost: purchases.totalCost,
			note: purchases.note,
			status: purchases.status,
			createdAt: purchases.createdAt,
			adminName: users.name
		})
		.from(purchases)
		.leftJoin(users, eq(users.id, purchases.createdBy))
		.orderBy(desc(purchases.id))
		.limit(PER_PAGE)
		.offset((page - 1) * PER_PAGE);

	return {
		purchases: rows,
		pagination: {
			page,
			perPage: PER_PAGE,
			totalItems,
			totalPages
		}
	};
};
