/**
 * Seed riwayat 5 bulan: 30 pelanggan, 7 paket bundling baru, ±280 pesanan lengkap (pembayaran, pengiriman,
 * pembatalan), restock/pembelian, mutasi stok, log aktivitas, dan ulasan produk.
 *
 * Prinsip: stok & kuota SEKARANG tidak berubah. Riwayat disusun mundur dari stok sekarang oleh "perencana
 * pasokan" per (produk, ukuran) dan per paket: pasokan (restock) dialokasikan ke tanggal restock bersama
 * sehingga stok tidak pernah negatif dan berakhir tepat di nilai sekarang. Semua nilai acak memakai PRNG
 * ber-seed tetap (hasil dapat diulang untuk jam yang sama).
 *
 * Aman dijalankan berulang: bila sudah ada pengguna `*@example.com`, tidak ada yang diubah.
 * Hanya untuk data contoh/pengembangan. Pakai:  npm run db:seed-riwayat   (jalankan db:migrate-sync dulu)
 */
import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';
import sharp from 'sharp';

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD !== 'true') {
	throw new Error(
		'Riwayat contoh tidak boleh diisi di produksi (set SEED_ALLOW_PROD=true bila sengaja).'
	);
}

const sqlite = new Database(process.env.DATABASE_URL || 'downshit.db');
sqlite.pragma('foreign_keys = ON');

if (sqlite.prepare(`SELECT 1 FROM users WHERE email LIKE '%@example.com' LIMIT 1`).get()) {
	console.log('Riwayat sudah pernah diisi (ada pengguna *@example.com). Tidak ada yang diubah.');
	process.exit(0);
}

/* ====================================================================== */
/* Utilitas: PRNG, waktu, format                                          */
/* ====================================================================== */
function mulberry32(a: number) {
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
type Rng = () => number;
const SEED = 20261116;
const rng: Rng = mulberry32(SEED);
const uni = (r: Rng, a: number, b: number) => a + (b - a) * r();
const rint = (r: Rng, a: number, b: number) => Math.floor(uni(r, a, b + 1));
const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const chance = (r: Rng, p: number) => r() < p;
function wpick<T>(r: Rng, items: readonly T[], weights: readonly number[]): T {
	const total = weights.reduce((a, b) => a + b, 0);
	let x = r() * total;
	for (let i = 0; i < items.length; i++) {
		x -= weights[i];
		if (x <= 0) return items[i];
	}
	return items[items.length - 1];
}
function normal(r: Rng, mean = 0, sd = 1) {
	const u1 = Math.max(r(), 1e-9);
	return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * r());
}
const shuffle = <T>(r: Rng, arr: T[]): T[] => {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
};

const MIN = 60_000;
const H = 3_600_000;
const DAY = 86_400_000;
const WIB_OFF = 7 * H;
const pad = (n: number, l = 2) => String(n).padStart(l, '0');
const iso = (t: number) => new Date(t).toISOString();
const fmtRp = (n: number) => n.toLocaleString('id-ID');
const round500 = (n: number) => Math.round(n / 500) * 500;
const roundUp6 = (n: number) => Math.ceil(n / 6) * 6;

const wib = (t: number) => {
	const d = new Date(t + WIB_OFF);
	return {
		y: d.getUTCFullYear(),
		m: d.getUTCMonth() + 1,
		d: d.getUTCDate(),
		h: d.getUTCHours(),
		mi: d.getUTCMinutes(),
		dow: d.getUTCDay()
	};
};
const fromWib = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) =>
	Date.UTC(y, m - 1, d, h, mi, s) - WIB_OFF;
const ymdWib = (t: number) => {
	const w = wib(t);
	return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
};
const ymdCompact = (t: number) => {
	const w = wib(t);
	return `${String(w.y).slice(2)}${pad(w.m)}${pad(w.d)}`;
};
const wibHour = (t: number) => {
	const w = wib(t);
	return w.h + w.mi / 60;
};
const wibDayStart = (t: number) => {
	const w = wib(t);
	return fromWib(w.y, w.m, w.d);
};

const START = fromWib(2026, 6, 16, 0, 0);
const NOW = Date.now();
if (NOW < START + 60 * DAY) {
	throw new Error(
		'Jam sistem terlalu dini: riwayat 5 bulan butuh tanggal sekarang ≥ pertengahan Agustus 2026.'
	);
}
const GENERAL_END = NOW - 5 * DAY; // pesanan "umum" berakhir di sini; sisanya pesanan terbaru yang diatur manual

