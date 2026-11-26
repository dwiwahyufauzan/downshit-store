import { describe, expect, it } from 'vitest';
import { GET } from '../../routes/api/wilayah/+server';
import { listWilayah } from './wilayah';

const call = (qs: string) =>
	GET({ url: new URL(`http://x/api/wilayah?${qs}`) } as never) as Promise<Response>;
const status = async (qs: string) => {
	try {
		return (await call(qs)).status;
	} catch (e) {
		return (e as { status: number }).status;
	}
};

describe('data wilayah', () => {
	it('berjenjang dari provinsi sampai desa/kelurahan', async () => {
		const provinces = await listWilayah('provinsi');
		const jabar = provinces.find(([, n]) => n === 'Jawa Barat')!;
		expect(provinces).toHaveLength(38);

		const cities = await listWilayah('kota', jabar[0]);
		const subang = cities.find(([, n]) => n === 'Kabupaten Subang')!;
		expect(subang).toBeDefined();

		const districts = await listWilayah('kecamatan', subang[0]);
		expect(districts.map(([, n]) => n)).toContain('Subang');

		const village = await listWilayah('desa', districts.find(([, n]) => n === 'Subang')![0]);
		expect(village.length).toBeGreaterThan(0);
	});

	it('hanya mengembalikan anak dari induk yang dipilih; induk tak dikenal → kosong', async () => {
		const jabar = (await listWilayah('provinsi')).find(([, n]) => n === 'Jawa Barat')![0];
		const cities = await listWilayah('kota', jabar);
		expect(cities.every(([code]) => code.startsWith(`${jabar}.`))).toBe(true);
		expect(await listWilayah('kota', '99')).toEqual([]);
	});

	it('endpoint: daftar ber-cache, parameter tak valid ditolak 400', async () => {
		const res = await call('level=provinsi');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toContain('max-age');
		expect(((await res.json()) as unknown[]).length).toBe(38);

		expect(await status('level=negara')).toBe(400);
		expect(await status('level=kota')).toBe(400); // induk wajib
		expect(await status('level=kota&parent=../../etc')).toBe(400);
	});
});
