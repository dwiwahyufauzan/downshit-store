import { sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const id = () => integer('id').primaryKey({ autoIncrement: true });
/** Semua timestamp disimpan ISO-8601 UTC ('2026-11-14T04:16:11.123Z') agar urutan string = urutan waktu. */
export const NOW_ISO = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const nowIso = () => new Date().toISOString();
// $defaultFn/$onUpdateFn dijalankan aplikasi, jadi tetap ISO walau DDL tabel lama masih CURRENT_TIMESTAMP
const createdAt = () => text('created_at').notNull().default(NOW_ISO).$defaultFn(nowIso);
const updatedAt = () =>
	text('updated_at').notNull().default(NOW_ISO).$defaultFn(nowIso).$onUpdateFn(nowIso);

export const ORDER_STATUS = [
	'menunggu_pembayaran',
	'menunggu_konfirmasi',
	'diproses',
	'dikirim',
	'selesai',
	'dibatalkan'
] as const;

/* ---------- 1. Pengguna (users & sessions) ---------- */
export const users = sqliteTable(
	'users',
	{
		id: id(),
		name: text('name').notNull(),
		email: text('email').notNull(),
		phone: text('phone'),
		address: text('address'),
		passwordHash: text('password_hash').notNull(),
		role: text('role', { enum: ['owner', 'admin', 'konsumen'] })
			.notNull()
			.default('konsumen'),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		mustChangePassword: integer('must_change_password', { mode: 'boolean' })
			.notNull()
			.default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('uq_users_email').on(t.email), index('idx_users_role').on(t.role)]
);

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(), // sha256(token)
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: text('expires_at').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('idx_sessions_user').on(t.userId)]
);

