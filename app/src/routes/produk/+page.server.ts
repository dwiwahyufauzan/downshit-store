import { redirect } from '@sveltejs/kit';
import { listCatalog } from '#lib/server/catalog';
import { pageParam, priceParam } from '#lib/server/sql';
import { normalizeSize } from '#lib/utils/sizes';
import { CATALOG_PAGE_SIZE } from '#lib/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const page = pageParam(url);
	const perPage = CATALOG_PAGE_SIZE;
	const q = url.searchParams.get('q')?.trim() ?? '';
	const cat = url.searchParams.get('kategori')?.trim() ?? '';
	const sort = url.searchParams.get('urut') ?? 'terbaru';

	// Filter harga: bila terbalik (min > max) ditukar, bukan menghasilkan daftar kosong
	let min = priceParam(url, 'min');
	let max = priceParam(url, 'max');
	if (min !== null && max !== null && min > max) [min, max] = [max, min];
	const ukuran = normalizeSize(url.searchParams.get('ukuran') ?? '');

	const { items, total, categories, sizeOptions } = await listCatalog({
		page,
		perPage,
		q,
		cat,
		sort,
		min,
		max,
		ukuran
	});

	const totalPages = Math.max(1, Math.ceil(total / perPage));
	// ?page melebihi halaman terakhir (mis. filter dipersempit): arahkan ke halaman terakhir, bukan daftar kosong
	if (page > totalPages) {
		const u = new URL(url);
		if (totalPages > 1) u.searchParams.set('page', String(totalPages));
		else u.searchParams.delete('page');
		throw redirect(303, u.pathname + u.search);
	}

	return {
		items,
		categories,
		sizeOptions,
		pagination: { page, totalPages, totalItems: total, perPage },
		filters: { q, kategori: cat, urut: sort, min, max, ukuran }
	};
};
