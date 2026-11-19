import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getSizesFor } from './sizes';
import { transact } from './db';
import { NOW_ISO, products, purchaseItems, purchases } from './db/schema';
import { nextPurchaseCode } from './codes';
import { increaseProductStock, removeProductStock } from './stock';
import { logActivity } from './activity';

/** Pelanggaran aturan bisnis pembelian (bukan galat sistem): pesan aman ditampilkan ke admin. */
export class PurchaseRuleError extends Error {}

export type PurchaseInput = {
	supplierName?: string | null;
	purchaseDate: string;
	note?: string | null;
	/** 'diterima' (bawaan): stok langsung naik. 'dipesan': stok baru naik saat `receivePurchase`. */
	status?: 'dipesan' | 'diterima';
	/** `size`: label ukuran untuk produk ber-ukuran; '' untuk produk tanpa ukuran */
	items: { productId: number; size?: string; quantity: number; unitCost: number }[];
};

const movementMeta = (purchaseId: number, code: string, by: number) => ({
	type: 'pembelian' as const,
	refType: 'purchase',
	refId: purchaseId,
	note: `Pembelian ${code}`,
	by
});

/**
 * Catat pembelian/restock (SRS-F-006, BR-09) dalam SATU transaksi: kode PBL → header → per baris
 * (stok naik + mutasi `pembelian` + purchase_items) → log. Gagal di tengah = rollback total
 * (stok tak berubah, tidak ada baris purchases). Item diurutkan menurut productId (pola kunci konsisten).
 */
export function createPurchase(adminId: number, input: PurchaseInput) {
	const items = [...input.items]
		.map((i) => ({ ...i, size: i.size ?? '' }))
		.sort((a, b) => a.productId - b.productId || a.size.localeCompare(b.size));
	const total = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
	const status = input.status ?? 'diterima';

	return transact((tx) => {
		// Semua produk harus ada dan belum dihapus (cegah error foreign key = 500)
		const found = tx
			.select({ id: products.id, name: products.name })
			.from(products)
			.where(
				and(
					inArray(
						products.id,
						items.map((i) => i.productId)
					),
					isNull(products.deletedAt)
				)
			)
			.all();
		if (found.length !== new Set(items.map((i) => i.productId)).size) {
			throw new PurchaseRuleError(
				'Ada produk dalam daftar yang tidak ditemukan atau sudah dihapus.'
			);
		}

		// Produk ber-ukuran wajib menyebut ukuran yang ada; produk tanpa ukuran tidak boleh menyebutnya
		const sizesOf = getSizesFor(
			tx,
			found.map((f) => f.id)
		);
		const nameOf = new Map(found.map((f) => [f.id, f.name]));
		for (const it of items) {
			const sizes = sizesOf.get(it.productId) ?? [];
			const name = nameOf.get(it.productId) ?? 'produk';
			if (sizes.length > 0 && !it.size) {
				throw new PurchaseRuleError(`Pilih ukuran untuk "${name}".`);
			}
			if (sizes.length > 0 && !sizes.some((s) => s.label === it.size)) {
				throw new PurchaseRuleError(`Ukuran ${it.size} tidak ada pada "${name}".`);
			}
			if (sizes.length === 0 && it.size) {
				throw new PurchaseRuleError(`"${name}" tidak memiliki pilihan ukuran.`);
			}
		}

		const code = nextPurchaseCode(tx);
		const p = tx
			.insert(purchases)
			.values({
				code,
				supplierName: input.supplierName ?? null,
				purchaseDate: input.purchaseDate,
				totalCost: total,
				note: input.note ?? null,
				status,
				receivedAt: status === 'diterima' ? NOW_ISO : null,
				createdBy: adminId
			})
			.returning({ id: purchases.id })
			.get();

		for (const it of items) {
			if (status === 'diterima') {
				increaseProductStock(
					tx,
					it.productId,
					it.quantity,
					movementMeta(p.id, code, adminId),
					it.size
				);
			}
			tx.insert(purchaseItems)
				.values({
					purchaseId: p.id,
					productId: it.productId,
					size: it.size,
					quantity: it.quantity,
					unitCost: it.unitCost
				})
				.run();
		}

		logActivity(
			adminId,
			'purchase.create',
			'purchase',
			p.id,
			`Pembelian ${code} ${status === 'diterima' ? 'dicatat (stok bertambah)' : 'dipesan'} (${items.length} item, total Rp ${total.toLocaleString('id-ID')})`,
			tx
		);
		return { id: p.id, code, total };
	});
}

