/** Nomor WhatsApp → format internasional tanpa tanda baca (08xxx / +62xxx / 62xxx → 62xxx). Kosong bila tidak valid. */
export function waDigits(raw: string | null | undefined): string {
	const d = (raw ?? '').replace(/\D/g, '');
	const intl = d.startsWith('0') ? '62' + d.slice(1) : d;
	// nomor Indonesia: 62 + 8–13 digit; di luar itu kemungkinan salah ketik
	return /^62\d{8,13}$/.test(intl) ? intl : '';
}

/** Tautan wa.me dengan pesan awal. Mengembalikan null bila nomor tidak valid. */
export function waLink(raw: string | null | undefined, text?: string): string | null {
	const n = waDigits(raw);
	if (!n) return null;
	return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
