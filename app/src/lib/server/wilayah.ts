/** Data wilayah administratif Indonesia (provinsi → kota/kab → kecamatan → desa/kelurahan), dari berkas statis. */
export type WilayahOption = [code: string, name: string];

type Data = {
	p: WilayahOption[];
	r: Record<string, WilayahOption[]>;
	d: Record<string, WilayahOption[]>;
	v: Record<string, WilayahOption[]>;
};

export const WILAYAH_LEVELS = ['provinsi', 'kota', 'kecamatan', 'desa'] as const;
export type WilayahLevel = (typeof WILAYAH_LEVELS)[number];

// dimuat sekali saat pertama dipakai (±3 MB) dan tidak ikut membebani startup
let cache: Promise<Data> | undefined;
const load = () =>
	(cache ??= import('./data/wilayah.json').then((m) => m.default as unknown as Data));

/**
 * Daftar pilihan satu tingkat: `provinsi` tanpa induk; `kota` per kode provinsi, `kecamatan` per kode kota,
 * `desa` per kode kecamatan. Kode induk tak dikenal → daftar kosong.
 */
export async function listWilayah(level: WilayahLevel, parent = ''): Promise<WilayahOption[]> {
	const data = await load();
	if (level === 'provinsi') return data.p;
	const table = level === 'kota' ? data.r : level === 'kecamatan' ? data.d : data.v;
	return table[parent] ?? [];
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Kode desa/kelurahan (Kemendagri) dari nama pilihan dropdown, atau null bila nama tidak dikenal
 * (alamat ketikan bebas). Kode ini memuat kode kecamatan, kota, dan provinsinya.
 */
export async function resolveVillageCode(a: {
	province: string;
	city: string;
	district: string;
	village: string;
}): Promise<string | null> {
	const data = await load();
	const find = (list: WilayahOption[] | undefined, name: string) =>
		list?.find(([, n]) => norm(n) === norm(name))?.[0];
	const p = find(data.p, a.province);
	const c = p && find(data.r[p], a.city);
	const d = c && find(data.d[c], a.district);
	return (d && find(data.v[d], a.village)) || null;
}
