import { describe, expect, it } from 'vitest';
import { waDigits, waLink } from './whatsapp';

describe('waDigits', () => {
	it('menormalkan berbagai format nomor Indonesia ke 62xxx', () => {
		expect(waDigits('081234567890')).toBe('6281234567890');
		expect(waDigits('+62 812-3456-7890')).toBe('6281234567890');
		expect(waDigits('6281234567890')).toBe('6281234567890');
		expect(waDigits('(0812) 3456 7890')).toBe('6281234567890');
	});

	it('nomor kosong / terlalu pendek / bukan Indonesia → string kosong', () => {
		expect(waDigits('')).toBe('');
		expect(waDigits(null)).toBe('');
		expect(waDigits(undefined)).toBe('');
		expect(waDigits('0812')).toBe('');
		expect(waDigits('+1 415 555 2671')).toBe('');
		expect(waDigits('abc')).toBe('');
	});
});

describe('waLink', () => {
	it('membuat tautan wa.me dengan pesan ter-encode', () => {
		expect(waLink('0812-3456-7890', 'Halo & selamat siang?')).toBe(
			'https://wa.me/6281234567890?text=Halo%20%26%20selamat%20siang%3F'
		);
	});

	it('tanpa pesan → tanpa query', () => {
		expect(waLink('081234567890')).toBe('https://wa.me/6281234567890');
	});

	it('nomor tidak valid → null (tombol tidak ditampilkan, bukan tautan rusak)', () => {
		expect(waLink('')).toBeNull();
		expect(waLink('12')).toBeNull();
	});
});
