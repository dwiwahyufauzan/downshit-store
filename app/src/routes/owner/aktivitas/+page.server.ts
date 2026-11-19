import { and, count, desc, eq, gte, like, lte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '#lib/server/db';
import { activityLogs, orders, payments, users } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { pageParam } from '#lib/server/sql';
import { parseRange } from '#lib/server/time';
import type { PageServerLoad } from './$types';

const PER_PAGE = 20;

const JENIS = {
	penjualan: 'order.%',
	pembayaran: 'payment.%',
	pengiriman: 'shipment.%',
	pembelian: 'purchase.%',
	stok: 'stock.%'
} as const;

type Jenis = keyof typeof JENIS;
const PSTATUS = ['menunggu', 'dikonfirmasi', 'ditolak', 'dikembalikan'] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole(locals, 'owner');
	const r = parseRange(url);
	const page = pageParam(url);
	const tab = url.searchParams.get('tab') === 'transaksi' ? 'transaksi' : 'aktivitas';
	const base = {
		page,
		range: { dari: r.dari, sampai: r.sampai, error: r.error ?? null }
	};

	const fromIso = r.from.toISOString();
	const toIso = r.to.toISOString();

	if (tab === 'aktivitas') {
		const rawJenis = url.searchParams.get('jenis') as Jenis | null;
		const jenis = rawJenis && rawJenis in JENIS ? rawJenis : null;

		const byType =
			jenis && jenis in JENIS
				? like(activityLogs.action, JENIS[jenis])
				: or(...Object.values(JENIS).map((p) => like(activityLogs.action, p)));

		const where = and(
			byType,
			gte(activityLogs.createdAt, fromIso),
			lte(activityLogs.createdAt, toIso)
		);

		const [rows, [{ total }]] = await Promise.all([
			db
				.select({
					id: activityLogs.id,
					at: activityLogs.createdAt,
					action: activityLogs.action,
					description: activityLogs.description,
					actor: users.name
				})
				.from(activityLogs)
				.leftJoin(users, eq(users.id, activityLogs.userId))
				.where(where)
				.orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
				.limit(PER_PAGE)
				.offset((page - 1) * PER_PAGE),
			db.select({ total: count() }).from(activityLogs).where(where)
		]);

		return {
			...base,
			tab: 'aktivitas' as const,
			jenis,
			rows,
			total,
			perPage: PER_PAGE,
			totalPages: Math.max(1, Math.ceil(total / PER_PAGE))
		};
	}

	// Tab transaksi pembayaran
	const confirmer = alias(users, 'confirmer');
	const sf = url.searchParams.get('status');
	const statusValid = sf && (PSTATUS as readonly string[]).includes(sf);

	const where = and(
		statusValid ? eq(payments.status, sf as (typeof PSTATUS)[number]) : undefined,
		gte(payments.createdAt, fromIso),
		lte(payments.createdAt, toIso)
	);

	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				id: payments.id,
				orderCode: orders.code,
				customer: users.name,
				amount: payments.amount,
				status: payments.status,
				note: payments.note,
				uploadedAt: payments.createdAt,
				confirmedAt: payments.confirmedAt,
				confirmedBy: confirmer.name
			})
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.innerJoin(users, eq(users.id, orders.userId))
			.leftJoin(confirmer, eq(confirmer.id, payments.confirmedBy))
			.where(where)
			.orderBy(desc(payments.createdAt), desc(payments.id))
			.limit(PER_PAGE)
			.offset((page - 1) * PER_PAGE),
		db.select({ total: count() }).from(payments).where(where)
	]);

	return {
		...base,
		tab: 'transaksi' as const,
		status: statusValid ? sf : null,
		rows,
		total,
		perPage: PER_PAGE,
		totalPages: Math.max(1, Math.ceil(total / PER_PAGE))
	};
};
