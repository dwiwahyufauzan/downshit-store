/**
 * Pesan WhatsApp admin → pelanggan dan pelanggan → toko harus sesuai status pesanan:
 * dibaca dari tautan yang dihasilkan loader halaman asli (bukan dari fungsi templat saja).
 */
import { describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-orders-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file, uploads: `./tests/.tmp-uploads-orders-${rand}` };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: env.uploads,
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { db } from './db';
import { orders, users } from './db/schema';
import { eq } from 'drizzle-orm';
import { cancelOrder, createOrderFromCart, expireUnpaidOrders } from './orders';
import {
	completeOrder,
	confirmPayment,
	rejectPayment,
	shipOrder,
	submitPaymentProof
} from './order-flow';
import * as adminDetail from '../../routes/admin/pesanan/[kode]/+page.server';
import * as customerDetail from '../../routes/pesanan/[kode]/+page.server';
import {
	SHIP,
	U,
	adminId,
	bundleId,
	buyerId,
	cartAdd,
	expireNow,
	newOrder,
	topiId,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

type Loaded = { waUrl: string | null; waTopic?: string };

const adminWa = async (code: string) => {
	const d = (await adminDetail.load({
		params: { kode: code },
		locals: U(adminId, 'admin'),
		url: new URL(`http://x/admin/pesanan/${code}`)
	} as never)) as Loaded;
	return { ...d, text: textOf(d.waUrl) };
};

const customerWa = async (code: string) => {
	const d = (await customerDetail.load({
		params: { kode: code },
		locals: {
			user: {
				id: buyerId,
				role: 'konsumen',
				name: 'Budi Santoso',
				email: 'b@x.id',
				mustChangePassword: false
			},
			sessionId: 's'
		},
		url: new URL(`http://x/pesanan/${code}`)
	} as never)) as Loaded & { cancelledBy: string | null; refund: string };
	return { ...d, text: textOf(d.waUrl) };
};

/** Isi pesan hasil decode dari tautan wa.me (yang dilihat pengguna saat WhatsApp terbuka) */
function textOf(url: string | null) {
	if (!url) return '';
	return new URL(url).searchParams.get('text') ?? '';
}

const proof = (code: string) => submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');

describe('WhatsApp admin → pelanggan menyesuaikan status pesanan', () => {
	it('menunggu pembayaran: tagihan lengkap (barang, total, rekening, tautan, batas bayar)', async () => {
		const o = await newOrder();
		const d = await adminWa(o.code);
		expect(d.waUrl).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/);
		expect(d.waTopic).toBe('Ingatkan pembayaran');
		expect(d.text).toContain('Halo Budi Santoso');
		expect(d.text).toContain(`*${o.code}*`);
		expect(d.text).toContain('masih menunggu pembayaran');
		expect(d.text).toContain('Kaos Classic - L');
		expect(d.text).toMatch(/Total: Rp\s?115\.000/);
		expect(d.text).toContain('BCA 1234567890 a.n. Store Downshit');
		expect(d.text).toContain(`http://localhost:5173/pesanan/${o.code}`);
		expect(d.text).toContain('Batas pembayaran:');
		expect(d.text).not.toContain('...');
	});

	it('bukti ditolak: menyebut alasan penolakan dan meminta unggah ulang', async () => {
		const o = await newOrder();
		await proof(o.code);
		await rejectPayment(o.code, adminId, 'Nominal tidak sesuai');
		const d = await adminWa(o.code);
		expect(d.waTopic).toBe('Bukti transfer ditolak');
		expect(d.text).toContain('belum dapat kami terima');
		expect(d.text).toContain('Alasan: Nominal tidak sesuai');
		expect(d.text).toContain('unggah ulang');
	});

	it('menunggu konfirmasi: memberi tahu bukti sudah diterima dan sedang diperiksa', async () => {
		const o = await newOrder();
		await proof(o.code);
		const d = await adminWa(o.code);
		expect(d.waTopic).toBe('Bukti transfer diterima');
		expect(d.text).toContain('sedang kami periksa');
	});

	it('diproses: menyebut pembayaran terkonfirmasi dan alamat tujuan', async () => {
		const o = await newOrder();
		await proof(o.code);
		await confirmPayment(o.code, adminId);
		const d = await adminWa(o.code);
		expect(d.waTopic).toBe('Pembayaran terkonfirmasi');
		expect(d.text).toContain('sudah kami konfirmasi');
		expect(d.text).toContain('Jl. Contoh No. 1 Subang');
	});

	it('dikirim: kurir, nomor resi, halaman lacak, dan ajakan konfirmasi terima', async () => {
		const o = await newOrder();
		await proof(o.code);
		await confirmPayment(o.code, adminId);
		await shipOrder(o.code, adminId, { courier: 'JNE', trackingNumber: 'JNE1234567890' });
		const d = await adminWa(o.code);
		expect(d.waTopic).toBe('Info pengiriman & resi');
		expect(d.text).toContain('Kurir: JNE');
		expect(d.text).toContain('No. resi: JNE1234567890');
		expect(d.text).toContain('https://jne.co.id/tracking-package');
		expect(d.text).toContain('Pesanan sudah diterima');
		expect(d.text).toContain('7 hari');
	});

	it('selesai: terima kasih dan ajakan ulasan', async () => {
		const o = await newOrder();
		await proof(o.code);
		await confirmPayment(o.code, adminId);
		await shipOrder(o.code, adminId, { courier: 'JNE', trackingNumber: 'JNE1234567890' });
		await completeOrder(o.code, { id: buyerId, role: 'konsumen' });
		const d = await adminWa(o.code);
		expect(d.text).toContain('sudah selesai');
		expect(d.text).toContain('ulasan');
	});

	describe('dibatalkan', () => {
		it('oleh admin sebelum ada pembayaran: alasan admin, tanpa pengembalian dana', async () => {
			const o = await newOrder();
			await cancelOrder(o.orderId, { id: adminId, role: 'admin' }, 'Stok ternyata rusak');
			const d = await adminWa(o.code);
			expect(d.waTopic).toBe('Kabari pembatalan');
			expect(d.text).toContain('terpaksa kami batalkan');
			expect(d.text).toContain('Alasan: Stok ternyata rusak');
			expect(d.text).toContain('tidak ada dana yang perlu dikembalikan');
			expect(d.text).not.toContain('nomor rekening');
			expect(d.text).not.toContain('...');
		});

		it('oleh admin setelah pembayaran dikonfirmasi: menjanjikan refund dan minta rekening', async () => {
			const o = await newOrder();
			await proof(o.code);
			await confirmPayment(o.code, adminId);
			await cancelOrder(o.orderId, { id: adminId, role: 'admin' }, 'Barang tidak tersedia');
			const d = await adminWa(o.code);
			expect(d.text).toContain('Alasan: Barang tidak tersedia');
			expect(d.text).toMatch(/Pembayaran Rp\s?115\.000 yang sudah kami terima akan dikembalikan/);
			expect(d.text).toContain('nomor rekening');
		});

		it('oleh admin saat bukti belum diverifikasi: minta bukti & rekening bila sudah transfer', async () => {
			const o = await newOrder();
			await proof(o.code);
			await cancelOrder(o.orderId, { id: adminId, role: 'admin' }, 'Pembeli tidak bisa dihubungi');
			const d = await adminWa(o.code);
			expect(d.text).toContain('belum sempat kami verifikasi');
			expect(d.text).toContain('Jika Anda sudah mentransfer');
			expect(d.text).not.toContain('tidak ada dana yang perlu dikembalikan');
		});

		it('oleh pembeli: menyebut permintaan pembeli, alasan bawaan tidak ditampilkan', async () => {
			const o = await newOrder();
			await cancelOrder(o.orderId, { id: buyerId, role: 'konsumen' }, 'Dibatalkan oleh pembeli');
			const d = await adminWa(o.code);
			expect(d.text).toContain('sesuai permintaan Anda');
			expect(d.text).not.toContain('Alasan:');
			expect(d.text).not.toContain('terpaksa');
		});

		it('oleh sistem (kedaluwarsa): menyebut batas waktu pembayaran', async () => {
			const o = await newOrder();
			expireNow(o.orderId);
			expect(await expireUnpaidOrders()).toBe(1);
			const d = await adminWa(o.code);
			expect(d.text).toContain('kami batalkan otomatis karena melewati batas waktu pembayaran');
			expect(d.text).not.toContain('Alasan:');
			expect(d.text).toContain('http://localhost:5173/produk');
		});
	});

	it('nomor: utamakan nomor penerima pesanan, cadangan nomor akun, keduanya rusak → tanpa tautan', async () => {
		const o = await newOrder();
		db.update(users).set({ phone: '081300000000' }).where(eq(users.id, buyerId)).run();
		expect((await adminWa(o.code)).waUrl).toContain('/6281234567890?'); // nomor penerima pesanan

		db.update(orders).set({ recipientPhone: '12' }).where(eq(orders.id, o.orderId)).run();
		expect((await adminWa(o.code)).waUrl).toContain('/6281300000000?'); // cadangan: nomor akun

		db.update(users).set({ phone: '12' }).where(eq(users.id, buyerId)).run();
		const none = await adminWa(o.code);
		expect(none.waUrl).toBeNull(); // tombol disembunyikan, bukan tautan rusak
		expect(none.waTopic).toBe('Ingatkan pembayaran');
	});
});

