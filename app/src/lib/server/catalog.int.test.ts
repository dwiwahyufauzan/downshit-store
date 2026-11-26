/**
 * Katalog & detail produk (SRS-F-005, TC-005-*): filter, urutan, paginasi, favorit tidak termasuk.
 * Memakai DB SQLite terisolasi (salinan skema kosong dari tests/global-setup.ts) + fixture bersama orders.fixture.ts.
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

import { count, eq } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import { db } from './db';
import { bundles, cartItems, orders, productSizes, products, users } from './db/schema';
import * as katalog from '../../routes/produk/+page.server';
import * as produkDetail from '../../routes/produk/[slug]/+page.server';
import * as bundleDetail from '../../routes/bundling/[slug]/+page.server';
import * as keranjang from '../../routes/keranjang/+page.server';
import * as checkout from '../../routes/checkout/+page.server';
import * as profil from '../../routes/profil/+page.server';
import { CATALOG_PAGE_SIZE } from '../constants';
import {
	GUEST,
	SHIP,
	U,
	adminId,
	buyerId,
	cartAdd,
	catchResult,
	hoodieId,
	kaosId,
	ownerId,
	topiId,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

/* ====================================================================== */
/** Isian alamat baru di form checkout */
const ADDR = {
	addressMode: 'baru',
	province: 'Jawa Barat',
	city: 'Kabupaten Subang',
	district: 'Subang',
	village: 'Soklat',
	addressDetail: 'Jl. Contoh No. 1',
	postalCode: '41211'
};
const RECIPIENT = { recipientName: SHIP.recipientName, recipientPhone: SHIP.recipientPhone };

/** Panggilan POST ke action checkout oleh `buyerId` */
const ev = (fields: Record<string, string>) => {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		locals: U(buyerId),
		request: new Request('http://x', { method: 'POST', body: fd })
	} as never;
};

