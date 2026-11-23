/**
 * Migrasi additive & idempoten untuk database SQLite yang dibuat dari versi skema lebih lama.
 * `drizzle-kit push` sering gagal pada DB berisi data (membuat ulang indeks), jadi kolom baru
 * ditambahkan di sini dengan ALTER TABLE yang aman. Pakai:  npm run db:migrate-sync
 */
import 'dotenv/config';
import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_URL || 'downshit.db';
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');

type Step = { table: string; column: string; ddl: string };

// Urutkan sesuai kapan kolom ditambahkan ke schema.ts
const STEPS: Step[] = [
	{
		table: 'users',
		column: 'must_change_password',
		ddl: 'ALTER TABLE users ADD COLUMN must_change_password integer NOT NULL DEFAULT 0'
	},
	{
		table: 'products',
		column: 'is_bundleable',
		ddl: 'ALTER TABLE products ADD COLUMN is_bundleable integer NOT NULL DEFAULT 1'
	},
	{
		table: 'orders',
		column: 'expires_at',
		ddl: 'ALTER TABLE orders ADD COLUMN expires_at text'
	},
	// Stok per ukuran
	{
		table: 'cart_items',
		column: 'size',
		ddl: "ALTER TABLE cart_items ADD COLUMN size text NOT NULL DEFAULT ''"
	},
	{
		table: 'order_items',
		column: 'size',
		ddl: "ALTER TABLE order_items ADD COLUMN size text NOT NULL DEFAULT ''"
	},
	{
		table: 'order_item_components',
		column: 'size',
		ddl: "ALTER TABLE order_item_components ADD COLUMN size text NOT NULL DEFAULT ''"
	},
	{
		table: 'purchase_items',
		column: 'size',
		ddl: "ALTER TABLE purchase_items ADD COLUMN size text NOT NULL DEFAULT ''"
	},
	{
		table: 'stock_movements',
		column: 'size',
		ddl: 'ALTER TABLE stock_movements ADD COLUMN size text'
	},
	// Status pembelian (dipesan → diterima / dibatalkan); pembelian lama dianggap sudah diterima
	{
		table: 'purchases',
		column: 'status',
		ddl: "ALTER TABLE purchases ADD COLUMN status text NOT NULL DEFAULT 'diterima'"
	},
	{
		table: 'purchases',
		column: 'received_at',
		ddl: 'ALTER TABLE purchases ADD COLUMN received_at text'
	},
	{
		table: 'purchases',
		column: 'cancelled_at',
		ddl: 'ALTER TABLE purchases ADD COLUMN cancelled_at text'
	},
	{
		table: 'purchases',
		column: 'cancel_note',
		ddl: 'ALTER TABLE purchases ADD COLUMN cancel_note text'
	},
	// Pembayaran online (Midtrans)
	{
		table: 'payments',
		column: 'gateway_order_id',
		ddl: 'ALTER TABLE payments ADD COLUMN gateway_order_id text'
	},
	{
		table: 'payments',
		column: 'gateway_type',
		ddl: 'ALTER TABLE payments ADD COLUMN gateway_type text'
	},
	{
		table: 'payments',
		column: 'gateway_tx_id',
		ddl: 'ALTER TABLE payments ADD COLUMN gateway_tx_id text'
	},
	{
		table: 'payments',
		column: 'payment_code',
		ddl: 'ALTER TABLE payments ADD COLUMN payment_code text'
	},
	{
		table: 'payments',
		column: 'redirect_url',
		ddl: 'ALTER TABLE payments ADD COLUMN redirect_url text'
	},
	{
		table: 'payments',
		column: 'expires_at',
		ddl: 'ALTER TABLE payments ADD COLUMN expires_at text'
	}
];

const hasColumn = (table: string, column: string) =>
	(sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).some(
		(c) => c.name === column
	);