describe('paket bundling', () => {
	it('pesan memuat isi paket (produk & ukuran), bukan kode pilihan ukuran internal — di kedua arah', async () => {
		await cartAdd(buyerId, 'bundle', bundleId, 1);
		const { code } = await createOrderFromCart(buyerId, SHIP);
		for (const text of [(await adminWa(code)).text, (await customerWa(code)).text]) {
			expect(text).toContain('• Paket Hemat ×1');
			expect(text).toMatch(/ – Kaos Classic - L/);
			expect(text).toMatch(/ – Topi/);
			expect(text).not.toMatch(/\d+:[A-Za-z0-9]+\|/); // bentuk "36:L|54:34"
		}
	});
});

describe('WhatsApp pelanggan → toko menyesuaikan status pesanan', () => {
	it('memuat kode, status, barang, total dan nama pelanggan; dikirim ke nomor toko', async () => {
		const o = await newOrder();
		const d = await customerWa(o.code);
		expect(d.waUrl).toMatch(/^https:\/\/wa\.me\/6283867358863\?text=/);
		expect(d.text).toContain('saya Budi Santoso');
		expect(d.text).toContain(`Pesanan: *${o.code}*`);
		expect(d.text).toContain('Status: Menunggu Pembayaran');
		expect(d.text).toContain('Kaos Classic - L');
		expect(d.text).toMatch(/Total: Rp\s?115\.000/);
		expect(d.text).toContain('pembayaran pesanan ini');
	});

	it('menyesuaikan keperluan per status', async () => {
		const a = await newOrder();
		await proof(a.code);
		expect((await customerWa(a.code)).text).toContain('cek verifikasi pembayarannya');

		await rejectPayment(a.code, adminId, 'Buram');
		expect((await customerWa(a.code)).text).toContain(
			'Bukti transfer saya ditolak (alasan: Buram)'
		);

		await proof(a.code);
		await confirmPayment(a.code, adminId);
		expect((await customerWa(a.code)).text).toContain('kapan pesanan dikirim');

		await shipOrder(a.code, adminId, { courier: 'JNE', trackingNumber: 'JNE999' });
		const sent = (await customerWa(a.code)).text;
		expect(sent).toContain('dikirim via JNE (resi JNE999)');
		expect(sent).toContain('Status: Dikirim');
	});

	it('pesanan dibatalkan setelah bayar: menanyakan pengembalian dana', async () => {
		const o = await newOrder();
		await proof(o.code);
		await confirmPayment(o.code, adminId);
		await cancelOrder(o.orderId, { id: adminId, role: 'admin' }, 'Barang habis');
		const d = await customerWa(o.code);
		expect(d.cancelledBy).toBe('admin');
		expect(d.refund).toBe('dikembalikan');
		expect(d.text).toContain('(alasan: Barang habis)');
		expect(d.text).toContain('pengembalian dana');
	});

	it('data halaman memuat siapa yang membatalkan (admin / pembeli / sistem)', async () => {
		const byBuyer = await newOrder();
		await cancelOrder(byBuyer.orderId, { id: buyerId, role: 'konsumen' }, 'Salah pilih ukuran');
		const bySystem = await newOrder(buyerId, topiId, 1);
		expireNow(bySystem.orderId);
		await expireUnpaidOrders();
		expect((await customerWa(byBuyer.code)).cancelledBy).toBe('konsumen');
		expect((await customerWa(bySystem.code)).cancelledBy).toBe('sistem');
		expect((await customerWa(bySystem.code)).refund).toBe('tidak_ada');
	});
});
