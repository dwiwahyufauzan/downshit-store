/** Teks tampilan voucher untuk banner beranda (murni; dipakai server & komponen). */
import { formatRupiah } from './format';

export type PromoVoucher = {
	code: string;
	description: string | null;
	type: 'percent' | 'fixed';
	value: number;
	minSubtotal: number;
	maxDiscount: number | null;
	endsAt: string | null;
	/** Sisa kuota (null = tanpa batas) */
	remaining: number | null;
};

/** "Diskon 10%" / "Potongan Rp 25.000" */
export const promoHeadline = (v: Pick<PromoVoucher, 'type' | 'value'>) =>
	v.type === 'percent' ? `Diskon ${v.value}%` : `Potongan ${formatRupiah(v.value)}`;

/** "Min. belanja Rp 100.000 · maks. potongan Rp 30.000" (kosong bila tanpa syarat) */
export function promoCondition(v: Pick<PromoVoucher, 'type' | 'minSubtotal' | 'maxDiscount'>) {
	const parts = [
		v.minSubtotal > 0 ? `Min. belanja ${formatRupiah(v.minSubtotal)}` : 'Tanpa minimal belanja'
	];
	if (v.type === 'percent' && v.maxDiscount)
		parts.push(`maks. potongan ${formatRupiah(v.maxDiscount)}`);
	return parts.join(' · ');
}

const DAY = 86_400_000;

/**
 * Keterangan masa berlaku. Berakhir pada akhir hari WIB `endsAt`:
 * "Berakhir hari ini" / "Sisa 3 hari" / "Sampai 31 Des 2026" (> 14 hari) / "Tanpa batas waktu".
 */
export function promoExpiry(endsAt: string | null, now = new Date()): string {
	if (!endsAt) return 'Tanpa batas waktu';
	const left = Date.parse(endsAt) - now.getTime();
	if (left <= 0) return 'Sudah berakhir';
	const days = Math.ceil(left / DAY);
	if (days <= 1) return 'Berakhir hari ini';
	if (days <= 14) return `Sisa ${days} hari`;
	const date = new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'Asia/Jakarta'
	}).format(new Date(endsAt));
	return `Sampai ${date}`;
}

/** Peringatan kuota hanya saat tinggal sedikit agar banner tidak ramai. */
export const promoScarcity = (remaining: number | null) =>
	remaining !== null && remaining > 0 && remaining <= 20 ? `Sisa ${remaining} kuota` : null;
