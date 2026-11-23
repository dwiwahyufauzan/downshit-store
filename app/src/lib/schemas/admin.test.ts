import { describe, expect, it } from 'vitest';
import { productCreateSchema, productUpdateSchema } from './product';
import { categorySchema } from './category';
import { purchaseSchema } from './purchase';
import { adjustSchema } from './stock';
import { settingsSchema } from './settings';
import { bundleCreateSchema } from './bundle';

const prod = { name: 'Kaos Uji', categoryId: '1', price: '50000', stock: '5' };
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
	r.success ? '' : r.error!.issues.map((i) => i.message).join('|');

describe('productCreateSchema (TC-003-02/03/04)', () => {
	it('menerima input form valid (string) dan menyatukan ke angka', () => {
		const r = productCreateSchema.parse({ ...prod, isBundleable: true });
		expect(r).toMatchObject({
			price: 50000,
			stock: 5,
			categoryId: 1,
			isBundleable: true,
			isActive: false
		});
	});

	it.each([
		['nama kosong', { name: '' }, 'minimal 3'],
		['nama 2 huruf', { name: 'ab' }, 'minimal 3'],
		['harga negatif', { price: '-1' }, 'minimal Rp 1.000'],
		['harga nol', { price: '0' }, 'minimal Rp 1.000'],
		['harga desimal', { price: '1000.5' }, 'bilangan bulat'],
		['harga huruf', { price: 'abc' }, 'harus berupa angka'],
		['harga kosong', { price: '' }, 'wajib diisi'],
		['harga terlalu besar', { price: '1e9' }, 'maksimal'],
		['stok negatif', { stock: '-5' }, 'tidak boleh negatif'],
		['stok desimal', { stock: '1.5' }, 'bilangan bulat'],
		['kategori kosong', { categoryId: '' }, 'wajib diisi'],
		['kategori 0', { categoryId: '0' }, 'pilih kategori']
	])('menolak %s', (_l, o, expected) => {
		expect(msg(productCreateSchema.safeParse({ ...prod, ...o }))).toContain(expected);
	});

	it('form edit tidak punya field stok: `stock` yang dikirim manual dibuang (TC-003-14, BR-19)', () => {
		const r = productUpdateSchema.parse({ ...prod, stock: '999' });
		expect('stock' in r).toBe(false);
	});
});

describe('categorySchema', () => {
	it('nama min 2 karakter, deskripsi opsional maks 500', () => {
		expect(categorySchema.safeParse({ name: 'K' }).success).toBe(false);
		expect(categorySchema.safeParse({ name: 'Kaos' }).success).toBe(true);
		expect(categorySchema.safeParse({ name: 'Kaos', description: 'x'.repeat(501) }).success).toBe(
			false
		);
		expect(categorySchema.safeParse({ name: null }).success).toBe(false);
	});
});

describe('purchaseSchema (TC-006-03/04)', () => {
	const ok = {
		purchaseDate: '2026-11-14',
		items: [{ productId: '1', quantity: '10', unitCost: '5000' }]
	};
	it('valid', () => expect(purchaseSchema.safeParse(ok).success).toBe(true));
	it('tanpa produk / qty 0 / qty negatif / biaya negatif / duplikat ditolak', () => {
		expect(purchaseSchema.safeParse({ ...ok, items: [] }).success).toBe(false);
		expect(
			msg(purchaseSchema.safeParse({ ...ok, items: [{ productId: 1, quantity: 0, unitCost: 1 }] }))
		).toContain('minimal 1');
		expect(
			purchaseSchema.safeParse({ ...ok, items: [{ productId: 1, quantity: -3, unitCost: 1 }] })
				.success
		).toBe(false);
		expect(
			purchaseSchema.safeParse({ ...ok, items: [{ productId: 1, quantity: 1, unitCost: -1 }] })
				.success
		).toBe(false);
		const dup = { productId: 1, quantity: 1, unitCost: 1 };
		expect(msg(purchaseSchema.safeParse({ ...ok, items: [dup, dup] }))).toContain('duplikat');
	});
	it('tanggal: kosong, format salah, tidak ada di kalender → ditolak tanpa melempar', () => {
		for (const purchaseDate of ['', '14-11-2026', '2026-02-31', '2026-13-01', 'abc'])
			expect(purchaseSchema.safeParse({ ...ok, purchaseDate }).success).toBe(false);
		expect(purchaseSchema.safeParse({ ...ok, purchaseDate: '2028-02-29' }).success).toBe(true);
	});
});

