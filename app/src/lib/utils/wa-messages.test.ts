import { describe, expect, it } from 'vitest';
import {
	cancelReasonText,
	dataRequestMessage,
	forgotPasswordMessage,
	itemLines,
	messageToCustomer,
	messageToStore,
	refundCase,
	storeInquiryMessage,
	tempPasswordMessage,
	type WaOrder,
	type WaStore
} from './wa-messages';

const store: WaStore = {
	name: 'Downshit Store',
	origin: 'https://downshit.id',
	bankName: 'BCA',
	bankNumber: '1234567890',
	bankHolder: 'Store Downshit',
	autoCompleteDays: 7
};

const order = (over: Partial<WaOrder> = {}): WaOrder => ({
	code: 'DWN-261119-ABCD',
	status: 'menunggu_pembayaran',
	total: 115_000,
	expiresAt: '2026-11-20T08:00:00.000Z',
	recipientName: 'Budi',
	shippingAddress: 'Jl. Contoh No. 1 Subang',
	cancelReason: null,
	cancelledBy: null,
	items: [{ name: 'Kaos Classic', size: 'L', quantity: 2 }],
	payment: null,
	refund: 'tidak_ada',
	shipment: null,
	...over
});

describe('refundCase', () => {
	it('pembayaran dikonfirmasi lalu dibatalkan → dikembalikan', () => {
		expect(refundCase([{ status: 'dikembalikan', note: 'Pesanan dibatalkan: x' }])).toBe(
			'dikembalikan'
		);
	});
	it('bukti belum diperiksa saat dibatalkan → bukti_belum_diverifikasi', () => {
		expect(refundCase([{ status: 'ditolak', note: 'Pesanan dibatalkan' }])).toBe(
			'bukti_belum_diverifikasi'
		);
	});
	it('bukti yang ditolak admin (alasan lain) atau tanpa pembayaran → tidak_ada', () => {
		expect(refundCase([{ status: 'ditolak', note: 'Buram' }])).toBe('tidak_ada');
		expect(refundCase([])).toBe('tidak_ada');
	});
	it('refund menang atas bukti yang belum diverifikasi', () => {
		expect(
			refundCase([
				{ status: 'ditolak', note: 'Pesanan dibatalkan' },
				{ status: 'dikembalikan', note: null }
			])
		).toBe('dikembalikan');
	});
});

describe('itemLines', () => {
	it('satu baris per barang dengan ukuran dan jumlah; ukuran kosong tidak menyisakan tanda kurung', () => {
		expect(
			itemLines([
				{ name: 'Kaos', size: 'L', quantity: 2 },
				{ name: 'Topi', size: '', quantity: 1 }
			])
		).toBe('• Kaos (L) ×2\n• Topi ×1');
	});
	it('paket bundling: isi paket di bawah barisnya, ukuran paket tidak ditampilkan', () => {
		expect(
			itemLines([
				{
					name: 'Paket Rebahan',
					size: '',
					quantity: 1,
					components: [
						{ name: 'Hoodie', size: 'L', quantity: 1 },
						{ name: 'Kaos Kaki', size: '', quantity: 2 }
					]
				}
			])
		).toBe('• Paket Rebahan ×1\n   – Hoodie (L)\n   – Kaos Kaki ×2');
	});
	it('daftar panjang dipotong dan menyebut sisanya', () => {
		const items = Array.from({ length: 11 }, (_, i) => ({ name: `P${i}`, size: '', quantity: 1 }));
		const lines = itemLines(items).split('\n');
		expect(lines).toHaveLength(9);
		expect(lines.at(-1)).toBe('• dan 3 item lainnya');
	});
});

describe('cancelReasonText', () => {
	it('alasan bawaan pembeli / kosong tidak ditampilkan', () => {
		expect(cancelReasonText('Dibatalkan oleh pembeli')).toBeNull();
		expect(cancelReasonText('  ')).toBeNull();
		expect(cancelReasonText(null)).toBeNull();
		expect(cancelReasonText(' Salah ukuran ')).toBe('Salah ukuran');
	});
});