/* ---------- 2. Katalog (kategori, produk, bundling) ---------- */
export const categories = sqliteTable(
	'categories',
	{
		id: id(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		description: text('description'),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('uq_categories_slug').on(t.slug)]
);

export const products = sqliteTable(
	'products',
	{
		id: id(),
		categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		description: text('description'),
		price: integer('price').notNull(),
		stock: integer('stock').notNull().default(0),
		imageUrl: text('image_url'),
		isBundleable: integer('is_bundleable', { mode: 'boolean' }).notNull().default(true),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		deletedAt: text('deleted_at'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('uq_products_slug').on(t.slug),
		index('idx_products_category').on(t.categoryId)
	]
);

/**
 * Galeri foto produk (satu produk bisa memiliki banyak foto).
 * `products.imageUrl` tetap disimpan sebagai foto utama (thumbnail katalog & kompatibilitas).
 */
export const productImages = sqliteTable(
	'product_images',
	{
		id: id(),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		imageUrl: text('image_url').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt()
	},
	(t) => [index('idx_product_images_product').on(t.productId)]
);

/**
 * Ukuran produk (S/M/L/XL, 30/32, dst.) dengan stok masing-masing. Produk tanpa baris di sini = tanpa ukuran.
 * Invarian: untuk produk ber-ukuran, `products.stock` = SUM(product_sizes.stock) (dijaga di lib/server/stock.ts).
 */
export const productSizes = sqliteTable(
	'product_sizes',
	{
		id: id(),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		stock: integer('stock').notNull().default(0),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('uq_product_size').on(t.productId, t.label)]
);

export const bundles = sqliteTable(
	'bundles',
	{
		id: id(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		description: text('description'),
		price: integer('price').notNull(),
		stock: integer('stock').notNull().default(0),
		imageUrl: text('image_url'),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		deletedAt: text('deleted_at'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('uq_bundles_slug').on(t.slug)]
);

export const bundleItems = sqliteTable(
	'bundle_items',
	{
		id: id(),
		bundleId: integer('bundle_id')
			.notNull()
			.references(() => bundles.id, { onDelete: 'cascade' }),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'restrict' }),
		quantity: integer('quantity').notNull().default(1)
	},
	(t) => [uniqueIndex('uq_bundle_product').on(t.bundleId, t.productId)]
);

/* ---------- 3. Keranjang (carts & cart_items) ---------- */
export const carts = sqliteTable(
	'carts',
	{
		id: id(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('uq_carts_user').on(t.userId)]
);

export const cartItems = sqliteTable(
	'cart_items',
	{
		id: id(),
		cartId: integer('cart_id')
			.notNull()
			.references(() => carts.id, { onDelete: 'cascade' }),
		productId: integer('product_id').references(() => products.id, { onDelete: 'cascade' }),
		bundleId: integer('bundle_id').references(() => bundles.id, { onDelete: 'cascade' }),
		quantity: integer('quantity').notNull().default(1),
		// Produk: label ukuran ('' = tanpa ukuran). Bundling: pilihan ukuran komponen, mis. "12:L|15:M".
		size: text('size').notNull().default('')
	},
	(t) => [
		index('idx_ci_cart').on(t.cartId),
		// cegah baris ganda per produk+ukuran / bundling+pilihan (NULL boleh berulang di SQLite)
		uniqueIndex('uq_ci_product').on(t.cartId, t.productId, t.size),
		uniqueIndex('uq_ci_bundle').on(t.cartId, t.bundleId, t.size)
	]
);

/* ---------- 3b. Favorit (wishlist) ---------- */
/** Produk yang disimpan konsumen; satu baris per (pengguna, produk). Ikut terhapus bersama pengguna/produk. */
export const wishlists = sqliteTable(
	'wishlists',
	{
		id: id(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('uq_wishlist_user_product').on(t.userId, t.productId),
		index('idx_wishlist_user').on(t.userId, t.createdAt)
	]
);

/* ---------- 4. Pesanan, Item & Snapshot Komponen ---------- */
export const orders = sqliteTable(
	'orders',
	{
		id: id(),
		code: text('code').notNull(), // DWN-261114-XXXX
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		status: text('status', { enum: ORDER_STATUS }).notNull().default('menunggu_pembayaran'),
		subtotal: integer('subtotal').notNull(),
		shippingCost: integer('shipping_cost').notNull().default(0),
		total: integer('total').notNull(),
		recipientName: text('recipient_name').notNull(),
		recipientPhone: text('recipient_phone').notNull(),
		shippingAddress: text('shipping_address').notNull(),
		notes: text('notes'),
		expiresAt: text('expires_at'),
		cancelReason: text('cancel_reason'),
		cancelledAt: text('cancelled_at'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('uq_orders_code').on(t.code),
		index('idx_orders_user').on(t.userId),
		index('idx_orders_status').on(t.status),
		index('idx_orders_created').on(t.createdAt)
	]
);

export const orderItems = sqliteTable(
	'order_items',
	{
		id: id(),
		orderId: integer('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		itemType: text('item_type', { enum: ['product', 'bundle'] }).notNull(),
		productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
		bundleId: integer('bundle_id').references(() => bundles.id, { onDelete: 'set null' }),
		itemName: text('item_name').notNull(), // snapshot nama
		unitPrice: integer('unit_price').notNull(), // snapshot harga
		quantity: integer('quantity').notNull(),
		subtotal: integer('subtotal').notNull(),
		size: text('size').notNull().default('') // snapshot ukuran (bundling: pilihan komponen)
	},
	(t) => [index('idx_oi_order').on(t.orderId)]
);

export const orderItemComponents = sqliteTable(
	'order_item_components',
	{
		id: id(),
		orderItemId: integer('order_item_id')
			.notNull()
			.references(() => orderItems.id, { onDelete: 'cascade' }),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'restrict' }),
		quantity: integer('quantity').notNull(), // total unit fisik produk
		size: text('size').notNull().default('') // ukuran komponen yang dipotong stoknya
	},
	(t) => [index('idx_oic_item').on(t.orderItemId)]
);

/* ---------- 4b. Ulasan produk ---------- */
/** Satu ulasan per (pesanan, produk); hanya pembeli dari pesanan berstatus `selesai` yang boleh menulis. */
export const reviews = sqliteTable(
	'reviews',
	{
		id: id(),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		orderId: integer('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		rating: integer('rating').notNull(), // 1–5 (divalidasi di aplikasi)
		comment: text('comment'),
		isVisible: integer('is_visible', { mode: 'boolean' }).notNull().default(true), // moderasi admin
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('uq_review_order_product').on(t.orderId, t.productId),
		index('idx_reviews_product').on(t.productId, t.isVisible),
		index('idx_reviews_user').on(t.userId)
	]
);

/* ---------- 5. Pembayaran & Pengiriman ---------- */
export const payments = sqliteTable(
	'payments',
	{
		id: id(),
		orderId: integer('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		// 'transfer_bank' (bukti diunggah, diverifikasi admin) atau grup gateway: 'ewallet' | 'qris' | 'va' | 'minimarket'
		method: text('method').notNull().default('transfer_bank'),
		amount: integer('amount').notNull(),
		proofUrl: text('proof_url'),
		// ---- khusus pembayaran online (Midtrans); NULL untuk transfer manual ----
		gatewayOrderId: text('gateway_order_id'), // order_id unik per percobaan: "<kode>-<n>"
		gatewayType: text('gateway_type'), // payment_type dari Midtrans: gopay, qris, bank_transfer, cstore, …
		gatewayTxId: text('gateway_tx_id'), // transaction_id dari Midtrans
		paymentCode: text('payment_code'), // nomor VA / kode bayar minimarket / bill key
		redirectUrl: text('redirect_url'), // halaman bayar Midtrans (Snap)
		expiresAt: text('expires_at'), // batas bayar transaksi di gateway
		status: text('status', { enum: ['menunggu', 'dikonfirmasi', 'ditolak', 'dikembalikan'] })
			.notNull()
			.default('menunggu'),
		note: text('note'),
		confirmedBy: integer('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
		confirmedAt: text('confirmed_at'),
		createdAt: createdAt()
	},
	(t) => [
		index('idx_pay_order').on(t.orderId),
		index('idx_pay_status').on(t.status),
		uniqueIndex('uq_pay_gateway_order').on(t.gatewayOrderId)
	]
);

/**
 * Transaksi payment gateway SIMULASI (mode PAYMENT_SIMULATOR, pengganti Midtrans untuk demo).
 * Satu baris per percobaan bayar online; tidak dipakai bila Midtrans asli terkonfigurasi.
 */
export const paymentSimulations = sqliteTable(
	'payment_simulations',
	{
		id: id(),
		gatewayOrderId: text('gateway_order_id').notNull(), // = payments.gateway_order_id
		token: text('token').notNull(), // rahasia di URL halaman bayar simulasi
		amount: integer('amount').notNull(),
		method: text('method').notNull(), // grup: ewallet | qris | va | minimarket
		channel: text('channel'), // saluran yang dipilih pelanggan (gopay, bca_va, indomaret, …); NULL = belum memilih
		paymentCode: text('payment_code'), // nomor VA / kode bayar yang dibangkitkan simulator
		status: text('status', { enum: ['pending', 'settlement', 'deny', 'expire', 'cancel'] })
			.notNull()
			.default('pending'),
		expiresAt: text('expires_at').notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('uq_sim_gateway_order').on(t.gatewayOrderId),
		uniqueIndex('uq_sim_token').on(t.token)
	]
);

export const shipments = sqliteTable(
	'shipments',
	{
		id: id(),
		orderId: integer('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		courier: text('courier'),
		trackingNumber: text('tracking_number'),
		status: text('status', { enum: ['belum_dikirim', 'dikirim', 'diterima'] })
			.notNull()
			.default('belum_dikirim'),
		note: text('note'),
		shippedAt: text('shipped_at'),
		deliveredAt: text('delivered_at'),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('uq_ship_order').on(t.orderId)]
);

/* ---------- 6. Pembelian (Restock) & Mutasi Stok ---------- */
export const purchases = sqliteTable(
	'purchases',
	{
		id: id(),
		code: text('code').notNull(), // PBL-261114-001
		supplierName: text('supplier_name'),
		purchaseDate: text('purchase_date').notNull(),
		totalCost: integer('total_cost').notNull().default(0),
		note: text('note'),
		// dipesan = barang belum tiba (stok BELUM naik); diterima = stok sudah naik; dibatalkan = selesai/dibatalkan
		status: text('status', { enum: ['dipesan', 'diterima', 'dibatalkan'] })
			.notNull()
			.default('diterima'),
		receivedAt: text('received_at'),
		cancelledAt: text('cancelled_at'),
		cancelNote: text('cancel_note'),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('uq_purchases_code').on(t.code)]
);

export const purchaseItems = sqliteTable(
	'purchase_items',
	{
		id: id(),
		purchaseId: integer('purchase_id')
			.notNull()
			.references(() => purchases.id, { onDelete: 'cascade' }),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'restrict' }),
		quantity: integer('quantity').notNull(),
		unitCost: integer('unit_cost').notNull().default(0),
		size: text('size').notNull().default('')
	},
	(t) => [index('idx_pi_purchase').on(t.purchaseId)]
);

export const stockMovements = sqliteTable(
	'stock_movements',
	{
		id: id(),
		productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
		bundleId: integer('bundle_id').references(() => bundles.id, { onDelete: 'set null' }),
		type: text('type', { enum: ['pembelian', 'penjualan', 'pembatalan', 'penyesuaian'] }).notNull(),
		size: text('size'), // ukuran yang bergerak (null = produk tanpa ukuran / bundling)
		quantityChange: integer('quantity_change').notNull(),
		stockAfter: integer('stock_after'), // stok setelah gerakan: per ukuran bila `size` terisi
		referenceType: text('reference_type'),
		referenceId: integer('reference_id'),
		note: text('note'),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('idx_sm_product').on(t.productId), index('idx_sm_created').on(t.createdAt)]
);

/* ---------- 7. Aktivitas, Pengaturan & Keamanan ---------- */
export const activityLogs = sqliteTable(
	'activity_logs',
	{
		id: id(),
		userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
		action: text('action').notNull(),
		entity: text('entity'),
		entityId: integer('entity_id'),
		description: text('description').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('idx_al_created').on(t.createdAt), index('idx_al_action').on(t.action)]
);

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: updatedAt()
});

export const loginAttempts = sqliteTable(
	'login_attempts',
	{
		id: id(),
		identifier: text('identifier').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('idx_la_ident').on(t.identifier, t.createdAt)]
);
