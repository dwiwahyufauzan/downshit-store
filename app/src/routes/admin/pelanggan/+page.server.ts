import { fail } from '@sveltejs/kit';
import { and, count, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { orders, users } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { contains, idParam, pageParam } from '#lib/server/sql';
import { resetCustomerPassword, setCustomerActive } from '#lib/server/customer-admin';

const PER_PAGE = 15;

export const load = async ({ url, locals }) => {
	requireRole(locals, 'admin');

	const q = url.searchParams.get('q')?.trim() ?? '';

	const whereConditions = and(
		eq(users.role, 'konsumen'),
		q ? or(contains(users.name, q), contains(users.email, q), contains(users.phone, q)) : undefined
	);

	const [totalCountRow] = await db.select({ count: count() }).from(users).where(whereConditions);

	const totalItems = totalCountRow?.count ?? 0;
	const totalPages = Math.ceil(totalItems / PER_PAGE);
	const page = Math.min(pageParam(url), Math.max(1, totalPages));

	const rows = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			phone: users.phone,
			createdAt: users.createdAt,
			isActive: users.isActive,
			orderCount: sql<number>`count(${orders.id})`.mapWith(Number),
			totalSpent:
				sql<number>`coalesce(sum(case when ${orders.status} in ('diproses', 'dikirim', 'selesai') then ${orders.total} end), 0)`.mapWith(
					Number
				)
		})
		.from(users)
		.leftJoin(orders, eq(orders.userId, users.id))
		.where(whereConditions)
		.groupBy(users.id)
		.orderBy(desc(users.createdAt))
		.limit(PER_PAGE)
		.offset((page - 1) * PER_PAGE);

	const [allRow] = await db.select({ n: count() }).from(users).where(eq(users.role, 'konsumen'));

	return {
		customers: rows,
		totalAll: allRow?.n ?? 0,
		filters: { q },
		pagination: {
			page,
			perPage: PER_PAGE,
			totalItems,
			totalPages
		}
	};
};

export const actions = {
	toggle: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());
		if (!id) return fail(400, { message: 'ID pelanggan tidak valid' });

		const active = fd.get('active')?.toString();
		const r = await setCustomerActive(
			admin.id,
			id,
			active === 'true' ? true : active === 'false' ? false : undefined
		);
		if (!r.ok) return fail(r.status, { message: r.message });
		return {
			success: true,
			message: `Akun ${r.name} ${r.isActive ? 'aktif kembali dan bisa login.' : 'dinonaktifkan; sesi login berakhir dan tidak bisa masuk.'}`
		};
	},

	reset: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());
		if (!id) return fail(400, { message: 'ID pelanggan tidak valid' });

		const r = await resetCustomerPassword(admin.id, id);
		if (!r.ok) return fail(r.status, { message: r.message });

		return {
			resetSuccess: true,
			tempPassword: r.tempPassword,
			customerName: r.name,
			customerEmail: r.email,
			customerPhone: r.phone
		};
	}
};
