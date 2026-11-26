/**
 * Data demo lengkap & terbaru (Nov 2026) di atas data yang sudah ada. TIDAK menghapus/menimpa data lama
 * dan tidak menyentuh akun asli (hanya pelanggan `*@example.com` yang alamatnya dilengkapi).
 *
 * Isi (semuanya konsisten satu sama lain):
 *  - 16 produk baru (kaos, hoodie, celana, aksesoris) lengkap dengan ukuran, berat, foto galeri, harga,
 *    dan 2 paket bundling baru; stok awal masuk lewat pembelian (restock) ke supplier.
 *  - 14 pelanggan baru; alamat terstruktur (provinsi → desa + kode pos + kode wilayah) untuk semua pelanggan contoh.
 *  - ±55 pesanan baru 17 Nov → hari ini dengan seluruh siklus (bayar transfer/QRIS/VA/e-wallet, konfirmasi,
 *    pengiriman + resi + layanan kurir, selesai, batal, kedaluwarsa, bukti ditolak), mutasi stok, log aktivitas,
 *    ulasan (sebagian berfoto), dan restock lanjutan.
 *  - Voucher berbagai status (aktif, akan datang, kedaluwarsa, kuota habis, nonaktif) + pemakaiannya,
 *    sebagian tampil di banner beranda.
 *  - Favorit, keranjang (ada yang tidak dicentang), dan pengingat "stok kembali tersedia".
 *
 * Cara kerja: kejadian disimulasikan berurutan menurut waktu (stok berubah saat pesanan dibuat/dibatalkan),
 * jadi stok tidak pernah negatif dan tiap mutasi `stock_after` cocok dengan stok sebenarnya.
 * Seluruh perubahan database dalam SATU transaksi + diperiksa asersi di akhir; gagal = tidak ada yang berubah.
 * Aman dijalankan berulang (ditandai di tabel settings). Cadangan DB dibuat dulu di ./backups.
 *
 * Pakai:  npm run db:seed-demo
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';
import sharp from 'sharp';
import { migrateDatabase } from '../src/lib/server/db/migrator';
import { formatAddress, type AddressParts } from '../src/lib/utils/address';
import { slugify } from '../src/lib/utils/slug';

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD !== 'true') {
	throw new Error(
		'Data demo tidak boleh diisi di produksi (set SEED_ALLOW_PROD=true bila sengaja).'
	);
}

const DB_PATH = process.env.DATABASE_URL || 'downshit.db';
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const MARKER = 'seed_demo_2026_11';
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD || 'Ganti-Password-123!';

/* ====================================================================== */
/* Utilitas                                                               */
/* ====================================================================== */
function mulberry32(a: number) {
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rng = mulberry32(20261126);
const rint = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const chance = (p: number) => rng() < p;
function wpick<T>(items: readonly T[], weights: readonly number[]): T {
	let x = rng() * weights.reduce((a, b) => a + b, 0);
	for (let i = 0; i < items.length; i++) {
		x -= weights[i];
		if (x <= 0) return items[i];
	}
	return items[items.length - 1];
}
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.now();
const wib = (ymd: string, hm = '00:00') => Date.parse(`${ymd}T${hm}:00+07:00`);
const rupiah = (n: number) => n.toLocaleString('id-ID');
const ymd6 = (ms: number) => {
	const d = new Date(ms + 7 * HOUR);
	return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

/* ====================================================================== */
/* Wilayah (data resmi) → alamat contoh                                   */
/* ====================================================================== */
type Opt = [string, string];
const WIL = JSON.parse(readFileSync(path.resolve('src/lib/server/data/wilayah.json'), 'utf8')) as {
	p: Opt[];
	r: Record<string, Opt[]>;
	d: Record<string, Opt[]>;
	v: Record<string, Opt[]>;
};

const STREETS = [
	'Jl. Raya Otista',
	'Jl. Merdeka',
	'Jl. Pahlawan',
	'Jl. Mawar',
	'Jl. Melati',
	'Jl. Kenanga',
	'Jl. Sudirman',
	'Jl. Diponegoro',
	'Jl. Ahmad Yani',
	'Jl. Veteran',
	'Jl. Cempaka',
	'Jl. Anggrek',
	'Gg. Bahagia',
	'Gg. Sukamaju',
	'Jl. Pasir Kaliki',
	'Jl. Cihampelas',
	'Jl. Kebon Jeruk'
];
// awalan kode pos per provinsi (perkiraan wajar, bukan data resmi)
const POSTAL_PREFIX: Record<string, string> = {
	'32': '4',
	'31': '1',
	'36': '15',
	'33': '5',
	'34': '55',
	'35': '6',
	'12': '2',
	'16': '3',
	'73': '9'
};

type Addr = AddressParts & { villageCode: string; provinceCode: string };
function randomAddress(): Addr {
	const prov = wpick(
		['32', '31', '33', '35', '36', '34', '12', '16', '73'],
		[56, 10, 8, 7, 6, 3, 4, 3, 3]
	);
	const province = WIL.p.find(([c]) => c === prov)!;
	const city = pick(WIL.r[prov]);
	const district = pick(WIL.d[city[0]]);
	const village = pick(WIL.v[district[0]]);
	const prefix = POSTAL_PREFIX[prov] ?? '2';
	const postalCode =
		prefix + String(rint(0, 10 ** (5 - prefix.length) - 1)).padStart(5 - prefix.length, '0');
	return {
		province: province[1],
		city: city[1],
		district: district[1],
		village: village[1],
		detail: `${pick(STREETS)} No. ${rint(1, 99)}, RT ${String(rint(1, 12)).padStart(2, '0')}/RW ${String(rint(1, 12)).padStart(2, '0')}`,
		postalCode,
		villageCode: village[0],
		provinceCode: prov
	};
}

const COURIERS = [
	{ courier: 'JNE', service: 'Reguler', etd: '2-3 hari', prefix: 'CGK' },
	{ courier: 'J&T', service: 'EZ', etd: '2-4 hari', prefix: 'JP' },
	{ courier: 'SiCepat', service: 'Reguler', etd: '2-3 hari', prefix: '00' },
	{ courier: 'AnterAja', service: 'Reguler', etd: '3-5 hari', prefix: '1000' }
];
function shippingFor(provinceCode: string) {
	const [lo, hi] =
		provinceCode === '32'
			? [9000, 15000]
			: ['31', '36'].includes(provinceCode)
				? [10000, 17000]
				: ['33', '34', '35'].includes(provinceCode)
					? [16000, 26000]
					: [30000, 52000];
	const c = pick(COURIERS);
	return {
		...c,
		label: `${c.courier} ${c.service}`,
		price: Math.round(rint(lo, hi) / 500) * 500
	};
}

/* ====================================================================== */
/* Gambar tiruan (placeholder) agar katalog & ulasan punya foto           */
/* ====================================================================== */
async function placeholder(
	folder: 'products' | 'bundles' | 'reviews' | 'proofs',
	title: string,
	hue: number,
	thumb = true
) {
	const dir = path.join(UPLOAD_DIR, folder);
	mkdirSync(dir, { recursive: true });
	const id = randomUUID();
	const size = folder === 'proofs' ? 700 : 900;
	const bg = `hsl(${hue} 12% ${folder === 'proofs' ? 97 : 90}%)`;
	const fg = `hsl(${hue} 30% 22%)`;
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	const svg = (
		n: number
	) => `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 900 900">
		<rect width="900" height="900" fill="${bg}"/>
		<rect x="60" y="60" width="780" height="780" fill="none" stroke="${fg}" stroke-width="6"/>
		<text x="450" y="420" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="700" text-anchor="middle" fill="${fg}">${esc(title.slice(0, 22))}</text>
		<text x="450" y="500" font-family="Helvetica, Arial, sans-serif" font-size="30" letter-spacing="10" text-anchor="middle" fill="${fg}" opacity="0.6">DOWNSHIT · DEMO</text>
	</svg>`;
	await sharp(Buffer.from(svg(size)))
		.webp({ quality: 78 })
		.toFile(path.join(dir, `${id}.webp`));
	if (thumb && folder !== 'proofs') {
		await sharp(Buffer.from(svg(400)))
			.webp({ quality: 72 })
			.toFile(path.join(dir, `${id}_t.webp`));
	}
	return `/uploads/${folder}/${id}.webp`;
}

/* ====================================================================== */
/* Katalog baru                                                           */
/* ====================================================================== */
type NewProduct = {
	cat: 'kaos' | 'hoodie' | 'celana' | 'aksesoris';
	name: string;
	price: number;
	cost: number;
	weight: number;
	sizes?: 'huruf' | 'pinggang';
	stock: number; // total stok awal (dibagi ke ukuran bila ber-ukuran)
	description: string;
	hue: number;
};
const KAOS = 'Cotton Combed 24s, sablon plastisol tahan lama, potongan oversized.';
const HOODIE = 'Fleece 320gsm, bagian dalam lembut, kantong kangguru dan jahitan rapi.';
const CELANA = 'Bahan tebal dengan potongan longgar dan saku fungsional.';
const NEW_PRODUCTS: NewProduct[] = [
	{
		cat: 'kaos',
		name: 'Pasundan Heritage Tee',
		price: 125000,
		cost: 62000,
		weight: 240,
		sizes: 'huruf',
		stock: 44,
		hue: 22,
		description: `Motif batik Pasundan dalam sablon minimalis. ${KAOS}`
	},
	{
		cat: 'kaos',
		name: 'Cipali Run Tee',
		price: 119000,
		cost: 58000,
		weight: 235,
		sizes: 'huruf',
		stock: 40,
		hue: 200,
		description: `Terinspirasi perjalanan malam di tol Cipali. ${KAOS}`
	},
	{
		cat: 'kaos',
		name: 'Angkot Biru Tee',
		price: 115000,
		cost: 56000,
		weight: 230,
		sizes: 'huruf',
		stock: 36,
		hue: 215,
		description: `Ilustrasi angkot biru khas Subang di dada. ${KAOS}`
	},
	{
		cat: 'kaos',
		name: 'Tangkuban Perahu Tee',
		price: 129000,
		cost: 64000,
		weight: 245,
		sizes: 'huruf',
		stock: 38,
		hue: 140,
		description: `Grafis kawah dan kabut pegunungan. ${KAOS}`
	},
	{
		cat: 'kaos',
		name: 'Jajan Pasar Tee',
		price: 109000,
		cost: 52000,
		weight: 225,
		sizes: 'huruf',
		stock: 48,
		hue: 48,
		description: `Ilustrasi jajanan pasar tradisional. ${KAOS}`
	},
	{
		cat: 'hoodie',
		name: 'Sawah Night Hoodie',
		price: 289000,
		cost: 148000,
		weight: 620,
		sizes: 'huruf',
		stock: 28,
		hue: 120,
		description: `Bordir sawah malam di punggung. ${HOODIE}`
	},
	{
		cat: 'hoodie',
		name: 'Kabut Lembang Zip Hoodie',
		price: 319000,
		cost: 165000,
		weight: 680,
		sizes: 'huruf',
		stock: 24,
		hue: 190,
		description: `Resleting penuh, warna abu kabut. ${HOODIE}`
	},
	{
		cat: 'hoodie',
		name: 'Subang Crewneck Fleece',
		price: 249000,
		cost: 126000,
		weight: 560,
		sizes: 'huruf',
		stock: 30,
		hue: 10,
		description: `Crewneck tanpa tudung, logo bordir kecil. ${HOODIE}`
	},
	{
		cat: 'celana',
		name: 'Selokan Denim Pants',
		price: 349000,
		cost: 182000,
		weight: 760,
		sizes: 'pinggang',
		stock: 26,
		hue: 225,
		description: `Denim 12oz wash gelap. ${CELANA}`
	},
	{
		cat: 'celana',
		name: 'Jalur Rel Cargo Shorts',
		price: 189000,
		cost: 94000,
		weight: 420,
		sizes: 'pinggang',
		stock: 32,
		hue: 80,
		description: `Cargo pendek sepanjang lutut. ${CELANA}`
	},
	{
		cat: 'celana',
		name: 'Parachute Pants Hitam',
		price: 299000,
		cost: 152000,
		weight: 480,
		sizes: 'pinggang',
		stock: 24,
		hue: 0,
		description: `Bahan parasut ringan dengan tali serut. ${CELANA}`
	},
	{
		cat: 'aksesoris',
		name: 'Tote Bag Canvas Subang',
		price: 79000,
		cost: 36000,
		weight: 210,
		stock: 50,
		hue: 35,
		description: 'Kanvas tebal 12oz dengan sablon dua sisi dan tali panjang.'
	},
	{
		cat: 'aksesoris',
		name: 'Bucket Hat Kabut',
		price: 99000,
		cost: 46000,
		weight: 110,
		stock: 34,
		hue: 170,
		description: 'Bucket hat katun twill dengan bordir kecil di sisi.'
	},
	{
		cat: 'aksesoris',
		name: 'Topi Snapback Dawuan',
		price: 109000,
		cost: 52000,
		weight: 130,
		stock: 30,
		hue: 260,
		description: 'Snapback 6 panel dengan bordir timbul.'
	},
	{
		cat: 'aksesoris',
		name: 'Kaos Kaki Crew Stripe',
		price: 45000,
		cost: 19000,
		weight: 70,
		stock: 80,
		hue: 330,
		description: 'Kaos kaki crew katun tebal, motif garis.'
	},
	{
		cat: 'aksesoris',
		name: 'Sticker Pack Vol. 2',
		price: 25000,
		cost: 9000,
		weight: 25,
		stock: 120,
		hue: 55,
		description: 'Isi 10 stiker vinyl tahan air.'
	}
];
const SPLIT = [2, 4, 3, 1]; // M & L paling laris
function splitStock(total: number): number[] {
	const sum = SPLIT.reduce((a, b) => a + b, 0);
	const parts = SPLIT.map((w) => Math.floor((total * w) / sum));
	parts[1] += total - parts.reduce((a, b) => a + b, 0);
	return parts;
}
const SIZE_SETS = { huruf: ['S', 'M', 'L', 'XL'], pinggang: ['28', '30', '32', '34'] } as const;
const SUPPLIERS: Record<string, string> = {
	kaos: 'CV Garmen Nusantara Bandung',
	hoodie: 'PT Sandang Prima Majalaya',
	celana: 'UD Denim Cimahi',
	aksesoris: 'CV Kreasi Sablon Subang'
};

const FIRST = [
	'Rina',
	'Dimas',
	'Putri',
	'Fajar',
	'Ayu',
	'Rizky',
	'Nadia',
	'Bagas',
	'Citra',
	'Yoga',
	'Salsa',
	'Hendra',
	'Tika',
	'Wahyu'
];
const LAST = [
	'Pratama',
	'Lestari',
	'Kusuma',
	'Ramadhan',
	'Wijaya',
	'Safitri',
	'Nugraha',
	'Anggraini',
	'Saputra',
	'Permata',
	'Hidayat',
	'Maharani',
	'Firmansyah',
	'Utami'
];

const REVIEW_TEXT: Record<number, string[]> = {
	5: [
		'Bahannya tebal dan adem, jahitan rapi. Ukuran pas sesuai tabel.',
		'Sablonnya awet setelah beberapa kali cuci. Pengiriman cepat!',
		'Kualitas jauh di atas harganya. Pasti beli lagi.',
		'Warnanya persis seperti di foto, packing aman.'
	],
	4: [
		'Bagus, hanya sedikit lebih besar dari perkiraan. Tetap puas.',
		'Bahan nyaman, pengiriman agak lama tapi barang oke.',
		'Sesuai deskripsi, jahitan rapi.'
	],
	3: ['Lumayan, tapi warnanya sedikit berbeda dari foto.', 'Bahan oke, ukuran agak kebesaran.'],
	2: ['Ada benang yang keluar di bagian jahitan.'],
	1: ['Ukuran tidak sesuai tabel, mohon diperbaiki.']
};

const NOTES = [
	'Tolong titip ke satpam bila tidak ada orang.',
	'Kirim secepatnya ya, untuk hadiah.',
	'Mohon dibungkus rapi.',
	'Hubungi dulu sebelum antar.'
];

/* ====================================================================== */
/* Program utama                                                          */
/* ====================================================================== */
async function main() {
	const sqlite = new Database(DB_PATH);
	sqlite.pragma('busy_timeout = 8000');
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');

	if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get()) {
		if (sqlite.prepare('SELECT 1 FROM settings WHERE key = ?').get(MARKER)) {
			console.log(
				'Data demo ini sudah pernah diisi (ditandai di settings). Tidak ada yang diubah.'
			);
			return;
		}
	}

	// 0) skema terbaru (migrasi berversi) + cadangan sebelum menyentuh data
	const m = migrateDatabase(sqlite);
	if (m.legacy)
		console.log(`  database lama disusul ke baseline (${m.columnsAdded} kolom ditambahkan)`);
	mkdirSync('backups', { recursive: true });
	const backup = path.join(
		'backups',
		`sebelum-seed-demo-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
	);
	await sqlite.backup(backup);
	console.log(`  cadangan: ${backup}`);

	const q = (sql: string) => sqlite.prepare(sql);
	const admin = q("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get() as
		{ id: number } | undefined;
	if (!admin) throw new Error('Akun admin belum ada: jalankan `npm run db:seed` dulu.');
	const adminId = admin.id;

	/* ---------- Siapkan semua berkas gambar DI LUAR transaksi (asinkron) ---------- */
	// Foto produk & bundling memakai gambar yang SUDAH ADA di toko (dipakai bergantian); placeholder hanya dibuat
	// bila toko belum punya gambar sama sekali. Foto ulasan & bukti transfer selalu berupa berkas baru.
	const onDisk = (u: string) => existsSync(path.join(UPLOAD_DIR, u.replace(/^\/uploads\//, '')));
	const poolProducts = (
		q(
			'SELECT DISTINCT image_url u FROM products WHERE image_url IS NOT NULL ORDER BY id'
		).all() as { u: string }[]
	)
		.map((r) => r.u)
		.filter(onDisk);
	const poolBundles = (
		q('SELECT DISTINCT image_url u FROM bundles WHERE image_url IS NOT NULL ORDER BY id').all() as {
			u: string;
		}[]
	)
		.map((r) => r.u)
		.filter(onDisk);
	const imgs = new Map<string, { main: string; extra: string }>();
	for (const [i, p] of NEW_PRODUCTS.entries()) {
		imgs.set(
			p.name,
			poolProducts.length > 0
				? {
						main: poolProducts[i % poolProducts.length],
						extra: poolProducts[(i + 3) % poolProducts.length]
					}
				: {
						main: await placeholder('products', p.name, p.hue),
						extra: await placeholder('products', `${p.name} (2)`, (p.hue + 25) % 360)
					}
		);
	}
	const bundleImgs =
		poolBundles.length >= 2
			? [poolBundles[poolBundles.length - 2], poolBundles[poolBundles.length - 1]]
			: [
					await placeholder('bundles', 'Paket Pasundan', 22),
					await placeholder('bundles', 'Paket Malam Hari', 225)
				];
	const reviewPool: string[] = [];
	for (let i = 0; i < 8; i++)
		reviewPool.push(await placeholder('reviews', `Foto ulasan ${i + 1}`, 30 + i * 40));
	const proofPool: string[] = []; // satu berkas bukti per pesanan transfer (diambil bertahap)
	for (let i = 0; i < 40; i++)
		proofPool.push(await placeholder('proofs', `Bukti transfer #${i + 1}`, 140, false));
	const passwordHash = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

	/* ---------- Statement ---------- */
	const insProduct =
		q(`INSERT INTO products (category_id, name, slug, description, price, stock, weight_grams, image_url, is_bundleable, is_active, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 1, ?, ?)`);
	const insSize = q(
		'INSERT INTO product_sizes (product_id, label, stock, sort_order) VALUES (?, ?, 0, ?)'
	);
	const insGallery = q(
		'INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)'
	);
	const insUser =
		q(`INSERT INTO users (name, email, phone, address, address_province, address_city, address_district, address_village, address_detail,
		address_postal_code, address_village_code, password_hash, role, is_active, created_at, updated_at, must_change_password)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'konsumen', 1, ?, ?, 0)`);
	const updUserAddr =
		q(`UPDATE users SET address=?, address_province=?, address_city=?, address_district=?, address_village=?, address_detail=?,
		address_postal_code=?, address_village_code=?, updated_at=? WHERE id=?`);
	const insLog = q(
		'INSERT INTO activity_logs (user_id, action, entity, entity_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	);
	const log = (
		uid: number | null,
		action: string,
		entity: string,
		entityId: number | null,
		desc: string,
		t: number
	) => insLog.run(uid, action, entity, entityId, desc.slice(0, 255), iso(t));

	const getProd = q('SELECT id, name, price, stock, is_active FROM products WHERE id = ?');
	const getSizeRow = q('SELECT stock FROM product_sizes WHERE product_id = ? AND label = ?');
	const addProdStock = q('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?');
	const addSizeStock = q(
		'UPDATE product_sizes SET stock = stock + ?, updated_at = ? WHERE product_id = ? AND label = ?'
	);
	const addBundleStock = q('UPDATE bundles SET stock = stock + ?, updated_at = ? WHERE id = ?');
	const insMove =
		q(`INSERT INTO stock_movements (product_id, bundle_id, type, quantity_change, stock_after, reference_type, reference_id, note, created_by, created_at, size)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
	const touched = new Set<string>(); // "p:ID:UKURAN" / "b:ID" yang mutasinya perlu diverifikasi

	/** Ubah stok produk (per ukuran bila ada) + catat mutasi. Negatif = kurang (harus cukup). */
	function moveProduct(
		productId: number,
		size: string,
		change: number,
		type: string,
		refType: string | null,
		refId: number | null,
		note: string | null,
		by: number | null,
		t: number
	) {
		if (size) {
			const cur = (getSizeRow.get(productId, size) as { stock: number } | undefined)?.stock;
			if (cur === undefined || cur + change < 0)
				throw new Error(`stok ${productId}/${size} tidak cukup`);
			addSizeStock.run(change, iso(t), productId, size);
			addProdStock.run(change, iso(t), productId);
			insMove.run(
				productId,
				null,
				type,
				change,
				cur + change,
				refType,
				refId,
				note,
				by,
				iso(t),
				size
			);
		} else {
			const cur = (getProd.get(productId) as { stock: number }).stock;
			if (cur + change < 0) throw new Error(`stok ${productId} tidak cukup`);
			addProdStock.run(change, iso(t), productId);
			insMove.run(
				productId,
				null,
				type,
				change,
				cur + change,
				refType,
				refId,
				note,
				by,
				iso(t),
				null
			);
		}
		touched.add(`p:${productId}:${size}`);
	}
	function moveBundle(
		bundleId: number,
		change: number,
		type: string,
		refType: string | null,
		refId: number | null,
		note: string | null,
		by: number | null,
		t: number
	) {
		const cur = (q('SELECT stock FROM bundles WHERE id = ?').get(bundleId) as { stock: number })
			.stock;
		if (cur + change < 0) throw new Error(`kuota paket ${bundleId} tidak cukup`);
		addBundleStock.run(change, iso(t), bundleId);
		insMove.run(null, bundleId, type, change, cur + change, refType, refId, note, by, iso(t), null);
		touched.add(`b:${bundleId}`);
	}

	/* ---------- Pembelian (restock) ---------- */
	const purchaseSeq = new Map<string, number>();
	const insPurchase =
		q(`INSERT INTO purchases (code, supplier_name, purchase_date, total_cost, note, created_by, created_at, status, received_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'diterima', ?)`);
	const insPItem = q(
		'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, size) VALUES (?, ?, ?, ?, ?)'
	);
	function purchase(
		t: number,
		supplier: string,
		note: string,
		lines: { productId: number; size: string; qty: number; cost: number }[]
	) {
		const ymd = ymd6(t);
		const n =
			(purchaseSeq.get(ymd) ??
				(
					q('SELECT COUNT(*) n FROM purchases WHERE code LIKE ?').get(`PBL-${ymd}-%`) as {
						n: number;
					}
				).n) + 1;
		purchaseSeq.set(ymd, n);
		const code = `PBL-${ymd}-${String(n).padStart(3, '0')}`;
		const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
		const date = new Date(t + 7 * HOUR).toISOString().slice(0, 10);
		const pid = Number(
			insPurchase.run(code, supplier, date, total, note, adminId, iso(t), iso(t)).lastInsertRowid
		);
		for (const l of lines) {
			insPItem.run(pid, l.productId, l.qty, l.cost, l.size);
			moveProduct(
				l.productId,
				l.size,
				l.qty,
				'pembelian',
				'purchase',
				pid,
				`Pembelian ${code}`,
				adminId,
				t
			);
		}
		log(
			adminId,
			'purchase.create',
			'purchase',
			pid,
			`Pembelian ${code} dari ${supplier} senilai Rp ${rupiah(total)}`,
			t
		);
	}

	const run = sqlite.transaction(() => {
		/* ================= 1) Produk baru + stok awal lewat pembelian ================= */
		const catId = Object.fromEntries(
			(q('SELECT id, slug FROM categories').all() as { id: number; slug: string }[]).map((c) => [
				c.slug,
				c.id
			])
		);
		const created = new Map<string, number>();
		const launchStart = wib('2026-11-12', '09:00');
		NEW_PRODUCTS.forEach((p, i) => {
			const t = launchStart + i * 6 * HOUR;
			const im = imgs.get(p.name)!;
			const id = Number(
				insProduct.run(
					catId[p.cat],
					p.name,
					slugify(p.name),
					p.description,
					p.price,
					p.weight,
					im.main,
					iso(t),
					iso(t)
				).lastInsertRowid
			);
			insGallery.run(id, im.main, 0);
			insGallery.run(id, im.extra, 1);
			if (p.sizes) SIZE_SETS[p.sizes].forEach((label, k) => insSize.run(id, label, k));
			created.set(p.name, id);
			log(adminId, 'product.create', 'product', id, `Produk ${p.name} dibuat`, t);
		});
		// stok awal: tiga pembelian per kategori (14–16 Nov), dicatat sebagai mutasi pembelian
		for (const cat of ['kaos', 'hoodie', 'celana', 'aksesoris'] as const) {
			const lines: { productId: number; size: string; qty: number; cost: number }[] = [];
			for (const p of NEW_PRODUCTS.filter((x) => x.cat === cat)) {
				const id = created.get(p.name)!;
				if (p.sizes)
					splitStock(p.stock).forEach((qty, k) =>
						lines.push({ productId: id, size: SIZE_SETS[p.sizes!][k], qty, cost: p.cost })
					);
				else lines.push({ productId: id, size: '', qty: p.stock, cost: p.cost });
			}
			purchase(
				wib('2026-11-15', '10:00') +
					['kaos', 'hoodie', 'celana', 'aksesoris'].indexOf(cat) * 3 * HOUR,
				SUPPLIERS[cat],
				'Stok awal produk koleksi November',
				lines
			);
		}

		// berat produk lama (belum punya data berat): perkiraan menurut jenis
		const weightOf = (name: string, cat: string) =>
			/hoodie|crewneck|zip/i.test(name)
				? 620
				: cat === 'celana' || /pants|shorts|celana/i.test(name)
					? 480
					: /topi|hat|beanie|cap/i.test(name)
						? 120
						: /tote|bag/i.test(name)
							? 220
							: /sock|kaos kaki/i.test(name)
								? 70
								: /keychain|gantungan|sticker/i.test(name)
									? 30
									: /longsleeve/i.test(name)
										? 280
										: 240;
		for (const r of q(`SELECT p.id, p.name, c.slug cat FROM products p LEFT JOIN categories c ON c.id = p.category_id
			WHERE p.weight_grams = 300 AND p.id NOT IN (${[...created.values()].join(',')})`).all() as {
			id: number;
			name: string;
			cat: string;
		}[]) {
			q('UPDATE products SET weight_grams = ? WHERE id = ?').run(weightOf(r.name, r.cat), r.id);
		}

		/* ================= 2) Bundling baru dari produk baru ================= */
		const insBundle = q(
			`INSERT INTO bundles (name, slug, description, price, stock, image_url, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?)`
		);
		const insBI = q('INSERT INTO bundle_items (bundle_id, product_id, quantity) VALUES (?, ?, ?)');
		const bundleDefs = [
			{
				name: 'Paket Pasundan',
				desc: 'Kaos Pasundan + topi snapback + tote bag, tampil serasi dari ujung kepala.',
				items: [
					['Pasundan Heritage Tee', 1],
					['Topi Snapback Dawuan', 1],
					['Tote Bag Canvas Subang', 1]
				] as [string, number][],
				off: 0.88,
				quota: 14
			},
			{
				name: 'Paket Malam Hari',
				desc: 'Hoodie Sawah Night + celana parachute + kaos kaki, siap nongkrong sampai larut.',
				items: [
					['Sawah Night Hoodie', 1],
					['Parachute Pants Hitam', 1],
					['Kaos Kaki Crew Stripe', 2]
				] as [string, number][],
				off: 0.86,
				quota: 10
			}
		];
		const newBundleIds: number[] = [];
		bundleDefs.forEach((b, i) => {
			const t = wib('2026-11-16', '13:00') + i * 2 * HOUR;
			const normal = b.items.reduce(
				(s, [n, qty]) => s + NEW_PRODUCTS.find((p) => p.name === n)!.price * qty,
				0
			);
			const bid = Number(
				insBundle.run(
					b.name,
					slugify(b.name),
					b.desc,
					Math.round((normal * b.off) / 500) * 500,
					bundleImgs[i],
					iso(t),
					iso(t)
				).lastInsertRowid
			);
			for (const [n, qty] of b.items) insBI.run(bid, created.get(n)!, qty);
			moveBundle(
				bid,
				b.quota,
				'penyesuaian',
				'manual',
				null,
				'Stok awal kuota bundling',
				adminId,
				t
			);
			log(adminId, 'bundle.create', 'bundle', bid, `Paket ${b.name} dibuat`, t);
			newBundleIds.push(bid);
		});

		/* ================= 3) Pelanggan: baru + alamat terstruktur ================= */
		const newUsers: { id: number; name: string; addr: Addr; createdAt: number }[] = [];
		const usedEmails = new Set(
			(q('SELECT email FROM users').all() as { email: string }[]).map((u) => u.email)
		);
		for (let i = 0; i < 14; i++) {
			const name = `${FIRST[i]} ${LAST[(i * 5 + 3) % LAST.length]}`;
			let email = `${slugify(name).replace(/-/g, '.')}@example.com`;
			if (usedEmails.has(email)) email = `${slugify(name).replace(/-/g, '.')}${i}@example.com`;
			usedEmails.add(email);
			const addr = randomAddress();
			const t = wib('2026-11-03', '08:00') + Math.floor(rng() * 21 * DAY);
			const id = Number(
				insUser.run(
					name,
					email,
					`08${rint(11, 99)}${String(rint(0, 99999999)).padStart(8, '0')}`,
					formatAddress(addr),
					addr.province,
					addr.city,
					addr.district,
					addr.village,
					addr.detail,
					addr.postalCode,
					addr.villageCode,
					passwordHash,
					iso(t),
					iso(t)
				).lastInsertRowid
			);
			newUsers.push({ id, name, addr, createdAt: t });
			log(id, 'auth.register', 'user', id, `Pelanggan baru terdaftar: ${name}`, t);
		}
		// pelanggan contoh yang sudah ada: alamat teks bebas → terstruktur
		const sample = q(
			"SELECT id, name, created_at FROM users WHERE role='konsumen' AND email LIKE '%@example.com' AND address_village_code IS NULL"
		).all() as { id: number; name: string; created_at: string }[];
		const customerAddr = new Map<number, Addr>();
		for (const u of sample) {
			const a = randomAddress();
			updUserAddr.run(
				formatAddress(a),
				a.province,
				a.city,
				a.district,
				a.village,
				a.detail,
				a.postalCode,
				a.villageCode,
				iso(NOW),
				u.id
			);
			customerAddr.set(u.id, a);
		}
		for (const u of newUsers) customerAddr.set(u.id, u.addr);

		// pelanggan yang boleh berbelanja: contoh (aktif) + baru
		type Cust = { id: number; name: string; phone: string; addr: Addr; createdAt: number };
		const customers: Cust[] = (
			q(
				"SELECT id, name, phone, created_at FROM users WHERE role='konsumen' AND is_active=1 AND email LIKE '%@example.com'"
			).all() as { id: number; name: string; phone: string; created_at: string }[]
		)
			.filter((u) => customerAddr.has(u.id))
			.map((u) => ({
				id: u.id,
				name: u.name,
				phone: u.phone ?? '081200000000',
				addr: customerAddr.get(u.id)!,
				createdAt: Date.parse(u.created_at)
			}));

		/* ================= 4) Voucher ================= */
		const insVoucher =
			q(`INSERT INTO vouchers (code, description, type, value, min_subtotal, max_discount, starts_at, ends_at, usage_limit, used_count, per_user_limit, is_active, show_on_home, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`);
		type V = {
			id: number;
			code: string;
			type: 'percent' | 'fixed';
			value: number;
			min: number;
			max: number | null;
			startsAt: number | null;
			endsAt: number | null;
			limit: number | null;
			perUser: number;
			active: boolean;
			pref: number;
		};
		const vlist: (Omit<V, 'id'> & { desc: string; home: boolean })[] = [
			{
				code: 'HEMAT10',
				desc: 'Diskon 10% semua produk, berlaku sampai akhir tahun',
				type: 'percent',
				value: 10,
				min: 100000,
				max: 30000,
				startsAt: wib('2026-11-01'),
				endsAt: wib('2026-12-31', '23:59'),
				limit: 200,
				perUser: 1,
				active: true,
				home: true,
				pref: 0.28
			},
			{
				code: 'ONGKIR15',
				desc: 'Potongan Rp 15.000 untuk belanja di atas Rp 150.000',
				type: 'fixed',
				value: 15000,
				min: 150000,
				max: null,
				startsAt: wib('2026-11-10'),
				endsAt: wib('2026-12-15', '23:59'),
				limit: 60,
				perUser: 1,
				active: true,
				home: true,
				pref: 0.2
			},
			{
				code: 'PAYDAY25',
				desc: 'Promo gajian: potongan Rp 25.000',
				type: 'fixed',
				value: 25000,
				min: 200000,
				max: null,
				startsAt: wib('2026-11-20'),
				endsAt: wib('2026-11-30', '23:59'),
				limit: 40,
				perUser: 1,
				active: true,
				home: true,
				pref: 0.25
			},
			{
				code: 'FLASH50',
				desc: 'Flash sale 50% (maks. Rp 50.000), kuota terbatas',
				type: 'percent',
				value: 50,
				min: 200000,
				max: 50000,
				startsAt: wib('2026-11-17'),
				endsAt: wib('2026-11-28', '23:59'),
				limit: 12,
				perUser: 1,
				active: true,
				home: true,
				pref: 0.22
			},
			{
				code: 'NATAL25',
				desc: 'Promo Natal 25% (maks. Rp 75.000)',
				type: 'percent',
				value: 25,
				min: 250000,
				max: 75000,
				startsAt: wib('2026-12-01'),
				endsAt: wib('2026-12-26', '23:59'),
				limit: 100,
				perUser: 1,
				active: true,
				home: false,
				pref: 0
			},
			{
				code: 'BLACKFRIDAY',
				desc: 'Black Friday 20% (maks. Rp 60.000)',
				type: 'percent',
				value: 20,
				min: 150000,
				max: 60000,
				startsAt: wib('2026-11-26'),
				endsAt: wib('2026-11-29', '23:59'),
				limit: 150,
				perUser: 2,
				active: true,
				home: true,
				pref: 0
			},
			{
				code: 'KAOSBARU',
				desc: 'Selamat datang koleksi November',
				type: 'percent',
				value: 15,
				min: 100000,
				max: 40000,
				startsAt: wib('2026-11-12'),
				endsAt: wib('2026-11-19', '23:59'),
				limit: 30,
				perUser: 1,
				active: true,
				home: false,
				pref: 0.18
			},
			{
				code: 'LEBARAN',
				desc: 'Voucher musiman (sudah berakhir)',
				type: 'percent',
				value: 10,
				min: 0,
				max: null,
				startsAt: wib('2026-09-01'),
				endsAt: wib('2026-10-31', '23:59'),
				limit: null,
				perUser: 1,
				active: true,
				home: false,
				pref: 0
			},
			{
				code: 'MEMBER5',
				desc: 'Voucher internal pelanggan setia (dimatikan)',
				type: 'fixed',
				value: 5000,
				min: 50000,
				max: null,
				startsAt: null,
				endsAt: null,
				limit: null,
				perUser: 5,
				active: false,
				home: false,
				pref: 0
			},
			{
				code: 'MURAH5',
				desc: 'Kuota 5 pelanggan pertama',
				type: 'fixed',
				value: 10000,
				min: 80000,
				max: null,
				startsAt: wib('2026-11-17'),
				endsAt: wib('2026-12-31', '23:59'),
				limit: 5,
				perUser: 1,
				active: true,
				home: false,
				pref: 0.6
			}
		];
		const vouchers: V[] = vlist.map((v) => {
			const { desc, home, ...rest } = v;
			const id = Number(
				insVoucher.run(
					v.code,
					desc,
					v.type,
					v.value,
					v.min,
					v.max,
					v.startsAt ? iso(v.startsAt) : null,
					v.endsAt ? iso(v.endsAt) : null,
					v.limit,
					v.perUser,
					v.active ? 1 : 0,
					home ? 1 : 0,
					iso(wib('2026-11-01')),
					iso(wib('2026-11-01'))
				).lastInsertRowid
			);
			log(
				adminId,
				'voucher.create',
				'voucher',
				id,
				`Voucher ${v.code} dibuat`,
				wib('2026-11-01', '09:00')
			);
			return { id, ...rest };
		});
		const insRedeem = q(
			'INSERT INTO voucher_redemptions (voucher_id, user_id, order_id, created_at) VALUES (?, ?, ?, ?)'
		);
		const bumpVoucher = q('UPDATE vouchers SET used_count = used_count + ? WHERE id = ?');
		const userVoucherUse = (vid: number, uid: number) =>
			(
				q('SELECT COUNT(*) n FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ?').get(
					vid,
					uid
				) as { n: number }
			).n;
		const usedCount = (vid: number) =>
			(q('SELECT used_count u FROM vouchers WHERE id = ?').get(vid) as { u: number }).u;

		/* ================= 5) Simulasi kejadian (pesanan, restock) ================= */
		type Ev = { t: number; seq: number; run: () => void };
		const queue: Ev[] = [];
		let seq = 0;
		const at = (t: number, run: () => void) => queue.push({ t, seq: seq++, run });

		const insOrder =
			q(`INSERT INTO orders (code, user_id, status, subtotal, discount, voucher_code, shipping_cost, total, recipient_name, recipient_phone,
			shipping_address, shipping_postal_code, shipping_village_code, shipping_service, shipping_etd, notes, expires_at, created_at, updated_at)
			VALUES (?, ?, 'menunggu_pembayaran', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
		const insOI = q(
			`INSERT INTO order_items (order_id, item_type, product_id, bundle_id, item_name, unit_price, quantity, subtotal, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insOIC = q(
			'INSERT INTO order_item_components (order_item_id, product_id, quantity, size) VALUES (?, ?, ?, ?)'
		);
		const insPay =
			q(`INSERT INTO payments (order_id, method, amount, proof_url, status, note, confirmed_by, confirmed_at, created_at,
			gateway_order_id, gateway_type, gateway_tx_id, payment_code, redirect_url, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
		const updPay = q(
			'UPDATE payments SET status = ?, note = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?'
		);
		const insSim = q(
			`INSERT INTO payment_simulations (gateway_order_id, token, amount, method, channel, payment_code, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const updSim = q(
			'UPDATE payment_simulations SET status = ?, updated_at = ? WHERE gateway_order_id = ?'
		);
		const setOrder = q('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?');
		const insShip = q(
			`INSERT INTO shipments (order_id, status, updated_at) VALUES (?, 'belum_dikirim', ?)`
		);
		const shipOut = q(
			`UPDATE shipments SET courier=?, tracking_number=?, status='dikirim', shipped_at=?, updated_at=? WHERE order_id=?`
		);
		const shipDone = q(
			`UPDATE shipments SET status='diterima', delivered_at=?, updated_at=? WHERE order_id=?`
		);
		const insReview = q(
			'INSERT INTO reviews (product_id, user_id, order_id, rating, comment, is_visible, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
		);
		const insRImg = q(
			'INSERT INTO review_images (review_id, image_url, sort_order, created_at) VALUES (?, ?, ?, ?)'
		);

		type Line = {
			kind: 'product' | 'bundle';
			id: number;
			name: string;
			price: number;
			qty: number;
			size: string;
			comps?: { productId: number; qty: number; size: string }[];
		};
		const activeProducts = () =>
			q(
				'SELECT p.id, p.name, p.price, p.stock FROM products p WHERE p.is_active = 1 AND p.deleted_at IS NULL AND p.stock > 0'
			).all() as { id: number; name: string; price: number; stock: number }[];
		const sizesOf = (pid: number) =>
			q('SELECT label, stock FROM product_sizes WHERE product_id = ? ORDER BY sort_order, id').all(
				pid
			) as { label: string; stock: number }[];

		/** Susun baris pesanan dari stok SAAT INI (null bila tidak ada yang bisa dibeli). */
		function buildLines(): Line[] | null {
			const lines: Line[] = [];
			const target = wpick([1, 2, 3], [55, 35, 10]);
			const newIds = new Set(created.values());
			let guard = 0;
			while (lines.length < target && guard++ < 25) {
				if (chance(0.14) && lines.every((l) => l.kind !== 'bundle')) {
					const bs = q(
						'SELECT b.id, b.name, b.price, b.stock FROM bundles b WHERE b.is_active = 1 AND b.deleted_at IS NULL AND b.stock > 0'
					).all() as { id: number; name: string; price: number; stock: number }[];
					const b = bs.length ? pick(bs) : null;
					if (b) {
						const comps: Line['comps'] = [];
						let ok = true;
						for (const c of q(
							'SELECT bi.product_id pid, bi.quantity qty FROM bundle_items bi WHERE bi.bundle_id = ?'
						).all(b.id) as { pid: number; qty: number }[]) {
							const sz = sizesOf(c.pid).filter((s) => s.stock >= c.qty);
							const prod = getProd.get(c.pid) as { stock: number; is_active: number };
							if (!prod.is_active || prod.stock < c.qty) {
								ok = false;
								break;
							}
							if (sizesOf(c.pid).length > 0) {
								if (!sz.length) {
									ok = false;
									break;
								}
								comps.push({ productId: c.pid, qty: c.qty, size: pick(sz).label });
							} else comps.push({ productId: c.pid, qty: c.qty, size: '' });
						}
						if (ok) {
							lines.push({
								kind: 'bundle',
								id: b.id,
								name: b.name,
								price: b.price,
								qty: 1,
								size: '',
								comps
							});
							continue;
						}
					}
				}
				const pool = activeProducts();
				if (!pool.length) break;
				// produk baru lebih sering dibeli (sedang diluncurkan)
				const p = wpick(
					pool,
					pool.map((x) => (newIds.has(x.id) ? 2.2 : 1))
				);
				const sz = sizesOf(p.id);
				let size = '';
				if (sz.length) {
					const avail = sz.filter((s) => s.stock > 0);
					if (!avail.length) continue;
					size = wpick(
						avail,
						avail.map((s) => (['M', 'L', '30', '32'].includes(s.label) ? 3 : 1))
					).label;
				}
				if (lines.some((l) => l.kind === 'product' && l.id === p.id && l.size === size)) continue;
				const have = size ? sz.find((s) => s.label === size)!.stock : p.stock;
				const qty = Math.min(have, wpick([1, 2, 3], [78, 17, 5]));
				if (qty < 1) continue;
				lines.push({ kind: 'product', id: p.id, name: p.name, price: p.price, qty, size });
			}
			return lines.length ? lines : null;
		}

		const doneOrders: {
			id: number;
			code: string;
			userId: number;
			completeAt: number;
			lines: Line[];
		}[] = [];
		let proofIdx = 0;
		let gwSeq = (q('SELECT COUNT(*) n FROM payment_simulations').get() as { n: number }).n + 1;
		const codes = new Set(
			(q('SELECT code FROM orders').all() as { code: string }[]).map((o) => o.code)
		);

		function placeOrder(t0: number) {
			const eligible = customers.filter((c) => c.createdAt <= t0 - 5 * MIN);
			if (!eligible.length) return;
			const cust = pick(eligible);
			const lines = buildLines();
			if (!lines) return;
			const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);

			// voucher yang berlaku pada saat itu
			let voucher: V | null = null;
			let discount = 0;
			if (chance(0.5)) {
				const cands = vouchers.filter((v) => {
					if (!v.active || v.pref <= 0) return false;
					if ((v.startsAt && t0 < v.startsAt) || (v.endsAt && t0 > v.endsAt)) return false;
					if (v.limit !== null && usedCount(v.id) >= v.limit) return false;
					if (userVoucherUse(v.id, cust.id) >= v.perUser) return false;
					return subtotal >= v.min;
				});
				if (cands.length) {
					const v = wpick(
						cands,
						cands.map((c) => c.pref)
					);
					const raw = v.type === 'percent' ? Math.floor((subtotal * v.value) / 100) : v.value;
					discount = Math.max(
						0,
						Math.min(v.type === 'percent' && v.max ? Math.min(raw, v.max) : raw, subtotal)
					);
					if (discount > 0) voucher = v;
				}
			}

			const ship = shippingFor(cust.addr.provinceCode);
			const total = subtotal - discount + ship.price;
			let code = '';
			do
				code = `DWN-${ymd6(t0)}-${[...Array(3)]
					.map(() => rint(0, 255).toString(16).padStart(2, '0'))
					.join('')
					.toUpperCase()}`;
			while (codes.has(code));
			codes.add(code);

			const recipient = chance(0.12)
				? {
						name: pick(FIRST) + ' ' + pick(LAST),
						phone: `08${rint(11, 99)}${String(rint(0, 99999999)).padStart(8, '0')}`
					}
				: { name: cust.name, phone: cust.phone };
			const expires = t0 + 24 * HOUR;
			const oid = Number(
				insOrder.run(
					code,
					cust.id,
					subtotal,
					discount,
					voucher?.code ?? null,
					ship.price,
					total,
					recipient.name,
					recipient.phone,
					formatAddress(cust.addr),
					cust.addr.postalCode,
					cust.addr.villageCode,
					ship.label,
					ship.etd,
					chance(0.15) ? pick(NOTES) : null,
					iso(expires),
					iso(t0),
					iso(t0)
				).lastInsertRowid
			);
			const meta = { type: 'penjualan', refType: 'order', refId: oid };
			for (const l of lines) {
				const oi = Number(
					insOI.run(
						oid,
						l.kind,
						l.kind === 'product' ? l.id : null,
						l.kind === 'bundle' ? l.id : null,
						l.name,
						l.price,
						l.qty,
						l.price * l.qty,
						l.size
					).lastInsertRowid
				);
				if (l.kind === 'product')
					moveProduct(l.id, l.size, -l.qty, meta.type, meta.refType, oid, null, cust.id, t0);
				else {
					moveBundle(l.id, -l.qty, meta.type, meta.refType, oid, null, cust.id, t0);
					for (const c of l.comps!) {
						moveProduct(
							c.productId,
							c.size,
							-c.qty * l.qty,
							meta.type,
							meta.refType,
							oid,
							`Komponen paket "${l.name}"`,
							cust.id,
							t0
						);
						insOIC.run(oi, c.productId, c.qty * l.qty, c.size);
					}
				}
			}
			insShip.run(oid, iso(t0));
			if (voucher) {
				insRedeem.run(voucher.id, cust.id, oid, iso(t0));
				bumpVoucher.run(1, voucher.id);
			}
			log(
				cust.id,
				'order.create',
				'order',
				oid,
				`Pesanan ${code} berhasil dibuat senilai Rp ${rupiah(total)}`,
				t0
			);

			/* ----- rencana siklus hidup menurut umur pesanan ----- */
			const ageDays = (NOW - t0) / DAY;
			const path =
				ageDays > 6
					? wpick(
							[
								'selesai',
								'batal_user',
								'kedaluwarsa',
								'batal_setelah_bayar',
								'ditolak_lalu_kedaluwarsa'
							],
							[80, 6, 8, 3, 3]
						)
					: ageDays > 3
						? wpick(
								['selesai', 'dikirim', 'batal_user', 'kedaluwarsa', 'diproses'],
								[58, 24, 6, 7, 5]
							)
						: ageDays > 1
							? wpick(
									[
										'selesai',
										'dikirim',
										'diproses',
										'menunggu_konfirmasi',
										'batal_user',
										'kedaluwarsa'
									],
									[14, 34, 24, 8, 8, 12]
								)
							: wpick(
									[
										'dikirim',
										'diproses',
										'menunggu_konfirmasi',
										'menunggu_pembayaran',
										'batal_user'
									],
									[8, 24, 22, 38, 8]
								);

			const method = wpick(
				['transfer_bank', 'qris', 'va', 'ewallet', 'minimarket'] as const,
				[58, 16, 12, 10, 4]
			);
			const gateway = method !== 'transfer_bank';
			const gw = gateway
				? {
						type:
							method === 'qris'
								? 'qris'
								: method === 'va'
									? pick(['bca_va', 'bni_va', 'bri_va'])
									: method === 'ewallet'
										? pick(['gopay', 'dana', 'shopeepay'])
										: pick(['indomaret', 'alfamart']),
						orderId: `${code}-1`,
						token: randomUUID().replace(/-/g, '').slice(0, 24),
						txId: `sim-${gwSeq++}`,
						pay:
							method === 'va'
								? String(rint(8000, 8999)) + String(rint(0, 99999999999)).padStart(11, '0')
								: method === 'minimarket'
									? `${rint(1000, 9999)}${rint(100000, 999999)}`
									: ''
					}
				: null;
			let payId = 0;

			const startPayment = (t: number) => {
				if (gateway && gw) {
					const channel = method === 'qris' ? 'other_qris' : gw.type;
					insSim.run(
						gw.orderId,
						gw.token,
						total,
						method,
						channel,
						gw.pay || null,
						'pending',
						iso(t + 24 * HOUR),
						iso(t),
						iso(t)
					);
					payId = Number(
						insPay.run(
							oid,
							method,
							total,
							null,
							'menunggu',
							null,
							null,
							null,
							iso(t),
							gw.orderId,
							gw.type,
							gw.txId,
							gw.pay || null,
							`/simulasi-bayar/${gw.token}`,
							iso(t + 24 * HOUR)
						).lastInsertRowid
					);
					log(
						cust.id,
						'payment.start',
						'order',
						oid,
						`Pembayaran online ${code} dimulai (${method})`,
						t
					);
				}
			};
			if (gateway) at(t0 + 20 * 1000, () => startPayment(t0 + 20 * 1000));

			const uploadProof = (t: number) => {
				const proof = proofPool[proofIdx++ % proofPool.length];
				payId = Number(
					insPay.run(
						oid,
						'transfer_bank',
						total,
						proof,
						'menunggu',
						null,
						null,
						null,
						iso(t),
						null,
						null,
						null,
						null,
						null,
						null
					).lastInsertRowid
				);
				setOrder.run('menunggu_konfirmasi', iso(t), oid);
				log(cust.id, 'payment.proof', 'order', oid, `Bukti transfer ${code} diunggah`, t);
			};
			const confirmTransfer = (t: number) => {
				updPay.run('dikonfirmasi', null, adminId, iso(t), payId);
				setOrder.run('diproses', iso(t), oid);
				log(
					adminId,
					'payment.confirm',
					'order',
					oid,
					`Pembayaran pesanan ${code} dikonfirmasi oleh admin`,
					t
				);
			};
			const settleGateway = (t: number) => {
				updPay.run('dikonfirmasi', null, null, iso(t), payId);
				updSim.run('settlement', iso(t), gw!.orderId);
				setOrder.run('diproses', iso(t), oid);
				log(
					null,
					'payment.confirm',
					'order',
					oid,
					`Pembayaran pesanan ${code} lunas otomatis lewat ${method}`,
					t
				);
			};
			const cancel = (t: number, by: number | null, reason: string) => {
				for (const l of lines) {
					if (l.kind === 'product')
						moveProduct(l.id, l.size, l.qty, 'pembatalan', 'order', oid, null, by, t);
					else {
						moveBundle(l.id, l.qty, 'pembatalan', 'order', oid, null, by, t);
						for (const c of l.comps!)
							moveProduct(
								c.productId,
								c.size,
								c.qty * l.qty,
								'pembatalan',
								'order',
								oid,
								null,
								by,
								t
							);
					}
				}
				for (const p of q(
					'SELECT id, status, gateway_order_id g FROM payments WHERE order_id = ?'
				).all(oid) as { id: number; status: string; g: string | null }[]) {
					if (p.status === 'dikonfirmasi')
						updPay.run(
							'dikembalikan',
							`Pesanan dibatalkan: ${reason}`.slice(0, 255),
							null,
							null,
							p.id
						);
					else if (p.status === 'menunggu') {
						updPay.run(
							'ditolak',
							p.g ? 'Waktu pembayaran online habis' : 'Pesanan dibatalkan',
							null,
							null,
							p.id
						);
						if (p.g) updSim.run('expire', iso(t), p.g);
					}
				}
				if (voucher) {
					q('DELETE FROM voucher_redemptions WHERE order_id = ?').run(oid);
					bumpVoucher.run(-1, voucher.id);
				}
				q(
					'UPDATE orders SET status = ?, cancel_reason = ?, cancelled_at = ?, updated_at = ? WHERE id = ?'
				).run('dibatalkan', reason, iso(t), iso(t), oid);
				log(by, 'order.cancel', 'order', oid, `Pesanan ${code} dibatalkan (${reason})`, t);
			};
			const ship_ = (t: number) => {
				const tracking = `${ship.prefix}${String(rint(0, 10 ** 10 - 1)).padStart(10, '0')}`;
				shipOut.run(ship.courier, tracking, iso(t), iso(t), oid);
				setOrder.run('dikirim', iso(t), oid);
				log(
					adminId,
					'shipment.send',
					'order',
					oid,
					`Pesanan ${code} dikirim via ${ship.courier} (Resi: ${tracking})`,
					t
				);
			};
			const complete = (t: number) => {
				shipDone.run(iso(t), iso(t), oid);
				setOrder.run('selesai', iso(t), oid);
				log(
					cust.id,
					'order.complete',
					'order',
					oid,
					`Pesanan ${code} diselesaikan oleh konsumen`,
					t
				);
				doneOrders.push({ id: oid, code, userId: cust.id, completeAt: t, lines });
			};

			// jadwal tahap pembayaran (dipotong bila melewati "sekarang")
			const tPay = t0 + rint(4, 150) * MIN;
			const tConfirm = tPay + rint(10, 300) * MIN;
			const tShip = Math.max(tConfirm, tPay) + rint(4, 30) * HOUR;
			// pembayaran gateway lunas otomatis: pengiriman dihitung dari saat bayar, bukan dari konfirmasi admin
			const tShipFinal = gateway ? tPay + rint(4, 30) * HOUR : tShip;
			const tDone = tShipFinal + rint(1, 4) * DAY + rint(0, 10) * HOUR;
			const payStep = (t: number) => (gateway ? settleGateway(t) : uploadProof(t));
			const sched = (t: number, fn: () => void) => {
				if (t <= NOW) at(t, fn);
			};

			switch (path) {
				case 'menunggu_pembayaran':
					break;
				case 'menunggu_konfirmasi':
					if (gateway) break; // gateway tidak punya status ini: tetap menunggu pembayaran
					sched(tPay, () => uploadProof(tPay));
					break;
				case 'diproses':
				case 'dikirim':
				case 'selesai': {
					if (gateway) sched(tPay, () => settleGateway(tPay));
					else {
						sched(tPay, () => uploadProof(tPay));
						sched(tConfirm, () => confirmTransfer(tConfirm));
					}
					if (path !== 'diproses') sched(tShipFinal, () => ship_(tShipFinal));
					if (path === 'selesai') sched(tDone, () => complete(tDone));
					break;
				}
				case 'batal_user': {
					const tc = t0 + rint(20, 600) * MIN;
					sched(tc, () => cancel(tc, cust.id, 'Dibatalkan oleh pembeli'));
					break;
				}
				case 'kedaluwarsa':
					sched(expires + MIN, () =>
						cancel(expires + MIN, null, 'Melewati batas waktu pembayaran')
					);
					break;
				case 'batal_setelah_bayar': {
					sched(tPay, () => payStep(tPay));
					if (!gateway) sched(tConfirm, () => confirmTransfer(tConfirm));
					const tc = (gateway ? tPay : tConfirm) + rint(2, 20) * HOUR;
					sched(tc, () => cancel(tc, adminId, 'Stok produk bermasalah, dana dikembalikan'));
					break;
				}
				case 'ditolak_lalu_kedaluwarsa': {
					if (gateway) {
						sched(expires + MIN, () =>
							cancel(expires + MIN, null, 'Melewati batas waktu pembayaran')
						);
						break;
					}
					sched(tPay, () => uploadProof(tPay));
					const tr = tPay + rint(30, 240) * MIN;
					sched(tr, () => {
						updPay.run('ditolak', 'Nominal transfer tidak sesuai tagihan', adminId, iso(tr), payId);
						q('UPDATE orders SET status = ?, expires_at = ?, updated_at = ? WHERE id = ?').run(
							'menunggu_pembayaran',
							iso(tr + 24 * HOUR),
							iso(tr),
							oid
						);
						log(
							adminId,
							'payment.reject',
							'order',
							oid,
							`Bukti transfer ${code} ditolak: Nominal transfer tidak sesuai tagihan`,
							tr
						);
					});
					sched(tr + 24 * HOUR + MIN, () =>
						cancel(tr + 24 * HOUR + MIN, null, 'Melewati batas waktu pembayaran')
					);
					break;
				}
			}
		}

		// jadwal pesanan: lebih ramai di akhir pekan & sore/malam (WIB)
		const start = wib('2026-11-17', '07:00');
		for (let t = start; t < NOW - 20 * MIN;) {
			const hour = new Date(t + 7 * HOUR).getUTCHours();
			const rate =
				hour >= 19 && hour <= 22
					? 1.9
					: hour >= 11 && hour <= 14
						? 1.3
						: hour >= 1 && hour <= 6
							? 0.1
							: 0.7;
			if (chance(rate * 0.085)) {
				const when = t + rint(0, 14) * MIN; // nilai tetap per pesanan (bukan variabel loop yang terus berubah)
				at(when, () => placeOrder(when));
			}
			t += 15 * MIN;
		}
		// restock lanjutan (stok menipis → supplier mengirim)
		for (const when of [wib('2026-11-22', '10:00'), wib('2026-11-25', '09:30')]) {
			if (when > NOW) continue;
			at(when, () => {
				const low = q(`SELECT ps.product_id pid, ps.label, ps.stock, p.name, p.price, c.slug cat
					FROM product_sizes ps JOIN products p ON p.id = ps.product_id LEFT JOIN categories c ON c.id = p.category_id
					WHERE ps.stock <= 3 AND p.is_active = 1 AND p.deleted_at IS NULL ORDER BY ps.stock, ps.product_id LIMIT 14`).all() as {
					pid: number;
					label: string;
					stock: number;
					name: string;
					price: number;
					cat: string;
				}[];
				const noSize =
					q(`SELECT p.id pid, p.name, p.price, c.slug cat FROM products p LEFT JOIN categories c ON c.id = p.category_id
					WHERE p.is_active = 1 AND p.deleted_at IS NULL AND p.stock <= 6 AND NOT EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = p.id) LIMIT 6`).all() as {
						pid: number;
						name: string;
						price: number;
						cat: string;
					}[];
				const bySupplier = new Map<
					string,
					{ productId: number; size: string; qty: number; cost: number }[]
				>();
				const add = (
					cat: string,
					line: { productId: number; size: string; qty: number; cost: number }
				) =>
					bySupplier.set(SUPPLIERS[cat] ?? SUPPLIERS.kaos, [
						...(bySupplier.get(SUPPLIERS[cat] ?? SUPPLIERS.kaos) ?? []),
						line
					]);
				for (const l of low)
					add(l.cat, {
						productId: l.pid,
						size: l.label,
						qty: rint(6, 14),
						cost: Math.round((l.price * 0.5) / 500) * 500
					});
				for (const l of noSize)
					add(l.cat, {
						productId: l.pid,
						size: '',
						qty: rint(15, 40),
						cost: Math.round((l.price * 0.45) / 500) * 500
					});
				let k = 0;
				for (const [supplier, lines] of bySupplier)
					purchase(when + k++ * 20 * MIN, supplier, 'Restock rutin (stok menipis)', lines);
			});
		}

		// jalankan kejadian menurut waktu (kejadian baru boleh ditambahkan saat berjalan)
		while (queue.length) {
			queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
			const ev = queue.shift()!;
			ev.run();
		}

		/* ================= 6) Ulasan (sebagian berfoto) ================= */
		let reviewCount = 0;
		let photoCount = 0;
		for (const o of doneOrders) {
			if (!chance(0.8)) continue;
			const tReview = o.completeAt + rint(8, 70) * HOUR;
			if (tReview > NOW) continue;
			const prods = new Map<number, string>();
			for (const l of o.lines) {
				if (l.kind === 'product') prods.set(l.id, l.name);
				else
					for (const c of l.comps!)
						prods.set(c.productId, (getProd.get(c.productId) as { name: string }).name);
			}
			for (const [pid] of prods) {
				if (!chance(0.8)) continue;
				const rating = wpick([5, 4, 3, 2, 1], [58, 26, 9, 4, 3]);
				const rid = Number(
					insReview.run(
						pid,
						o.userId,
						o.id,
						rating,
						chance(0.82) ? pick(REVIEW_TEXT[rating]) : null,
						iso(tReview),
						iso(tReview)
					).lastInsertRowid
				);
				log(
					o.userId,
					'review.create',
					'product',
					pid,
					`Ulasan ${rating} bintang untuk ${prods.get(pid)} (pesanan ${o.code})`,
					tReview
				);
				reviewCount++;
				if (chance(0.32)) {
					const n = rint(1, 2);
					for (let i = 0; i < n; i++) {
						insRImg.run(rid, pick(reviewPool), i, iso(tReview));
						photoCount++;
					}
				}
			}
		}

		/* ================= 7) Stok habis + pengingat stok kembali ================= */
		// koreksi stok: dua ukuran populer dikosongkan (mis. rusak/terjual offline) agar fitur pengingat punya contoh nyata
		const soldOutVariants: { pid: number; size: string }[] = [];
		for (const name of ['Cipali Run Tee', 'Sawah Night Hoodie']) {
			const pid = created.get(name)!;
			const row = q(
				'SELECT label, stock FROM product_sizes WHERE product_id = ? AND stock > 0 ORDER BY stock DESC LIMIT 1'
			).get(pid) as { label: string; stock: number } | undefined;
			if (!row) continue;
			moveProduct(
				pid,
				row.label,
				-row.stock,
				'penyesuaian',
				'manual',
				null,
				'Koreksi stok: terjual offline di bazar',
				adminId,
				NOW - 5 * HOUR
			);
			log(
				adminId,
				'stock.adjust',
				'product',
				pid,
				`Stok ${name} ukuran ${row.label} dikoreksi menjadi 0 (bazar)`,
				NOW - 5 * HOUR
			);
			soldOutVariants.push({ pid, size: row.label });
		}
		const insSub = q(
			'INSERT OR IGNORE INTO stock_subscriptions (user_id, product_id, size, notified_at, created_at) VALUES (?, ?, ?, NULL, ?)'
		);
		for (const v of soldOutVariants) {
			for (const c of [...customers].sort(() => rng() - 0.5).slice(0, rint(2, 4)))
				insSub.run(c.id, v.pid, v.size, iso(NOW - rint(1, 90) * HOUR));
		}
		// varian yang sudah habis karena terjual juga punya peminat
		for (const r of q(`SELECT ps.product_id pid, ps.label FROM product_sizes ps JOIN products p ON p.id = ps.product_id
			WHERE ps.stock = 0 AND p.is_active = 1 AND p.deleted_at IS NULL ORDER BY RANDOM() LIMIT 4`).all() as {
			pid: number;
			label: string;
		}[]) {
			for (const c of [...customers].sort(() => rng() - 0.5).slice(0, rint(1, 3)))
				insSub.run(c.id, r.pid, r.label, iso(NOW - rint(1, 200) * HOUR));
		}

		/* ================= 8) Favorit & keranjang ================= */
		const insWish = q(
			'INSERT OR IGNORE INTO wishlists (user_id, product_id, created_at) VALUES (?, ?, ?)'
		);
		const allActive = q(
			'SELECT id FROM products WHERE is_active = 1 AND deleted_at IS NULL'
		).all() as { id: number }[];
		let wishes = 0;
		for (const c of customers) {
			const n = rint(0, 4);
			for (let i = 0; i < n; i++) {
				insWish.run(c.id, pick(allActive).id, iso(NOW - rint(1, 400) * HOUR));
				wishes++;
			}
		}
		const hasCart = new Set(
			(q('SELECT user_id FROM carts').all() as { user_id: number }[]).map((c) => c.user_id)
		);
		let carts = 0;
		for (const c of newUsers.filter((u) => !hasCart.has(u.id)).slice(0, 9)) {
			const cartId = Number(
				q('INSERT INTO carts (user_id, updated_at) VALUES (?, ?)').run(
					c.id,
					iso(NOW - rint(1, 120) * HOUR)
				).lastInsertRowid
			);
			const picks = new Set<string>();
			for (let i = 0; i < rint(1, 3); i++) {
				const p = pick(activeProducts());
				const sz = sizesOf(p.id).filter((s) => s.stock > 0);
				if (sizesOf(p.id).length && !sz.length) continue;
				const size = sz.length ? pick(sz).label : '';
				if (picks.has(`${p.id}:${size}`)) continue;
				picks.add(`${p.id}:${size}`);
				const have = size ? sz.find((s) => s.label === size)!.stock : p.stock;
				// sebagian baris sengaja tidak dicentang (fitur "pilih item untuk checkout")
				q(
					'INSERT INTO cart_items (cart_id, product_id, quantity, size, is_selected) VALUES (?, ?, ?, ?, ?)'
				).run(cartId, p.id, Math.min(have, rint(1, 2)), size, chance(0.7) ? 1 : 0);
			}
			carts++;
		}

		/* ================= 9) Pengaturan toko & penanda ================= */
		const setS = q(
			'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?'
		);
		setS.run('shipping_origin_postal', '41211', iso(NOW));
		setS.run('shipping_couriers', 'jne,jnt,sicepat,anteraja', iso(NOW));
		q('INSERT INTO settings (key, value) VALUES (?, ?)').run(MARKER, iso(NOW));

		/* ================= 10) Pemeriksaan konsistensi (gagal = rollback) ================= */
		const bad = (msg: string): never => {
			throw new Error(`Pemeriksaan konsistensi GAGAL: ${msg}`);
		};
		if ((q('SELECT COUNT(*) n FROM products WHERE stock < 0').get() as { n: number }).n)
			bad('ada stok produk negatif');
		if ((q('SELECT COUNT(*) n FROM product_sizes WHERE stock < 0').get() as { n: number }).n)
			bad('ada stok ukuran negatif');
		if ((q('SELECT COUNT(*) n FROM bundles WHERE stock < 0').get() as { n: number }).n)
			bad('ada kuota paket negatif');
		const drift =
			q(`SELECT p.id, p.name, p.stock, (SELECT SUM(s.stock) FROM product_sizes s WHERE s.product_id = p.id) AS sz FROM products p
			WHERE EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = p.id) AND p.stock != (SELECT SUM(s.stock) FROM product_sizes s WHERE s.product_id = p.id)`).all();
		if (drift.length)
			bad(`stok produk ≠ jumlah stok ukuran (${JSON.stringify(drift.slice(0, 3))})`);
		for (const key of touched) {
			const [kind, id, size] = key.split(':');
			const last =
				kind === 'b'
					? (q(
							'SELECT stock_after s FROM stock_movements WHERE bundle_id = ? ORDER BY id DESC LIMIT 1'
						).get(Number(id)) as { s: number } | undefined)
					: (q(
							"SELECT stock_after s FROM stock_movements WHERE product_id = ? AND COALESCE(size, '') = ? ORDER BY id DESC LIMIT 1"
						).get(Number(id), size) as { s: number } | undefined);
			const cur =
				kind === 'b'
					? (q('SELECT stock s FROM bundles WHERE id = ?').get(Number(id)) as { s: number }).s
					: size
						? (
								q('SELECT stock s FROM product_sizes WHERE product_id = ? AND label = ?').get(
									Number(id),
									size
								) as { s: number }
							).s
						: (q('SELECT stock s FROM products WHERE id = ?').get(Number(id)) as { s: number }).s;
			if (last && last.s !== cur)
				bad(`mutasi terakhir ${key} (${last.s}) ≠ stok sekarang (${cur})`);
		}
		const sinceDemo = iso(wib('2026-11-17'));
		if (
			(
				q(
					`SELECT COUNT(*) n FROM orders WHERE created_at >= ? AND total != subtotal - discount + shipping_cost`
				).get(sinceDemo) as { n: number }
			).n
		)
			bad('total pesanan ≠ subtotal − diskon + ongkir');
		if (
			(
				q(
					`SELECT COUNT(*) n FROM orders o WHERE o.created_at >= ? AND o.subtotal != (SELECT COALESCE(SUM(subtotal),0) FROM order_items WHERE order_id = o.id)`
				).get(sinceDemo) as { n: number }
			).n
		)
			bad('subtotal pesanan ≠ jumlah item');
		for (const v of q('SELECT id, code, used_count FROM vouchers').all() as {
			id: number;
			code: string;
			used_count: number;
		}[]) {
			const n = (
				q('SELECT COUNT(*) n FROM voucher_redemptions WHERE voucher_id = ?').get(v.id) as {
					n: number;
				}
			).n;
			if (n !== v.used_count) bad(`voucher ${v.code}: used_count ${v.used_count} ≠ pemakaian ${n}`);
		}
		if (
			(
				q(
					`SELECT COUNT(*) n FROM orders o WHERE o.created_at >= ? AND o.status IN ('diproses','dikirim','selesai') AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'dikonfirmasi')`
				).get(sinceDemo) as { n: number }
			).n
		)
			bad('pesanan terbayar tanpa pembayaran terkonfirmasi');
		if (
			(
				q(
					`SELECT COUNT(*) n FROM orders o JOIN shipments s ON s.order_id = o.id WHERE o.created_at >= ? AND o.status IN ('dikirim','selesai') AND s.tracking_number IS NULL`
				).get(sinceDemo) as { n: number }
			).n
		)
			bad('pesanan dikirim tanpa nomor resi');
		if ((q('PRAGMA foreign_key_check').all() as unknown[]).length)
			bad('foreign key tidak konsisten');

		const stat = (sql: string) => (q(sql).get() as { n: number }).n;
		return {
			products: created.size,
			bundles: newBundleIds.length,
			customersNew: newUsers.length,
			customersBackfilled: sample.length,
			orders: stat(`SELECT COUNT(*) n FROM orders WHERE created_at >= '${sinceDemo}'`),
			byStatus: q(
				`SELECT status, COUNT(*) n FROM orders WHERE created_at >= '${sinceDemo}' GROUP BY status ORDER BY n DESC`
			).all() as { status: string; n: number }[],
			reviews: reviewCount,
			photos: photoCount,
			vouchers: vouchers.length,
			redemptions: stat('SELECT COUNT(*) n FROM voucher_redemptions'),
			wishes,
			carts,
			alerts: stat('SELECT COUNT(*) n FROM stock_subscriptions')
		};
	});

	const r = run();
	console.log('\n✓ Data demo terisi.');
	console.log(`  Produk baru: ${r.products} · paket bundling baru: ${r.bundles}`);
	console.log(`  Pelanggan baru: ${r.customersNew} · alamat dilengkapi: ${r.customersBackfilled}`);
	console.log(
		`  Pesanan baru: ${r.orders} (${r.byStatus.map((s) => `${s.status} ${s.n}`).join(', ')})`
	);
	console.log(
		`  Ulasan: ${r.reviews} (${r.photos} foto) · voucher: ${r.vouchers} (${r.redemptions} pemakaian)`
	);
	console.log(`  Favorit: ${r.wishes} · keranjang: ${r.carts} · pengingat stok: ${r.alerts}`);
	console.log(`  Akun pelanggan contoh memakai password: ${PASSWORD}`);
	sqlite.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
