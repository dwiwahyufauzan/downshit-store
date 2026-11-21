import {
	CANCEL_REASON_BY_CUSTOMER,
	PAYMENT_NOTE_ORDER_CANCELLED,
	STATUS_LABEL,
	type OrderStatus
} from '#lib/constants';
import { trackingPageFor } from './courier';
import { formatDate, formatRupiah } from './format';

/**
 * Seluruh isi pesan WhatsApp sistem ada di sini (satu tempat) supaya kalimatnya konsisten dan
 * selalu sesuai keadaan pesanan: admin → pelanggan (`messageToCustomer`), pelanggan → toko
 * (`messageToStore`), serta pesan umum. Fungsi murni; tautan dibuat oleh `waLink` (./whatsapp).
 * Sapaan ke pelanggan memakai "Anda" (formal), sama dengan pesan password sementara.
 */

/** Baris barang; paket bundling membawa isinya (`components`), ukuran paket sendiri dikosongkan */
export type WaItem = {
	name: string;
	size: string;
	quantity: number;
	components?: { name: string; size: string; quantity: number }[];
};

export type CancelledBy = 'admin' | 'konsumen' | 'sistem';

/** Nasib dana pelanggan pada pesanan yang dibatalkan */
export type RefundCase = 'dikembalikan' | 'bukti_belum_diverifikasi' | 'tidak_ada';

export type WaOrder = {
	code: string;
	status: OrderStatus;
	total: number;
	expiresAt: string | null;
	recipientName: string;
	shippingAddress: string;
	cancelReason: string | null;
	/** `null` bila tidak diketahui (data lama tanpa log) */
	cancelledBy: CancelledBy | null;
	items: WaItem[];
	/** Pembayaran terbaru; `null` bila belum pernah mengunggah bukti */
	payment: { status: string; note: string | null } | null;
	refund: RefundCase;
	shipment: { courier: string | null; trackingNumber: string | null } | null;
};

export type WaStore = {
	name: string;
	/** Asal situs (mis. https://downshit.id), untuk tautan ke halaman pesanan */
	origin: string;
	bankName: string;
	bankNumber: string;
	bankHolder: string;
	autoCompleteDays: number;
};

/** Menentukan apakah ada dana pelanggan yang harus dikembalikan saat pesanan dibatalkan */
export function refundCase(payments: { status: string; note: string | null }[]): RefundCase {
	if (payments.some((p) => p.status === 'dikembalikan')) return 'dikembalikan';
	// bukti transfer yang belum diperiksa saat pesanan dibatalkan: uang mungkin sudah masuk
	if (payments.some((p) => p.status === 'ditolak' && p.note === PAYMENT_NOTE_ORDER_CANCELLED)) {
		return 'bukti_belum_diverifikasi';
	}
	return 'tidak_ada';
}

/** Alasan pembatalan yang layak ditampilkan; alasan bawaan pembeli tidak menambah informasi */
export function cancelReasonText(reason: string | null | undefined): string | null {
	const r = reason?.trim();
	return r && r !== CANCEL_REASON_BY_CUSTOMER ? r : null;
}

const MAX_ITEM_LINES = 8;

/** Daftar barang: "• Nama (ukuran) ×jumlah"; isi paket bundling di baris bawahnya ("   – Produk (ukuran)") */
export function itemLines(items: WaItem[]): string {
	const lines: string[] = [];
	for (const i of items.slice(0, MAX_ITEM_LINES)) {
		const size = i.size.trim();
		lines.push(`• ${i.name}${size ? ` (${size})` : ''} ×${i.quantity}`);
		for (const c of i.components ?? []) {
			const cs = c.size.trim();
			lines.push(`   – ${c.name}${cs ? ` (${cs})` : ''}${c.quantity > 1 ? ` ×${c.quantity}` : ''}`);
		}
	}
	if (items.length > MAX_ITEM_LINES)
		lines.push(`• dan ${items.length - MAX_ITEM_LINES} item lainnya`);
	return lines.join('\n');
}

const orderLink = (s: WaStore, code: string) => `${s.origin}/pesanan/${encodeURIComponent(code)}`;
const deadline = (iso: string | null) => (iso ? `${formatDate(iso)} WIB` : null);
const join = (parts: (string | null | false | undefined)[]) =>
	parts.filter((p) => p !== null && p !== false && p !== undefined).join('\n');

