/**
 * Pembuat data sintetis untuk menguji laporan owner (angka vs SQL manual) dan performa.
 * Murni better-sqlite3 (tanpa modul aplikasi) sehingga dapat dipakai oleh vitest maupun CLI
 * (`npx tsx tests/gen-synthetic.ts <file.db> <jumlah>`).
 *
 * Semua timestamp ISO-8601 UTC ('2026-11-14T04:16:11.123Z'), sama dengan yang ditulis aplikasi.
 */
import type Database from 'better-sqlite3';

export type OrderStatus =
	'menunggu_pembayaran' | 'menunggu_konfirmasi' | 'diproses' | 'dikirim' | 'selesai' | 'dibatalkan';

export type SynthItem =
	| { kind: 'product'; productId: number; qty: number }
	| { kind: 'bundle'; bundleId: number; qty: number };

export type SynthOrder = {
	userId: number;
	status: OrderStatus;
	createdAt: string; // ISO UTC
	shipping?: number;
	items: SynthItem[];
	code?: string;
};

export type Catalog = {
	owner: number;
	admin: number;
	buyers: number[];
	/** id => harga */
	products: { id: number; name: string; price: number }[];
	bundles: {
		id: number;
		name: string;
		price: number;
		parts: { productId: number; qty: number }[];
	}[];
};

const PRICE: Record<string, number> = {};

/** Pembangkit acak deterministik (mulberry32) agar uji dapat diulang. */
export function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Isi katalog minimal (3 pembeli, owner, admin, 5 produk, 2 paket) pada DB kosong. */
export function seedCatalog(db: Database.Database, buyerNames?: string[]): Catalog {
	const insUser = db.prepare(
		`insert into users (name, email, password_hash, role) values (?, ?, 'x', ?)`
	);
	const owner = Number(insUser.run('Owner Uji', 'owner@uji.local', 'owner').lastInsertRowid);
	const admin = Number(insUser.run('Admin Uji', 'admin@uji.local', 'admin').lastInsertRowid);
	const names = buyerNames ?? ['Budi Santoso', 'Siti Aminah', 'Citra Dewi'];
	const buyers = names.map((n, i) =>
		Number(insUser.run(n, `pembeli${i + 1}@uji.local`, 'konsumen').lastInsertRowid)
	);

	const insProd = db.prepare(
		`insert into products (name, slug, price, stock, is_bundleable) values (?, ?, ?, ?, 1)`
	);
	const specs: [string, number][] = [
		['Kaos Downshit Hitam', 100_000],
		['Topi Downshit', 50_000],
		['Hoodie Downshit', 250_000],
		['Totebag Downshit', 35_000],
		['Sticker Pack', 15_000]
	];
	const products = specs.map(([name, price]) => {
		const id = Number(
			insProd.run(name, name.toLowerCase().replace(/\W+/g, '-'), price, 1000).lastInsertRowid
		);
		PRICE[id] = price;
		return { id, name, price };
	});

	const insBundle = db.prepare(
		`insert into bundles (name, slug, price, stock) values (?, ?, ?, 1000)`
	);
	const insBI = db.prepare(
		`insert into bundle_items (bundle_id, product_id, quantity) values (?, ?, ?)`
	);
	const bdefs: [string, number, [number, number][]][] = [
		[
			'Paket Hemat Kaos + Topi',
			130_000,
			[
				[0, 1],
				[1, 1]
			]
		],
		[
			'Paket Streetwear Lengkap',
			340_000,
			[
				[0, 1],
				[2, 1],
				[3, 2]
			]
		]
	];
	const bundles = bdefs.map(([name, price, parts]) => {
		const id = Number(
			insBundle.run(name, name.toLowerCase().replace(/\W+/g, '-'), price).lastInsertRowid
		);
		const resolved = parts.map(([pi, qty]) => ({ productId: products[pi].id, qty }));
		for (const p of resolved) insBI.run(id, p.productId, p.qty);
		return { id, name, price, parts: resolved };
	});

	return { owner, admin, buyers, products, bundles };
}

