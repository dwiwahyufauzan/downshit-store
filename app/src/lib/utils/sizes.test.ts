import { describe, expect, it } from 'vitest';
import {
	compareSizes,
	decodeSelection,
	encodeSelection,
	isValidSize,
	normalizeSize
} from './sizes';

describe('ukuran produk', () => {
	it('normalizeSize merapikan huruf & spasi', () => {
		expect(normalizeSize('  xl ')).toBe('XL');
		expect(normalizeSize('all   size')).toBe('ALL SIZE');
	});

	it('isValidSize menerima label wajar dan menolak yang aneh', () => {
		for (const ok of ['S', 'XXL', '30', 'ALL SIZE', '38.5', 'S/M'])
			expect(isValidSize(ok)).toBe(true);
		for (const bad of ['', ' ', '-S', 'S;DROP', 'LABELYANGTERLALUPANJANG', 'a|b', 'x:y']) {
			expect(isValidSize(bad)).toBe(false);
		}
	});

	it('compareSizes: huruf menurut urutan lazim, angka menurut nilai', () => {
		expect(['XL', 'S', 'M', 'XXL', 'L'].sort(compareSizes)).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
		expect(['34', '28', '30'].sort(compareSizes)).toEqual(['28', '30', '34']);
	});

	it('encode/decode pilihan bundling bolak-balik dan terurut menurut productId', () => {
		const enc = encodeSelection({ 15: 'M', 12: 'L' });
		expect(enc).toBe('12:L|15:M');
		expect(decodeSelection(enc)).toEqual({ 12: 'L', 15: 'M' });
		expect(encodeSelection({})).toBe('');
		expect(decodeSelection('')).toEqual({});
		expect(decodeSelection('abc|:|3:')).toEqual({});
	});
});
