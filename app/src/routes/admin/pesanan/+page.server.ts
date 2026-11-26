import { requireRole } from '#lib/server/guards';
import { listAdminOrders } from '#lib/server/admin-lists';
import { pageParam } from '#lib/server/sql';
import { isYmd } from '#lib/server/time';
import { ORDER_STATUS, type OrderStatus } from '#lib/constants';

export const load = async ({ url, locals }) => {
	requireRole(locals, 'admin');

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

	const { orders, pagination } = await listAdminOrders({
		page: pageParam(url),
		q,
		status,
		dari,
		sampai
	});
	return { orders, filters: { q, status, dari, sampai }, pagination };
};
