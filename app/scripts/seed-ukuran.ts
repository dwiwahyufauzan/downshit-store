/**
 * Memberi ukuran pada produk pakaian yang belum punya (kaos/hoodie → S–XL, celana → 28–34) dengan
 * membagi stok yang ada ke tiap ukuran, sehingga total produk TIDAK berubah (tidak perlu mutasi stok).
 * Aman dijalankan berulang: produk yang sudah punya ukuran dilewati. Hanya untuk data contoh/pengembangan.
 *
 * Pakai:  npm run db:seed-ukuran   (jalankan db:migrate-sync dulu)
 */
import 'dotenv/config';
import Database from 'better-sqlite3';

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD !== 'true') {
	throw new Error(
		'Ukuran contoh tidak boleh diisi di produksi (set SEED_ALLOW_PROD=true bila sengaja).'
	);
}

const sqlite = new Database(process.env.DATABASE_URL || 'downshit.db');
sqlite.pragma('foreign_keys = ON');

const LETTERS = ['S', 'M', 'L', 'XL'];
const WAIST = ['28', '30', '32', '34'];
const WEIGHTS = [2, 4, 3, 1]; // sebaran stok wajar: M & L paling laris

/** Bagi `total` menurut bobot; sisa pembulatan masuk ke ukuran terlaris (indeks 1). */
function split(total: number): number[] {
	const sum = WEIGHTS.reduce((a, b) => a + b, 0);
	const parts = WEIGHTS.map((w) => Math.floor((total * w) / sum));
	parts[1] += total - parts.reduce((a, b) => a + b, 0);
	return parts;
}

const targets = sqlite
	.prepare(
		`SELECT p.id, p.name, p.stock, c.slug AS cat FROM products p
		 JOIN categories c ON c.id = p.category_id
		 WHERE p.deleted_at IS NULL AND c.slug IN ('kaos','hoodie','celana')
		   AND NOT EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = p.id)`
	)
	.all() as { id: number; name: string; stock: number; cat: string }[];

const insert = sqlite.prepare(
	'INSERT INTO product_sizes (product_id, label, stock, sort_order) VALUES (?, ?, ?, ?)'
);
const run = sqlite.transaction(() => {
	for (const p of targets) {
		const labels = p.cat === 'celana' ? WAIST : LETTERS;
		split(p.stock).forEach((n, i) => insert.run(p.id, labels[i], n, i));
	}
});
run();

console.log(`Produk diberi ukuran: ${targets.length}`);