describe('adjustSchema (TC-012-03)', () => {
	const ok = { kind: 'product', id: '1', newStock: '10', note: 'opname mingguan' };
	it('valid', () => expect(adjustSchema.safeParse(ok).success).toBe(true));
	it('catatan wajib min 5 karakter; stok tidak negatif', () => {
		expect(msg(adjustSchema.safeParse({ ...ok, note: 'abc' }))).toContain('minimal 5');
		expect(msg(adjustSchema.safeParse({ ...ok, note: '    ' }))).toContain('minimal 5');
		expect(msg(adjustSchema.safeParse({ ...ok, newStock: '-1' }))).toContain('tidak boleh negatif');
		expect(adjustSchema.safeParse({ ...ok, kind: 'x' }).success).toBe(false);
	});
});

describe('settingsSchema (TC-016-02)', () => {
	const ok = {
		storeName: 'Downshit',
		whatsapp: '6281234567890',
		shippingCost: '15000',
		bankName: 'BCA',
		bankNumber: '1234567890',
		bankHolder: 'Downshit',
		lowStock: '5',
		paymentDeadlineHours: '24',
		maxUnpaidOrders: '3',
		autoCompleteDays: '7',
		payTransfer: 'on'
	};
	it('valid', () => expect(settingsSchema.safeParse(ok).success).toBe(true));
	it('kotak centang metode bayar: "on" aktif, kosong nonaktif', () => {
		const r = settingsSchema.parse({ ...ok, payQris: 'on', payVa: null });
		expect(r).toMatchObject({ payTransfer: true, payQris: true, payVa: false, payEwallet: false });
	});
	it('menolak bila semua metode pembayaran dimatikan', () => {
		const r = settingsSchema.safeParse({ ...ok, payTransfer: null });
		expect(r.success).toBe(false);
		expect(r.error?.issues[0]?.message).toBe('Aktifkan minimal satu metode pembayaran');
	});
	it('metode online saja (tanpa transfer) diterima', () => {
		expect(settingsSchema.safeParse({ ...ok, payTransfer: null, payEwallet: 'on' }).success).toBe(
			true
		);
	});
	it.each([
		['ongkir negatif', { shippingCost: '-1' }],
		['ongkir huruf', { shippingCost: 'abc' }],
		['ongkir kosong', { shippingCost: '' }],
		['batas bayar 0', { paymentDeadlineHours: '0' }],
		['batas bayar 169', { paymentDeadlineHours: '169' }],
		['max belum bayar 0', { maxUnpaidOrders: '0' }],
		['auto-selesai 61', { autoCompleteDays: '61' }],
		['WA diawali 0', { whatsapp: '0812345678' }],
		['WA diawali +', { whatsapp: '+6281234567890' }],
		['rekening huruf', { bankNumber: '12ab34' }],
		['ambang negatif', { lowStock: '-1' }]
	])('menolak %s', (_l, o) => {
		expect(settingsSchema.safeParse({ ...ok, ...o }).success).toBe(false);
	});
	it('ambang stok 0 dan batas atas diterima', () => {
		expect(settingsSchema.safeParse({ ...ok, lowStock: '0', shippingCost: '0' }).success).toBe(
			true
		);
		expect(settingsSchema.safeParse({ ...ok, paymentDeadlineHours: '168' }).success).toBe(true);
	});
});

describe('bundleCreateSchema dengan input form (TC-004-02/03)', () => {
	const ok = {
		name: 'Paket Uji',
		price: '120000',
		stock: '5',
		items: [
			{ productId: '1', quantity: '1' },
			{ productId: '2', quantity: '2' }
		]
	};
	it('valid; komponen string diubah ke angka', () => {
		const r = bundleCreateSchema.parse(ok);
		expect(r.items[1]).toEqual({ productId: 2, quantity: 2 });
	});
	it('1 komponen / duplikat / qty 21 / items bukan array ditolak dengan pesan Indonesia', () => {
		expect(msg(bundleCreateSchema.safeParse({ ...ok, items: [ok.items[0]] }))).toContain('minimal');
		expect(
			msg(bundleCreateSchema.safeParse({ ...ok, items: [ok.items[0], ok.items[0]] }))
		).toContain('duplikat');
		expect(
			msg(
				bundleCreateSchema.safeParse({
					...ok,
					items: [{ productId: 1, quantity: 21 }, ok.items[1]]
				})
			)
		).toContain('maksimal 20');
		expect(msg(bundleCreateSchema.safeParse({ ...ok, items: 'x' }))).toContain('tidak valid');
	});
});
