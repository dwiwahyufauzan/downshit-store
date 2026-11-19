const WIB = 'Asia/Jakarta';
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_DAYS = 366;

/** true bila string adalah tanggal kalender nyata (menolak 2026-02-31, 2026-13-01). */
export function isYmd(s: string | null | undefined): s is string {
	const m = YMD.exec(s ?? '');
	if (!m) return false;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const t = new Date(Date.UTC(y, mo - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 00:00:00.000 WIB pada tanggal tsb */
export const wibStart = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
/** 23:59:59.999 WIB pada tanggal tsb */
export const wibEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999+07:00`);

/** 'YYYY-MM-DD' hari ini menurut WIB (tidak bergantung zona waktu server) */
export const todayWib = (now = new Date()) =>
	new Intl.DateTimeFormat('sv-SE', {
		timeZone: WIB,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);

/** 'YYYY-MM-DD HH:mm' menurut WIB — untuk CSV & tabel cetak */
export const wibStamp = (d: Date | string) =>
	new Intl.DateTimeFormat('sv-SE', {
		timeZone: WIB,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(d));

export type Range = { from: Date; to: Date; dari: string; sampai: string; error?: string };

/**
 * Membaca ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD. Default: tanggal 1 bulan ini s/d hari ini (WIB).
 * Input salah TIDAK melempar error: mengembalikan rentang default + `error` (pesan untuk ditampilkan).
 */
export function parseRange(url: URL, now = new Date()): Range {
	const today = todayWib(now);
	const defDari = `${today.slice(0, 8)}01`;
	const build = (dari: string, sampai: string, error?: string): Range => ({
		from: wibStart(dari),
		to: wibEnd(sampai),
		dari,
		sampai,
		...(error ? { error } : {})
	});

	const qd = url.searchParams.get('dari');
	const qs = url.searchParams.get('sampai');
	if (!qd && !qs) return build(defDari, today);

	const dari = qd || defDari;
	const sampai = qs || today;
	if (!isYmd(dari) || !isYmd(sampai))
		return build(defDari, today, 'Format tanggal tidak valid (gunakan YYYY-MM-DD).');
	if (sampai < dari)
		return build(defDari, today, 'Tanggal akhir tidak boleh lebih awal dari tanggal awal.');
	const days =
		(Date.parse(`${sampai}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000 + 1;
	if (days > MAX_DAYS) return build(defDari, today, `Rentang maksimal ${MAX_DAYS} hari.`);
	return build(dari, sampai);
}
