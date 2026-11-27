import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from 'svelte';
import ProductReviews from './ProductReviews.svelte';

const review = (o: Record<string, unknown> = {}) => ({
	id: 1,
	rating: 5,
	comment: 'Bahan tebal, jahitan rapi',
	createdAt: '2026-11-20T03:00:00.000Z',
	name: 'Budi S.',
	photos: [],
	...o
});
const summary = (o: Record<string, unknown> = {}) => ({
	count: 3,
	avg: 4.7,
	dist: [0, 0, 1, 0, 2] as [number, number, number, number, number],
	...o
});

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('ProductReviews', () => {
	it('belum ada ulasan: keadaan kosong, tanpa ringkasan', () => {
		mount(ProductReviews, {
			target: document.body,
			props: { summary: summary({ count: 0, avg: null }), reviews: [], showAll: false }
		});
		expect(document.body.textContent).toContain('Belum ada ulasan');
		expect(document.body.textContent).not.toContain('Sebaran rating');
	});

	it('foto dengan URL sama dalam satu ulasan tetap tampil (tidak memicu each_key_duplicate)', () => {
		const same = { url: '/uploads/reviews/a.webp', thumbUrl: '/uploads/reviews/a_t.webp' };
		mount(ProductReviews, {
			target: document.body,
			props: { summary: summary(), reviews: [review({ photos: [same, same] })], showAll: true }
		});
		expect(document.querySelectorAll('img[alt^="Foto dari"]')).toHaveLength(2);
	});

	it('ringkasan rata-rata + sebaran, komentar, tanggal WIB, dan foto ulasan', () => {
		mount(ProductReviews, {
			target: document.body,
			props: {
				summary: summary(),
				reviews: [
					review({
						photos: [{ url: '/uploads/reviews/a.webp', thumbUrl: '/uploads/reviews/a_t.webp' }]
					}),
					review({ id: 2, name: 'Sari L.', comment: null, rating: 3 })
				],
				showAll: true
			}
		});
		const t = document.body.textContent ?? '';
		expect(t).toContain('4.7');
		expect(t).toContain('dari 3 ulasan');
		expect(t).toContain('Budi S.');
		expect(t).toContain('Bahan tebal, jahitan rapi');
		expect(document.querySelector('img[src="/uploads/reviews/a_t.webp"]')).not.toBeNull();
		expect(
			document.querySelector('a[href="/uploads/reviews/a.webp"]')!.getAttribute('rel')
		).toMatch(/noopener/);
		expect(document.querySelectorAll('[aria-label="Sebaran rating"] li')).toHaveLength(5);
	});

	it('tautan "Lihat semua" hanya bila masih ada ulasan lain dan belum menampilkan semua', () => {
		const base = { summary: summary({ count: 10 }), reviews: [review()] };
		mount(ProductReviews, { target: document.body, props: { ...base, showAll: false } });
		expect(document.querySelector('a[href="?ulasan=semua#ulasan"]')!.textContent).toContain(
			'Lihat semua 10 ulasan'
		);

		document.body.innerHTML = '';
		mount(ProductReviews, { target: document.body, props: { ...base, showAll: true } });
		expect(document.querySelector('a[href="?ulasan=semua#ulasan"]')).toBeNull();
	});
});
