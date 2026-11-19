export const rupiah = (n: number | string | null | undefined): string => {
	const num = Number(n ?? 0);
	return new Intl.NumberFormat('id-ID', {
		style: 'currency',
		currency: 'IDR',
		maximumFractionDigits: 0
	}).format(num);
};

export const tanggal = (d: Date | string | null | undefined): string => {
	if (!d) return '-';
	const date = typeof d === 'string' ? new Date(d) : d;
	if (!(date instanceof Date) || isNaN(date.getTime())) return '-';
	return new Intl.DateTimeFormat('id-ID', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Asia/Jakarta'
	}).format(date);
};

export const formatRupiah = rupiah;
export const formatDate = tanggal;
