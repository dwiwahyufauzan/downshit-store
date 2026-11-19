import { describe, expect, it } from 'vitest';
import { FULL_WIDTH, THUMB_WIDTH, srcsetOf, thumbOf } from './image';

describe('thumbOf', () => {
	it('gambar unggahan webp → versi _t; lainnya apa adanya', () => {
		expect(thumbOf('/uploads/products/abc-123.webp')).toBe('/uploads/products/abc-123_t.webp');
		expect(thumbOf('/uploads/bundles/x.webp')).toBe('/uploads/bundles/x_t.webp');
		expect(thumbOf('/uploads/products/abc_t.webp')).toBe('/uploads/products/abc_t.webp');
		expect(thumbOf('/uploads/products/lama.jpg')).toBe('/uploads/products/lama.jpg');
		expect(thumbOf('https://cdn.example/a.webp')).toBe('https://cdn.example/a.webp');
		expect(thumbOf(null)).toBeNull();
	});
});

describe('srcsetOf', () => {
	it('gambar unggahan → thumbnail (400w) + utama (1200w)', () => {
		expect(srcsetOf('/uploads/products/abc-123.webp')).toBe(
			`/uploads/products/abc-123_t.webp ${THUMB_WIDTH}w, /uploads/products/abc-123.webp ${FULL_WIDTH}w`
		);
		expect(srcsetOf('/uploads/bundles/x.webp')).toContain('/uploads/bundles/x_t.webp 400w');
	});

	it('tanpa srcset untuk URL yang tidak punya dua ukuran', () => {
		expect(srcsetOf(null)).toBeUndefined();
		expect(srcsetOf('')).toBeUndefined();
		expect(srcsetOf('/uploads/products/lama.jpg')).toBeUndefined();
		expect(srcsetOf('https://cdn.example/a.webp')).toBeUndefined();
		expect(srcsetOf('/uploads/products/abc_t.webp')).toBeUndefined(); // sudah thumbnail
		expect(srcsetOf('/uploads/proofs/abc.webp')).toBeUndefined(); // bukti bayar tidak punya thumbnail
	});
});
