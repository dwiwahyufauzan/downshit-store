import { describe, expect, it } from 'vitest';
import { promoCondition, promoExpiry, promoHeadline, promoScarcity } from './promo';

const NOW = new Date('2026-11-26T05:00:00Z');
const endOf = (d: string) => `${d}T16:59:59.999Z`; // akhir hari WIB

describe('teks promo', () => {
	it('judul: persen vs nominal', () => {
		expect(promoHeadline({ type: 'percent', value: 15 })).toBe('Diskon 15%');
		expect(promoHeadline({ type: 'fixed', value: 25000 })).toMatch(/^Potongan Rp\s?25\.000$/);
	});

	it('syarat: minimal belanja dan batas potongan (hanya untuk persen)', () => {
		expect(promoCondition({ type: 'percent', minSubtotal: 0, maxDiscount: null })).toBe(
			'Tanpa minimal belanja'
		);
		const c = promoCondition({ type: 'percent', minSubtotal: 100000, maxDiscount: 30000 });
		expect(c).toMatch(/Min\. belanja Rp\s?100\.000/);
		expect(c).toMatch(/maks\. potongan Rp\s?30\.000/);
		expect(promoCondition({ type: 'fixed', minSubtotal: 50000, maxDiscount: 30000 })).not.toMatch(
			/maks/
		);
	});

	it('masa berlaku: hari ini / sisa N hari / tanggal / tanpa batas / berakhir', () => {
		expect(promoExpiry(null, NOW)).toBe('Tanpa batas waktu');
		expect(promoExpiry(endOf('2026-11-26'), NOW)).toBe('Berakhir hari ini');
		expect(promoExpiry(endOf('2026-11-29'), NOW)).toBe('Sisa 4 hari');
		expect(promoExpiry(endOf('2026-12-31'), NOW)).toMatch(/^Sampai 31 Des 2026$/);
		expect(promoExpiry('2026-11-25T00:00:00Z', NOW)).toBe('Sudah berakhir');
	});

	it('kuota hanya diumumkan saat tinggal sedikit', () => {
		expect(promoScarcity(null)).toBeNull();
		expect(promoScarcity(0)).toBeNull();
		expect(promoScarcity(21)).toBeNull();
		expect(promoScarcity(20)).toBe('Sisa 20 kuota');
		expect(promoScarcity(3)).toBe('Sisa 3 kuota');
	});
});
