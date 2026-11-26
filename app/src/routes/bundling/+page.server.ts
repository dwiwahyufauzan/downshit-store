import { listBundles } from '#lib/server/catalog';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const urut = (url.searchParams.get('urut') ?? 'terbaru').trim();

	return { bundles: await listBundles({ q, urut }), filters: { q, urut } };
};
