import { z } from 'zod';

const nf = new Intl.NumberFormat('id-ID');
const fmt = (n: number) => nf.format(n);

/**
 * Bilangan bulat dari input form (string). Kosong → "wajib diisi" (bukan diam-diam 0 seperti z.coerce),
 * bukan angka → pesan Indonesia, di luar batas → pesan batas yang jelas.
 */
export const intField = (
	label: string,
	o: { min?: number; max?: number; minMsg?: string; maxMsg?: string } = {}
) => {
	const min = o.min ?? 0;
	const max = o.max ?? Number.MAX_SAFE_INTEGER;
	return z.preprocess(
		(v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : Number(v)) : v),
		z
			.number({
				error: (iss) =>
					iss.input === undefined || iss.input === null
						? `${label} wajib diisi`
						: `${label} harus berupa angka`
			})
			.int(`${label} harus berupa bilangan bulat`)
			.min(min, o.minMsg ?? `${label} minimal ${fmt(min)}`)
			.max(max, o.maxMsg ?? `${label} maksimal ${fmt(max)}`)
	);
};

/** Teks wajib dengan panjang min–max (sudah di-trim). */
export const textField = (label: string, min: number, max: number, minMsg?: string) =>
	z
		.string({ error: `${label} wajib diisi` })
		.trim()
		.min(min, minMsg ?? (min <= 1 ? `${label} wajib diisi` : `${label} minimal ${min} karakter`))
		.max(max, `${label} maksimal ${fmt(max)} karakter`);

/** Teks opsional (boleh kosong/undefined) dengan batas panjang. */
export const optionalText = (label: string, max: number) =>
	z
		.string()
		.trim()
		.max(max, `${label} maksimal ${fmt(max)} karakter`)
		.optional();
