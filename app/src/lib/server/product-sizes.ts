import { and, eq } from 'drizzle-orm';
import type { Tx } from './db';
import { NOW_ISO, productSizes, products, stockMovements } from './db/schema';
import { getSizes, syncProductTotal } from './sizes';
import { INITIAL_STOCK_NOTE } from './product-usage';
import type { SizeInput } from '#lib/schemas/product';

/** Pelanggaran aturan ukuran produk: pesan aman ditampilkan ke admin. */
export class SizeRuleError extends Error {}

/**
 * Produk baru dengan ukuran: tiap ukuran dibuat dengan stok awalnya (mutasi "stok awal" per ukuran),
 * lalu `products.stock` = jumlah semua ukuran. Dipanggil di dalam transaksi pembuatan produk.
 */
export function createInitialSizes(tx: Tx, productId: number, rows: SizeInput[], by: number) {
	for (const r of rows) {
		tx.insert(productSizes).values({ productId, label: r.label, stock: r.stock }).run();
		if (r.stock > 0) {
			tx.insert(stockMovements)
				.values({
					productId,
					size: r.label,
					type: 'penyesuaian',
					quantityChange: r.stock,
					stockAfter: r.stock,
					referenceType: 'manual',
					note: INITIAL_STOCK_NOTE,
					createdBy: by
				})
				.run();
		}
	}
	syncProductTotal(tx, productId);
}

/**
 * Ubah daftar ukuran produk yang sudah ada (dipanggil di dalam transaksi).
 * - Hapus: hanya ukuran yang stoknya 0 (stok tidak boleh hilang diam-diam).
 * - Tambah: ukuran baru dengan stok awal; bila produk sebelumnya TANPA ukuran dan punya stok, stok lama
 *   dipindahkan ke ukuran (dicatat sebagai penyesuaian) sehingga total tetap = jumlah semua ukuran.
 */
export function applySizeEdit(
	tx: Tx,
	productId: number,
	by: number,
	add: SizeInput[],
	remove: string[]
): { added: number; removed: number } {
	if (add.length === 0 && remove.length === 0) return { added: 0, removed: 0 };

	const before = getSizes(tx, productId);
	const byLabel = new Map(before.map((s) => [s.label, s]));

	for (const label of remove) {
		const row = byLabel.get(label);
		if (!row) throw new SizeRuleError(`Ukuran ${label} tidak ditemukan.`);
		if (row.stock > 0) {
			throw new SizeRuleError(
				`Ukuran ${label} masih punya stok ${row.stock}. Sesuaikan stoknya menjadi 0 di halaman Stok dulu.`
			);
		}
	}
	for (const r of add) {
		if (byLabel.has(r.label) && !remove.includes(r.label)) {
			throw new SizeRuleError(`Ukuran ${r.label} sudah ada.`);
		}
	}

	const prod = tx
		.select({ stock: products.stock })
		.from(products)
		.where(eq(products.id, productId))
		.get();
	if (!prod) throw new SizeRuleError('Produk tidak ditemukan.');

	for (const label of remove) {
		tx.delete(productSizes)
			.where(and(eq(productSizes.productId, productId), eq(productSizes.label, label)))
			.run();
	}

	// Konversi dari produk tanpa ukuran: stok lama pindah ke ukuran-ukuran baru
	const converting = before.length === 0 && add.length > 0;
	if (converting && prod.stock > 0) {
		tx.insert(stockMovements)
			.values({
				productId,
				type: 'penyesuaian',
				quantityChange: -prod.stock,
				stockAfter: 0,
				referenceType: 'manual',
				note: 'Dipindahkan ke stok per ukuran',
				createdBy: by
			})
			.run();
	}

	for (const r of add) {
		tx.insert(productSizes).values({ productId, label: r.label, stock: r.stock }).run();
		if (r.stock > 0) {
			tx.insert(stockMovements)
				.values({
					productId,
					size: r.label,
					type: 'penyesuaian',
					quantityChange: r.stock,
					stockAfter: r.stock,
					referenceType: 'manual',
					note: converting ? 'Stok awal ukuran (konversi)' : 'Stok awal ukuran baru',
					createdBy: by
				})
				.run();
		}
	}

	// Total produk dihitung ulang; tanpa ukuran tersisa → stok 0 (semua ukuran yang dihapus bersaldo 0)
	const remaining = getSizes(tx, productId);
	if (remaining.length === 0) {
		tx.update(products)
			.set({ stock: 0, updatedAt: NOW_ISO })
			.where(eq(products.id, productId))
			.run();
	} else {
		syncProductTotal(tx, productId);
	}
	return { added: add.length, removed: remove.length };
}
