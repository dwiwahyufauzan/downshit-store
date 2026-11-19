import { CATALOG_REQUIRES_LOGIN, ORIGIN } from '$app/env/private';
import { buildRobotsTxt } from '#lib/utils/seo';
import type { RequestHandler } from './$types';

// Dinamis (bukan static/robots.txt) karena baris Sitemap harus berupa URL absolut sesuai ORIGIN.
export const GET: RequestHandler = ({ url }) =>
	new Response(
		buildRobotsTxt(ORIGIN || url.origin, { catalogPrivate: CATALOG_REQUIRES_LOGIN === 'true' }),
		{
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Cache-Control': 'public, max-age=3600'
			}
		}
	);
