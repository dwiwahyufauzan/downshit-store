import { describe, expect, it } from 'vitest';
import { canTransition } from './order-status';

describe('Order state transitions', () => {
	it('allows valid forward transitions', () => {
		expect(canTransition('menunggu_pembayaran', 'menunggu_konfirmasi')).toBe(true);
		expect(canTransition('menunggu_konfirmasi', 'diproses')).toBe(true);
		expect(canTransition('diproses', 'dikirim')).toBe(true);
		expect(canTransition('dikirim', 'selesai')).toBe(true);
	});

	it('allows cancellation from unfulfilled states', () => {
		expect(canTransition('menunggu_pembayaran', 'dibatalkan')).toBe(true);
		expect(canTransition('menunggu_konfirmasi', 'dibatalkan')).toBe(true);
		expect(canTransition('diproses', 'dibatalkan')).toBe(true);
	});

	it('disallows invalid transitions', () => {
		expect(canTransition('selesai', 'menunggu_pembayaran')).toBe(false);
		expect(canTransition('dibatalkan', 'dikirim')).toBe(false);
		expect(canTransition('dikirim', 'menunggu_konfirmasi')).toBe(false);
	});
});
