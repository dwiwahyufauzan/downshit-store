import { describe, expect, it } from 'vitest';
import { canTransition, allowedNext } from './order-status';

describe('State Machine Status Pesanan (BR-11)', () => {
	it('mengizinkan alur normal transaksi dari checkout sampai selesai', () => {
		expect(canTransition('menunggu_pembayaran', 'menunggu_konfirmasi')).toBe(true);
		expect(canTransition('menunggu_konfirmasi', 'diproses')).toBe(true);
		expect(canTransition('diproses', 'dikirim')).toBe(true);
		expect(canTransition('dikirim', 'selesai')).toBe(true);
	});

	it('mengizinkan pembatalan sebelum diproses (SRS-F-010)', () => {
		expect(canTransition('menunggu_pembayaran', 'dibatalkan')).toBe(true);
		expect(canTransition('menunggu_konfirmasi', 'dibatalkan')).toBe(true);
	});

	it('menolak transisi ilegal atau pembatalan setelah dikirim', () => {
		expect(canTransition('menunggu_pembayaran', 'selesai')).toBe(false);
		expect(canTransition('dikirim', 'dibatalkan')).toBe(false);
		expect(canTransition('selesai', 'diproses')).toBe(false);
		expect(canTransition('dibatalkan', 'diproses')).toBe(false);
	});

	it('mengembalikan daftar status selanjutnya yang diizinkan', () => {
		expect(allowedNext('menunggu_pembayaran')).toEqual(['menunggu_konfirmasi', 'dibatalkan']);
		expect(allowedNext('selesai')).toEqual([]);
		expect(allowedNext('dibatalkan')).toEqual([]);
	});
});
