export const ORDER_STATUS = [
	'menunggu_pembayaran',
	'menunggu_konfirmasi',
	'diproses',
	'dikirim',
	'selesai',
	'dibatalkan'
] as const;

export type OrderStatus = (typeof ORDER_STATUS)[number];

export const STATUS_LABEL: Record<OrderStatus, string> = {
	menunggu_pembayaran: 'Menunggu Pembayaran',
	menunggu_konfirmasi: 'Menunggu Konfirmasi',
	diproses: 'Diproses',
	dikirim: 'Dikirim',
	selesai: 'Selesai',
	dibatalkan: 'Dibatalkan'
};

/** Kelas badge (lihat layout.css) per status pesanan */
export const STATUS_BADGE: Record<OrderStatus, string> = {
	menunggu_pembayaran: 'badge-warn',
	menunggu_konfirmasi: 'badge-info',
	diproses: 'badge-outline',
	dikirim: 'badge-ink',
	selesai: 'badge-ok',
	dibatalkan: 'badge-danger'
};

/** Status pembayaran "efektif" pesanan = baris payments terbaru, atau `belum_bayar` bila belum ada upload (BR-20) */
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
	belum_bayar: 'Belum bayar',
	menunggu: 'Menunggu verifikasi',
	dikonfirmasi: 'Dikonfirmasi',
	ditolak: 'Ditolak',
	dikembalikan: 'Dikembalikan'
};

/** Catatan pembayaran bila pesanan dibatalkan saat bukti transfer belum diverifikasi (dipakai orders.ts dan pesan WhatsApp) */
export const PAYMENT_NOTE_ORDER_CANCELLED = 'Pesanan dibatalkan';

/** Alasan bawaan bila pembeli membatalkan tanpa menulis alasan */
export const CANCEL_REASON_BY_CUSTOMER = 'Dibatalkan oleh pembeli';
/** Alasan yang dicatat job otomatis untuk pesanan yang tidak dibayar sampai batas waktu */
export const CANCEL_REASON_EXPIRED = 'Melewati batas waktu pembayaran';

export const PAYMENT_STATUS_BADGE: Record<string, string> = {
	belum_bayar: 'badge-muted',
	menunggu: 'badge-warn',
	dikonfirmasi: 'badge-ok',
	ditolak: 'badge-danger',
	dikembalikan: 'badge-muted'
};

/** Kurir yang tersedia di form pengiriman admin (SRS-F-014) */
export const COURIERS = [
	'JNE',
	'J&T',
	'SiCepat',
	'Pos Indonesia',
	'AnterAja',
	'Gojek/Grab (Instan)',
	'Lainnya'
] as const;

/** @deprecated pakai STATUS_BADGE */
export const STATUS_COLOR: Record<OrderStatus, string> = {
	menunggu_pembayaran: 'bg-amber-100 text-amber-800 border-amber-300',
	menunggu_konfirmasi: 'bg-blue-100 text-blue-800 border-blue-300',
	diproses: 'bg-indigo-100 text-indigo-800 border-indigo-300',
	dikirim: 'bg-purple-100 text-purple-800 border-purple-300',
	selesai: 'bg-emerald-100 text-emerald-800 border-emerald-300',
	dibatalkan: 'bg-rose-100 text-rose-800 border-rose-300'
};

export const CANCELLABLE: readonly OrderStatus[] = [
	'menunggu_pembayaran',
	'menunggu_konfirmasi'
] as const;

export const PAID_STATUSES: readonly OrderStatus[] = ['diproses', 'dikirim', 'selesai'] as const;

/** Jumlah produk per halaman di katalog (/produk) */
export const CATALOG_PAGE_SIZE = 50;
