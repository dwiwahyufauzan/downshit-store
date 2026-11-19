import { and, eq, gte, sql } from 'drizzle-orm';
import { db, type Tx } from './db';
import { NOW_ISO, bundles, productSizes, products, stockMovements } from './db/schema';
import { getSizes, hasSizes, sizeStock } from './sizes';

/**
 * Semua fungsi di sini SINKRON (driver better-sqlite3) dan dimaksudkan dipanggil di dalam
 * `transact()` supaya perubahan stok + mutasi tercatat atomik.
 *
 * Stok per ukuran: produk yang punya baris di `product_sizes` WAJIB diubah per ukuran (parameter `size`),
 * dan `products.stock` selalu = jumlah stok semua ukurannya. Produk tanpa ukuran memakai `size = ''`.
 */
type Exec = typeof db | Tx;
type Meta = {
	type: 'pembelian' | 'penjualan' | 'pembatalan' | 'penyesuaian';
	refType?: string;
	refId?: number;
	note?: string;
	by?: number | null;
};

type Target = { productId: number } | { bundleId: number };

function record(tx: Exec, target: Target, change: number, stockAfter: number, m: Meta, size = '') {
	tx.insert(stockMovements)
		.values({
			...target,
			size: size || null,
			type: m.type,
			quantityChange: change,
			stockAfter,
			referenceType: m.refType,
			referenceId: m.refId,
			note: m.note,
			createdBy: m.by ?? null
		})
		.run();
}

/** Ukuran pertama produk (urutan tampil) — tujuan cadangan untuk stok yang kembali tanpa ukuran tercatat. */
const firstSize = (tx: Exec, productId: number): string | undefined =>
	getSizes(tx, productId)[0]?.label;

/**
 * Tambah stok. `size` kosong pada produk yang kini ber-ukuran (mis. pesanan lama dibatalkan setelah produk
 * diberi ukuran) → masuk ke ukuran pertama + dicatat; ukuran yang sudah dihapus dibuat kembali.
 */
export function increaseProductStock(
	tx: Exec,
	productId: number,
	qty: number,
	m: Meta,
	size = ''
): void {
	let target = size;
	let note = m.note;
	if (!target) {
		const first = firstSize(tx, productId);
		if (first) {
			target = first;
			note = [m.note, `Ukuran tidak tercatat → ${first}`].filter(Boolean).join(' · ');
		}
	}

	tx.update(products)
		.set({ stock: sql`${products.stock} + ${qty}`, updatedAt: NOW_ISO })
		.where(eq(products.id, productId))
		.run();

	let after: number;
	if (target) {
		const r = tx
			.update(productSizes)
			.set({ stock: sql`${productSizes.stock} + ${qty}`, updatedAt: NOW_ISO })
			.where(and(eq(productSizes.productId, productId), eq(productSizes.label, target)))
			.run();
		if (r.changes === 0) {
			const last = tx
				.select({ n: sql<number>`COALESCE(MAX(${productSizes.sortOrder}), 0)` })
				.from(productSizes)
				.where(eq(productSizes.productId, productId))
				.get();
			tx.insert(productSizes)
				.values({ productId, label: target, stock: qty, sortOrder: (last?.n ?? 0) + 1 })
				.run();
		}
		after = sizeStock(tx, productId, target) ?? qty;
	} else {
		after =
			tx.select({ stock: products.stock }).from(products).where(eq(products.id, productId)).get()
				?.stock ?? 0;
	}
	record(tx, { productId }, qty, after, { ...m, note }, target);
}

/**
 * Kurangi stok hanya bila cukup. false = stok kurang / produk tak aktif / ukuran tidak ada /
 * produk ber-ukuran tetapi ukuran tidak diberikan. Tidak mengubah apa pun bila false.
 */
export function decreaseProductStock(
	tx: Exec,
	productId: number,
	qty: number,
	m: Meta,
	size = ''
): boolean {
	const prod = tx
		.select({ stock: products.stock, active: products.isActive })
		.from(products)
		.where(eq(products.id, productId))
		.get();
	if (!prod || !prod.active || prod.stock < qty) return false;

	if (!size) {
		if (hasSizes(tx, productId)) return false; // wajib memilih ukuran
		const r = tx
			.update(products)
			.set({ stock: sql`${products.stock} - ${qty}`, updatedAt: NOW_ISO })
			.where(and(eq(products.id, productId), gte(products.stock, qty)))
			.run();
		if (r.changes === 0) return false;
		record(tx, { productId }, -qty, prod.stock - qty, m);
		return true;
	}

	const r = tx
		.update(productSizes)
		.set({ stock: sql`${productSizes.stock} - ${qty}`, updatedAt: NOW_ISO })
		.where(
			and(
				eq(productSizes.productId, productId),
				eq(productSizes.label, size),
				gte(productSizes.stock, qty)
			)
		)
		.run();
	if (r.changes === 0) return false;

	tx.update(products)
		.set({ stock: sql`${products.stock} - ${qty}`, updatedAt: NOW_ISO })
		.where(eq(products.id, productId))
		.run();
	record(tx, { productId }, -qty, sizeStock(tx, productId, size) ?? 0, m, size);
	return true;
}

