/**
 * CLI: isi sebuah DB SQLite dengan pesanan sintetis (hanya untuk DB uji/dev, JANGAN produksi).
 *   npx tsx tests/gen-synthetic.ts <file.db> [jumlah=5000] [dari=2026-01-01] [sampai=2026-11-14]
 * Menolak berjalan bila DB sudah berisi pesanan kecuali --force-append.
 */
import Database from 'better-sqlite3';
import { generateOrders, seedCatalog, type Catalog } from './synthetic';

const [file, countArg = '5000', from = '2026-01-01', to = '2026-11-14', flag] =
	process.argv.slice(2);
if (!file) {
	console.error('Pemakaian: npx tsx tests/gen-synthetic.ts <file.db> [jumlah] [dari] [sampai]');
	process.exit(1);
}
if (/downshit\.db$/.test(file) && !/tmp|scratchpad/.test(file)) {
	console.error('MENOLAK: itu DB asli pengguna. Pakai salinan.');
	process.exit(1);
}

const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const existing = db.prepare('select count(*) as n from orders').get() as { n: number };
if (existing.n > 0 && flag !== '--force-append') {
	console.error(`DB sudah berisi ${existing.n} pesanan. Tambahkan --force-append untuk menambah.`);
	process.exit(1);
}

// Pakai pembeli & produk yang sudah ada bila ada; kalau tidak buat katalog baru.
const users = db.prepare('select id, role from users').all() as { id: number; role: string }[];
let cat: Catalog;
const prodCount = (db.prepare('select count(*) as n from products').get() as { n: number }).n;
if (prodCount >= 5 && users.some((u) => u.role === 'konsumen')) {
	const products = db
		.prepare('select id, name, price from products order by id limit 5')
		.all() as Catalog['products'];
	const bundlesRows = db
		.prepare('select id, name, price from bundles where deleted_at is null order by id')
		.all() as {
		id: number;
		name: string;
		price: number;
	}[];
	const parts = db.prepare(
		'select product_id as productId, quantity as qty from bundle_items where bundle_id = ?'
	);
	cat = {
		owner: users.find((u) => u.role === 'owner')!.id,
		admin: users.find((u) => u.role === 'admin')!.id,
		buyers: users.filter((u) => u.role === 'konsumen').map((u) => u.id),
		products,
		bundles: bundlesRows.map((b) => ({
			...b,
			parts: parts.all(b.id) as { productId: number; qty: number }[]
		}))
	};
	if (cat.bundles.length === 0) {
		console.error(
			'DB berisi produk tetapi tanpa bundling; buat 1 bundling dulu atau pakai DB kosong.'
		);
		process.exit(1);
	}
} else {
	cat = seedCatalog(db);
}

const t = Date.now();
generateOrders(db, cat, {
	count: Number(countArg),
	fromIso: `${from}T00:00:00.000Z`,
	toIso: `${to}T23:59:59.999Z`
});
const n = db.prepare('select count(*) as n from orders').get() as { n: number };
console.log(
	`OK: ${countArg} pesanan ditambahkan dalam ${Date.now() - t} ms; total orders = ${n.n}`
);
db.close();
