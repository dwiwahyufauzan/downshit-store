import { requireRole } from '#lib/server/guards';
import { pageParam } from '#lib/server/sql';
import { parseRange } from '#lib/server/time';
import {
	bundleComponentUnits,
	bundleVsSingle,
	dailyRevenue,
	fillDays,
	parseStatus,
	salesList,
	salesSummary,
	topItems
} from '#lib/server/reports';
import type { PageServerLoad } from './$types';

const PER_PAGE = 20;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole(locals, 'owner');
	const r = parseRange(url);
	const status = parseStatus(url.searchParams.get('status'));
	const page = pageParam(url);

	const [summary, daily, top, split, comp, list] = await Promise.all([
		salesSummary(r.from, r.to, status),
		dailyRevenue(r.from, r.to, status),
		topItems(r.from, r.to, 10, status),
		bundleVsSingle(r.from, r.to, status),
		bundleComponentUnits(r.from, r.to, status),
		salesList(r.from, r.to, status, { page, perPage: PER_PAGE })
	]);

	return {
		range: { dari: r.dari, sampai: r.sampai, error: r.error ?? null },
		status,
		page,
		totalPages: Math.max(1, Math.ceil(list.total / PER_PAGE)),
		perPage: PER_PAGE,
		summary,
		top,
		split,
		comp,
		rows: list.rows,
		total: list.total,
		daily: fillDays(daily, r.dari, r.sampai)
	};
};