/** Sisipkan satu pesanan lengkap (orders, order_items, order_item_components, shipments). */
export function makeOrderInserter(db: Database.Database, cat: Catalog) {
	const insOrder = db.prepare(
		`insert into orders (code, user_id, status, subtotal, shipping_cost, total, recipient_name,
			recipient_phone, shipping_address, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, 'Penerima Uji', '081234567890', 'Jl. Uji No. 1', ?, ?)`
	);
	const insItem = db.prepare(
		`insert into order_items (order_id, item_type, product_id, bundle_id, item_name, unit_price, quantity, subtotal)
		 values (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insComp = db.prepare(
		`insert into order_item_components (order_item_id, product_id, quantity) values (?, ?, ?)`
	);
	let seq = 0;

	return (o: SynthOrder) => {
		const shipping = o.shipping ?? 15_000;
		let subtotal = 0;
		const lines = o.items.map((it) => {
			if (it.kind === 'product') {
				const p = cat.products.find((x) => x.id === it.productId)!;
				subtotal += p.price * it.qty;
				return { ...it, name: p.name, unit: p.price };
			}
			const b = cat.bundles.find((x) => x.id === it.bundleId)!;
			subtotal += b.price * it.qty;
			return { ...it, name: b.name, unit: b.price };
		});
		const code =
			o.code ??
			`DWN-${o.createdAt.slice(2, 10).replace(/-/g, '')}-${(++seq).toString(36).toUpperCase().padStart(5, '0')}`;
		const orderId = Number(
			insOrder.run(
				code,
				o.userId,
				o.status,
				subtotal,
				shipping,
				subtotal + shipping,
				o.createdAt,
				o.createdAt
			).lastInsertRowid
		);
		for (const l of lines) {
			if (l.kind === 'product') {
				insItem.run(orderId, 'product', l.productId, null, l.name, l.unit, l.qty, l.unit * l.qty);
			} else {
				const itemId = Number(
					insItem.run(orderId, 'bundle', null, l.bundleId, l.name, l.unit, l.qty, l.unit * l.qty)
						.lastInsertRowid
				);
				const b = cat.bundles.find((x) => x.id === l.bundleId)!;
				for (const part of b.parts) insComp.run(itemId, part.productId, part.qty * l.qty);
			}
		}
		return { orderId, code, subtotal, total: subtotal + shipping };
	};
}

/**
 * Hasilkan `count` pesanan acak tersebar antara `fromIso` dan `toIso` (UTC), dengan campuran status
 * dan jam acak (termasuk 00:00-07:00 WIB = 17:00-24:00 UTC hari sebelumnya).
 */
export function generateOrders(
	db: Database.Database,
	cat: Catalog,
	opts: { count: number; fromIso: string; toIso: string; seed?: number }
) {
	const rand = rng(opts.seed ?? 42);
	const insert = makeOrderInserter(db, cat);
	const t0 = Date.parse(opts.fromIso);
	const t1 = Date.parse(opts.toIso);
	const statuses: [OrderStatus, number][] = [
		['selesai', 0.45],
		['dikirim', 0.1],
		['diproses', 0.1],
		['menunggu_konfirmasi', 0.1],
		['menunggu_pembayaran', 0.1],
		['dibatalkan', 0.15]
	];
	const pickStatus = () => {
		let r = rand();
		for (const [s, w] of statuses) {
			if ((r -= w) < 0) return s;
		}
		return 'selesai' as OrderStatus;
	};
	const run = db.transaction(() => {
		for (let i = 0; i < opts.count; i++) {
			const items: SynthItem[] = [];
			const lines = 1 + Math.floor(rand() * 3);
			for (let k = 0; k < lines; k++) {
				const qty = 1 + Math.floor(rand() * 3);
				if (rand() < 0.3) {
					items.push({
						kind: 'bundle',
						bundleId: cat.bundles[Math.floor(rand() * cat.bundles.length)].id,
						qty
					});
				} else {
					items.push({
						kind: 'product',
						productId: cat.products[Math.floor(rand() * cat.products.length)].id,
						qty
					});
				}
			}
			insert({
				userId: cat.buyers[Math.floor(rand() * cat.buyers.length)],
				status: pickStatus(),
				createdAt: new Date(t0 + Math.floor(rand() * (t1 - t0))).toISOString(),
				shipping: rand() < 0.1 ? 0 : 15_000,
				items
			});
		}
	});
	run();
}
