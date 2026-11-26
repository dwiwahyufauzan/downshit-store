import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import ShippingPicker from './ShippingPicker.svelte';

const OPTIONS = [
	{ id: 'jne:reg', label: 'JNE Reguler', price: 18000, etd: '2-3 hari' },
	{ id: 'jnt:ez', label: 'J&T EZ', price: 21000, etd: null }
];

const settle = async () => {
	for (let i = 0; i < 8; i++) {
		await new Promise((r) => setTimeout(r, 120)); // melewati jeda 350 ms secara bertahap
		await tick();
	}
};

type State = { cost: number; blocker: string };
function mountPicker(over: Partial<Record<string, unknown>> = {}) {
	const st: State = { cost: -1, blocker: '?' };
	const comp = mount(ShippingPicker, {
		target: document.body,
		props: {
			shippingApi: true,
			flatCost: 15000,
			weightGrams: 1300,
			postal: '40115',
			get cost() {
				return st.cost;
			},
			set cost(v: number) {
				st.cost = v;
			},
			get blocker() {
				return st.blocker as 'none';
			},
			set blocker(v) {
				st.blocker = v;
			},
			...over
		}
	});
	return { st, comp };
}
const stub = (quote: unknown, ok = true) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => quote }))
	);

beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('ShippingPicker', () => {
	it('API kurir nonaktif: ongkir flat, tidak memanggil jaringan, tidak menghalangi', async () => {
		const f = vi.fn();
		vi.stubGlobal('fetch', f);
		const { st } = mountPicker({ shippingApi: false });
		await tick();
		expect(st).toEqual({ cost: 15000, blocker: 'none' });
		expect(document.body.textContent).toMatch(/Ongkos kirim flat/);
		expect(f).not.toHaveBeenCalled();
	});

	it('kode pos belum lengkap: petunjuk saja; tidak menahan pengiriman & tidak memanggil API', async () => {
		const f = vi.fn();
		vi.stubGlobal('fetch', f);
		const { st } = mountPicker({ postal: '401' });
		await settle();
		expect(document.body.textContent).toMatch(/Isi kode pos tujuan/);
		expect(st.blocker).toBe('none');
		expect(f).not.toHaveBeenCalled();
	});

	it('tarif kurir: pelanggan wajib memilih; memilih menetapkan ongkir', async () => {
		stub({ source: 'api', options: OPTIONS });
		const { st } = mountPicker();
		await settle();

		const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="shippingOption"]')];
		expect(radios.map((r) => r.value)).toEqual(['jne:reg', 'jnt:ez']);
		expect(document.body.textContent).toContain('Berat pesanan sekitar 1,3 kg');
		expect(st.blocker).toBe('pick'); // belum memilih
		expect(st.cost).toBe(15000); // sementara flat

		radios[1].click();
		await tick();
		await tick();
		expect(st).toEqual({ cost: 21000, blocker: 'none' });
	});

	it('opsi tersimpan dipulihkan (mis. setelah formulir dikembalikan karena galat)', async () => {
		stub({ source: 'api', options: OPTIONS });
		const { st } = mountPicker({ initialOption: 'jne:reg' });
		await settle();
		expect(st).toEqual({ cost: 18000, blocker: 'none' });
		expect(document.querySelector<HTMLInputElement>('input[value="jne:reg"]')!.checked).toBe(true);
	});

	it('server membalas ongkir flat (kurir tak melayani): otomatis dipakai dan ikut terkirim', async () => {
		stub({ source: 'flat', options: [{ id: 'flat', label: 'Standar', price: 12000, etd: null }] });
		const { st } = mountPicker();
		await settle();
		expect(st.blocker).toBe('none');
		expect(document.body.textContent).toMatch(/ongkos kirim standar/);
		expect(
			document.querySelector<HTMLInputElement>('input[type="hidden"][name="shippingOption"]')!.value
		).toBe('flat');
	});

	it('galat jaringan/server: pesan + menahan pengiriman', async () => {
		stub({}, false);
		const { st } = mountPicker();
		await settle();
		expect(document.body.textContent).toMatch(/Tarif kurir gagal dimuat/);
		expect(st.blocker).toBe('failed');
	});

	it('galat dari server ditampilkan', async () => {
		stub({ source: 'api', options: OPTIONS });
		mountPicker({ error: 'Pilih layanan pengiriman' });
		await settle();
		expect(document.body.textContent).toContain('Pilih layanan pengiriman');
	});

	it('berganti kode pos membatalkan permintaan lama (tidak ada data basi)', async () => {
		stub({ source: 'api', options: OPTIONS });
		const { comp } = mountPicker();
		await settle();
		await unmount(comp);
		expect(document.body.querySelector('input[name="shippingOption"]')).toBeNull();
	});
});