/**
 * Tarik kembali stok yang pernah masuk (pembatalan pembelian). Berbeda dari `decreaseProductStock`:
 * tidak mensyaratkan produk aktif. false = stok sekarang kurang (sebagian sudah terjual) → tidak mengubah apa pun.
 */
export function removeProductStock(
	tx: Exec,
	productId: number,
	qty: number,
	m: Meta,
	size = ''
): boolean {
	const target = size || firstSize(tx, productId) || '';
	const prod = tx
		.select({ stock: products.stock })
		.from(products)
		.where(eq(products.id, productId))
		.get();
	if (!prod || prod.stock < qty) return false;

	if (target) {
		const r = tx
			.update(productSizes)
			.set({ stock: sql`${productSizes.stock} - ${qty}`, updatedAt: NOW_ISO })
			.where(
				and(
					eq(productSizes.productId, productId),
					eq(productSizes.label, target),
					gte(productSizes.stock, qty)
				)
			)
			.run();
		if (r.changes === 0) return false;
		tx.update(products)
			.set({ stock: sql`${products.stock} - ${qty}`, updatedAt: NOW_ISO })
			.where(eq(products.id, productId))
			.run();
		record(tx, { productId }, -qty, sizeStock(tx, productId, target) ?? 0, m, target);
		return true;
	}

	tx.update(products)
		.set({ stock: sql`${products.stock} - ${qty}`, updatedAt: NOW_ISO })
		.where(eq(products.id, productId))
		.run();
	record(tx, { productId }, -qty, prod.stock - qty, m);
	return true;
}

export function increaseBundleStock(tx: Exec, bundleId: number, qty: number, m: Meta): void {
	tx.update(bundles)
		.set({ stock: sql`${bundles.stock} + ${qty}`, updatedAt: NOW_ISO })
		.where(eq(bundles.id, bundleId))
		.run();
	const b = tx.select({ stock: bundles.stock }).from(bundles).where(eq(bundles.id, bundleId)).get();
	record(tx, { bundleId }, qty, b?.stock ?? 0, m);
}

export function decreaseBundleStock(tx: Exec, bundleId: number, qty: number, m: Meta): boolean {
	const r = tx
		.update(bundles)
		.set({ stock: sql`${bundles.stock} - ${qty}`, updatedAt: NOW_ISO })
		.where(and(eq(bundles.id, bundleId), eq(bundles.isActive, true), gte(bundles.stock, qty)))
		.run();
	if (r.changes === 0) return false;

	const b = tx.select({ stock: bundles.stock }).from(bundles).where(eq(bundles.id, bundleId)).get();
	record(tx, { bundleId }, -qty, b?.stock ?? 0, m);
	return true;
}

/** Atur stok produk (penyesuaian manual). Produk ber-ukuran: `size` wajib (stok ukuran itu yang diatur). */
export function setProductStock(
	tx: Exec,
	productId: number,
	newStock: number,
	by: number,
	note: string,
	size = ''
): number {
	const cur = tx
		.select({ stock: products.stock })
		.from(products)
		.where(eq(products.id, productId))
		.get();
	if (!cur) throw new Error('Produk tidak ditemukan');

	if (!size) {
		if (hasSizes(tx, productId)) throw new Error('Pilih ukuran yang stoknya disesuaikan');
		const diff = newStock - cur.stock;
		if (diff === 0) return 0;
		tx.update(products)
			.set({ stock: newStock, updatedAt: NOW_ISO })
			.where(eq(products.id, productId))
			.run();
		record(tx, { productId }, diff, newStock, { type: 'penyesuaian', refType: 'manual', note, by });
		return diff;
	}

	const before = sizeStock(tx, productId, size);
	if (before === undefined) throw new Error(`Ukuran ${size} tidak ditemukan`);
	const diff = newStock - before;
	if (diff === 0) return 0;

	tx.update(productSizes)
		.set({ stock: newStock, updatedAt: NOW_ISO })
		.where(and(eq(productSizes.productId, productId), eq(productSizes.label, size)))
		.run();
	tx.update(products)
		.set({ stock: sql`${products.stock} + ${diff}`, updatedAt: NOW_ISO })
		.where(eq(products.id, productId))
		.run();
	record(
		tx,
		{ productId },
		diff,
		newStock,
		{ type: 'penyesuaian', refType: 'manual', note, by },
		size
	);
	return diff;
}

export function setBundleStock(
	tx: Exec,
	bundleId: number,
	newStock: number,
	by: number,
	note: string
): number {
	const cur = tx
		.select({ stock: bundles.stock })
		.from(bundles)
		.where(eq(bundles.id, bundleId))
		.get();
	if (!cur) throw new Error('Bundling tidak ditemukan');
	const diff = newStock - cur.stock;
	if (diff === 0) return 0;

	tx.update(bundles)
		.set({ stock: newStock, updatedAt: NOW_ISO })
		.where(eq(bundles.id, bundleId))
		.run();
	record(tx, { bundleId }, diff, newStock, { type: 'penyesuaian', refType: 'manual', note, by });
	return diff;
}