describe('katalog & detail (SRS-F-005, TC-005-*)', () => {
	const url = (qs = '') => new URL(`http://x/produk${qs}`);

	it('hanya produk aktif & tidak terhapus; cari, kategori, urutan (TC-005-01/03/04)', async () => {
		db.update(products).set({ isActive: false }).where(eq(products.id, hoodieId)).run();
		const all = (await katalog.load({ url: url() } as never)) as {
			items: { name: string }[];
			pagination: { totalItems: number };
		};
		expect(all.items.map((i) => i.name).sort()).toEqual(['Kaos Classic - L', 'Topi']);

		const q = (await katalog.load({ url: url('?q=kaos') } as never)) as {
			items: { name: string }[];
		};
		expect(q.items.map((i) => i.name)).toEqual(['Kaos Classic - L']);

		const cat = (await katalog.load({ url: url('?kategori=kaos') } as never)) as {
			items: { name: string }[];
		};
		expect(cat.items).toHaveLength(1);

		const asc = (await katalog.load({ url: url('?urut=termurah') } as never)) as {
			items: { price: number }[];
		};
		expect(asc.items.map((i) => i.price)).toEqual([50_000, 100_000]);
		const desc = (await katalog.load({ url: url('?urut=termahal') } as never)) as {
			items: { price: number }[];
		};
		expect(desc.items.map((i) => i.price)).toEqual([100_000, 50_000]);
	});

	it('karakter % dan _ pada pencarian tidak menjadi wildcard', async () => {
		for (const q of ['%', '_', 'k_os', '%%%']) {
			const r = (await katalog.load({ url: url(`?q=${encodeURIComponent(q)}`) } as never)) as {
				items: unknown[];
			};
			expect(r.items).toHaveLength(0);
		}
	});

	it('paginasi sesuai CATALOG_PAGE_SIZE', async () => {
		// isi sampai tepat (satu halaman penuh + 5 produk) tanpa bergantung pada data awal tes lain
		const existing = db.select({ n: count() }).from(products).get()?.n ?? 0;
		const extra = 5;
		for (let i = 0; i < CATALOG_PAGE_SIZE + extra - existing; i++)
			db.insert(products)
				.values({ name: `Produk ${i}`, slug: `produk-${i}`, price: 1000 + i, stock: 1 })
				.run();
		const p1 = (await katalog.load({ url: url() } as never)) as {
			items: unknown[];
			pagination: { totalPages: number };
		};
		expect(p1.items).toHaveLength(CATALOG_PAGE_SIZE);
		expect(p1.pagination.totalPages).toBe(2);
		const p2 = (await katalog.load({ url: url('?page=2') } as never)) as { items: unknown[] };
		expect(p2.items).toHaveLength(extra);
		const bad = (await katalog.load({ url: url('?page=-4') } as never)) as {
			pagination: { page: number };
		};
		expect(bad.pagination.page).toBe(1);
	});

	it('filter harga & ukuran: rentang, urutan terbalik, input rusak, ukuran habis, kombinasi', async () => {
		db.insert(productSizes)
			.values([
				{ productId: kaosId, label: 'M', stock: 3 },
				{ productId: kaosId, label: 'L', stock: 0 }, // habis → tidak boleh cocok
				{ productId: hoodieId, label: 'M', stock: 2 },
				{ productId: hoodieId, label: 'XL', stock: 5 }
			])
			.run();
		type R = { items: { name: string }[]; sizeOptions: string[]; filters: Record<string, unknown> };
		const names = async (qs: string) =>
			((await katalog.load({ url: url(qs) } as never)) as R).items.map((i) => i.name).sort();
		const ALL = ['Hoodie', 'Kaos Classic - L', 'Topi'];

		expect(await names('')).toEqual(ALL);
		expect(await names('?min=100000')).toEqual(['Hoodie', 'Kaos Classic - L']);
		expect(await names('?max=100000')).toEqual(['Kaos Classic - L', 'Topi']);
		expect(await names('?min=60000&max=200000')).toEqual(['Kaos Classic - L']);
		expect(await names('?min=50000&max=50000')).toEqual(['Topi']); // batas inklusif

		// min > max ditukar, bukan hasil kosong
		expect(await names('?min=200000&max=60000')).toEqual(['Kaos Classic - L']);
		// input rusak diabaikan (bukan error / bukan nol hasil)
		expect(await names('?min=abc&max=-5')).toEqual(ALL);
		expect(await names('?min=&max=')).toEqual(ALL);
		expect(await names('?min=1e9&max=99999999999')).toEqual(ALL);
		expect(await names("?min=1'%20OR%201=1--")).toEqual(ALL);

		// ukuran: hanya yang stoknya ada; huruf kecil dinormalkan
		expect(await names('?ukuran=M')).toEqual(['Hoodie', 'Kaos Classic - L']);
		expect(await names('?ukuran=m')).toEqual(['Hoodie', 'Kaos Classic - L']);
		expect(await names('?ukuran=L')).toEqual([]);
		expect(await names('?ukuran=XL')).toEqual(['Hoodie']);
		expect(await names('?ukuran=ZZ')).toEqual([]);
		expect(await names('?ukuran=M&max=100000')).toEqual(['Kaos Classic - L']);
		expect(await names('?ukuran=M&q=hood')).toEqual(['Hoodie']);

		// total & halaman ikut terfilter; filter dikembalikan ke tampilan
		const r = (await katalog.load({ url: url('?ukuran=M&min=1000') } as never)) as R & {
			pagination: { totalItems: number };
		};
		expect(r.pagination.totalItems).toBe(2);
		expect(r.filters).toMatchObject({ ukuran: 'M', min: 1000, max: null });

		// pilihan ukuran: hanya yang ada stoknya, terurut; produk nonaktif tidak ikut
		expect(((await katalog.load({ url: url() } as never)) as R).sizeOptions).toEqual(['M', 'XL']);
		db.update(products).set({ isActive: false }).where(eq(products.id, hoodieId)).run();
		expect(((await katalog.load({ url: url() } as never)) as R).sizeOptions).toEqual(['M']);
	});

	it('detail: slug tidak ada / nonaktif / terhapus → 404 (TC-005-08/09)', async () => {
		const ev = (slug: string) =>
			({ params: { slug }, locals: GUEST, url: new URL('http://x/produk') }) as never;
		const missing = await catchResult(() => produkDetail.load(ev('xxx')));
		expect(!missing.ok && missing.error.status).toBe(404);
		db.update(products).set({ isActive: false }).where(eq(products.id, topiId)).run();
		const off = await catchResult(() => produkDetail.load(ev('topi')));
		expect(!off.ok && off.error.status).toBe(404);
		db.update(products)
			.set({ isActive: true, deletedAt: new Date().toISOString() })
			.where(eq(products.id, topiId))
			.run();
		const del = await catchResult(() => produkDetail.load(ev('topi')));
		expect(!del.ok && del.error.status).toBe(404);

		db.update(bundles).set({ isActive: false }).run();
		const b = await catchResult(() => bundleDetail.load(ev('paket-hemat')));
		expect(!b.ok && b.error.status).toBe(404);
	});

	it('detail produk memuat paket terkait (hanya bundling aktif) dan isKonsumen', async () => {
		const ev = (uid: number | null, role: 'konsumen' | 'admin' = 'konsumen') =>
			({
				params: { slug: 'kaos-classic-l' },
				locals: uid ? U(uid, role) : GUEST,
				url: new URL('http://x/produk/kaos-classic-l')
			}) as never;
		const r = (await produkDetail.load(ev(buyerId))) as {
			relatedBundles: { slug: string }[];
			isKonsumen: boolean;
		};
		expect(r.relatedBundles.map((b) => b.slug)).toEqual(['paket-hemat']);
		expect(r.isKonsumen).toBe(true);
		expect(
			((await produkDetail.load(ev(adminId, 'admin'))) as { isKonsumen: boolean }).isKonsumen
		).toBe(false);
		db.update(bundles).set({ isActive: false }).run();
		expect(
			((await produkDetail.load(ev(buyerId))) as { relatedBundles: unknown[] }).relatedBundles
		).toHaveLength(0);
	});

	it('detail bundling: stok efektif, harga normal & hemat (TC-005-07/11)', async () => {
		db.update(bundles).set({ stock: 15 }).run();
		db.update(products).set({ stock: 3 }).where(eq(products.id, kaosId)).run();
		const r = (await bundleDetail.load({
			params: { slug: 'paket-hemat' },
			locals: GUEST
		} as never)) as {
			effectiveStock: number;
			normalPrice: number;
			savings: number;
			components: unknown[];
		};
		expect(r.effectiveStock).toBe(3);
		expect(r.normalPrice).toBe(150_000);
		expect(r.savings).toBe(20_000);
		expect(r.components).toHaveLength(2);
	});

	it('?/tambah: admin → 403, tamu → redirect login, konsumen → masuk keranjang (TC-005-10, TC-009-13)', async () => {
		const ev = (locals: unknown, qty: string, slug = 'kaos-classic-l') => {
			const fd = new FormData();
			fd.set('qty', qty);
			return {
				params: { slug },
				locals,
				url: new URL(`http://x/produk/${slug}`),
				request: new Request('http://x', { method: 'POST', body: fd })
			} as never;
		};
		const adm = (await produkDetail.actions.tambah(ev(U(adminId, 'admin'), '1'))) as {
			status: number;
		};
		expect(adm.status).toBe(403);
		const own = (await bundleDetail.actions.tambah(
			ev(U(ownerId, 'owner'), '1', 'paket-hemat')
		)) as {
			status: number;
		};
		expect(own.status).toBe(403);
		const guest = await catchResult(() => produkDetail.actions.tambah(ev(GUEST, '1')));
		expect(!guest.ok && isRedirect(guest.error)).toBe(true);
		expect(db.select().from(cartItems).all()).toHaveLength(0);

		const badQty = (await produkDetail.actions.tambah(ev(U(buyerId), '0'))) as { status: number };
		expect(badQty.status).toBe(400);
		const frac = (await produkDetail.actions.tambah(ev(U(buyerId), '1.5'))) as { status: number };
		expect(frac.status).toBe(400);
		const ok = (await produkDetail.actions.tambah(ev(U(buyerId), '2'))) as {
			success: boolean;
			toastAction: { href: string; label: string };
		};
		expect(ok.success).toBe(true);
		expect(ok.toastAction).toEqual({ href: '/keranjang', label: 'Lihat keranjang' }); // tautan di toast
		const okB = (await bundleDetail.actions.tambah(ev(U(buyerId), '1', 'paket-hemat'))) as {
			success: boolean;
			toastAction: { href: string };
		};
		expect(okB.success).toBe(true);
		expect(okB.toastAction.href).toBe('/keranjang');
		expect(db.select().from(cartItems).all()).toHaveLength(2);
	});

	it('admin/owner tidak bisa memakai keranjang & checkout (TC-009-13)', async () => {
		for (const role of ['admin', 'owner'] as const) {
			const loc = U(role === 'admin' ? adminId : ownerId, role);
			const ev = { locals: loc, url: new URL('http://x/keranjang') } as never;
			const c = await catchResult(() => keranjang.load(ev));
			expect(!c.ok && c.error.status).toBe(403);
			const k = await catchResult(() => checkout.load(ev));
			expect(!k.ok && k.error.status).toBe(403);
			const post = await catchResult(() =>
				checkout.actions.default({
					locals: loc,
					request: new Request('http://x', { method: 'POST', body: new FormData() })
				} as never)
			);
			expect(!post.ok && post.error.status).toBe(403);
		}
	});

	it('checkout action: validasi alamat (TC-009-07), sukses → redirect ke pesanan, harga form diabaikan', async () => {
		await cartAdd(buyerId, 'product', kaosId, 1);
		const bad = (await checkout.actions.default(
			ev({ recipientName: 'Budi', recipientPhone: '081234567890' })
		)) as { status: number; data: { errors: Record<string, string[]> } };
		expect(bad.status).toBe(400);
		expect(bad.data.errors.addressDetail?.length).toBeGreaterThan(0);
		expect(db.select().from(orders).all()).toHaveLength(0);

		const r = await catchResult(() =>
			checkout.actions.default(
				ev({ ...RECIPIENT, ...ADDR, total: '1', subtotal: '1', price: '1', saveToProfile: 'on' })
			)
		);
		expect(!r.ok && isRedirect(r.error)).toBe(true);
		const o = db.select().from(orders).get()!;
		expect(o.total).toBe(115_000);
		const u = db.select().from(users).where(eq(users.id, buyerId)).get()!;
		expect(o.shippingAddress).toBe(
			'Jl. Contoh No. 1, Desa/Kel. Soklat, Kec. Subang, Kabupaten Subang, Jawa Barat 41211'
		);
		expect(u.address).toBe(o.shippingAddress);
		expect(u.addressCity).toBe('Kabupaten Subang');
		expect(u.addressDetail).toBe('Jl. Contoh No. 1');
	});
	it('checkout: alamat default profil dipakai dari DB (kolom formulir diabaikan); tidak ada default → ditolak', async () => {
		await cartAdd(buyerId, 'product', kaosId, 1);

		// belum punya alamat default
		const none = (await checkout.actions.default(ev({ ...RECIPIENT, addressMode: 'profil' }))) as {
			status: number;
			data: { errors: Record<string, string[]> };
		};
		expect(none.status).toBe(400);
		expect(none.data.errors.addressMode?.length).toBeGreaterThan(0);
		expect(db.select().from(orders).all()).toHaveLength(0);

		db.update(users)
			.set({
				addressProvince: 'Jawa Tengah',
				addressCity: 'Kota Semarang',
				addressDistrict: 'Tembalang',
				addressVillage: 'Sendangmulyo',
				addressPostalCode: '50275',
				addressDetail: 'Jl. Profil No. 9'
			})
			.where(eq(users.id, buyerId))
			.run();

		const r = await catchResult(() =>
			// isian alamat baru ikut terkirim tapi harus diabaikan pada mode profil
			checkout.actions.default(ev({ ...RECIPIENT, ...ADDR, addressMode: 'profil' }))
		);
		expect(!r.ok && isRedirect(r.error)).toBe(true);
		expect(db.select().from(orders).get()!.shippingAddress).toBe(
			'Jl. Profil No. 9, Desa/Kel. Sendangmulyo, Kec. Tembalang, Kota Semarang, Jawa Tengah 50275'
		);
	});

	it('checkout: alamat baru tanpa centang simpan tidak mengubah alamat default', async () => {
		db.update(users)
			.set({ addressCity: 'Kota Semarang', addressDetail: 'Jl. Profil No. 9' })
			.where(eq(users.id, buyerId))
			.run();
		await cartAdd(buyerId, 'product', kaosId, 1);
		const r = await catchResult(() => checkout.actions.default(ev({ ...RECIPIENT, ...ADDR })));
		expect(!r.ok && isRedirect(r.error)).toBe(true);
		const u = db.select().from(users).where(eq(users.id, buyerId)).get()!;
		expect(u.addressCity).toBe('Kota Semarang');
		expect(u.addressDetail).toBe('Jl. Profil No. 9');
	});
	it('profil: simpan alamat default terstruktur, tolak sebagian, kosongkan semua = hapus', async () => {
		const save = (fields: Record<string, string>) =>
			(profil.actions.updateProfile as (e: never) => Promise<unknown>)(
				ev({ name: 'Budi Santoso', phone: '081234567890', ...fields })
			) as Promise<{ status?: number; profileSuccess?: boolean }>;
		const row = () => db.select().from(users).where(eq(users.id, buyerId)).get()!;

		const partial = await save({ province: 'Jawa Barat', city: 'Kabupaten Subang' });
		expect(partial.status).toBe(400);
		expect(row().addressCity).toBeNull();

		const ok = await save({ ...ADDR });
		expect(ok.profileSuccess).toBe(true);
		expect(row().addressVillage).toBe('Soklat');
		expect(row().address).toBe(
			'Jl. Contoh No. 1, Desa/Kel. Soklat, Kec. Subang, Kabupaten Subang, Jawa Barat 41211'
		);

		expect((await save({})).profileSuccess).toBe(true);
		expect(row().address).toBeNull();
		expect(row().addressDetail).toBeNull();
	});
});