function loadPurchase(tx: Parameters<Parameters<typeof transact>[0]>[0], id: number) {
	const p = tx.select().from(purchases).where(eq(purchases.id, id)).get();
	if (!p) throw new PurchaseRuleError('Pembelian tidak ditemukan.');
	const rows = tx
		.select({
			productId: purchaseItems.productId,
			size: purchaseItems.size,
			quantity: purchaseItems.quantity,
			name: products.name
		})
		.from(purchaseItems)
		.innerJoin(products, eq(products.id, purchaseItems.productId))
		.where(eq(purchaseItems.purchaseId, id))
		.all()
		.sort((a, b) => a.productId - b.productId || a.size.localeCompare(b.size));
	return { p, rows };
}

/** Barang pesanan sudah tiba: stok naik per baris (satu transaksi) dan status menjadi 'diterima'. */
export function receivePurchase(adminId: number, id: number) {
	return transact((tx) => {
		const { p, rows } = loadPurchase(tx, id);
		if (p.status !== 'dipesan') {
			throw new PurchaseRuleError(
				p.status === 'diterima'
					? 'Pembelian ini sudah diterima sebelumnya.'
					: 'Pembelian yang sudah dibatalkan tidak dapat diterima.'
			);
		}
		for (const r of rows) {
			increaseProductStock(
				tx,
				r.productId,
				r.quantity,
				movementMeta(p.id, p.code, adminId),
				r.size
			);
		}
		tx.update(purchases)
			.set({ status: 'diterima', receivedAt: NOW_ISO })
			.where(eq(purchases.id, id))
			.run();
		logActivity(
			adminId,
			'purchase.receive',
			'purchase',
			id,
			`Pembelian ${p.code} diterima (stok bertambah, ${rows.length} item)`,
			tx
		);
		return { code: p.code };
	});
}

/**
 * Batalkan pembelian. Berstatus 'dipesan' → hanya status berubah (stok belum pernah naik). Berstatus
 * 'diterima' → stok setiap baris ditarik kembali; bila sebagian sudah terjual (stok kurang) seluruh
 * pembatalan ditolak dan tidak ada yang berubah.
 */
export function cancelPurchase(adminId: number, id: number, reason?: string | null) {
	return transact((tx) => {
		const { p, rows } = loadPurchase(tx, id);
		if (p.status === 'dibatalkan') throw new PurchaseRuleError('Pembelian ini sudah dibatalkan.');

		const reverse = p.status === 'diterima';
		if (reverse) {
			for (const r of rows) {
				const ok = removeProductStock(
					tx,
					r.productId,
					r.quantity,
					{
						type: 'penyesuaian',
						refType: 'purchase',
						refId: p.id,
						note: `Pembatalan pembelian ${p.code}`,
						by: adminId
					},
					r.size
				);
				if (!ok) {
					throw new PurchaseRuleError(
						`Stok "${r.name}${r.size ? ` (${r.size})` : ''}" tidak cukup untuk ditarik ${r.quantity} pcs ` +
							'karena sebagian sudah terjual. Pembelian tidak dibatalkan.'
					);
				}
			}
		}
		tx.update(purchases)
			.set({ status: 'dibatalkan', cancelledAt: NOW_ISO, cancelNote: reason?.trim() || null })
			.where(eq(purchases.id, id))
			.run();
		logActivity(
			adminId,
			'purchase.cancel',
			'purchase',
			id,
			`Pembelian ${p.code} dibatalkan${reverse ? ' (stok ditarik kembali)' : ''}${reason?.trim() ? `: ${reason.trim()}` : ''}`,
			tx
		);
		return { code: p.code, reversed: reverse };
	});
}