describe('messageToCustomer', () => {
	it('tagihan memuat total, rekening, tautan pesanan, dan batas bayar; tanpa batas bayar baris itu hilang', () => {
		const m = messageToCustomer(order(), store);
		expect(m.topic).toBe('Ingatkan pembayaran');
		expect(m.text).toContain('Halo Budi, kami dari Downshit Store.');
		expect(m.text).toContain('• Kaos Classic (L) ×2');
		expect(m.text).toContain('BCA 1234567890 a.n. Store Downshit');
		expect(m.text).toContain('https://downshit.id/pesanan/DWN-261119-ABCD');
		expect(m.text).toContain('Batas pembayaran:');
		expect(messageToCustomer(order({ expiresAt: null }), store).text).not.toContain(
			'Batas pembayaran'
		);
	});

	it('bukti ditolak: alasan dicantumkan hanya bila ada', () => {
		const withNote = messageToCustomer(
			order({ payment: { status: 'ditolak', note: 'Nominal kurang' } }),
			store
		).text;
		expect(withNote).toContain('Alasan: Nominal kurang');
		const noNote = messageToCustomer(
			order({ payment: { status: 'ditolak', note: null } }),
			store
		).text;
		expect(noNote).not.toContain('Alasan:');
		expect(noNote).toContain('belum dapat kami terima');
	});

	it('dikirim: tanpa data kurir/resi tetap kalimat utuh (tidak ada "undefined"/"null")', () => {
		const m = messageToCustomer(order({ status: 'dikirim', shipment: null }), store);
		expect(m.text).toContain('sudah kami kirim');
		expect(m.text).not.toMatch(/undefined|null|Kurir:|No\. resi:/);
		expect(m.text).toContain('7 hari');
	});

	it('dikirim via kurir tanpa halaman lacak (instan) → tanpa baris "Lacak di"', () => {
		const m = messageToCustomer(
			order({
				status: 'dikirim',
				shipment: { courier: 'Gojek/Grab (Instan)', trackingNumber: 'ABC' }
			}),
			store
		);
		expect(m.text).toContain('Kurir: Gojek/Grab (Instan)');
		expect(m.text).not.toContain('Lacak di');
	});

	it('dibatalkan menurut pelaku & nasib dana', () => {
		const cancelled = (over: Partial<WaOrder>) =>
			messageToCustomer(order({ status: 'dibatalkan', ...over }), store).text;

		const admin = cancelled({ cancelledBy: 'admin', cancelReason: 'Stok rusak' });
		expect(admin).toContain('terpaksa kami batalkan');
		expect(admin).toContain('Alasan: Stok rusak');

		const buyer = cancelled({ cancelledBy: 'konsumen', cancelReason: 'Dibatalkan oleh pembeli' });
		expect(buyer).toContain('sesuai permintaan Anda');
		expect(buyer).not.toContain('Alasan:');

		const sys = cancelled({
			cancelledBy: 'sistem',
			cancelReason: 'Melewati batas waktu pembayaran'
		});
		expect(sys).toContain('kami batalkan otomatis');
		expect(sys).not.toContain('Alasan:');

		expect(cancelled({ cancelledBy: null })).toContain('terpaksa kami batalkan'); // data lama tanpa log
		expect(cancelled({ refund: 'dikembalikan' })).toContain('akan dikembalikan');
		expect(cancelled({ refund: 'bukti_belum_diverifikasi' })).toContain(
			'belum sempat kami verifikasi'
		);
		expect(cancelled({ refund: 'tidak_ada' })).toContain('tidak ada dana yang perlu dikembalikan');
	});

	it('kode pesanan di tautan di-encode', () => {
		expect(messageToCustomer(order({ code: 'A B/C' }), store).text).toContain('/pesanan/A%20B%2FC');
	});

	it('setiap status menghasilkan pesan tanpa titik-titik menggantung', () => {
		for (const status of [
			'menunggu_pembayaran',
			'menunggu_konfirmasi',
			'diproses',
			'dikirim',
			'selesai',
			'dibatalkan'
		] as const) {
			const m = messageToCustomer(order({ status }), store);
			expect(m.topic.length).toBeGreaterThan(3);
			expect(m.text).toContain('*DWN-261119-ABCD*');
			expect(m.text).not.toContain('...');
		}
	});
});

describe('messageToStore', () => {
	it('memuat identitas pesanan dan keperluan sesuai status', () => {
		const t = messageToStore(order({ status: 'menunggu_konfirmasi' }), store, 'Budi Santoso');
		expect(t).toContain('Halo Downshit Store, saya Budi Santoso.');
		expect(t).toContain('Pesanan: *DWN-261119-ABCD*');
		expect(t).toContain('Status: Menunggu Konfirmasi');
		expect(t).toContain('cek verifikasi pembayarannya');
	});

	it('bukti ditolak membawa alasan; dibatalkan dengan dana menanyakan pengembalian', () => {
		expect(
			messageToStore(order({ payment: { status: 'ditolak', note: 'Buram' } }), store, 'B')
		).toContain('ditolak (alasan: Buram)');
		const c = messageToStore(
			order({ status: 'dibatalkan', cancelReason: 'Habis', refund: 'dikembalikan' }),
			store,
			'B'
		);
		expect(c).toContain('(alasan: Habis)');
		expect(c).toContain('pengembalian dana');
		const noRefund = messageToStore(order({ status: 'dibatalkan' }), store, 'B');
		expect(noRefund).not.toContain('pengembalian dana');
	});
});

describe('pesan umum & akun', () => {
	it('pertanyaan umum memakai nama toko', () => {
		expect(storeInquiryMessage('Downshit Store')).toBe(
			'Halo Downshit Store, saya ingin bertanya seputar produk dan ketersediaan stok.'
		);
		expect(dataRequestMessage('X')).toContain('koreksi/penonaktifan data akun');
	});

	it('lupa password mencantumkan email, atau petunjuk mengisinya bila belum diketik', () => {
		expect(forgotPasswordMessage('X', ' a@b.id ')).toContain('Email akun saya: a@b.id');
		expect(forgotPasswordMessage('X')).toContain('(tulis email akun Anda di sini)');
		expect(forgotPasswordMessage('X', '   ')).toContain('(tulis email akun Anda di sini)');
	});

	it('password sementara memuat email, password, tautan masuk, dan peringatan keamanan', () => {
		const t = tempPasswordMessage({
			name: 'Budi',
			email: 'budi@x.id',
			password: 'Abc123xyz',
			storeName: 'Downshit Store',
			loginUrl: 'https://downshit.id/login'
		});
		expect(t).toContain('Halo Budi, kami dari Downshit Store.');
		expect(t).toContain('Email: budi@x.id');
		expect(t).toContain('Password sementara: Abc123xyz');
		expect(t).toContain('https://downshit.id/login');
		expect(t).toContain('jangan bagikan');
	});
});
