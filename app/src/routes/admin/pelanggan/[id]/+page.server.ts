import { error, fail } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { orders, payments, shipments, users } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { idParam } from '#lib/server/sql';
import { resetCustomerPassword, setCustomerActive } from '#lib/server/customer-admin';

export const load = async ({ params, locals }) => {
	requireRole(locals, 'admin');
	const id = idParam(params.id);
	if (!id) throw error(404, 'Pelanggan tidak ditemukan');

	const [cust] = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			phone: users.phone,
			address: users.address,
			isActive: users.isActive,
			createdAt: users.createdAt
		})
		.from(users)
		.where(and(eq(users.id, id), eq(users.role, 'konsumen')))
		.limit(1);

	if (!cust) throw error(404, 'Pelanggan tidak ditemukan');

	const customerOrders = await db
		.select({
			id: orders.id,
			code: orders.code,
			status: orders.status,
			total: orders.total,
			createdAt: orders.createdAt,
			// Pembayaran terbaru saja: JOIN langsung menggandakan baris bila ada >1 bukti bayar
			paymentStatus: sql<
				string | null
			>`(select ${payments.status} from ${payments} where ${payments.orderId} = ${orders.id} order by ${payments.id} desc limit 1)`,
			shipmentStatus: shipments.status,
			trackingNumber: shipments.trackingNumber
		})
		.from(orders)
		.leftJoin(shipments, eq(shipments.orderId, orders.id))
		.where(eq(orders.userId, id))
		.orderBy(desc(orders.id));

	// Total belanja = pesanan yang sudah dibayar (BR-12: diproses/dikirim/selesai)
	const totalSpent = customerOrders
		.filter((o) => ['diproses', 'dikirim', 'selesai'].includes(o.status))
		.reduce((sum, o) => sum + o.total, 0);

	return {
		customer: cust,
		orders: customerOrders,
		totalSpent
	};
};

export const actions = {
	toggle: async ({ params, request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const id = idParam(params.id);
		if (!id) error(404, 'Pelanggan tidak ditemukan');
		const fd = await request.formData();
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

	reset: async ({ params, locals }) => {
		const admin = requireRole(locals, 'admin');
		const id = idParam(params.id);
		if (!id) error(404, 'Pelanggan tidak ditemukan');
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
