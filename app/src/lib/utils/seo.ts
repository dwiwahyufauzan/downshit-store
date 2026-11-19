/** URL absolut dari path situs ("/produk/x") atau URL penuh (dibiarkan). Origin kosong → path apa adanya. */
export function absoluteUrl(origin: string | null | undefined, pathOrUrl: string): string {
	if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
	const base = (origin ?? '').replace(/\/+$/, '');
	return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export function xmlEscape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/** Halaman yang tidak perlu/boleh diindeks mesin pencari (bukan pengaman akses: itu tugas hooks.server.ts). */
export const ROBOTS_DISALLOW = [
	'/admin',
	'/owner',
	'/internal',
	'/login',
	'/register',
	'/logout',
	'/keranjang',
	'/checkout',
	'/pesanan',
	'/favorit',
	'/profil',
	'/uploads/proofs/'
] as const;

export function buildRobotsTxt(origin: string, opts: { catalogPrivate?: boolean } = {}): string {
	const disallow = [...ROBOTS_DISALLOW, ...(opts.catalogPrivate ? ['/produk', '/bundling'] : [])];
	return [
		'User-agent: *',
		...disallow.map((p) => `Disallow: ${p}`),
		'Allow: /',
		'',
		`Sitemap: ${absoluteUrl(origin, '/sitemap.xml')}`,
		''
	].join('\n');
}

export type SitemapEntry = { path: string; lastmod?: string | null };

/** Batas protokol sitemap: 50.000 URL per berkas. */
export const SITEMAP_MAX_URLS = 50_000;

export function buildSitemapXml(origin: string, entries: SitemapEntry[]): string {
	const urls = entries.slice(0, SITEMAP_MAX_URLS).map((e) => {
		const lastmod = e.lastmod ? `<lastmod>${xmlEscape(e.lastmod)}</lastmod>` : '';
		return `  <url><loc>${xmlEscape(absoluteUrl(origin, e.path))}</loc>${lastmod}</url>`;
	});
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		'</urlset>',
		''
	].join('\n');
}
