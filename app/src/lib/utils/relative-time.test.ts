import { describe, expect, it } from 'vitest';
import { waktuRelatif } from './relative-time';

const NOW = Date.parse('2026-11-14T10:00:00Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

describe('waktuRelatif', () => {
	it('kurang dari semenit = "baru saja"', () => {
		expect(waktuRelatif(ago(5), NOW)).toBe('baru saja');
		expect(waktuRelatif(ago(59), NOW)).toBe('baru saja');
	});
	it('menit, jam, hari memakai bahasa Indonesia', () => {
		expect(waktuRelatif(ago(5 * 60), NOW)).toBe('5 menit yang lalu');
		expect(waktuRelatif(ago(3 * 3600), NOW)).toBe('3 jam yang lalu');
		expect(waktuRelatif(ago(86_400), NOW)).toBe('kemarin');
		expect(waktuRelatif(ago(5 * 86_400), NOW)).toBe('5 hari yang lalu');
	});
	it('lebih dari 30 hari = tanggal WIB lengkap', () => {
		const out = waktuRelatif('2026-09-01T03:00:00.000Z', NOW);
		expect(out).toMatch(/2026/);
		expect(out).toMatch(/10\.00|10:00/); // 03:00 UTC = 10:00 WIB
	});
	it('waktu di masa depan tidak crash', () => {
		expect(waktuRelatif(new Date(NOW + 3 * 3600 * 1000), NOW)).toMatch(/jam/);
	});
});