function refundParagraph(o: WaOrder, who: 'kami' | 'anda'): string {
	if (o.refund === 'dikembalikan') {
		return `Pembayaran ${formatRupiah(o.total)} yang sudah ${who === 'kami' ? 'kami terima' : 'Anda transfer'} akan dikembalikan. Mohon balas pesan ini dengan nama bank, nomor rekening, dan nama pemilik rekening tujuan.`;
	}
	if (o.refund === 'bukti_belum_diverifikasi') {
		return 'Bukti transfer Anda belum sempat kami verifikasi. Jika Anda sudah mentransfer, mohon balas pesan ini beserta bukti transfer, nama bank, nomor rekening, dan nama pemilik rekening tujuan agar dana dapat kami kembalikan.';
	}
	return 'Belum ada pembayaran yang kami terima untuk pesanan ini, jadi tidak ada dana yang perlu dikembalikan.';
}

/* ---------- Admin → pelanggan ---------- */

/**
 * Pesan yang disiapkan admin untuk pelanggan sesuai status pesanan saat ini.
 * `topic` = keterangan singkat isi pesan, ditampilkan pada tombol agar admin tahu apa yang akan terkirim.
 */
export function messageToCustomer(o: WaOrder, s: WaStore): { topic: string; text: string } {
	const hi = `Halo ${o.recipientName}, kami dari ${s.name}.`;
	const code = `*${o.code}*`;
	const bank = `${s.bankName} ${s.bankNumber} a.n. ${s.bankHolder}`;

	switch (o.status) {
		case 'menunggu_pembayaran': {
			if (o.payment?.status === 'ditolak') {
				return {
					topic: 'Bukti transfer ditolak',
					text: join([
						hi,
						'',
						`Bukti transfer untuk pesanan ${code} belum dapat kami terima.`,
						o.payment.note ? `Alasan: ${o.payment.note}` : null,
						'',
						`Mohon unggah ulang bukti transfer yang benar${o.expiresAt ? ` sebelum ${deadline(o.expiresAt)}` : ''}:`,
						orderLink(s, o.code),
						'',
						`Total yang harus dibayar: ${formatRupiah(o.total)}`,
						`Transfer ke ${bank}.`
					])
				};
			}
			return {
				topic: 'Ingatkan pembayaran',
				text: join([
					hi,
					'',
					`Pesanan ${code} masih menunggu pembayaran:`,
					itemLines(o.items),
					`Total: ${formatRupiah(o.total)}`,
					'',
					`Silakan transfer ke ${bank}, lalu unggah bukti transfer di:`,
					orderLink(s, o.code),
					o.expiresAt
						? `Batas pembayaran: ${deadline(o.expiresAt)}. Lewat dari itu pesanan dibatalkan otomatis.`
						: null
				])
			};
		}

		case 'menunggu_konfirmasi':
			return {
				topic: 'Bukti transfer diterima',
				text: join([
					hi,
					'',
					`Bukti transfer pesanan ${code} (${formatRupiah(o.total)}) sudah kami terima dan sedang kami periksa.`,
					'Kami kabari lagi setelah pembayaran terkonfirmasi.'
				])
			};

		case 'diproses':
			return {
				topic: 'Pembayaran terkonfirmasi',
				text: join([
					hi,
					'',
					`Pembayaran pesanan ${code} sudah kami konfirmasi. Terima kasih!`,
					'Pesanan sedang kami siapkan dan akan dikirim ke:',
					o.recipientName,
					o.shippingAddress,
					'',
					'Nomor resi kami kabari setelah pesanan dikirim.'
				])
			};

		case 'dikirim': {
			const courier = o.shipment?.courier;
			const resi = o.shipment?.trackingNumber;
			const page = trackingPageFor(courier);
			return {
				topic: 'Info pengiriman & resi',
				text: join([
					hi,
					'',
					`Pesanan ${code} sudah kami kirim.`,
					courier ? `Kurir: ${courier}` : null,
					resi ? `No. resi: ${resi}` : null,
					page ? `Lacak di ${page} (tempel nomor resi).` : null,
					'',
					`Setelah paket sampai, mohon tekan "Pesanan sudah diterima" di ${orderLink(s, o.code)}. Tanpa konfirmasi, pesanan selesai otomatis ${s.autoCompleteDays} hari setelah dikirim.`
				])
			};
		}

		case 'selesai':
			return {
				topic: 'Terima kasih & ajak ulasan',
				text: join([
					hi,
					'',
					`Pesanan ${code} sudah selesai. Terima kasih sudah berbelanja di ${s.name}!`,
					`Kami senang bila Anda menulis ulasan produk di ${orderLink(s, o.code)}`
				])
			};

		case 'dibatalkan': {
			const opening =
				o.cancelledBy === 'sistem'
					? `Pesanan ${code} kami batalkan otomatis karena melewati batas waktu pembayaran.`
					: o.cancelledBy === 'konsumen'
						? `Kami sudah memproses pembatalan pesanan ${code} sesuai permintaan Anda.`
						: `Mohon maaf, pesanan ${code} terpaksa kami batalkan.`;
			const why = o.cancelledBy === 'sistem' ? null : cancelReasonText(o.cancelReason);
			const reason = why ? `Alasan: ${why}` : null;
			return {
				topic: 'Kabari pembatalan',
				text: join([
					hi,
					'',
					opening,
					reason,
					'',
					refundParagraph(o, 'kami'),
					'',
					`Bila masih ingin berbelanja, silakan buat pesanan baru di ${s.origin}/produk. Mohon maaf atas ketidaknyamanannya.`
				])
			};
		}
	}
}

