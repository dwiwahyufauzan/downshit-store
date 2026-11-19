import { and, eq, isNull } from 'drizzle-orm';
import { CATALOG_REQUIRES_LOGIN, ORIGIN } from '$app/env/private';
import { db } from '#lib/server/db';
import { bundles, products } from '#lib/server/db/schema';
import { buildSitemapXml, type SitemapEntry } from '#lib/utils/seo';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const entries: SitemapEntry[] = [{ path: '/' }, { path: '/kebijakan-privasi' }];

	// Katalog wajib login → mesin pencari tidak bisa membukanya, jadi tidak didaftarkan
	if (CATALOG_REQUIRES_LOGIN !== 'true') {
		entries.push({ path: '/produk' }, { path: '/bundling' });

		const prods = db
			.select({ slug: products.slug, updatedAt: products.updatedAt })
			.from(products)
			.where(and(eq(products.isActive, true), isNull(products.deletedAt)))
			.all();
		for (const p of prods) {
			entries.push({ path: `/produk/${encodeURIComponent(p.slug)}`, lastmod: p.updatedAt });
		}

		const buns = db
			.select({ slug: bundles.slug, updatedAt: bundles.updatedAt })
			.from(bundles)
			.where(and(eq(bundles.isActive, true), isNull(bundles.deletedAt)))
			.all();
		for (const b of buns) {
			entries.push({ path: `/bundling/${encodeURIComponent(b.slug)}`, lastmod: b.updatedAt });
		}
	}

	return new Response(buildSitemapXml(ORIGIN || url.origin, entries), {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
