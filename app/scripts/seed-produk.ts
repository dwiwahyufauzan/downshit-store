/**
 * Menambah produk contoh bernama artikel (mis. "Collapsed Boxy Tee", "Subang Skate Hoodie").
 * Aman dijalankan berulang: produk dengan slug yang sama dilewati, data lain tidak disentuh
 * (berbeda dengan `db:seed` yang menimpa pengaturan toko). Foto diunggah lewat halaman admin.
 *
 * Pakai:  npm run db:seed-produk
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as s from '../src/lib/server/db/schema';
import { slugify } from '../src/lib/utils/slug';

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD !== 'true') {
	throw new Error(
		'Produk contoh tidak boleh diisi di produksi (set SEED_ALLOW_PROD=true bila sengaja).'
	);
}

const db = drizzle(new Database(process.env.DATABASE_URL || 'downshit.db'), { schema: s });

type Item = { kategori: string; name: string; price: number; stock: number; description: string };

const KAOS = 'Cotton Combed 24s dengan sablon plastisol tahan lama.';
const HOODIE = 'Fleece tebal 320gsm, bagian dalam lembut, jahitan rapi.';
const CELANA = 'Twill tebal dengan potongan longgar dan saku fungsional.';

const items: Item[] = [
	// ---- Kaos ----
	{
		kategori: 'kaos',
		name: 'Collapsed Boxy Tee',
		price: 129000,
		stock: 40,
		description: `Potongan boxy, grafis "Collapsed" di dada. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Subang Skate Tee',
		price: 119000,
		stock: 45,
		description: `Grafis papan skate bertema jalanan Subang di bagian belakang. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Dawuan Nights Tee',
		price: 119000,
		stock: 30,
		description: `Sablon reflektif tipis yang menyala saat terkena lampu. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Lembur Club Tee',
		price: 109000,
		stock: 55,
		description: `Untuk yang pulang paling akhir. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Jalan Pintas Tee',
		price: 109000,
		stock: 35,
		description: `Grafis peta jalan tikus di bagian depan. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Rebahan Society Tee',
		price: 99000,
		stock: 60,
		description: `Kaos santai untuk hari libur. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Pantura Longsleeve Tee',
		price: 149000,
		stock: 25,
		description: `Lengan panjang dengan sablon di lengan kiri. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Karat Oversized Tee',
		price: 139000,
		stock: 4,
		description: `Efek karat pada sablon, potongan oversized. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Gang Sempit Tee',
		price: 109000,
		stock: 0,
		description: `Grafis gang sempit hitam-putih. ${KAOS}`
	},
	{
		kategori: 'kaos',
		name: 'Static Noise Tee',
		price: 119000,
		stock: 38,
		description: `Grafis noise TV rusak dengan warna kontras. ${KAOS}`
	},
	// ---- Hoodie ----
	{
		kategori: 'hoodie',
		name: 'Subang Skate Hoodie',
		price: 289000,
		stock: 25,
		description: `Bordir logo di dada dan sablon besar di punggung. ${HOODIE}`
	},
	{
		kategori: 'hoodie',
		name: 'Collapsed Zip Hoodie',
		price: 319000,
		stock: 18,
		description: `Resleting penuh dengan saku kanguru. ${HOODIE}`
	},
	{
		kategori: 'hoodie',
		name: 'Hujan Deras Hoodie',
		price: 299000,
		stock: 22,
		description: `Tudung lebar, cocok untuk musim hujan. ${HOODIE}`
	},
	{
		kategori: 'hoodie',
		name: 'Midnight Dawuan Crewneck',
		price: 259000,
		stock: 5,
		description: `Sweater leher bulat tanpa tudung. ${HOODIE}`
	},
	{
		kategori: 'hoodie',
		name: 'Lembur Club Hoodie',
		price: 279000,
		stock: 28,
		description: `Bordir kecil di lengan. ${HOODIE}`
	},
	// ---- Celana ----
	{
		kategori: 'celana',
		name: 'Collapsed Baggy Pants',
		price: 249000,
		stock: 20,
		description: `Potongan baggy dengan lutut lebih longgar. ${CELANA}`
	},
	{
		kategori: 'celana',
		name: 'Pantura Cargo Pants',
		price: 269000,
		stock: 17,
		description: `Enam saku dengan tali serut di bagian bawah. ${CELANA}`
	},
	{
		kategori: 'celana',
		name: 'Gang Sempit Sweatpants',
		price: 199000,
		stock: 32,
		description: `Fleece tipis dengan karet pinggang dan tali. ${CELANA}`
	},
	{
		kategori: 'celana',
		name: 'Karat Work Pants',
		price: 289000,
		stock: 14,
		description: `Bahan kerja dengan jahitan ganda di bagian lutut. ${CELANA}`
	},
	{
		kategori: 'celana',
		name: 'Rebahan Shorts',
		price: 169000,
		stock: 40,
		description: `Celana pendek santai di atas lutut. ${CELANA}`
	},
	// ---- Aksesoris ----
	{
		kategori: 'aksesoris',
		name: 'Collapsed Tote Bag',
		price: 89000,
		stock: 50,
		description: 'Kanvas tebal dengan sablon dua sisi dan tali bahu panjang.'
	},
	{
		kategori: 'aksesoris',
		name: 'Subang Skate Socks',
		price: 39000,
		stock: 80,
		description: 'Kaos kaki setinggi betis dengan rajutan logo.'
	},
	{
		kategori: 'aksesoris',
		name: 'Pantura Trucker Hat',
		price: 79000,
		stock: 35,
		description: 'Topi trucker dengan jaring di bagian belakang dan snapback.'
	},
	{
		kategori: 'aksesoris',
		name: 'Karat Keychain',
		price: 25000,
		stock: 100,
		description: 'Gantungan kunci logam dengan ukiran logo.'
	},
	{
		kategori: 'aksesoris',
		name: 'Static Noise Beanie',
		price: 69000,
		stock: 42,
		description: 'Kupluk rajut dengan label tenun kecil.'
	}
];

// Selang-seling antar kategori supaya produk "terbaru" di beranda tidak berisi satu jenis saja.
// Kaos paling banyak, jadi sebagian dimasukkan lebih dulu.
const byCat = (k: string) => items.filter((i) => i.kategori === k);
const kaos = byCat('kaos');
const rest = [kaos.slice(5), byCat('hoodie'), byCat('celana'), byCat('aksesoris')];
const ordered: Item[] = [...kaos.slice(0, 5)];
for (let i = 0; i < Math.max(...rest.map((r) => r.length)); i++) {
	for (const r of rest) if (r[i]) ordered.push(r[i]);
}

const cats = await db.select().from(s.categories);
const catId = Object.fromEntries(cats.map((c) => [c.slug, c.id]));

let added = 0;
let skipped = 0;
for (const it of ordered) {
	if (!catId[it.kategori])
		throw new Error(`Kategori "${it.kategori}" belum ada. Jalankan db:seed dulu.`);
	const slug = slugify(it.name);
	const [exists] = await db
		.select({ id: s.products.id })
		.from(s.products)
		.where(eq(s.products.slug, slug))
		.limit(1);
	if (exists) {
		skipped++;
		continue;
	}
	await db.insert(s.products).values({
		categoryId: catId[it.kategori],
		name: it.name,
		slug,
		description: it.description,
		price: it.price,
		stock: it.stock
	});
	added++;
}

console.log(`Produk ditambahkan: ${added}, dilewati (slug sudah ada): ${skipped}`);
