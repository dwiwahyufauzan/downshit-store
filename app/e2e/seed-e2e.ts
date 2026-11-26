/**
 * Data khusus E2E di atas seed dasar (scripts/seed.ts): ukuran untuk satu kaos, voucher, dan stok yang pasti.
 * Dijalankan oleh global-setup.ts dengan DATABASE_URL database sementara.
 */
import Database from 'better-sqlite3';

const db = new Database(process.env.DATABASE_URL!);
db.pragma('foreign_keys = ON');

const kaos = db
	.prepare("SELECT id FROM products WHERE slug = 'kaos-downshit-logo-putih'")
	.get() as {
	id: number;
};
if (!kaos) throw new Error('produk dasar tidak ditemukan: seed.ts belum jalan?');

db.transaction(() => {
	// kaos ber-ukuran: stok produk = jumlah stok ukuran
	const sizes: [string, number][] = [
		['S', 5],
		['M', 15],
		['L', 15],
		['XL', 5]
	];
	sizes.forEach(([label, stock], i) =>
		db
			.prepare(
				'INSERT INTO product_sizes (product_id, label, stock, sort_order) VALUES (?, ?, ?, ?)'
			)
			.run(kaos.id, label, stock, i)
	);
	db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(40, kaos.id);

	// metode bayar online (simulator) menyala selain transfer bank
	for (const key of [
		'pay_qris_enabled',
		'pay_va_enabled',
		'pay_ewallet_enabled',
		'pay_minimarket_enabled'
	]) {
		db.prepare(
			'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
		).run(key, 'true');
	}

	// voucher yang tampil di banner beranda
	db.prepare(
		`INSERT INTO vouchers (code, description, type, value, min_subtotal, max_discount, usage_limit, per_user_limit, is_active, show_on_home)
		 VALUES ('E2E10', 'Diskon uji E2E', 'percent', 10, 50000, 20000, 5, 1, 1, 1)`
	).run();
})();

db.close();
console.log('  ✓ seed E2E: ukuran kaos + voucher E2E10 + metode bayar online');
