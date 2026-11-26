import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick } from 'svelte';
import AddressFields from './AddressFields.svelte';

const DATA: Record<string, [string, string][]> = {
	'provinsi|': [
		['32', 'Jawa Barat'],
		['33', 'Jawa Tengah']
	],
	'kota|32': [
		['32.13', 'Kabupaten Subang'],
		['32.73', 'Kota Bandung']
	],
	'kota|33': [['33.74', 'Kota Semarang']],
	'kecamatan|32.13': [
		['32.13.03', 'Subang'],
		['32.13.02', 'Pagaden']
	],
	'desa|32.13.03': [['32.13.03.1005', 'Soklat']]
};

function stubFetch(ok = true) {
	vi.stubGlobal('fetch', async (url: string) => {
		const q = new URL(url, 'http://x').searchParams;
		const key = `${q.get('level')}|${q.get('parent') ?? ''}`;
		const good = ok && key in DATA;
		return { ok: good, status: good ? 200 : 500, json: async () => DATA[key] ?? [] };
	});
}

const settle = async () => {
	for (let i = 0; i < 10; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
};
const sel = (id: string) => document.getElementById(id) as HTMLSelectElement;
const opts = (id: string) => [...sel(id).options].map((o) => o.value);
const choose = async (id: string, value: string) => {
	sel(id).value = value;
	sel(id).dispatchEvent(new Event('change', { bubbles: true }));
	await settle();
};

beforeEach(() => {
	document.body.innerHTML = '';
	stubFetch();
});

describe('AddressFields', () => {
	it('berjenjang: tiap tingkat terisi sesuai pilihan di atasnya dan direset saat induk berganti', async () => {
		mount(AddressFields, { target: document.body, props: {} });
		await settle();
		expect(opts('province')).toEqual(['', 'Jawa Barat', 'Jawa Tengah']);
		expect(sel('city').disabled).toBe(true);

		await choose('province', 'Jawa Barat');
		expect(opts('city')).toEqual(['', 'Kabupaten Subang', 'Kota Bandung']);
		expect(sel('district').disabled).toBe(true);

		await choose('city', 'Kabupaten Subang');
		await choose('district', 'Subang');
		expect(opts('village')).toEqual(['', 'Soklat']);

		await choose('province', 'Jawa Tengah');
		expect(opts('city')).toEqual(['', 'Kota Semarang']);
		expect(sel('city').value).toBe('');
		expect(opts('district')).toEqual(['']);
		expect(sel('village').disabled).toBe(true);
	});

	it('memulihkan pilihan tersimpan di setiap tingkat', async () => {
		mount(AddressFields, {
			target: document.body,
			props: {
				values: {
					province: 'Jawa Barat',
					city: 'Kabupaten Subang',
					district: 'Subang',
					village: 'Soklat',
					addressDetail: 'Jl. A No. 1',
					postalCode: '41211'
				}
			}
		});
		await settle();
		expect(sel('province').value).toBe('Jawa Barat');
		expect(sel('city').value).toBe('Kabupaten Subang');
		expect(sel('district').value).toBe('Subang');
		expect(sel('village').value).toBe('Soklat');
		expect((document.getElementById('addressDetail') as HTMLTextAreaElement).value).toBe(
			'Jl. A No. 1'
		);
		expect((document.getElementById('postalCode') as HTMLInputElement).value).toBe('41211');
	});

	it('nilai lama yang tak cocok dengan data dikosongkan beserta tingkat di bawahnya', async () => {
		mount(AddressFields, {
			target: document.body,
			props: {
				values: { province: 'Jawa Barat', city: 'Subang (lama)', district: 'X', village: 'Y' }
			}
		});
		await settle();
		expect(sel('province').value).toBe('Jawa Barat');
		expect(sel('city').value).toBe('');
		expect(sel('district').disabled).toBe(true);
	});

	it('data wilayah gagal dimuat → isian teks biasa (checkout tetap bisa dipakai)', async () => {
		stubFetch(false);
		mount(AddressFields, { target: document.body, props: { values: { city: 'Subang' } } });
		await settle();
		const city = document.getElementById('city') as HTMLInputElement;
		expect(city.tagName).toBe('INPUT');
		expect(city.value).toBe('Subang');
	});

	it('kode pos: memanggil onpostal tiap berubah; required mengikuti prop', async () => {
		const seen: string[] = [];
		mount(AddressFields, {
			target: document.body,
			props: { onpostal: (p: string) => seen.push(p), required: false }
		});
		await settle();
		const postal = document.getElementById('postalCode') as HTMLInputElement;
		postal.value = '41211';
		postal.dispatchEvent(new Event('input', { bubbles: true }));
		expect(seen).toEqual(['41211']);
		expect(postal.required).toBe(false);
		expect(sel('province').required).toBe(false);
	});

	it('kode pos: atribut pattern utuh [0-9]{5} (regresi: "{5}" di atribut Svelte dibaca sebagai ekspresi)', async () => {
		mount(AddressFields, { target: document.body, props: {} });
		await settle();
		const pattern = (document.getElementById('postalCode') as HTMLInputElement).getAttribute(
			'pattern'
		);
		expect(pattern).toBe('[0-9]{5}');
		const re = new RegExp(`^(?:${pattern})$`);
		expect(re.test('41211')).toBe(true);
		expect(re.test('4121')).toBe(false);
		expect(re.test('412110')).toBe(false);
	});
});