/* ====================================================================== */
/* Data referensi dari DB                                                 */
/* ====================================================================== */
const admin = sqlite
	.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`)
	.get() as { id: number } | undefined;
if (!admin) throw new Error('Tidak ada akun admin. Jalankan db:seed dulu.');
const ADMIN_ID = admin.id;

const shipRow = sqlite
	.prepare(`SELECT value FROM settings WHERE key = 'shipping_flat_cost'`)
	.get() as { value: string } | undefined;
const SHIPPING = Number.isFinite(Number(shipRow?.value)) && shipRow ? Number(shipRow.value) : 15000;

type Prod = {
	id: number;
	name: string;
	slug: string;
	cat: string;
	price: number;
	stock: number;
	sizes: { label: string; stock: number }[];
	launchIdx: number;
	availAt: number;
	pop: number;
	quality: number;
};
const prodRows = sqlite
	.prepare(
		`SELECT p.id, p.name, p.slug, c.slug AS cat, p.price, p.stock FROM products p
		 JOIN categories c ON c.id = p.category_id WHERE p.deleted_at IS NULL AND p.is_active = 1 ORDER BY p.id`
	)
	.all() as { id: number; name: string; slug: string; cat: string; price: number; stock: number }[];
const sizeRows = sqlite
	.prepare(`SELECT product_id, label, stock FROM product_sizes ORDER BY product_id, id`)
	.all() as { product_id: number; label: string; stock: number }[];
const prods: Prod[] = prodRows.map((p) => ({
	...p,
	sizes: sizeRows
		.filter((s) => s.product_id === p.id)
		.map((s) => ({ label: s.label, stock: s.stock })),
	launchIdx: 0,
	availAt: 0,
	pop: 1,
	quality: 4.3
}));
const prodById = new Map(prods.map((p) => [p.id, p]));
const prodByName = new Map(prods.map((p) => [p.name, p]));

/* ====================================================================== */
/* Tanggal restock bersama & jadwal rilis produk                          */
/* ====================================================================== */
const RESTOCK: number[] = [];
{
	let base = fromWib(2026, 6, 16, 10, 30);
	RESTOCK.push(base);
	for (;;) {
		base += 21 * DAY;
		const t =
			wibDayStart(base) + rint(rng, 10, 14) * H + rint(rng, 0, 59) * MIN + rint(rng, -1, 1) * DAY;
		if (t > NOW - 4 * DAY) break;
		RESTOCK.push(t);
	}
}
const M = RESTOCK.length;

// Produk dasar rilis di restock pertama; artikel baru tersebar menurut bobot pada restock berikutnya
const BASE_NAMES = new Set([
	'Kaos Downshit Classic Hitam',
	'Kaos Downshit Logo Putih',
	'Hoodie Downshit Heavy',
	'Celana Cargo Downshit',
	'Topi Downshit Dad Hat'
]);
{
	// Artikel yang harus jadi terlaris dirilis lebih awal agar punya masa jual panjang
	const FORCE_LAUNCH: Record<string, number> = { 'Gang Sempit Tee': 0, 'Karat Oversized Tee': 1 };
	for (const p of prods)
		if (p.name in FORCE_LAUNCH) p.launchIdx = Math.min(FORCE_LAUNCH[p.name], M - 1);
	const rest = shuffle(
		rng,
		prods.filter((p) => !BASE_NAMES.has(p.name) && !(p.name in FORCE_LAUNCH))
	);
	const weights = [5, 5, 4, 4, 3, 2, 1].slice(0, Math.min(7, M));
	const slots: number[] = [];
	weights.forEach((w, i) => {
		for (let k = 0; k < w; k++) slots.push(i);
	});
	rest.forEach((p, i) => (p.launchIdx = slots[i % slots.length]));
	for (const p of prods) p.availAt = RESTOCK[p.launchIdx] + 30 * MIN;
}

/* Popularitas & kualitas laten */
const POP_MULT: Record<string, number> = {
	'Gang Sempit Tee': 4.8,
	'Karat Oversized Tee': 3.2,
	'Collapsed Boxy Tee': 1.9,
	'Subang Skate Tee': 1.7,
	'Lembur Club Tee': 1.3,
	'Karat Keychain': 1.6,
	'Subang Skate Socks': 1.4,
	'Kaos Downshit Classic Hitam': 1.3,
	'Midnight Dawuan Crewneck': 0.35,
	'Hujan Deras Hoodie': 0.5,
	'Jalan Pintas Tee': 0.55,
	'Karat Work Pants': 0.45
};
const PREMIUM = new Set([
	'Collapsed Boxy Tee',
	'Subang Skate Tee',
	'Lembur Club Hoodie',
	'Subang Skate Hoodie',
	'Kaos Downshit Classic Hitam',
	'Hoodie Downshit Heavy',
	'Collapsed Zip Hoodie'
]);
const WEAK: Record<string, number> = {
	'Karat Oversized Tee': 3.8,
	'Static Noise Beanie': 3.7,
	'Rebahan Shorts': 3.9
};
const CAT_POP: Record<string, number> = { kaos: 1.2, hoodie: 0.75, celana: 0.7, aksesoris: 0.9 };
for (const p of prods) {
	p.pop = Math.exp(normal(rng, 0, 0.5)) * (CAT_POP[p.cat] ?? 1) * (POP_MULT[p.name] ?? 1);
	p.quality = WEAK[p.name] ?? (PREMIUM.has(p.name) ? uni(rng, 4.7, 4.9) : uni(rng, 4.1, 4.6));
}

/* ====================================================================== */
/* Paket bundling (7 baru + yang sudah ada)                               */
/* ====================================================================== */
type Bundle = {
	id: number;
	/** kunci rantai stok yang stabil: id lama, atau `new:slug` untuk paket baru (id belum ada saat perencanaan) */
	key: string;
	name: string;
	slug: string;
	description: string | null;
	price: number;
	finalQuota: number;
	isNew: boolean;
	comps: { productId: number; qty: number }[];
	launchAt: number;
	pop: number;
};
const NEW_BUNDLES: { name: string; desc: string; comps: string[] }[] = [
	{
		name: 'Paket Collapsed',
		desc: 'Satu set artikel Collapsed: kaos boxy, celana baggy, dan tote bag.',
		comps: ['Collapsed Boxy Tee', 'Collapsed Baggy Pants', 'Collapsed Tote Bag']
	},
	{
		name: 'Paket Subang Skate',
		desc: 'Kaos, hoodie, dan kaos kaki seri Subang Skate untuk satu outfit lengkap.',
		comps: ['Subang Skate Tee', 'Subang Skate Hoodie', 'Subang Skate Socks']
	},
	{
		name: 'Paket Lembur Club',
		desc: 'Kaos dan hoodie Lembur Club, cocok untuk yang pulang paling akhir.',
		comps: ['Lembur Club Tee', 'Lembur Club Hoodie']
	},
	{
		name: 'Paket Pantura',
		desc: 'Longsleeve, cargo pants, dan trucker hat seri Pantura.',
		comps: ['Pantura Longsleeve Tee', 'Pantura Cargo Pants', 'Pantura Trucker Hat']
	},
	{
		name: 'Paket Karat',
		desc: 'Kaos oversized, work pants, dan gantungan kunci seri Karat.',
		comps: ['Karat Oversized Tee', 'Karat Work Pants', 'Karat Keychain']
	},
	{
		name: 'Paket Static Noise',
		desc: 'Kaos dan kupluk seri Static Noise.',
		comps: ['Static Noise Tee', 'Static Noise Beanie']
	},
	{
		name: 'Paket Rebahan',
		desc: 'Kaos dan celana pendek santai seri Rebahan.',
		comps: ['Rebahan Society Tee', 'Rebahan Shorts']
	}
];
const bundles: Bundle[] = [];
{
	const existing = sqlite
		.prepare(
			`SELECT id, name, slug, description, price, stock FROM bundles WHERE deleted_at IS NULL ORDER BY id`
		)
		.all() as {
		id: number;
		name: string;
		slug: string;
		description: string | null;
		price: number;
		stock: number;
	}[];
	const itemRows = sqlite
		.prepare(`SELECT bundle_id, product_id, quantity FROM bundle_items`)
		.all() as { bundle_id: number; product_id: number; quantity: number }[];
	for (const b of existing) {
		const comps = itemRows
			.filter((i) => i.bundle_id === b.id)
			.map((i) => ({ productId: i.product_id, qty: i.quantity }));
		const maxIdx = Math.max(...comps.map((c) => prodById.get(c.productId)?.launchIdx ?? 0));
		bundles.push({
			...b,
			key: String(b.id),
			finalQuota: b.stock,
			isNew: false,
			comps,
			launchAt: RESTOCK[maxIdx] + rint(rng, 2, 5) * DAY + 2 * H,
			pop: uni(rng, 0.7, 1.4)
		});
	}
	const slugs = new Set(
		(sqlite.prepare(`SELECT slug FROM bundles`).all() as { slug: string }[]).map((s) => s.slug)
	);
	NEW_BUNDLES.forEach((nb, i) => {
		const comps = nb.comps.map((n) => {
			const p = prodByName.get(n);
			if (!p) throw new Error(`Produk "${n}" untuk ${nb.name} tidak ditemukan.`);
			return { productId: p.id, qty: 1 };
		});
		const normalSum = comps.reduce((s, c) => s + (prodById.get(c.productId)?.price ?? 0), 0);
		const price = round500(normalSum * uni(rng, 0.82, 0.9));
		const maxIdx = Math.max(...comps.map((c) => prodById.get(c.productId)?.launchIdx ?? 0));
		let slug = nb.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '');
		while (slugs.has(slug)) slug += '-2';
		slugs.add(slug);
		bundles.push({
			id: 0,
			key: `new:${slug}`,
			name: nb.name,
			slug,
			description: nb.desc,
			price,
			finalQuota: rint(rng, 8, 30),
			isNew: true,
			comps,
			launchAt: RESTOCK[maxIdx] + rint(rng, 2, 6) * DAY + (i % 3) * H + 3 * H,
			pop: uni(rng, 0.6, 1.7)
		});
	});
}

/* ====================================================================== */
/* Pelanggan                                                              */
/* ====================================================================== */
const NAMES: [string, string][] = [
	['Adi', 'Nugraha'],
	['Siti', 'Rahmawati'],
	['Budi', 'Santoso'],
	['Dewi', 'Lestari'],
	['Rizky', 'Pratama'],
	['Nur', 'Aisyah'],
	['Fajar', 'Ramadhan'],
	['Putri', 'Maharani'],
	['Dimas', 'Prasetyo'],
	['Rina', 'Wulandari'],
	['Agus', 'Setiawan'],
	['Intan', 'Permata'],
	['Yusuf', 'Hidayat'],
	['Maya', 'Anggraini'],
	['Bagas', 'Saputra'],
	['Lia', 'Kusuma'],
	['Hendra', 'Gunawan'],
	['Citra', 'Dewanti'],
	['Rafi', 'Maulana'],
	['Ayu', 'Puspita'],
	['Galih', 'Firmansyah'],
	['Tiara', 'Salsabila'],
	['Eko', 'Wahyudi'],
	['Nabila', 'Zahra'],
	['Ilham', 'Kurniawan'],
	['Sekar', 'Ayuningtyas'],
	['Reza', 'Alfarizi'],
	['Anisa', 'Fitriani'],
	['Doni', 'Hermawan'],
	['Mega', 'Silvia']
];
const STREETS = [
	'Raya Otista',
	'Merdeka',
	'Jenderal Sudirman',
	'Ahmad Yani',
	'Pasar Baru',
	'Siliwangi',
	'Pahlawan',
	'Cagak',
	'Veteran',
	'Kebon Jati',
	'Mawar',
	'Melati',
	'Kenanga',
	'Cempaka',
	'Dipati Ukur',
	'Cihampelas',
	'Setiabudi',
	'Kemang Selatan'
];
const LOCALES: {
	city: string;
	prov: string;
	kec: string[];
	kel: string[];
	zip: string[];
	w: number;
}[] = [
	{
		city: 'Kabupaten Subang',
		prov: 'Jawa Barat',
		kec: ['Subang', 'Dawuan', 'Pagaden', 'Pamanukan', 'Kalijati', 'Cipunagara'],
		kel: ['Karanganyar', 'Soklat', 'Cigadung', 'Dawuan Kidul', 'Pagaden Barat', 'Mulyasari'],
		zip: ['41211', '41212', '41213', '41251', '41271', '41286'],
		w: 8
	},
	{
		city: 'Kota Bandung',
		prov: 'Jawa Barat',
		kec: ['Coblong', 'Cicendo', 'Buahbatu', 'Sukajadi', 'Antapani'],
		kel: ['Lebak Siliwangi', 'Pasteur', 'Margasari', 'Pasteur', 'Antapani Kidul'],
		zip: ['40132', '40171', '40287', '40162', '40291'],
		w: 3
	},
	{
		city: 'Jakarta Selatan',
		prov: 'DKI Jakarta',
		kec: ['Kebayoran Baru', 'Tebet', 'Pancoran'],
		kel: ['Senayan', 'Tebet Barat', 'Kalibata'],
		zip: ['12110', '12810', '12740'],
		w: 1.5
	},
	{
		city: 'Kota Cirebon',
		prov: 'Jawa Barat',
		kec: ['Kejaksan', 'Harjamukti'],
		kel: ['Kebonbaru', 'Kalijaga'],
		zip: ['45121', '45142'],
		w: 0.8
	},
	{
		city: 'Kabupaten Purwakarta',
		prov: 'Jawa Barat',
		kec: ['Purwakarta', 'Plered'],
		kel: ['Nagri Kaler', 'Citeko'],
		zip: ['41111', '41162'],
		w: 0.7
	},
	{
		city: 'Kabupaten Karawang',
		prov: 'Jawa Barat',
		kec: ['Karawang Barat', 'Telukjambe Timur'],
		kel: ['Nagasari', 'Sukaluyu'],
		zip: ['41311', '41361'],
		w: 0.6
	},
	{
		city: 'Kota Bekasi',
		prov: 'Jawa Barat',
		kec: ['Bekasi Timur', 'Bekasi Selatan'],
		kel: ['Margahayu', 'Kayuringin Jaya'],
		zip: ['17113', '17148'],
		w: 0.4
	}
];
const PHONE_PREFIX = [
	'0811',
	'0812',
	'0813',
	'0821',
	'0822',
	'0852',
	'0857',
	'0878',
	'0895',
	'0896'
];

type Customer = {
	idx: number;
	id: number;
	name: string;
	email: string;
	phone: string;
	address: string;
	regAt: number;
	active: boolean;
	affinity: number[]; // kaos, hoodie, celana, aksesoris
	usualLetter: string;
	usualWaist: string;
	count: number;
};
const CATS = ['kaos', 'hoodie', 'celana', 'aksesoris'] as const;

/** Waktu belanja WIB 08:00–23:30, lebih ramai malam hari */
const HOUR_W = [2, 3, 4, 5, 6, 5, 4, 4, 5, 6, 7, 9, 11, 12, 10, 4]; // jam 8 … 23
function shopOffset(r: Rng): number {
	const h = 8 + wpick(r, [...HOUR_W.keys()], HOUR_W);
	const maxMin = h === 23 ? 30 : 60;
	return h * H + rint(r, 0, maxMin - 1) * MIN + rint(r, 0, 59) * 1000;
}
function shopTimeOnOrAfter(t: number, r: Rng): number {
	const hr = wibHour(t);
	if (hr >= 8 && hr < 23.5) return t;
	const ds = wibDayStart(t);
	return (hr < 8 ? ds : ds + DAY) + 8 * H + rint(r, 0, 150) * MIN;
}

/* Bobot hari: tren naik, akhir pekan & tanggal gajian lebih ramai */
const NDAYS = Math.floor((NOW - START) / DAY) + 1;
const dayStart = (i: number) => START + i * DAY;
const dayIdx = (t: number) => Math.max(0, Math.min(NDAYS - 1, Math.floor((t - START) / DAY)));
const dayW: number[] = [];
for (let i = 0; i < NDAYS; i++) {
	const w = wib(dayStart(i));
	const trend = 0.55 + (1.05 * i) / NDAYS;
	const dow = w.dow === 0 || w.dow === 6 ? 1.25 : w.dow === 5 ? 1.1 : 1;
	const payday = w.d >= 25 || w.d <= 2 ? 1.2 : 1;
	dayW.push(trend * dow * payday);
}
const dayCum: number[] = [];
dayW.reduce((acc, w, i) => (dayCum[i] = acc + w), 0);
function sampleDay(r: Rng, lo: number, hi: number): number {
	const base = lo > 0 ? dayCum[lo - 1] : 0;
	const x = base + r() * (dayCum[hi] - base);
	let a = lo;
	let b = hi;
	while (a < b) {
		const mid = (a + b) >> 1;
		if (dayCum[mid] >= x) b = mid;
		else a = mid + 1;
	}
	return a;
}

const customers: Customer[] = [];
{
	const emails = new Set<string>();
	const regLo = START + 7 * DAY;
	const regHi = NOW - 21 * DAY;
	const regTimes: number[] = [];
	for (let i = 0; i < 6; i++) {
		regTimes.push(
			shopTimeOnOrAfter(START + rint(rng, 0, 6) * DAY + 12 * H + rint(rng, 0, 500) * MIN, rng)
		);
	}
	for (let i = 6; i < NAMES.length; i++) {
		const u = Math.pow(rng(), 1.25);
		regTimes.push(shopTimeOnOrAfter(regLo + u * (regHi - regLo), rng));
	}
	regTimes.sort((a, b) => a - b);
	const order = shuffle(
		rng,
		NAMES.map((_, i) => i)
	);
	NAMES.forEach(([first, last], idx) => {
		const name = `${first} ${last}`;
		const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
		if (emails.has(email)) throw new Error(`Email ganda: ${email}`);
		emails.add(email);
		const loc = wpick(
			rng,
			LOCALES,
			LOCALES.map((l) => l.w)
		);
		const k = rint(rng, 0, loc.kec.length - 1);
		const address = `Jl. ${pick(rng, STREETS)} No. ${rint(rng, 1, 120)}, RT ${pad(rint(rng, 1, 12))}/RW ${pad(
			rint(rng, 1, 9)
		)}, Kel. ${loc.kel[k] ?? loc.kel[0]}, Kec. ${loc.kec[k]}, ${loc.city}, ${loc.prov} ${loc.zip[k] ?? loc.zip[0]}`;
		const fav = rint(rng, 0, 3);
		const aff = CATS.map(
			(_, ci) => [0.5, 0.2, 0.18, 0.12][ci] * uni(rng, 0.4, 1.8) * (ci === fav ? 2 : 1)
		);
		customers.push({
			idx,
			id: 0,
			name,
			email,
			phone: `${pick(rng, PHONE_PREFIX)}${rint(rng, 1000000, 9999999)}`,
			address,
			regAt: regTimes[order.indexOf(idx)],
			active: true,
			affinity: aff,
			usualLetter: wpick(rng, ['S', 'M', 'L', 'XL'], [0.17, 0.38, 0.33, 0.12]),
			usualWaist: wpick(rng, ['28', '30', '32', '34'], [0.12, 0.36, 0.34, 0.18]),
			count: 0
		});
	});
}

/* ====================================================================== */
/* Pesanan: jumlah per pelanggan, waktu, baris                            */
/* ====================================================================== */
type Line =
	| { kind: 'product'; productId: number; size: string; qty: number; unit: number; name: string }
	| {
			kind: 'bundle';
			bundleId: number;
			selection: string;
			qty: number;
			unit: number;
			name: string;
			comps: { productId: number; size: string; qty: number }[];
	  };
type Stage = null | 'pay' | 'confirm' | 'process' | 'ship' | 'done';
type Path = 'normal' | 'rejected' | 'unpaid' | 'custCancel' | 'adminCancel';
type LogEv = { t: number; who: 'cust' | 'admin' | 'system'; action: string; desc: string };
type Proof = {
	at: number;
	status: 'menunggu' | 'ditolak' | 'dikonfirmasi' | 'dikembalikan';
	note: string | null;
	byAt: number | null;
};
type Life = {
	status: string;
	expiresAt: number;
	proofs: Proof[];
	shipped: null | { at: number; courier: string; tracking: string };
	delivered: null | { at: number; by: 'cust' | 'system' };
	cancelled: null | { at: number; by: 'cust' | 'admin' | 'system'; reason: string };
	updatedAt: number;
	logs: LogEv[];
};
type GenOrder = {
	idx: number;
	cust: Customer;
	createdAt: number;
	lines: Line[];
	subtotal: number;
	code: string;
	path: Path;
	stage: Stage;
	rejectFlag: boolean;
	notes: string | null;
	life: Life;
	id: number;
};

const N_GENERAL = 270;
{
	const avail = (c: Customer) => Math.max(5, (GENERAL_END - c.regAt) / DAY);
	const act = customers.map(() => Math.exp(normal(rng, 0, 0.55)));
	const w = customers.map((c, i) => act[i] * Math.pow(avail(c), 0.7));
	const sum = w.reduce((a, b) => a + b, 0);
	const counts = w.map((x) => Math.min(12, Math.max(3, Math.round((x / sum) * N_GENERAL))));
	let total = counts.reduce((a, b) => a + b, 0);
	while (total !== N_GENERAL) {
		const i = rint(rng, 0, counts.length - 1);
		if (total > N_GENERAL && counts[i] > 3) {
			counts[i]--;
			total--;
		} else if (total < N_GENERAL && counts[i] < 12) {
			counts[i]++;
			total++;
		}
	}
	customers.forEach((c, i) => (c.count = counts[i]));
}

function genTimes(c: Customer, n: number, hi: number, r: Rng): number[] {
	const first = shopTimeOnOrAfter(c.regAt + uni(r, 0.3 * H, 30 * H), r);
	const lo = dayIdx(first) + 1;
	const hiDay = dayIdx(hi);
	for (let attempt = 0; attempt < 60; attempt++) {
		const ts: number[] = [first];
		for (let k = 1; k < n; k++) {
			const d = sampleDay(r, Math.min(lo, hiDay), hiDay);
			ts.push(dayStart(d) + shopOffset(r));
		}
		ts.sort((a, b) => a - b);
		let ok = ts[ts.length - 1] <= hi;
		for (let k = 1; k < ts.length && ok; k++) if (ts[k] - ts[k - 1] < 18 * H) ok = false;
		if (ok) return ts;
	}
	// cadangan: sebar merata
	const span = Math.max(DAY, hi - first);
	return Array.from({ length: n }, (_, k) => shopTimeOnOrAfter(first + (span * k) / n, r)).filter(
		(t) => t <= hi
	);
}

const CAT_PRODUCTS = new Map<string, Prod[]>();
for (const p of prods) CAT_PRODUCTS.set(p.cat, [...(CAT_PRODUCTS.get(p.cat) ?? []), p]);

function chooseSize(r: Rng, c: Customer, p: Prod): string {
	if (p.sizes.length === 0) return '';
	const labels = p.sizes.map((s) => s.label);
	const usual = p.cat === 'celana' ? c.usualWaist : c.usualLetter;
	if (labels.includes(usual) && chance(r, 0.78)) return usual;
	const wmap: Record<string, number> = {
		S: 0.17,
		M: 0.38,
		L: 0.33,
		XL: 0.12,
		'28': 0.12,
		'30': 0.36,
		'32': 0.34,
		'34': 0.18
	};
	return wpick(
		r,
		labels,
		labels.map((l) => wmap[l] ?? 0.2)
	);
}

function genLines(r: Rng, c: Customer, t: number): Line[] {
	const nLines = wpick(r, [1, 2, 3], [0.58, 0.3, 0.12]);
	const lines: Line[] = [];
	const used = new Set<string>();
	const availBundles = bundles.filter((b) => b.launchAt + 30 * MIN <= t);
	for (let li = 0; li < nLines; li++) {
		if (availBundles.length > 0 && chance(r, 0.18)) {
			const b = wpick(
				r,
				availBundles,
				availBundles.map((x) => x.pop)
			);
			const key = `b${b.id || b.name}`;
			if (!used.has(key)) {
				used.add(key);
				const comps = b.comps.map((bc) => {
					const p = prodById.get(bc.productId)!;
					return { productId: p.id, size: chooseSize(r, c, p), qty: bc.qty };
				});
				const sel = Object.fromEntries(
					comps.filter((x) => x.size).map((x) => [x.productId, x.size])
				);
				const selection = Object.entries(sel)
					.map(([id, l]) => [Number(id), l] as const)
					.sort((a, b2) => a[0] - b2[0])
					.map(([id, l]) => `${id}:${l}`)
					.join('|');
				lines.push({
					kind: 'bundle',
					bundleId: b.id,
					selection,
					qty: chance(r, 0.94) ? 1 : 2,
					unit: b.price,
					name: b.name,
					comps
				});
				continue;
			}
		}
		const accessoryOnly = li > 0 && chance(r, 0.35);
		const catW = accessoryOnly ? [0, 0, 0, 1] : c.affinity;
		const cat = wpick(r, CATS, catW);
		const pool = (CAT_PRODUCTS.get(cat) ?? []).filter((p) => p.availAt <= t);
		if (pool.length === 0) continue;
		const p = wpick(
			r,
			pool,
			pool.map((x) => x.pop)
		);
		const size = chooseSize(r, c, p);
		const key = `p${p.id}:${size}`;
		if (used.has(key)) continue;
		used.add(key);
		lines.push({
			kind: 'product',
			productId: p.id,
			size,
			qty: wpick(r, [1, 2, 3], [0.88, 0.11, 0.01]),
			unit: p.price,
			name: p.name
		});
	}
	if (lines.length === 0) {
		const p = pick(
			r,
			prods.filter((x) => x.availAt <= t)
		);
		lines.push({
			kind: 'product',
			productId: p.id,
			size: chooseSize(r, c, p),
			qty: 1,
			unit: p.price,
			name: p.name
		});
	}
	return lines;
}

const orders: GenOrder[] = [];
const codes = new Set<string>();
function newOrderCode(r: Rng, t: number): string {
	for (;;) {
		const code = `DWN-${ymdCompact(t)}-${Math.floor(r() * 0xffffff)
			.toString(16)
			.toUpperCase()
			.padStart(6, '0')}`;
		if (!codes.has(code)) {
			codes.add(code);
			return code;
		}
	}
}
const NOTES = [
	'Tolong dipacking rapi ya.',
	'Titip ke satpam kalau tidak ada orang.',
	'Mohon kirim secepatnya, mau dipakai weekend.',
	'Warna sesuai foto ya kak.',
	'Tolong sertakan kantong belanja.'
];

function addOrder(c: Customer, createdAtRaw: number, stage: Stage, path: Path, rejectFlag = false) {
	const createdAt = Math.max(createdAtRaw, RESTOCK[0] + 45 * MIN);
	const idx = orders.length;
	const r = mulberry32(SEED + idx * 7919 + 13);
	const lines = genLines(r, c, createdAt);
	const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
	orders.push({
		idx,
		cust: c,
		createdAt,
		lines,
		subtotal,
		code: newOrderCode(r, createdAt),
		path,
		stage,
		rejectFlag,
		notes: chance(r, 0.14) ? pick(r, NOTES) : null,
		life: null as unknown as Life,
		id: 0
	});
}

// Pesanan umum
for (const c of customers) {
	const ts = genTimes(c, c.count, GENERAL_END, rng);
	c.count = ts.length;
	for (const t of ts) {
		const path = wpick<Path>(
			rng,
			['normal', 'rejected', 'unpaid', 'custCancel', 'adminCancel'],
			[0.9, 0.03, 0.04, 0.015, 0.015]
		);
		addOrder(c, t, null, path);
	}
}
// 16 pesanan terbaru dengan tahap yang ditentukan
{
	const plan: { stage: Stage; n: number; lo: number; hi: number; rej?: boolean }[] = [
		{ stage: 'pay', n: 3, lo: 0.7 * H, hi: 16 * H },
		{ stage: 'confirm', n: 3, lo: 3 * H, hi: 22 * H, rej: true },
		{ stage: 'process', n: 3, lo: 14 * H, hi: 40 * H },
		{ stage: 'ship', n: 4, lo: 36 * H, hi: 95 * H },
		{ stage: 'done', n: 3, lo: 100 * H, hi: 120 * H }
	];
	const pool = shuffle(
		rng,
		customers.filter((c) => c.count <= 11)
	);
	let ci = 0;
	for (const p of plan) {
		for (let k = 0; k < p.n; k++) {
			const c = pool[ci++ % pool.length];
			let t = NOW - uni(rng, p.lo, p.hi);
			for (let tries = 0; tries < 300; tries++) {
				const hr = wibHour(t);
				if (hr >= 8 && hr < 23.5) break;
				t = NOW - uni(rng, p.lo, p.hi);
			}
			c.count++;
			addOrder(c, t, p.stage, 'normal', Boolean(p.rej && k === 0));
		}
	}
}
orders.sort((a, b) => a.createdAt - b.createdAt);
orders.forEach((o, i) => (o.idx = i));

/* ====================================================================== */
/* Siklus pesanan                                                         */
/* ====================================================================== */
const COURIERS = ['JNE', 'J&T', 'SiCepat', 'Pos Indonesia', 'AnterAja'];
const COURIER_W = [0.34, 0.28, 0.17, 0.09, 0.12];
const REJECT_REASONS = [
	'Nominal transfer tidak sesuai dengan total pesanan.',
	'Bukti transfer buram dan tidak terbaca.',
	'Transfer ke rekening yang salah, mohon periksa lagi.'
];
const CUST_CANCEL_REASONS = [
	'Salah memilih ukuran.',
	'Berubah pikiran, ingin pesan ulang.',
	'Alamat pengiriman salah.'
];
const ADMIN_CANCEL_REASONS = [
	'Stok fisik tidak lolos pengecekan kualitas.',
	'Pelanggan meminta pembatalan lewat WhatsApp.',
	'Alamat tidak terjangkau kurir.'
];

function trackingFor(r: Rng, courier: string): string {
	const d = (n: number) => String(Math.floor(r() * 10 ** n)).padStart(n, '0');
	switch (courier) {
		case 'JNE':
			return `CM${d(10)}`;
		case 'J&T':
			return `JP${d(10)}`;
		case 'SiCepat':
			return `00${d(10)}`;
		case 'Pos Indonesia':
			return `P${d(12)}`;
		default:
			return `1${d(11)}`;
	}
}
/** Geser ke jam kerja (admin 08–21, kirim 09–19 WIB) */
function workTime(t: number, kind: 'admin' | 'ship', r: Rng): number {
	const [from, to] = kind === 'admin' ? [8, 21] : [9, 19];
	const hr = wibHour(t);
	if (hr >= from && hr < to) return t;
	const ds = wibDayStart(t);
	return (hr < from ? ds : ds + DAY) + from * H + rint(r, 0, 50) * MIN;
}

function simulate(o: GenOrder): Life {
	const r = mulberry32(SEED + o.idx * 104729 + 7);
	const total = o.subtotal + SHIPPING;
	const L: Life = {
		status: 'menunggu_pembayaran',
		expiresAt: o.createdAt + DAY,
		proofs: [],
		shipped: null,
		delivered: null,
		cancelled: null,
		updatedAt: o.createdAt,
		logs: []
	};
	const log = (t: number, who: LogEv['who'], action: string, desc: string) => {
		L.logs.push({ t, who, action, desc });
		L.updatedAt = Math.max(L.updatedAt, t);
	};
	log(
		o.createdAt,
		'cust',
		'order.create',
		`Pesanan ${o.code} berhasil dibuat senilai Rp ${fmtRp(total)}`
	);

	const cap = o.stage ? NOW - 5 * MIN : NOW - 3 * H;
	const step = (prev: number, lo: number, hi: number, shift?: 'admin' | 'ship') => {
		let t = prev + uni(r, lo, hi);
		if (shift) t = workTime(t, shift, r);
		if (t > cap) {
			if (cap - prev < 2 * MIN)
				throw new Error(`Pesanan ${o.code}: tidak ada ruang waktu sebelum sekarang.`);
			t = prev + Math.max(MIN, (cap - prev) * uni(r, 0.3, 0.85));
		}
		return t;
	};
	const cancel = (t: number, by: 'cust' | 'admin' | 'system', reason: string) => {
		L.cancelled = { at: t, by, reason };
		L.status = 'dibatalkan';
		log(t, by === 'cust' ? 'cust' : by, 'order.cancel', `Pesanan ${o.code} dibatalkan (${reason})`);
	};
	const proof = (at: number) => {
		L.proofs.push({ at, status: 'menunggu', note: null, byAt: null });
		L.status = 'menunggu_konfirmasi';
		log(at, 'cust', 'payment.proof', `Bukti bayar pesanan ${o.code} diunggah oleh konsumen`);
	};
	const lastProof = () => L.proofs[L.proofs.length - 1];

	if (o.stage === 'pay') return L;
	if (o.path === 'unpaid') {
		cancel(L.expiresAt, 'system', 'Melewati batas waktu pembayaran');
		return L;
	}
	if (o.path === 'custCancel') {
		const reason = pick(r, CUST_CANCEL_REASONS);
		if (chance(r, 0.6)) {
			cancel(step(o.createdAt, 20 * MIN, 8 * H), 'cust', reason);
		} else {
			proof(step(o.createdAt, 10 * MIN, 2 * H));
			const t = step(lastProof().at, 15 * MIN, 5 * H);
			lastProof().status = 'ditolak';
			lastProof().note = 'Pesanan dibatalkan';
			cancel(t, 'cust', reason);
		}
		return L;
	}

	proof(step(o.createdAt, 10 * MIN, 5 * H));
	if (o.path === 'rejected' || o.rejectFlag) {
		const why = pick(r, REJECT_REASONS);
		const t = step(lastProof().at, 30 * MIN, 6 * H, 'admin');
		lastProof().status = 'ditolak';
		lastProof().note = why;
		lastProof().byAt = t;
		L.expiresAt = t + DAY;
		L.status = 'menunggu_pembayaran';
		log(t, 'admin', 'payment.reject', `Bukti transfer ${o.code} ditolak: ${why}`);
		proof(step(t, 20 * MIN, 8 * H));
	}
	if (o.stage === 'confirm') return L;

	if (o.path === 'adminCancel' && chance(r, 0.3)) {
		const t = step(lastProof().at, 30 * MIN, 8 * H, 'admin');
		lastProof().status = 'ditolak';
		lastProof().note = 'Pesanan dibatalkan';
		cancel(t, 'admin', pick(r, ADMIN_CANCEL_REASONS));
		return L;
	}
	const confirmAt = step(lastProof().at, 30 * MIN, 10 * H, 'admin');
	lastProof().status = 'dikonfirmasi';
	lastProof().byAt = confirmAt;
	L.status = 'diproses';
	log(
		confirmAt,
		'admin',
		'payment.confirm',
		`Pembayaran pesanan ${o.code} dikonfirmasi oleh admin`
	);
	if (o.stage === 'process') return L;

	if (o.path === 'adminCancel') {
		const reason = pick(r, ADMIN_CANCEL_REASONS);
		const t = step(confirmAt, 1 * H, 20 * H, 'admin');
		lastProof().status = 'dikembalikan';
		lastProof().note = `Pesanan dibatalkan: ${reason}`;
		cancel(t, 'admin', reason);
		return L;
	}

	const shipAt = step(confirmAt, 1 * H, 30 * H, 'ship');
	const courier = wpick(r, COURIERS, COURIER_W);
	L.shipped = { at: shipAt, courier, tracking: trackingFor(r, courier) };
	L.status = 'dikirim';
	log(
		shipAt,
		'admin',
		'shipment.send',
		`Pesanan ${o.code} dikirim via ${courier} (Resi: ${L.shipped.tracking})`
	);
	if (o.stage === 'ship') return L;

	const bySystem = o.stage !== 'done' && chance(r, 0.15);
	let doneAt = bySystem ? shipAt + 7 * DAY + uni(r, 0, 6 * H) : shipAt + uni(r, 2 * DAY, 6 * DAY);
	if (!bySystem) {
		// kurir tiba siang–malam hari
		doneAt = wibDayStart(doneAt) + uni(r, 10 * H, 21 * H);
	}
	let by: 'cust' | 'system' = bySystem ? 'system' : 'cust';
	if (doneAt > cap) {
		if (cap - shipAt < DAY)
			throw new Error(`Pesanan ${o.code}: tidak cukup waktu untuk pengiriman.`);
		doneAt = shipAt + Math.max(DAY, (cap - shipAt) * uni(r, 0.5, 0.95));
		by = 'cust';
	}
	L.delivered = { at: doneAt, by };
	L.status = 'selesai';
	log(
		doneAt,
		by === 'cust' ? 'cust' : 'system',
		'order.complete',
		`Pesanan ${o.code} diselesaikan oleh ${by === 'cust' ? 'konsumen' : 'system'}`
	);
	return L;
}
for (const o of orders) o.life = simulate(o);

/* ====================================================================== */
/* Kejadian stok & perencana pasokan                                      */
/* ====================================================================== */
type Ev = {
	t: number;
	delta: number;
	chain: string;
	productId: number | null;
	bundleId: number | null;
	size: string; // '' = tanpa ukuran
	type: 'penjualan' | 'pembatalan' | 'pembelian' | 'penyesuaian';
	refType: 'order' | 'purchase' | 'manual' | null;
	orderIdx: number | null;
	purchaseIdx: number | null;
	note: string | null;
	by: number | null;
	/** indeks pelanggan pelaku (id baru dibuat saat insert); null = pakai `by` */
	byCust: number | null;
	seq: number;
	realId: number | null; // id baris stock_movements yang sudah ada
	nullSizeOnSized: boolean;
};
const pKey = (productId: number, size: string) => `p:${productId}:${size}`;
const bKey = (bundleId: number | string) => `b:${bundleId}`;
let seqCounter = 0;
const bundleChainKey = (b: Bundle) => bKey(b.key);
const bundleByName = new Map(bundles.map((b) => [b.name, b]));

function orderEvents(o: GenOrder): Ev[] {
	const out: Ev[] = [];
	const sale = (e: Omit<Ev, 'seq' | 'realId' | 'nullSizeOnSized' | 'orderIdx'>) =>
		out.push({ ...e, orderIdx: o.idx, seq: seqCounter++, realId: null, nullSizeOnSized: false });
	const base: Ev[] = [];
	for (const l of o.lines) {
		if (l.kind === 'product') {
			sale({
				t: o.createdAt,
				delta: -l.qty,
				chain: pKey(l.productId, l.size),
				productId: l.productId,
				bundleId: null,
				size: l.size,
				type: 'penjualan',
				refType: 'order',
				purchaseIdx: null,
				note: null,
				by: null,
				byCust: o.cust.idx
			});
		} else {
			const b = bundleByName.get(l.name)!;
			sale({
				t: o.createdAt,
				delta: -l.qty,
				chain: bundleChainKey(b),
				productId: null,
				bundleId: b.id || null,
				size: '',
				type: 'penjualan',
				refType: 'order',
				purchaseIdx: null,
				note: null,
				by: null,
				byCust: o.cust.idx
			});
			for (const c of l.comps) {
				sale({
					t: o.createdAt,
					delta: -c.qty * l.qty,
					chain: pKey(c.productId, c.size),
					productId: c.productId,
					bundleId: null,
					size: c.size,
					type: 'penjualan',
					refType: 'order',
					purchaseIdx: null,
					note: `Komponen paket "${l.name}"`,
					by: null,
					byCust: o.cust.idx
				});
			}
		}
	}
	base.push(...out);
	const c = o.life.cancelled;
	if (c) {
		const actorBy = c.by === 'admin' ? ADMIN_ID : null;
		const actorCust = c.by === 'cust' ? o.cust.idx : null;
		for (const e of base) {
			out.push({
				...e,
				t: c.at,
				delta: -e.delta,
				type: 'pembatalan',
				note: null,
				by: actorBy,
				byCust: actorCust,
				seq: seqCounter++
			});
		}
	}
	return out;
}

// Kejadian nyata yang sudah ada di DB (tetap pada waktunya)
const realEvents: Ev[] = [];
{
	const rows = sqlite
		.prepare(
			`SELECT id, product_id, bundle_id, size, quantity_change, created_at, type FROM stock_movements ORDER BY id`
		)
		.all() as {
		id: number;
		product_id: number | null;
		bundle_id: number | null;
		size: string | null;
		quantity_change: number;
		created_at: string;
		type: Ev['type'];
	}[];
	for (const m of rows) {
		let chain: string;
		let nullSizeOnSized = false;
		let size = m.size ?? '';
		if (m.bundle_id) chain = bKey(m.bundle_id);
		else {
			const p = m.product_id ? prodById.get(m.product_id) : undefined;
			if (!p) continue;
			if (p.sizes.length > 0 && !m.size) {
				// baris lama tanpa ukuran pada produk yang kini ber-ukuran → rantai ukuran terbesar (kejadian virtual)
				const biggest = [...p.sizes].sort(
					(a, b) => b.stock - a.stock || a.label.localeCompare(b.label)
				)[0];
				size = biggest.label;
				nullSizeOnSized = true;
			}
			chain = pKey(p.id, size);
		}
		realEvents.push({
			t: Date.parse(m.created_at),
			delta: m.quantity_change,
			chain,
			productId: m.product_id,
			bundleId: m.bundle_id,
			size,
			type: m.type,
			refType: null,
			orderIdx: null,
			purchaseIdx: null,
			note: null,
			by: null,
			byCust: null,
			seq: seqCounter++,
			realId: m.id,
			nullSizeOnSized
		});
	}
}

const currentStock = new Map<string, number>();
for (const p of prods) {
	if (p.sizes.length === 0) currentStock.set(pKey(p.id, ''), p.stock);
	else for (const s of p.sizes) currentStock.set(pKey(p.id, s.label), s.stock);
}
for (const b of bundles) currentStock.set(bundleChainKey(b), b.finalQuota);

function chainEvents(): Map<string, Ev[]> {
	// semua rantai ikut (juga yang tak pernah terjual): stok sekarang tetap harus punya riwayat pasokan
	const map = new Map<string, Ev[]>([...currentStock.keys()].map((k) => [k, [] as Ev[]]));
	const push = (e: Ev) => map.set(e.chain, [...(map.get(e.chain) ?? []), e]);
	for (const e of realEvents) push(e);
	for (const o of orders) for (const e of orderEvents(o)) push(e);
	for (const list of map.values()) list.sort((a, b) => a.t - b.t || a.seq - b.seq);
	return map;
}

/** Tanggal pasokan yang tersedia untuk sebuah rantai */
function supplyDates(chain: string): number[] {
	if (chain.startsWith('b:')) {
		const b = bundles.find((x) => x.key === chain.slice(2))!;
		return [b.launchAt, ...RESTOCK.filter((d) => d > b.launchAt + 3 * DAY)];
	}
	const productId = Number(chain.split(':')[1]);
	const p = prodById.get(productId)!;
	return RESTOCK.slice(p.launchIdx);
}

type Plan = { feasible: boolean; lots: number[]; dates: number[]; F: number; need: number };
function planChain(chain: string, evs: Ev[]): Plan {
	const dates = supplyDates(chain);
	const cur = currentStock.get(chain) ?? 0;
	let D = 0;
	let pref = 0;
	const need: number[] = []; // pref-max kebutuhan setelah tiap kejadian
	for (const e of evs) {
		D += e.delta;
		pref = Math.max(pref, -D);
		need.push(pref);
	}
	const F = cur - D;
	const needEnd = need.length ? need[need.length - 1] : 0;
	if (F < needEnd || F < 0) return { feasible: false, lots: [], dates, F, need: needEnd };

	const surplus = F - needEnd;
	const m = dates.length;
	const cum: number[] = [];
	let prevCum = 0;
	for (let k = 0; k < m; k++) {
		const next = k + 1 < m ? dates[k + 1] : Infinity;
		let Pk = 0;
		for (let i = 0; i < evs.length; i++) if (evs[i].t < next) Pk = need[i];
		let c = k === m - 1 ? F : Math.min(F, roundUp6(Pk + (surplus * (k + 1)) / m + 2));
		c = Math.max(c, prevCum, Pk);
		cum.push(c);
		prevCum = c;
	}
	return {
		feasible: true,
		lots: cum.map((c, k) => c - (k ? cum[k - 1] : 0)),
		dates,
		F,
		need: needEnd
	};
}

// Perbaiki rantai tak layak: ubah pembatalan sintetis terakhir menjadi pesanan selesai
let guard = 0;
for (;;) {
	if (guard++ > 400) throw new Error('Perencana stok tidak konvergen.');
	const map = chainEvents();
	let fixed = false;
	for (const [chain, evs] of map) {
		const plan = planChain(chain, evs);
		if (plan.feasible) continue;
		const cancels = evs.filter((e) => e.type === 'pembatalan' && e.orderIdx !== null);
		if (cancels.length === 0) {
			throw new Error(
				`Rantai ${chain} tidak layak (F=${plan.F}, kebutuhan=${plan.need}) dan tanpa pembatalan sintetis.`
			);
		}
		const victim = cancels[cancels.length - 1].orderIdx!;
		const o = orders[victim];
		o.path = 'normal';
		o.rejectFlag = false;
		o.life = simulate(o);
		fixed = true;
		break;
	}
	if (!fixed) break;
}

/* ====================================================================== */
/* Pembelian (restock) & kuota paket                                      */
/* ====================================================================== */
type PurchaseItem = { productId: number; size: string; quantity: number; unitCost: number };
type PurchaseDoc = {
	at: number;
	code: string;
	supplier: string;
	note: string;
	items: PurchaseItem[];
	total: number;
};
const SUPPLIERS = [
	'CV Garmen Nusantara Bandung',
	'Konveksi Cigondewah Jaya',
	'PT Sandang Prima Majalaya',
	'UD Denim Cimahi',
	'CV Kreasi Sablon Subang'
];
const costRatio = new Map<number, number>();
for (const p of prods) costRatio.set(p.id, uni(rng, 0.5, 0.58));
const purchaseByDate = new Map<number, PurchaseDoc>();
const supplyEvents: Ev[] = [];
const finalChains = chainEvents();
for (const [chain, evs] of finalChains) {
	const plan = planChain(chain, evs);
	plan.lots.forEach((lot, k) => {
		if (lot <= 0) return;
		const at = plan.dates[k];
		if (chain.startsWith('b:')) {
			const b = bundles.find((x) => x.key === chain.slice(2))!;
			supplyEvents.push({
				t: at,
				delta: lot,
				chain,
				productId: null,
				bundleId: b.id || null,
				size: '',
				type: 'penyesuaian',
				refType: 'manual',
				orderIdx: null,
				purchaseIdx: null,
				note: k === 0 ? 'Stok awal kuota bundling' : 'Penambahan kuota paket',
				by: ADMIN_ID,
				byCust: null,
				seq: -1 - seqCounter++,
				realId: null,
				nullSizeOnSized: false
			});
			return;
		}
		const productId = Number(chain.split(':')[1]);
		const size = chain.split(':')[2] ?? '';
		const p = prodById.get(productId)!;
		let doc = purchaseByDate.get(at);
		if (!doc) {
			doc = {
				at,
				code: `PBL-${ymdCompact(at)}-001`,
				supplier: SUPPLIERS[purchaseByDate.size % SUPPLIERS.length],
				note: purchaseByDate.size === 0 ? 'Stok awal toko' : 'Restock rutin',
				items: [],
				total: 0
			};
			purchaseByDate.set(at, doc);
		}
		const unitCost = round500(p.price * (costRatio.get(productId) ?? 0.55));
		doc.items.push({ productId, size, quantity: lot, unitCost });
		supplyEvents.push({
			t: at,
			delta: lot,
			chain,
			productId,
			bundleId: null,
			size,
			type: 'pembelian',
			refType: 'purchase',
			orderIdx: null,
			purchaseIdx: -1, // diisi setelah dokumen terurut
			note: null,
			by: ADMIN_ID,
			byCust: null,
			seq: -1 - seqCounter++,
			realId: null,
			nullSizeOnSized: false
		});
	});
}
const purchaseDocs = [...purchaseByDate.values()].sort((a, b) => a.at - b.at);
purchaseDocs.forEach((d, i) => {
	d.total = d.items.reduce((s, it) => s + it.quantity * it.unitCost, 0);
	for (const e of supplyEvents) if (e.type === 'pembelian' && e.t === d.at) e.purchaseIdx = i;
});
// kode PBL unik per tanggal WIB
{
	const perDay = new Map<string, number>();
	for (const d of purchaseDocs) {
		const ymd = ymdCompact(d.at);
		const n = (perDay.get(ymd) ?? 0) + 1;
		perDay.set(ymd, n);
		d.code = `PBL-${ymd}-${pad(n, 3)}`;
	}
}

/* Hitung ulang stock_after seluruh baris (sintetis + nyata) per rantai */
const afterOf = new Map<Ev, number>(); // untuk rantai ukuran/tanpa ukuran/bundel
const totalAfterOf = new Map<Ev, number>(); // untuk baris nyata ber-size NULL pada produk ber-ukuran (total produk)
{
	const all = new Map<string, Ev[]>();
	for (const [chain, evs] of finalChains) all.set(chain, [...evs]);
	for (const e of supplyEvents) all.set(e.chain, [...(all.get(e.chain) ?? []), e]);
	const byProduct = new Map<number, Ev[]>();
	for (const [chain, list] of all) {
		list.sort((a, b) => a.t - b.t || a.seq - b.seq);
		let level = 0;
		for (const e of list) {
			level += e.delta;
			afterOf.set(e, level);
			if (level < 0) throw new Error(`Stok negatif pada ${chain} (${iso(e.t)})`);
		}
		if (!chain.startsWith('b:')) {
			const pid = Number(chain.split(':')[1]);
			byProduct.set(pid, [...(byProduct.get(pid) ?? []), ...list]);
		}
	}
	for (const [, list] of byProduct) {
		list.sort((a, b) => a.t - b.t || a.seq - b.seq);
		let total = 0;
		for (const e of list) {
			total += e.delta;
			if (e.nullSizeOnSized) totalAfterOf.set(e, total);
		}
	}
	for (const [chain, list] of all) {
		const last = list.length ? afterOf.get(list[list.length - 1])! : 0;
		const cur = currentStock.get(chain) ?? 0;
		if (last !== cur) throw new Error(`Rantai ${chain} berakhir di ${last}, seharusnya ${cur}.`);
	}
}

/* ====================================================================== */
/* Ulasan                                                                 */
/* ====================================================================== */
type Review = {
	productId: number;
	userId: number; // diisi saat insert (idx pelanggan)
	custIdx: number;
	orderIdx: number;
	rating: number;
	comment: string | null;
	at: number;
	hidden: boolean;
	productName: string;
};
const reviewsOut: Review[] = [];
const OPEN: Record<number, string[]> = {
	5: [
		'Suka banget!',
		'Mantap, sesuai ekspektasi.',
		'Recommended banget!',
		'Kualitasnya di atas harganya.',
		'Puas belanja di sini.',
		'Keren parah, bakal repeat order.'
	],
	4: [
		'Bagus, sesuai foto.',
		'Overall puas.',
		'Oke banget untuk harganya.',
		'Barang bagus, cuma ada sedikit catatan.'
	],
	3: ['Lumayan sih.', 'Biasa aja, tapi masih oke.', 'Cukup, ada yang kurang.'],
	2: ['Kurang puas.', 'Agak kecewa sama hasilnya.'],
	1: ['Kecewa.', 'Tidak sesuai harapan.']
};
const POS: Record<string, string[]> = {
	kaos: [
		'Bahan cotton combed-nya adem dan tebal.',
		'Sablonnya rapi dan tidak gampang retak.',
		'Potongan boxy-nya pas, jatuhnya enak.',
		'Jahitannya rapi, tidak ada benang lepas.',
		'Warnanya pekat dan tidak luntur setelah dicuci.'
	],
	hoodie: [
		'Fleece-nya tebal dan hangat tapi tidak gerah.',
		'Bordirnya rapi dan detail.',
		'Tudungnya pas dan tali serutnya kuat.',
		'Bahannya lembut di dalam.'
	],
	celana: [
		'Bahan twill-nya tebal, potongan baggy-nya enak dipakai.',
		'Sakunya banyak dan fungsional.',
		'Jahitan kuat, cocok dipakai harian.'
	],
	aksesoris: [
		'Kualitas bahannya bagus untuk harga segini.',
		'Pas dipakai sehari-hari.',
		'Detailnya rapi, cocok buat melengkapi outfit.'
	]
};
const NEG: Record<string, string[]> = {
	kaos: [
		'Ukurannya lebih besar dari size chart.',
		'Warna sablon agak pudar setelah dicuci dua kali.',
		'Bahannya agak lebih tipis dari yang saya kira.',
		'Ada benang lepas di bagian jahitan.'
	],
	hoodie: [
		'Bagian dalamnya agak berbulu setelah dicuci.',
		'Lengannya kepanjangan.',
		'Tudungnya kurang tebal.'
	],
	celana: [
		'Pinggangnya agak longgar.',
		'Panjangnya kebablasan, harus dipotong.',
		'Warnanya sedikit beda dari foto.'
	],
	aksesoris: [
		'Jahitannya kurang rapi.',
		'Warnanya sedikit beda dari foto.',
		'Agak lebih kecil dari bayangan saya.'
	]
};
const SHIP_POS = [
	'Pengiriman cepat, packing aman.',
	'Dikirim hari yang sama, rapi.',
	'Admin responsif.',
	'Packing tebal, barang sampai aman.'
];
const SHIP_NEG = ['Pengiriman agak lama.', 'Packingnya kurang rapi.'];
const ENDINGS = [
	'Pasti beli lagi.',
	'Next mau coba artikel lain.',
	'Thanks Downshit!',
	'Semoga makin banyak artikel baru.'
];
function makeComment(r: Rng, rating: number, cat: string, size: string): string | null {
	if (chance(r, 0.15)) return null;
	const parts: string[] = [pick(r, OPEN[rating])];
	const pool = rating >= 4 ? (POS[cat] ?? POS.kaos) : (NEG[cat] ?? NEG.kaos);
	parts.push(pick(r, pool));
	if (size && chance(r, 0.4)) {
		parts.push(
			rating >= 4
				? `Ambil ukuran ${size}, pas banget.`
				: `Saya ambil ukuran ${size}, ternyata kurang pas.`
		);
	}
	if (chance(r, 0.3)) parts.push(pick(r, rating >= 3 ? SHIP_POS : SHIP_NEG));
	if (rating >= 4 && chance(r, 0.25)) parts.push(pick(r, ENDINGS));
	let text = parts.slice(0, chance(r, 0.5) ? 2 : 3).join(' ');
	if (chance(r, 0.15)) text = text.toLowerCase().replace(/banget/g, 'bgt');
	return text;
}
{
	const r = mulberry32(SEED + 424242);
	type Cand = { orderIdx: number; productId: number; size: string; doneAt: number };
	const cands: Cand[] = [];
	for (const o of orders) {
		if (o.life.status !== 'selesai' || !o.life.delivered) continue;
		const seen = new Set<number>();
		for (const l of o.lines) {
			if (l.kind === 'product') {
				if (!seen.has(l.productId))
					cands.push({
						orderIdx: o.idx,
						productId: l.productId,
						size: l.size,
						doneAt: o.life.delivered.at
					});
				seen.add(l.productId);
			} else {
				for (const c of l.comps) {
					if (!seen.has(c.productId))
						cands.push({
							orderIdx: o.idx,
							productId: c.productId,
							size: c.size,
							doneAt: o.life.delivered.at
						});
					seen.add(c.productId);
				}
			}
		}
	}
	const taken = new Set<string>();
	const make = (c: Cand, forceRating?: number) => {
		const p = prodById.get(c.productId)!;
		const rating = forceRating ?? Math.max(1, Math.min(5, Math.round(normal(r, p.quality, 0.75))));
		const at = c.doneAt + uni(r, 1 * DAY, 12 * DAY);
		if (at > NOW - 30 * MIN) return false;
		const key = `${c.orderIdx}:${c.productId}`;
		if (taken.has(key)) return false;
		taken.add(key);
		reviewsOut.push({
			productId: c.productId,
			userId: 0,
			custIdx: orders[c.orderIdx].cust.idx,
			orderIdx: c.orderIdx,
			rating,
			comment: makeComment(r, rating, p.cat, c.size),
			at,
			hidden: false,
			productName: p.name
		});
		return true;
	};
	for (const c of shuffle(r, cands)) if (chance(r, 0.56)) make(c);
	// produk laku wajib punya ≥ 3 ulasan
	const sold = new Map<number, number>();
	for (const o of orders) {
		if (!['diproses', 'dikirim', 'selesai'].includes(o.life.status)) continue;
		for (const l of o.lines) {
			if (l.kind === 'product') sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty);
			else
				for (const c of l.comps)
					sold.set(c.productId, (sold.get(c.productId) ?? 0) + c.qty * l.qty);
		}
	}
	for (const [pid, n] of sold) {
		if (n < 10) continue;
		let have = reviewsOut.filter((x) => x.productId === pid).length;
		for (const c of shuffle(
			r,
			cands.filter((x) => x.productId === pid)
		)) {
			if (have >= 3) break;
			if (make(c)) have++;
		}
	}
	// dua ulasan spam untuk uji moderasi (tersembunyi)
	const pool = shuffle(r, cands).filter((c) => !taken.has(`${c.orderIdx}:${c.productId}`));
	const spam = [
		{ rating: 1, text: 'Admin lama balas!!! hubungi saya di wa 0812-0000-1234 untuk bonus' },
		{ rating: 5, text: 'Mau diskon besar? kunjungi situs-promo[dot]biz sekarang' }
	];
	for (let i = 0; i < spam.length && i < pool.length; i++) {
		const c = pool[i];
		const at = c.doneAt + uni(r, 1 * DAY, 8 * DAY);
		if (at > NOW - 30 * MIN) continue;
		taken.add(`${c.orderIdx}:${c.productId}`);
		reviewsOut.push({
			productId: c.productId,
			userId: 0,
			custIdx: orders[c.orderIdx].cust.idx,
			orderIdx: c.orderIdx,
			rating: spam[i].rating,
			comment: spam[i].text,
			at,
			hidden: true,
			productName: prodById.get(c.productId)!.name
		});
	}
}

/* ====================================================================== */
/* Tulis ke DB                                                            */
/* ====================================================================== */
const PROOF_URL = '/uploads/proofs/seed-bukti-contoh.webp';
async function ensureProofPlaceholder() {
	const dir = path.resolve(process.env.UPLOAD_DIR ?? './uploads', 'proofs');
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'seed-bukti-contoh.webp');
	if (existsSync(file)) return;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
	<rect width="600" height="800" fill="#2a2a2d"/>
	<rect x="40" y="40" width="520" height="720" fill="none" stroke="#5a5a5e" stroke-width="3" stroke-dasharray="14 10"/>
	<text x="300" y="360" font-family="sans-serif" font-size="34" font-weight="700" fill="#e8e8e4" text-anchor="middle">BUKTI TRANSFER</text>
	<text x="300" y="410" font-family="sans-serif" font-size="26" fill="#9a9a95" text-anchor="middle">(DATA CONTOH)</text>
	</svg>`;
	await sharp(Buffer.from(svg)).webp({ quality: 80 }).toFile(file);
}
await ensureProofPlaceholder();

