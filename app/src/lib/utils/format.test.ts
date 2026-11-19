import { describe, expect, it } from 'vitest';
import { rupiah, tanggal } from './format';

describe('Format Utility (Rupiah & Tanggal)', () => {
	it('memformat angka ke mata uang Rupiah', () => {
		const res = rupiah(149000);
		expect(res).toContain('149.000');
		expect(res).toContain('Rp');
	});

	it('menangani nilai null atau undefined dengan aman', () => {
		const res = rupiah(null);
		expect(res).toContain('0');
	});

	it('memformat tanggal ke format lokal Indonesia', () => {
		const dateStr = '2026-11-14T10:00:00.000Z';
		const res = tanggal(dateStr);
		expect(res).toBeTruthy();
		expect(res).not.toBe('-');
	});

	it('tanggal selalu ditampilkan dalam WIB (UTC+7), bukan zona waktu server', () => {
		// 31 Okt 17:30 UTC = 1 Nov 00:30 WIB
		const res = tanggal('2026-10-31T17:30:00.000Z');
		expect(res).toMatch(/1 Nov 2026/);
		expect(res).toMatch(/00[.:]30/);
	});

	it('tanggal kosong/null -> tanda strip', () => {
		expect(tanggal(null)).toBe('-');
		expect(tanggal(undefined)).toBe('-');
	});

	it('rupiah menerima string angka dan membulatkan tanpa desimal', () => {
		expect(rupiah('1350000')).toMatch(/1\.350\.000/);
		expect(rupiah(1234.56)).not.toContain(',');
	});
});
