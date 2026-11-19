import { and, count, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { orders, users } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { escapeLike, pageParam } from '$lib/server/sql';
import { isYmd, wibEnd, wibStart } from '$lib/server/time';
import { ORDER_STATUS, type OrderStatus } from '$lib/constants';

const PER_PAGE = 15;

/** Status pembayaran "efektif" = baris payments terbaru (NULL = belum ada unggahan → belum_bayar) */
const latestPay = sql<
	string | null
>`(select p.status from payments p where p.order_id = ${orders.id} order by p.id desc limit 1)`;
const latestProof = sql<
	string | null
>`(select p.proof_url from payments p where p.order_id = ${orders.id} order by p.id desc limit 1)`;

export const load = async ({ url, locals }) => {
	requireRole(locals, 'admin');

	const page = pageParam(url);
	const q = url.searchParams.get('q')?.trim() ?? '';
	const statusParam = url.searchParams.get('status')?.trim() ?? '';
	const status = (ORDER_STATUS as readonly string[]).includes(statusParam)
		? (statusParam as OrderStatus)
		: undefined;

	// filter rentang tanggal (WIB); nilai tak valid diabaikan
	const dariRaw = url.searchParams.get('dari');
	const sampaiRaw = url.searchParams.get('sampai');
	const dari = isYmd(dariRaw) ? dariRaw : '';
	const sampai = isYmd(sampaiRaw) ? sampaiRaw : '';

	const whereConditions = and(
		status ? eq(orders.status, status) : undefined,
		dari ? gte(orders.createdAt, wibStart(dari).toISOString()) : undefined,
		sampai ? lte(orders.createdAt, wibEnd(sampai).toISOString()) : undefined,
		q
			? or(
					like(orders.code, `%${escapeLike(q)}%`),
					like(users.name, `%${escapeLike(q)}%`),
					like(orders.recipientName, `%${escapeLike(q)}%`)
				)
			: undefined
	);

	const [totalCountRow] = await db
		.select({ count: count() })
		.from(orders)
		.innerJoin(users, eq(users.id, orders.userId))
		.where(whereConditions);

	const totalItems = totalCountRow?.count ?? 0;
	const totalPages = Math.max(1, Math.ceil(totalItems / PER_PAGE));

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
		.where(whereConditions)
		// Prioritaskan status menunggu_konfirmasi di paling atas
		.orderBy(
			sql`CASE WHEN ${orders.status} = 'menunggu_konfirmasi' THEN 0 ELSE 1 END`,
			desc(orders.createdAt),
			desc(orders.id)
		)
		.limit(PER_PAGE)
		.offset((page - 1) * PER_PAGE);

	return {
		orders: rows.map(({ payStatus, proofUrl, ...o }) => ({
			...o,
			paymentStatus: payStatus ?? 'belum_bayar',
			hasProof: !!proofUrl
		})),
		filters: { q, status, dari, sampai },
		pagination: {
			page,
			perPage: PER_PAGE,
			totalItems,
			totalPages
		}
	};
};
