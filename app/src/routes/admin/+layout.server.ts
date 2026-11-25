import { count, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { orders } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';

export const load = async ({ locals, url }) => {
	const staff = requireRole(locals, 'admin');
	void url.pathname; // dibaca agar load ini berjalan ulang di tiap perpindahan halaman (badge sidebar tak membeku)

	const rows = await db
		.select({ status: orders.status, n: count() })
		.from(orders)
		.where(inArray(orders.status, ['menunggu_konfirmasi', 'diproses']))
		.groupBy(orders.status);

	const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;

	return {
		staff,
		badge: {
			konfirmasi: n('menunggu_konfirmasi'),
			proses: n('diproses')
		}
	};
};
