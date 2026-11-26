import { error, json } from '@sveltejs/kit';
import { listWilayah, WILAYAH_LEVELS, type WilayahLevel } from '#lib/server/wilayah';
import type { RequestHandler } from './$types';

/**
 * Pilihan wilayah untuk dropdown alamat bertingkat:
 *   /api/wilayah?level=provinsi
 *   /api/wilayah?level=kota&parent=32        (kode provinsi)
 *   /api/wilayah?level=kecamatan&parent=32.13 (kode kota/kabupaten)
 *   /api/wilayah?level=desa&parent=32.13.01  (kode kecamatan)
 * Balasan: [[kode, nama], ...]. Data referensi publik dan statis, jadi boleh di-cache lama.
 */
export const GET: RequestHandler = async ({ url }) => {
	const level = url.searchParams.get('level') as WilayahLevel | null;
	if (!level || !WILAYAH_LEVELS.includes(level)) throw error(400, 'level tidak valid');

	const parent = url.searchParams.get('parent') ?? '';
	if (level !== 'provinsi' && !/^\d{2}(\.\d{2}){0,2}$/.test(parent)) {
		throw error(400, 'parent tidak valid');
	}

	return json(await listWilayah(level, parent), {
		headers: { 'cache-control': 'public, max-age=86400' }
	});
};
