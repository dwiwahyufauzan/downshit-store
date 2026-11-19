import { error } from '@sveltejs/kit';
import { requireRole } from '#lib/server/guards';
import { parseRange, wibStamp } from '#lib/server/time';
import { parseStatus, salesList } from '#lib/server/reports';
import { toCsv } from '#lib/utils/csv';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireRole(locals, 'owner');
	const r = parseRange(url);
	if (r.error) {
		throw error(400, r.error);
	}

	const status = parseStatus(url.searchParams.get('status'));
	const sep = url.searchParams.get('pemisah') === 'koma' ? ',' : ';';

	const { rows } = await salesList(r.from, r.to, status);
	const sum = (k: 'subtotal' | 'shipping' | 'total') => rows.reduce((s, x) => s + x[k], 0);

	const csv = toCsv(
		[
			[
				'Kode Pesanan',
				'Tanggal (WIB)',
				'Pelanggan',
				'Status',
				'Subtotal (Pendapatan)',
				'Ongkir',
				'Total (Omzet)'
			],
			...rows.map((x) => [
				x.code,
				wibStamp(x.createdAt),
				x.customer,
				x.status,
				x.subtotal,
				x.shipping,
				x.total
			]),
			['TOTAL', '', '', `${rows.length} pesanan`, sum('subtotal'), sum('shipping'), sum('total')]
		],
		sep
	);

	return new Response('\uFEFF' + csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="laporan-penjualan_${r.dari}_${r.sampai}.csv"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
