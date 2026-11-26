import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount } from 'svelte';
import PromoBar from './PromoBar.svelte';
import { promoBar } from '#lib/stores/promo-bar.svelte';
import type { PromoVoucher } from '#lib/utils/promo';

const NOW = new Date('2026-11-26T05:00:00Z');
const promo = (o: Partial<PromoVoucher> = {}): PromoVoucher => ({
	code: 'HEMAT10',
	description: 'Diskon akhir tahun',
	type: 'percent',
	value: 10,
	minSubtotal: 100_000,
	maxDiscount: 30_000,
	endsAt: '2026-11-29T16:59:59.999Z',
	remaining: 5,
	...o
});
const bar = () => document.querySelector<HTMLElement>('[data-testid="promo-bar"]');
const click = (el: Element | null) => {
	(el as HTMLElement).click();
	flushSync();
};

beforeEach(() => {
	document.body.innerHTML = '';
	promoBar.closedSig = null;
});

describe('PromoBar', () => {
	it('tanpa voucher: tidak merender apa pun', () => {
		mount(PromoBar, { target: document.body, props: { promos: [], now: NOW } });
		expect(bar()).toBeNull();
	});

	it('menampilkan judul & kode voucher', () => {
		mount(PromoBar, { target: document.body, props: { promos: [promo()], now: NOW } });
		flushSync();
		expect(bar()?.getAttribute('aria-hidden')).toBe('false');
		expect(document.querySelector('[data-testid="promo-headline"]')?.textContent).toContain(
			'Diskon 10%'
		);
		expect(document.querySelector('[data-testid="promo-code"]')?.textContent).toBe('HEMAT10');
	});

	it('tombol tutup menyembunyikan banner; tetap tertutup saat dipasang ulang (pindah halaman)', () => {
		mount(PromoBar, { target: document.body, props: { promos: [promo()], now: NOW } });
		flushSync();
		click(document.querySelector('[aria-label="Tutup banner promo"]'));
		expect(bar()?.getAttribute('aria-hidden')).toBe('true');

		document.body.innerHTML = '';
		mount(PromoBar, { target: document.body, props: { promos: [promo()], now: NOW } });
		flushSync();
		expect(bar()?.getAttribute('aria-hidden')).toBe('true');
	});

	it('memuat ulang halaman (state baru) menampilkan banner lagi', () => {
		mount(PromoBar, { target: document.body, props: { promos: [promo()], now: NOW } });
		flushSync();
		expect(bar()?.getAttribute('aria-hidden')).toBe('false');
	});

	it('promo baru (kode berbeda) menampilkan banner lagi walau sebelumnya ditutup', () => {
		promoBar.closedSig = 'HEMAT10';
		mount(PromoBar, {
			target: document.body,
			props: { promos: [promo({ code: 'AKHIRTAHUN' })], now: NOW }
		});
		flushSync();
		expect(bar()?.getAttribute('aria-hidden')).toBe('false');
	});

	it('beberapa promo: penanda memilih promo lain', () => {
		mount(PromoBar, {
			target: document.body,
			props: { promos: [promo(), promo({ code: 'ONGKIR', type: 'fixed', value: 15000 })], now: NOW }
		});
		flushSync();
		expect(document.querySelector('[data-testid="promo-code"]')?.textContent).toBe('HEMAT10');
		click(document.querySelector('[aria-label="Tampilkan promo 2"]'));
		expect(document.querySelector('[data-testid="promo-code"]')?.textContent).toBe('ONGKIR');
	});
});