/* ---------- Pelanggan → toko ---------- */

/** Pesan awal dari pelanggan ke toko, memuat identitas pesanan dan keperluan sesuai statusnya. */
export function messageToStore(o: WaOrder, s: WaStore, customerName: string): string {
	const resi = o.shipment?.trackingNumber;
	const courier = o.shipment?.courier;

	let ask: string;
	switch (o.status) {
		case 'menunggu_pembayaran':
			ask =
				o.payment?.status === 'ditolak'
					? `Bukti transfer saya ditolak${o.payment.note ? ` (alasan: ${o.payment.note})` : ''}. Mohon bantuannya.`
					: 'Saya ingin bertanya soal pembayaran pesanan ini.';
			break;
		case 'menunggu_konfirmasi':
			ask = 'Saya sudah mengunggah bukti transfer. Mohon dibantu cek verifikasi pembayarannya.';
			break;
		case 'diproses':
			ask = 'Pembayaran sudah dikonfirmasi. Saya ingin menanyakan kapan pesanan dikirim.';
			break;
		case 'dikirim':
			ask = `Pesanan tercatat dikirim${courier ? ` via ${courier}` : ''}${resi ? ` (resi ${resi})` : ''}. Saya ingin menanyakan status pengirimannya.`;
			break;
		case 'selesai':
			ask =
				'Pesanan ini sudah selesai, tetapi saya ingin menyampaikan sesuatu terkait pesanan ini.';
			break;
		case 'dibatalkan':
			ask = `Pesanan ini dibatalkan${cancelReasonText(o.cancelReason) ? ` (alasan: ${cancelReasonText(o.cancelReason)})` : ''}. Saya ingin menanyakan hal ini${o.refund === 'tidak_ada' ? '.' : ' dan proses pengembalian dana saya.'}`;
			break;
	}

	return join([
		`Halo ${s.name}, saya ${customerName}.`,
		'',
		`Pesanan: *${o.code}*`,
		`Status: ${STATUS_LABEL[o.status]}`,
		itemLines(o.items),
		`Total: ${formatRupiah(o.total)}`,
		'',
		ask
	]);
}

/* ---------- Pesan umum & akun ---------- */

/** Pertanyaan umum dari pelanggan (footer, tombol mengambang, kontak) */
export const storeInquiryMessage = (storeName: string) =>
	`Halo ${storeName}, saya ingin bertanya seputar produk dan ketersediaan stok.`;

/** Lupa password: admin perlu tahu akun mana yang direset, jadi email diminta/dicantumkan */
export const forgotPasswordMessage = (storeName: string, email?: string | null) =>
	join([
		`Halo ${storeName}, saya lupa password akun saya dan ingin meminta reset password.`,
		`Email akun saya: ${email?.trim() || '(tulis email akun Anda di sini)'}`
	]);

/** Permintaan koreksi/penonaktifan data akun (halaman Kebijakan Privasi) */
export const dataRequestMessage = (storeName: string) =>
	`Halo ${storeName}, saya ingin bertanya atau meminta koreksi/penonaktifan data akun saya.`;

/** Admin → pelanggan setelah reset password: berisi password sementara dan cara masuk */
export function tempPasswordMessage(a: {
	name: string;
	email: string;
	password: string;
	storeName: string;
	loginUrl: string;
}) {
	return join([
		`Halo ${a.name}, kami dari ${a.storeName}.`,
		'',
		'Sesuai permintaan Anda, password akun Anda sudah kami reset.',
		`Email: ${a.email}`,
		`Password sementara: ${a.password}`,
		'',
		`Silakan masuk di ${a.loginUrl}. Anda akan diminta mengganti password saat masuk; semua sesi lama Anda sudah berakhir.`,
		'Demi keamanan, jangan bagikan password ini kepada siapa pun.'
	]);
}