const passwordHash = await hash('Ganti-Password-123!', {
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1
});

// Snapshot stok sebelum seed (untuk verifikasi invarian)
const snapProducts = sqlite.prepare(`SELECT id, stock FROM products ORDER BY id`).all();
const snapSizes = sqlite
	.prepare(`SELECT product_id, label, stock FROM product_sizes ORDER BY product_id, label`)
	.all();
const snapBundles = sqlite.prepare(`SELECT id, stock FROM bundles ORDER BY id`).all();

type Row = Record<string, unknown>;
const run = sqlite.transaction(() => {
	const q = (sql: string) => sqlite.prepare(sql);
	const insUser = q(
		`INSERT INTO users (name, email, phone, address, password_hash, role, is_active, created_at, updated_at, must_change_password)
		 VALUES (@name, @email, @phone, @address, @hash, 'konsumen', @active, @at, @at, 0)`
	);
	const logs: {
		t: number;
		userId: number | null;
		action: string;
		entity: string | null;
		entityId: number | null;
		desc: string;
	}[] = [];
	const log = (
		t: number,
		userId: number | null,
		action: string,
		entity: string | null,
		entityId: number | null,
		desc: string
	) => logs.push({ t, userId, action, entity, entityId, desc: desc.slice(0, 255) });

	/* Pelanggan */
	for (const c of customers) {
		c.id = Number(
			insUser.run({
				name: c.name,
				email: c.email,
				phone: c.phone,
				address: c.address,
				hash: passwordHash,
				active: 1,
				at: iso(c.regAt)
			}).lastInsertRowid
		);
		log(c.regAt, c.id, 'auth.register', 'user', c.id, `Pendaftaran konsumen baru: ${c.name}`);
	}
	{
		// satu pelanggan lama yang akhirnya dinonaktifkan admin (punya riwayat, tidak dihapus):
		// yang pesanan terakhirnya sudah lama, dinonaktifkan sesudah pesanan itu
		const lastOrder = (c: Customer) =>
			Math.max(...orders.filter((o) => o.cust === c).map((o) => o.createdAt));
		const quiet = [...customers]
			.filter((c) => lastOrder(c) < NOW - 14 * DAY)
			.sort((a, b) => a.count - b.count || a.regAt - b.regAt)[0];
		if (quiet) {
			sqlite
				.prepare(`UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?`)
				.run(iso(Math.min(NOW - 1 * H, lastOrder(quiet) + 3 * DAY)), quiet.id);
			quiet.active = false;
		}
	}

	/* Rilis produk: created_at = beberapa jam sebelum restock pertama produk itu */
	const updProd = q(`UPDATE products SET created_at = @at, updated_at = @at WHERE id = @id`);
	for (const p of prods) updProd.run({ id: p.id, at: iso(RESTOCK[p.launchIdx] - 3 * H) });

	/* Paket */
	const insBundle = q(
		`INSERT INTO bundles (name, slug, description, price, stock, is_active, created_at, updated_at)
		 VALUES (@name, @slug, @description, @price, @stock, 1, @at, @at)`
	);
	const insBI = q(`INSERT INTO bundle_items (bundle_id, product_id, quantity) VALUES (?, ?, ?)`);
	const updBundle = q(`UPDATE bundles SET created_at = @at, updated_at = @at WHERE id = @id`);
	for (const b of bundles) {
		if (b.isNew) {
			b.id = Number(
				insBundle.run({
					name: b.name,
					slug: b.slug,
					description: b.description,
					price: b.price,
					stock: b.finalQuota,
					at: iso(b.launchAt - 1 * H)
				}).lastInsertRowid
			);
			for (const c of b.comps) insBI.run(b.id, c.productId, c.qty);
			sqlite
				.prepare(
					`UPDATE products SET is_bundleable = 1 WHERE id IN (${b.comps.map((c) => c.productId).join(',')})`
				)
				.run();
			log(
				b.launchAt - 1 * H,
				ADMIN_ID,
				'bundle.create',
				'bundle',
				b.id,
				`Paket bundling dibuat: ${b.name} (${b.comps.length} item)`
			);
		} else {
			updBundle.run({ id: b.id, at: iso(b.launchAt - 1 * H) });
		}
	}
	// peta id paket untuk kejadian (kunci sementara new:slug → id)
	const chainId = (chain: string): string => {
		if (!chain.startsWith('b:')) return chain;
		const b = bundles.find((x) => x.key === chain.slice(2))!;
		return `b:${b.id}`;
	};

	/* Pembelian */
	const insPur = q(
		`INSERT INTO purchases (code, supplier_name, purchase_date, total_cost, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
	);
	const insPI = q(
		`INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, size) VALUES (?, ?, ?, ?, ?)`
	);
	const purchaseIds: number[] = [];
	for (const d of purchaseDocs) {
		const id = Number(
			insPur.run(d.code, d.supplier, ymdWib(d.at), d.total, d.note, ADMIN_ID, iso(d.at))
				.lastInsertRowid
		);
		purchaseIds.push(id);
		for (const it of d.items) insPI.run(id, it.productId, it.quantity, it.unitCost, it.size);
		log(
			d.at,
			ADMIN_ID,
			'purchase.create',
			'purchase',
			id,
			`Pembelian ${d.code} dicatat (${d.items.length} item, total Rp ${fmtRp(d.total)})`
		);
	}

	/* Pesanan */
	const insOrder = q(
		`INSERT INTO orders (code, user_id, status, subtotal, shipping_cost, total, recipient_name, recipient_phone, shipping_address,
		   notes, cancel_reason, cancelled_at, created_at, updated_at, expires_at)
		 VALUES (@code, @user, @status, @subtotal, @ship, @total, @rname, @rphone, @raddr, @notes, @creason, @cat, @created, @updated, @expires)`
	);
	const insItem = q(
		`INSERT INTO order_items (order_id, item_type, product_id, bundle_id, item_name, unit_price, quantity, subtotal, size)
		 VALUES (@order, @type, @product, @bundle, @name, @unit, @qty, @sub, @size)`
	);
	const insComp = q(
		`INSERT INTO order_item_components (order_item_id, product_id, quantity, size) VALUES (?, ?, ?, ?)`
	);
	const insPay = q(
		`INSERT INTO payments (order_id, method, amount, proof_url, status, note, confirmed_by, confirmed_at, created_at)
		 VALUES (?, 'transfer_bank', ?, ?, ?, ?, ?, ?, ?)`
	);
	const insShip = q(
		`INSERT INTO shipments (order_id, courier, tracking_number, status, shipped_at, delivered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
	);
	for (const o of orders) {
		const L = o.life;
		const total = o.subtotal + SHIPPING;
		o.id = Number(
			insOrder.run({
				code: o.code,
				user: o.cust.id,
				status: L.status,
				subtotal: o.subtotal,
				ship: SHIPPING,
				total,
				rname: o.cust.name,
				rphone: o.cust.phone,
				raddr: o.cust.address,
				notes: o.notes,
				creason: L.cancelled ? L.cancelled.reason.slice(0, 255) : null,
				cat: L.cancelled ? iso(L.cancelled.at) : null,
				created: iso(o.createdAt),
				updated: iso(L.updatedAt),
				expires: iso(L.expiresAt)
			}).lastInsertRowid
		);
		for (const l of o.lines) {
			if (l.kind === 'product') {
				insItem.run({
					order: o.id,
					type: 'product',
					product: l.productId,
					bundle: null,
					name: l.name,
					unit: l.unit,
					qty: l.qty,
					sub: l.unit * l.qty,
					size: l.size
				});
			} else {
				const b = bundleByName.get(l.name)!;
				const oi = Number(
					insItem.run({
						order: o.id,
						type: 'bundle',
						product: null,
						bundle: b.id,
						name: l.name,
						unit: l.unit,
						qty: l.qty,
						sub: l.unit * l.qty,
						size: l.selection
					}).lastInsertRowid
				);
				for (const c of l.comps) insComp.run(oi, c.productId, c.qty * l.qty, c.size);
			}
		}
		for (const p of L.proofs) {
			insPay.run(
				o.id,
				total,
				PROOF_URL,
				p.status,
				p.note,
				p.byAt ? ADMIN_ID : null,
				p.byAt ? iso(p.byAt) : null,
				iso(p.at)
			);
		}
		if (L.shipped) {
			insShip.run(
				o.id,
				L.shipped.courier,
				L.shipped.tracking,
				L.delivered ? 'diterima' : 'dikirim',
				iso(L.shipped.at),
				L.delivered ? iso(L.delivered.at) : null,
				iso(L.delivered?.at ?? L.shipped.at)
			);
		} else {
			insShip.run(o.id, null, null, 'belum_dikirim', null, null, iso(o.createdAt));
		}
		for (const e of L.logs) {
			const uid = e.who === 'cust' ? o.cust.id : e.who === 'admin' ? ADMIN_ID : null;
			log(e.t, uid, e.action, 'order', o.id, e.desc);
		}
	}

	/* Mutasi stok */
	const insMove = q(
		`INSERT INTO stock_movements (product_id, bundle_id, type, quantity_change, stock_after, reference_type, reference_id, note, created_by, created_at, size)
		 VALUES (@product, @bundle, @type, @delta, @after, @rtype, @rid, @note, @by, @at, @size)`
	);
	const updReal = q(`UPDATE stock_movements SET stock_after = ? WHERE id = ?`);
	const bundleIdOf = (e: Ev): number | null => {
		if (!e.chain.startsWith('b:')) return null;
		return Number(chainId(e.chain).slice(2));
	};
	const toInsert: Ev[] = [];
	for (const [, evs] of finalChains) for (const e of evs) if (e.realId === null) toInsert.push(e);
	for (const e of supplyEvents) toInsert.push(e);
	toInsert.sort((a, b) => a.t - b.t || a.seq - b.seq);
	for (const e of toInsert) {
		const after = afterOf.get(e)!;
		const bundle = bundleIdOf(e);
		insMove.run({
			product: e.chain.startsWith('b:') ? null : e.productId,
			bundle,
			type: e.type,
			delta: e.delta,
			after,
			rtype: e.refType,
			rid:
				e.orderIdx !== null
					? orders[e.orderIdx].id
					: e.purchaseIdx !== null && e.purchaseIdx >= 0
						? purchaseIds[e.purchaseIdx]
						: null,
			note: e.note,
			by: e.byCust !== null ? customers[e.byCust].id : e.by,
			at: iso(e.t),
			size: e.size || null
		});
		if (e.type === 'penyesuaian' && bundle) {
			const b = bundles.find((x) => x.id === bundle)!;
			const before = after - e.delta;
			log(
				e.t,
				ADMIN_ID,
				'stock.adjust',
				'bundle',
				bundle,
				`Stok ${b.name} disesuaikan ${before} → ${after} (selisih +${e.delta}): ${e.note}`
			);
		}
	}
	for (const [, evs] of finalChains) {
		for (const e of evs) {
			if (e.realId === null) continue;
			updReal.run(e.nullSizeOnSized ? totalAfterOf.get(e)! : afterOf.get(e)!, e.realId);
		}
	}

	/* Ulasan */
	const insRev = q(
		`INSERT INTO reviews (product_id, user_id, order_id, rating, comment, is_visible, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const rv of reviewsOut) {
		const cust = customers[rv.custIdx];
		const o = orders[rv.orderIdx];
		insRev.run(
			rv.productId,
			cust.id,
			o.id,
			rv.rating,
			rv.comment,
			rv.hidden ? 0 : 1,
			iso(rv.at),
			iso(rv.at)
		);
		log(
			rv.at,
			cust.id,
			'review.create',
			'product',
			rv.productId,
			`Ulasan ${rv.rating} bintang untuk ${rv.productName} (pesanan ${o.code})`
		);
	}

	/* Log aktivitas (urut waktu) */
	const insLog = q(
		`INSERT INTO activity_logs (user_id, action, entity, entity_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?)`
	);
	logs.sort((a, b) => a.t - b.t);
	for (const l of logs) insLog.run(l.userId, l.action, l.entity, l.entityId, l.desc, iso(l.t));

	/* ================================================================== */
	/* Verifikasi (gagal = rollback)                                      */
	/* ================================================================== */
	const fail: string[] = [];
	const check = (ok: boolean, msg: string) => {
		if (!ok) fail.push(msg);
	};
	const one = (sql: string, ...p: unknown[]) => sqlite.prepare(sql).get(...p) as Row;
	const all = (sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as Row[];
	const nowIso = iso(NOW + 1000);

	// (b) stok akhir identik + invarian total = jumlah ukuran
	check(
		JSON.stringify(all(`SELECT id, stock FROM products ORDER BY id`)) ===
			JSON.stringify(snapProducts),
		'stok produk berubah'
	);
	check(
		JSON.stringify(
			all(`SELECT product_id, label, stock FROM product_sizes ORDER BY product_id, label`)
		) === JSON.stringify(snapSizes),
		'stok ukuran berubah'
	);
	const oldBundleIds = (snapBundles as { id: number }[]).map((b) => b.id);
	check(
		JSON.stringify(
			all(`SELECT id, stock FROM bundles WHERE id IN (${oldBundleIds.join(',') || 0}) ORDER BY id`)
		) === JSON.stringify(snapBundles),
		'kuota paket lama berubah'
	);
	check(
		all(
			`SELECT p.id FROM products p JOIN product_sizes s ON s.product_id = p.id GROUP BY p.id HAVING p.stock != SUM(s.stock)`
		).length === 0,
		'products.stock != SUM(ukuran)'
	);

	// (c) replay stok per rantai: tidak negatif, stock_after cocok, akhir = stok sekarang
	{
		const mv = all(
			`SELECT id, product_id, bundle_id, size, quantity_change, stock_after, created_at FROM stock_movements ORDER BY created_at, id`
		) as {
			id: number;
			product_id: number | null;
			bundle_id: number | null;
			size: string | null;
			quantity_change: number;
			stock_after: number;
			created_at: string;
		}[];
		const lv = new Map<string, number>();
		const totalLv = new Map<number, number>();
		const biggest = (pid: number) => {
			const p = prodById.get(pid)!;
			return (
				[...p.sizes].sort((a, b) => b.stock - a.stock || a.label.localeCompare(b.label))[0]
					?.label ?? ''
			);
		};
		for (const m of mv) {
			if (m.bundle_id) {
				const k = `b:${m.bundle_id}`;
				const v = (lv.get(k) ?? 0) + m.quantity_change;
				lv.set(k, v);
				check(
					v >= 0 && v === m.stock_after,
					`bundel ${m.bundle_id} replay ${v} ≠ stock_after ${m.stock_after} (${m.created_at})`
				);
				continue;
			}
			const pid = m.product_id!;
			const p = prodById.get(pid)!;
			const nullOnSized = p.sizes.length > 0 && !m.size;
			const size = nullOnSized ? biggest(pid) : (m.size ?? '');
			const k = `p:${pid}:${size}`;
			const v = (lv.get(k) ?? 0) + m.quantity_change;
			lv.set(k, v);
			const tv = (totalLv.get(pid) ?? 0) + m.quantity_change;
			totalLv.set(pid, tv);
			check(v >= 0, `stok negatif ${k} (${m.created_at})`);
			check(
				nullOnSized ? tv === m.stock_after : v === m.stock_after,
				`${k} replay ${nullOnSized ? tv : v} ≠ stock_after ${m.stock_after} (${m.created_at})`
			);
		}
		for (const [k, v] of currentStock) {
			if (k.startsWith('b:')) continue; // paket baru diperiksa lewat tabel bundles di bawah
			check((lv.get(k) ?? 0) === v, `akhir ${k} = ${lv.get(k) ?? 0} ≠ ${v}`);
		}
		for (const b of bundles)
			check(
				(lv.get(`b:${b.id}`) ?? 0) === b.finalQuota,
				`akhir kuota paket ${b.name} ≠ ${b.finalQuota}`
			);
		for (const b of all(`SELECT id, stock FROM bundles`) as { id: number; stock: number }[]) {
			const want = bundles.find((x) => x.id === b.id)?.finalQuota;
			check(want === undefined || want === b.stock, `bundles.stock paket ${b.id}`);
		}
	}

	// (d) pesanan
	for (const o of all(
		`SELECT id, code, status, subtotal, shipping_cost, total, cancelled_at FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com')`
	) as {
		id: number;
		code: string;
		status: string;
		subtotal: number;
		shipping_cost: number;
		total: number;
		cancelled_at: string | null;
	}[]) {
		const items = all(
			`SELECT id, item_type, bundle_id, quantity, subtotal, unit_price FROM order_items WHERE order_id = ?`,
			o.id
		) as {
			id: number;
			item_type: string;
			bundle_id: number | null;
			quantity: number;
			subtotal: number;
			unit_price: number;
		}[];
		check(items.reduce((s, i) => s + i.subtotal, 0) === o.subtotal, `${o.code}: subtotal ≠ Σ item`);
		check(
			items.every((i) => i.unit_price * i.quantity === i.subtotal),
			`${o.code}: unit×qty ≠ subtotal`
		);
		check(o.subtotal + o.shipping_cost === o.total, `${o.code}: total ≠ subtotal + ongkir`);
		for (const it of items.filter((i) => i.item_type === 'bundle')) {
			const comps = all(
				`SELECT product_id, quantity FROM order_item_components WHERE order_item_id = ?`,
				it.id
			) as { product_id: number; quantity: number }[];
			const bi = all(
				`SELECT product_id, quantity FROM bundle_items WHERE bundle_id = ?`,
				it.bundle_id
			) as { product_id: number; quantity: number }[];
			check(
				bi.length === comps.length &&
					bi.every(
						(x) =>
							comps.find((c) => c.product_id === x.product_id)?.quantity ===
							x.quantity * it.quantity
					),
				`${o.code}: komponen bundling tidak cocok`
			);
		}
		const pays = all(`SELECT status FROM payments WHERE order_id = ? ORDER BY id`, o.id) as {
			status: string;
		}[];
		const ship = one(
			`SELECT status, shipped_at, delivered_at FROM shipments WHERE order_id = ?`,
			o.id
		) as { status: string; shipped_at: string | null; delivered_at: string | null };
		const lastPay = pays[pays.length - 1]?.status;
		switch (o.status) {
			case 'menunggu_pembayaran':
				check(
					lastPay !== 'menunggu' && lastPay !== 'dikonfirmasi' && ship.status === 'belum_dikirim',
					`${o.code}: status menunggu_pembayaran janggal`
				);
				break;
			case 'menunggu_konfirmasi':
				check(
					lastPay === 'menunggu' && ship.status === 'belum_dikirim',
					`${o.code}: menunggu_konfirmasi janggal`
				);
				break;
			case 'diproses':
				check(
					lastPay === 'dikonfirmasi' && ship.status === 'belum_dikirim',
					`${o.code}: diproses janggal`
				);
				break;
			case 'dikirim':
				check(
					lastPay === 'dikonfirmasi' &&
						ship.status === 'dikirim' &&
						!!ship.shipped_at &&
						!ship.delivered_at,
					`${o.code}: dikirim janggal`
				);
				break;
			case 'selesai':
				check(
					lastPay === 'dikonfirmasi' && ship.status === 'diterima' && !!ship.delivered_at,
					`${o.code}: selesai janggal`
				);
				break;
			case 'dibatalkan':
				check(!!o.cancelled_at && ship.status === 'belum_dikirim', `${o.code}: dibatalkan janggal`);
				break;
		}
	}
	// tidak ada waktu di masa depan
	for (const [t, c] of [
		['users', 'created_at'],
		['orders', 'created_at'],
		['orders', 'updated_at'],
		['orders', 'cancelled_at'],
		['payments', 'created_at'],
		['payments', 'confirmed_at'],
		['shipments', 'shipped_at'],
		['shipments', 'delivered_at'],
		['stock_movements', 'created_at'],
		['purchases', 'created_at'],
		['activity_logs', 'created_at'],
		['reviews', 'created_at']
	] as const) {
		const r = one(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} > ?`, nowIso) as { n: number };
		check(r.n === 0, `${t}.${c} punya ${r.n} waktu di masa depan`);
	}
	// pesanan dibuat setelah pendaftaran pelanggan & setelah paket rilis
	check(
		(
			one(
				`SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE u.email LIKE '%@example.com' AND o.created_at < u.created_at`
			) as { n: number }
		).n === 0,
		'ada pesanan sebelum pendaftaran pelanggan'
	);
	check(
		(
			one(
				`SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN bundles b ON b.id = oi.bundle_id WHERE o.created_at < b.created_at`
			) as { n: number }
		).n === 0,
		'ada pesanan paket sebelum paket dibuat'
	);
	check(
		(sqlite.prepare(`PRAGMA foreign_key_check`).all() as unknown[]).length === 0,
		'foreign_key_check tidak kosong'
	);

	if (fail.length)
		throw new Error(`Verifikasi gagal:\n - ${[...new Set(fail)].slice(0, 25).join('\n - ')}`);
});

run();

/* ====================================================================== */
/* Ringkasan (read-only)                                                  */
/* ====================================================================== */
const sum = (sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as Row[];
console.log('\n✓ Riwayat berhasil diisi (semua verifikasi lolos).');
console.log(
	`  Jendela: ${ymdWib(START)} → ${ymdWib(NOW)} WIB | restock: ${RESTOCK.map(ymdWib).join(', ')}`
);
console.log(
	`  Pelanggan baru   : ${(sum(`SELECT COUNT(*) n FROM users WHERE email LIKE '%@example.com'`)[0] as { n: number }).n}`
);
console.log(
	`  Paket bundling   : ${(sum(`SELECT COUNT(*) n FROM bundles`)[0] as { n: number }).n} total (${NEW_BUNDLES.length} baru)`
);
console.log(
	`  Pembelian        : ${purchaseDocs.length} dokumen, ${purchaseDocs.reduce((s, d) => s + d.items.length, 0)} baris`
);
console.log(
	`  Mutasi stok      : ${(sum(`SELECT COUNT(*) n FROM stock_movements`)[0] as { n: number }).n} baris`
);
console.log(
	`  Ulasan           : ${(sum(`SELECT COUNT(*) n FROM reviews`)[0] as { n: number }).n} (tersembunyi: ${(sum(`SELECT COUNT(*) n FROM reviews WHERE is_visible = 0`)[0] as { n: number }).n})`
);
console.log('  Pesanan per status:');
for (const r of sum(`SELECT status, COUNT(*) n FROM orders GROUP BY status ORDER BY n DESC`))
	console.log(`    ${String(r.status).padEnd(22)} ${r.n}`);
console.log('  Pesanan per bulan (WIB):');
for (const r of sum(
	`SELECT strftime('%Y-%m', datetime(created_at, '+7 hours')) AS bln, COUNT(*) n FROM orders GROUP BY bln ORDER BY bln`
)) {
	console.log(`    ${r.bln}  ${r.n}`);
}
console.log('  Terlaris (satuan, pesanan terbayar):');
for (const r of sum(
	`SELECT p.name, SUM(q) AS sold FROM (
		SELECT oi.product_id AS pid, oi.quantity AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
		 WHERE oi.item_type = 'product' AND o.status IN ('diproses','dikirim','selesai')
		UNION ALL
		SELECT c.product_id, c.quantity FROM order_item_components c JOIN order_items oi ON oi.id = c.order_item_id
		 JOIN orders o ON o.id = oi.order_id WHERE o.status IN ('diproses','dikirim','selesai')
	 ) x JOIN products p ON p.id = x.pid GROUP BY p.id ORDER BY sold DESC LIMIT 5`
)) {
	console.log(`    ${String(r.name).padEnd(30)} ${r.sold}`);
}
console.log('  Rating (≥ 3 ulasan; atas / bawah):');
const rated = sum(
	`SELECT p.name, ROUND(AVG(r.rating), 2) AS avg, COUNT(*) AS n FROM reviews r JOIN products p ON p.id = r.product_id
	 WHERE r.is_visible = 1 GROUP BY p.id HAVING n >= 3 ORDER BY avg DESC, n DESC`
);
for (const r of [...rated.slice(0, 5), ...rated.slice(-3)])
	console.log(`    ${String(r.name).padEnd(30)} ${r.avg}  (${r.n} ulasan)`);
console.log(
	`  Ongkir yang dipakai: Rp ${fmtRp(SHIPPING)} | password semua pelanggan: Ganti-Password-123!`
);