const run = sqlite.transaction(() => {
	let applied = 0;

	// Tabel ulasan produk
	sqlite.exec(
		`CREATE TABLE IF NOT EXISTS reviews (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
			user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
			rating integer NOT NULL,
			comment text,
			is_visible integer NOT NULL DEFAULT true,
			created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
		CREATE UNIQUE INDEX IF NOT EXISTS uq_review_order_product ON reviews (order_id, product_id);
		CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews (product_id, is_visible);
		CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews (user_id);`
	);

	// Tabel ukuran produk (stok per ukuran)
	sqlite.exec(
		`CREATE TABLE IF NOT EXISTS product_sizes (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
			label text NOT NULL,
			stock integer NOT NULL DEFAULT 0,
			sort_order integer NOT NULL DEFAULT 0,
			created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
		CREATE UNIQUE INDEX IF NOT EXISTS uq_product_size ON product_sizes (product_id, label);`
	);

	// Tabel galeri foto produk (multi-image per produk)
	sqlite.exec(
		`CREATE TABLE IF NOT EXISTS product_images (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
			image_url text NOT NULL,
			sort_order integer NOT NULL DEFAULT 0,
			created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
		CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id);`
	);

	// Tabel favorit (wishlist)
	sqlite.exec(
		`CREATE TABLE IF NOT EXISTS wishlists (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
			created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
		CREATE UNIQUE INDEX IF NOT EXISTS uq_wishlist_user_product ON wishlists (user_id, product_id);
		CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlists (user_id, created_at);`
	);

	// Tabel simulasi payment gateway (mode PAYMENT_SIMULATOR)
	sqlite.exec(
		`CREATE TABLE IF NOT EXISTS payment_simulations (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			gateway_order_id text NOT NULL,
			token text NOT NULL,
			amount integer NOT NULL,
			method text NOT NULL,
			channel text,
			payment_code text,
			status text NOT NULL DEFAULT 'pending',
			expires_at text NOT NULL,
			created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
		CREATE UNIQUE INDEX IF NOT EXISTS uq_sim_gateway_order ON payment_simulations (gateway_order_id);
		CREATE UNIQUE INDEX IF NOT EXISTS uq_sim_token ON payment_simulations (token);`
	);

	for (const s of STEPS) {
		if (hasColumn(s.table, s.column)) continue;
		sqlite.exec(s.ddl);
		console.log(`  + ${s.table}.${s.column}`);
		applied++;
	}

	// Satu order_id Midtrans = satu baris pembayaran (NULL untuk transfer manual boleh banyak)
	sqlite.exec(
		'CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_gateway_order ON payments (gateway_order_id)'
	);

	// Pesanan lama tanpa batas bayar: beri batas 24 jam dari pembuatan agar job kedaluwarsa tidak mengabaikannya
	sqlite.exec(
		`UPDATE orders SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+24 hours')
		 WHERE expires_at IS NULL AND status = 'menunggu_pembayaran'`
	);

	// BR-20: tidak ada baris pembayaran saat checkout. Buang baris 'menunggu' tanpa bukti (sisa checkout lama);
	// baris pembayaran online (punya gateway_order_id) memang tanpa bukti, jangan dihapus.
	const phantom = sqlite
		.prepare(
			`DELETE FROM payments WHERE proof_url IS NULL AND status = 'menunggu' AND gateway_order_id IS NULL`
		)
		.run().changes;
	if (phantom > 0) console.log(`  - ${phantom} baris payments kosong (tanpa bukti) dihapus`);

	// Keranjang: satu baris per produk+ukuran / bundling+pilihan (gabungkan duplikat lama lalu pasang indeks unik)
	const dupes = sqlite
		.prepare(
			`SELECT cart_id, product_id, bundle_id, size, MIN(id) AS keep, SUM(quantity) AS qty
			 FROM cart_items GROUP BY cart_id, product_id, bundle_id, size HAVING COUNT(*) > 1`
		)
		.all() as {
		cart_id: number;
		product_id: number | null;
		bundle_id: number | null;
		size: string;
		keep: number;
		qty: number;
	}[];
	for (const d of dupes) {
		sqlite
			.prepare(
				`DELETE FROM cart_items WHERE cart_id = ? AND product_id IS ? AND bundle_id IS ? AND size = ? AND id <> ?`
			)
			.run(d.cart_id, d.product_id, d.bundle_id, d.size, d.keep);
		sqlite
			.prepare(`UPDATE cart_items SET quantity = ? WHERE id = ?`)
			.run(Math.min(d.qty, 99), d.keep);
	}
	// Indeks lama (tanpa kolom size) diganti agar produk yang sama boleh ada dengan ukuran berbeda
	const indexHasSize = (name: string) =>
		(sqlite.prepare(`pragma index_info(${name})`).all() as { name: string }[]).some(
			(c) => c.name === 'size'
		);
	for (const name of ['uq_ci_product', 'uq_ci_bundle']) {
		if (!indexHasSize(name)) sqlite.exec(`DROP INDEX IF EXISTS ${name}`);
	}
	sqlite.exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_product ON cart_items (cart_id, product_id, size);
		 CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_bundle ON cart_items (cart_id, bundle_id, size);`
	);
	return applied;
});

const n = run();
console.log(n === 0 ? `✓ ${dbPath} sudah sinkron.` : `✓ ${dbPath}: ${n} kolom ditambahkan.`);
