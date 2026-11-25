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

/**
 * Metode pembayaran yang dipilih pelanggan. `transfer_bank` = manual (unggah bukti, admin memverifikasi);
 * empat lainnya = pembayaran online lewat Midtrans (terkonfirmasi otomatis lewat notifikasi).
 * `channels` = nilai `enabled_payments` Snap yang ditampilkan untuk grup tersebut.
 */
export const PAYMENT_METHODS = {
	transfer_bank: {
		label: 'Transfer bank (manual)',
		hint: 'Transfer ke rekening toko, lalu unggah bukti. Diverifikasi admin.',
		channels: []
	},
	ewallet: {
		label: 'E-wallet',
		hint: 'GoPay, OVO, DANA, ShopeePay. Otomatis terkonfirmasi.',
		channels: ['gopay', 'ovo', 'dana', 'shopeepay']
	},
	qris: {
		label: 'QRIS',
		hint: 'Scan dengan aplikasi bank atau e-wallet apa pun. Otomatis terkonfirmasi.',
		channels: ['other_qris']
	},
	va: {
		label: 'Virtual Account',
		hint: 'BCA, BNI, BRI, Permata, CIMB, Mandiri. Otomatis terkonfirmasi.',
		channels: ['bca_va', 'bni_va', 'bri_va', 'permata_va', 'cimb_va', 'echannel']
	},
	minimarket: {
		label: 'Minimarket',
		hint: 'Bayar tunai di Indomaret atau Alfamart. Otomatis terkonfirmasi.',
		channels: ['indomaret', 'alfamart']
	}
} as const;

export type PaymentMethod = keyof typeof PAYMENT_METHODS;
export const PAYMENT_METHOD_KEYS = Object.keys(PAYMENT_METHODS) as PaymentMethod[];
export type GatewayMethod = Exclude<PaymentMethod, 'transfer_bank'>;
export const GATEWAY_METHOD_KEYS = PAYMENT_METHOD_KEYS.filter(
	(k): k is GatewayMethod => k !== 'transfer_bank'
);

export const isGatewayMethod = (m: string): m is GatewayMethod =>
	(GATEWAY_METHOD_KEYS as string[]).includes(m);

/** Nama metode untuk tampilan; nilai tak dikenal ditampilkan apa adanya */
export const paymentMethodLabel = (m: string): string =>
	(PAYMENT_METHODS as Record<string, { label: string }>)[m]?.label ?? m;

/** Catatan pembayaran online yang dicatat otomatis (tampil di riwayat pembayaran) */
export const PAYMENT_NOTE_GATEWAY_REPLACED = 'Diganti dengan metode pembayaran lain';
export const PAYMENT_NOTE_GATEWAY_EXPIRED = 'Waktu pembayaran online habis';
export const PAYMENT_NOTE_GATEWAY_FAILED = 'Pembayaran online gagal atau dibatalkan';
export const PAYMENT_NOTE_PARTIAL_REFUND =
	'Refund/chargeback SEBAGIAN di Midtrans: tinjau pesanan ini secara manual';
export const PAYMENT_NOTE_LATE_REFUND =
	'Dibayar setelah pesanan dibatalkan. Dana perlu dikembalikan manual lewat dashboard Midtrans';
export const PAYMENT_NOTE_DOUBLE_REFUND =
	'Pembayaran ganda. Dana perlu dikembalikan manual lewat dashboard Midtrans';

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

/** Nama saluran pembayaran online (kunci dari `channelOf` di midtrans.ts) untuk tampilan */
export const GATEWAY_TYPE_LABEL: Record<string, string> = {
	gopay: 'GoPay',
	shopeepay: 'ShopeePay',
	dana: 'DANA',
	ovo: 'OVO',
	qris: 'QRIS',
	other_qris: 'QRIS',
	bca_va: 'BCA Virtual Account',
	bni_va: 'BNI Virtual Account',
	bri_va: 'BRI Virtual Account',
	permata_va: 'Permata Virtual Account',
	cimb_va: 'CIMB Niaga Virtual Account',
	echannel: 'Mandiri Bill Payment',
	indomaret: 'Indomaret',
	alfamart: 'Alfamart'
};
