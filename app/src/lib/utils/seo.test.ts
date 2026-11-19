import { describe, expect, it } from 'vitest';
import {
	ROBOTS_DISALLOW,
	SITEMAP_MAX_URLS,
	absoluteUrl,
	buildRobotsTxt,
	buildSitemapXml,
	xmlEscape
} from './seo';

describe('absoluteUrl', () => {
	it('menggabungkan origin dan path dengan satu slash', () => {
		expect(absoluteUrl('https://toko.id', '/produk/x')).toBe('https://toko.id/produk/x');
		expect(absoluteUrl('https://toko.id/', '/produk/x')).toBe('https://toko.id/produk/x');
		expect(absoluteUrl('https://toko.id', 'produk/x')).toBe('https://toko.id/produk/x');
	});
	it('URL penuh dibiarkan; origin kosong → path', () => {
		expect(absoluteUrl('https://toko.id', 'https://cdn.example/a.jpg')).toBe(
			'https://cdn.example/a.jpg'
		);
		expect(absoluteUrl(null, '/a')).toBe('/a');
		expect(absoluteUrl(undefined, '/a')).toBe('/a');
	});
});

describe('xmlEscape', () => {
	it('meloloskan lima karakter khusus XML', () => {
		expect(xmlEscape(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
	});
});

describe('buildRobotsTxt', () => {
	it('menutup area staf, akun, dan bukti bayar; membuka sisanya; menunjuk sitemap absolut', () => {
		const t = buildRobotsTxt('https://toko.id');
		for (const p of ROBOTS_DISALLOW) expect(t).toContain(`Disallow: ${p}\n`);
		expect(t).toContain('Disallow: /admin\n');
		expect(t).toContain('Disallow: /uploads/proofs/\n');
		expect(t).toContain('Allow: /\n');
		expect(t).toContain('Sitemap: https://toko.id/sitemap.xml\n');
		expect(t).not.toContain('Disallow: /produk');
	});
	it('katalog privat (wajib login) → /produk dan /bundling ikut ditutup', () => {
		const t = buildRobotsTxt('https://toko.id', { catalogPrivate: true });
		expect(t).toContain('Disallow: /produk\n');
		expect(t).toContain('Disallow: /bundling\n');
	});
});

describe('buildSitemapXml', () => {
	it('memuat loc absolut, lastmod, dan meloloskan karakter khusus', () => {
		const xml = buildSitemapXml('https://toko.id', [
			{ path: '/' },
			{ path: '/produk/kaos-a&b', lastmod: '2026-11-01T10:00:00.000Z' }
		]);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(xml).toContain('<loc>https://toko.id/</loc>');
		expect(xml).toContain(
			'<loc>https://toko.id/produk/kaos-a&amp;b</loc><lastmod>2026-11-01T10:00:00.000Z</lastmod>'
		);
	});
	it('tidak melebihi batas 50.000 URL', () => {
		const many = Array.from({ length: SITEMAP_MAX_URLS + 5 }, (_, i) => ({ path: `/p/${i}` }));
		expect(buildSitemapXml('https://t.id', many).match(/<url>/g)).toHaveLength(SITEMAP_MAX_URLS);
	});
});
