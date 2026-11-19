export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

/** ?page=… → bilangan bulat 1…100000 */
export const pageParam = (url: URL) =>
	Math.min(100_000, Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1));

/** :id dari URL → bilangan bulat positif atau null */
export const idParam = (v: string | undefined): number | null => {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : null;
};
