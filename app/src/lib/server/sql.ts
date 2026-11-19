export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

/** ?page=… → bilangan bulat 1…100000 */
export const pageParam = (url: URL) =>
	Math.min(100_000, Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1));

/** Batas atas filter harga (Rp): menolak angka mustahil yang bisa meluap/merusak query */
export const MAX_PRICE_FILTER = 1_000_000_000;

/** ?min=… / ?max=… → rupiah bulat 0…MAX_PRICE_FILTER, atau null bila kosong/tidak valid */
export const priceParam = (url: URL, name: string): number | null => {
	const raw = url.searchParams.get(name)?.trim();
	if (!raw || !/^\d{1,10}$/.test(raw)) return null;
	const n = Number(raw);
	return n <= MAX_PRICE_FILTER ? n : null;
};

/** :id dari URL → bilangan bulat positif atau null */
export const idParam = (v: string | undefined): number | null => {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : null;
};
