import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick } from 'svelte';
import VoucherBox from './VoucherBox.svelte';

const settle = async () => {
	for (let i = 0; i < 6; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
};
async function mountBox(over: Record<string, unknown> = {}) {
	// $state (file *.svelte.test.ts mendukung rune): induk sungguhan juga reaktif, jadi tampilan ikut berubah
	const st = $state({ applied: null as null | { code: string; discount: number } });
	mount(VoucherBox, {
		target: document.body,
		props: {
			get applied() {
				return st.applied;
			},
			set applied(v) {
				st.applied = v;
			},
			...over
		}
	});
	await settle(); // tunggu onMount selesai sebelum pengguna "mengetik"
	return st;
}
const api = (body: unknown, ok = true) => {
	const f = vi.fn(async (_url: string) => ({ ok, status: ok ? 200 : 429, json: async () => body }));
	vi.stubGlobal('fetch', f);
	return f;
};
const input = () => document.getElementById('voucher-input') as HTMLInputElement;
const type = (v: string) => {
	input().value = v;
	input().dispatchEvent(new Event('input', { bubbles: true }));
};
const pakai = () =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pakai'))!;

beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('VoucherBox', () => {
	it('kode valid: potongan dilaporkan, kode ikut terkirim lewat input tersembunyi, bisa dilepas', async () => {
		const f = api({ ok: true, code: 'HEMAT10', discount: 10000 });
		const st = await mountBox();
		type('hemat10');
		await tick();
		pakai().click();
		await settle();

		expect(f.mock.calls[0][0]).toBe('/api/voucher?code=hemat10');
		expect(st.applied).toEqual({ code: 'HEMAT10', discount: 10000 });
		expect(document.body.textContent).toMatch(/hemat Rp\s?10\.000/);
		expect(document.querySelector<HTMLInputElement>('input[name="voucherCode"]')!.value).toBe(
			'HEMAT10'
		);

		[...document.querySelectorAll('button')].find((b) => b.textContent === 'Lepas')!.click();
		await settle();
		expect(st.applied).toBeNull();
		expect(document.querySelector('input[name="voucherCode"]')).toBeNull();
	});

	it('kode ditolak server: pesan ditampilkan dan tidak ada potongan', async () => {
		api({ ok: false, message: 'Kode voucher tidak valid atau sudah tidak berlaku.' });
		const st = await mountBox();
		type('NGAWUR');
		await tick();
		pakai().click();
		await settle();
		expect(st.applied).toBeNull();
		expect(document.body.textContent).toContain('tidak valid');
	});

	it('galat jaringan/rate limit: pesan umum, tanpa potongan', async () => {
		api({}, false);
		const st = await mountBox();
		type('X1');
		await tick();
		pakai().click();
		await settle();
		expect(st.applied).toBeNull();
		expect(document.body.textContent).toContain('Gagal memeriksa voucher');
	});

	it('tombol Pakai nonaktif saat kosong; Enter menerapkan (tidak men-submit form)', async () => {
		const f = api({ ok: true, code: 'ABC', discount: 5000 });
		const st = await mountBox();
		expect(pakai().disabled).toBe(true);
		type('abc');
		await tick();
		const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		input().dispatchEvent(ev);
		await settle();
		expect(ev.defaultPrevented).toBe(true);
		expect(f).toHaveBeenCalledTimes(1);
		expect(st.applied?.code).toBe('ABC');
	});

	it('kode awal (form dikembalikan karena galat) langsung dicek ulang; galat server tampil', async () => {
		const f = api({ ok: true, code: 'HEMAT10', discount: 9000 });
		const st = await mountBox({
			initialCode: 'HEMAT10',
			error: 'Kuota voucher ini baru saja habis.'
		});
		await settle();
		expect(f).toHaveBeenCalledTimes(1);
		expect(st.applied?.discount).toBe(9000);
		expect(document.body.textContent).toContain('Kuota voucher ini baru saja habis.');
	});
});
