import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, transact, type Tx } from './db';
import { bundleItems, bundles, cartItems, carts, products } from './db/schema';
import { effectiveBundleStock } from '#lib/utils/bundle';
import {
	decodeSelection,
	encodeSelection,
	normalizeSize,
	type SizeSelection
} from '#lib/utils/sizes';
import { getSizes, sizeStock } from './sizes';

type Exec = typeof db | Tx;
export type CartKind = 'product' | 'bundle';

/** Batas jumlah per baris keranjang (sama dengan validasi Zod di route). */
export const MAX_CART_QTY = 99;

export async function getOrCreateCart(userId: number) {
	return getOrCreateCartSync(db, userId);
}

function getOrCreateCartSync(exec: Exec, userId: number) {
	const existing = exec.select().from(carts).where(eq(carts.userId, userId)).get();
	if (existing) return existing;
	// uq_carts_user: dua permintaan bersamaan tidak menghasilkan dua keranjang
	exec.insert(carts).values({ userId }).onConflictDoNothing().run();
	return exec.select().from(carts).where(eq(carts.userId, userId)).get()!;
}

type Check = { ok: true; size: string } | { ok: false; message: string };

/**
 * Validasi pilihan ukuran untuk satu baris keranjang dan kembalikan bentuk kanoniknya.
 * - Produk: ber-ukuran → label wajib ada di `product_sizes`; tanpa ukuran → harus kosong.
 * - Bundling: tiap komponen ber-ukuran wajib punya pilihan yang valid ("12:L|15:M").
 */
export function checkSize(exec: Exec, kind: CartKind, id: number, rawSize: string): Check {
	if (kind === 'product') {
		const sizes = getSizes(exec, id);
		if (sizes.length === 0) {
			return rawSize
				? { ok: false, message: 'Produk ini tidak memiliki pilihan ukuran' }
				: { ok: true, size: '' };
		}
		const label = normalizeSize(rawSize);
		if (!label) return { ok: false, message: 'Pilih ukuran terlebih dahulu' };
		if (!sizes.some((s) => s.label === label)) {
			return { ok: false, message: `Ukuran ${label} tidak tersedia` };
		}
		return { ok: true, size: label };
	}

	const comps = exec
		.select({ productId: bundleItems.productId, name: products.name })
		.from(bundleItems)
		.innerJoin(products, eq(products.id, bundleItems.productId))
		.where(eq(bundleItems.bundleId, id))
		.all();
	const picked = decodeSelection(rawSize);
	const clean: SizeSelection = {};
	for (const c of comps) {
		const sizes = getSizes(exec, c.productId);
		if (sizes.length === 0) continue;
		const label = normalizeSize(picked[c.productId] ?? '');
		if (!label) return { ok: false, message: `Pilih ukuran untuk ${c.name}` };
		if (!sizes.some((s) => s.label === label)) {
			return { ok: false, message: `Ukuran ${label} untuk ${c.name} tidak tersedia` };
		}
		clean[c.productId] = label;
	}
	return { ok: true, size: encodeSelection(clean) };
}

/**
 * Stok efektif yang boleh dibeli (0 bila nonaktif/terhapus atau pilihan ukuran tidak valid).
 * Produk ber-ukuran memakai stok ukuran terpilih. Bundling = min(kuota paket, ⌊stok komponen ÷ qty⌋),
 * komponen ber-ukuran memakai stok ukuran yang dipilih; komponen nonaktif/terhapus → 0.
 */
function stockSync(exec: Exec, kind: CartKind, id: number, size: string): number {
	if (kind === 'product') {
		const p = exec
			.select({ s: products.stock, active: products.isActive, deletedAt: products.deletedAt })
			.from(products)
			.where(eq(products.id, id))
			.get();
		if (!p || !p.active || p.deletedAt) return 0;
		if (getSizes(exec, id).length === 0) return size ? 0 : p.s;
		return size ? (sizeStock(exec, id, size) ?? 0) : 0;
	}

	const b = exec
		.select({ s: bundles.stock, active: bundles.isActive, deletedAt: bundles.deletedAt })
		.from(bundles)
		.where(eq(bundles.id, id))
		.get();
	if (!b || !b.active || b.deletedAt) return 0;

	const rows = exec
		.select({
			productId: bundleItems.productId,
			stock: products.stock,
			qty: bundleItems.quantity,
			active: products.isActive,
			deletedAt: products.deletedAt
		})
		.from(bundleItems)
		.innerJoin(products, eq(products.id, bundleItems.productId))
		.where(eq(bundleItems.bundleId, id))
		.all();

	if (rows.length === 0 || rows.some((c) => !c.active || c.deletedAt)) return 0;

	const picked = decodeSelection(size);
	const comps: { stock: number; qty: number }[] = [];
	for (const c of rows) {
		if (getSizes(exec, c.productId).length === 0) {
			comps.push({ stock: c.stock, qty: c.qty });
			continue;
		}
		const label = picked[c.productId];
		const st = label ? sizeStock(exec, c.productId, label) : undefined;
		if (st === undefined) return 0; // ukuran belum/tidak valid dipilih
		comps.push({ stock: st, qty: c.qty });
	}
	return effectiveBundleStock(b.s, comps);
}

export async function availableStock(kind: CartKind, id: number, size = ''): Promise<number> {
	return stockSync(db, kind, id, size);
}

/**
 * Tambah ke keranjang. Item yang sama (produk + ukuran) → qty bertambah (satu baris saja).
 * Dijalankan dalam transaksi `BEGIN IMMEDIATE`: baca-hitung-tulis tidak bisa disela klik ganda,
 * dan yang ditulis adalah nilai ABSOLUT (bukan `qty + n`). Indeks unik uq_ci_* jadi pengaman terakhir.
 * `size`: label ukuran (produk) atau pilihan ukuran komponen "12:L|15:M" (bundling).
 */
export async function addToCart(
	userId: number,
	kind: CartKind,
	id: number,
	qty: number,
	size = ''
) {
	if (!Number.isInteger(qty) || qty < 1 || qty > MAX_CART_QTY) {
		return { ok: false as const, message: `Jumlah harus 1–${MAX_CART_QTY}` };
	}

	return transact((tx) => {
		const chk = checkSize(tx, kind, id, size);
		if (!chk.ok) return { ok: false as const, message: chk.message };
		const norm = chk.size;

		const cart = getOrCreateCartSync(tx, userId);
		const col = kind === 'product' ? cartItems.productId : cartItems.bundleId;
		const existing = tx
			.select()
			.from(cartItems)
			.where(and(eq(cartItems.cartId, cart.id), eq(col, id), eq(cartItems.size, norm)))
			.get();

		const max = stockSync(tx, kind, id, norm);
		const target = (existing?.quantity ?? 0) + qty;
		const where = kind === 'product' && norm ? ` ukuran ${norm}` : '';

		if (max <= 0) return { ok: false as const, message: `Stok${where} habis` };
		if (target > max) {
			const inCart = existing?.quantity ?? 0;
			return {
				ok: false as const,
				message:
					inCart > 0
						? `Stok${where} tersedia hanya ${max} (sudah ${inCart} di keranjang)`
						: `Stok${where} tersedia hanya ${max}`
			};
		}
		if (target > MAX_CART_QTY) {
			return { ok: false as const, message: `Maksimal ${MAX_CART_QTY} per item di keranjang` };
		}

		if (existing) {
			// menambah lagi = jelas ingin membeli, jadi item yang tadinya tidak dicentang ikut dicentang
			tx.update(cartItems)
				.set({ quantity: target, isSelected: true })
				.where(eq(cartItems.id, existing.id))
				.run();
		} else {
			tx.insert(cartItems)
				.values({
					cartId: cart.id,
					quantity: target,
					size: norm,
					productId: kind === 'product' ? id : null,
					bundleId: kind === 'bundle' ? id : null
				})
				.run();
		}
		tx.update(carts)
			.set({ updatedAt: new Date().toISOString() })
			.where(eq(carts.id, cart.id))
			.run();

		return { ok: true as const };
	});
}

export type CartProblem = 'nonaktif' | 'stok' | 'ukuran' | null;

/** Baris keranjang dengan harga & ketersediaan TERKINI dari database (bukan dari klien). */
export async function getCartDetails(userId: number) {
	const cart = await getOrCreateCart(userId);
	const items = await db
		.select({
			id: cartItems.id,
			productId: cartItems.productId,
			bundleId: cartItems.bundleId,
			quantity: cartItems.quantity,
			size: cartItems.size,
			isSelected: cartItems.isSelected,
			prodName: products.name,
			prodSlug: products.slug,
			prodPrice: products.price,
			prodWeight: products.weightGrams,
			prodImage: products.imageUrl,
			prodActive: products.isActive,
			prodDeleted: products.deletedAt,
			bundleName: bundles.name,
			bundleSlug: bundles.slug,
			bundlePrice: bundles.price,
			bundleImage: bundles.imageUrl,
			bundleActive: bundles.isActive,
			bundleDeleted: bundles.deletedAt
		})
		.from(cartItems)
		.leftJoin(products, eq(products.id, cartItems.productId))
		.leftJoin(bundles, eq(bundles.id, cartItems.bundleId))
		.where(eq(cartItems.cartId, cart.id))
		.orderBy(cartItems.id);

	// Nama produk untuk menampilkan pilihan ukuran komponen bundling
	const pickedIds = new Set<number>();
	for (const it of items) {
		if (it.bundleId)
			for (const pid of Object.keys(decodeSelection(it.size))) pickedIds.add(Number(pid));
	}
	const names = new Map<number, string>();
	if (pickedIds.size > 0) {
		for (const r of db
			.select({ id: products.id, name: products.name })
			.from(products)
			.where(inArray(products.id, [...pickedIds]))
			.all()) {
			names.set(r.id, r.name);
		}
	}

	// Berat satuan paket bundling = jumlah berat komponennya (dipakai menghitung ongkir)
	const bundleWeight = new Map<number, number>();
	const bundleIdsInCart = [...new Set(items.flatMap((i) => (i.bundleId ? [i.bundleId] : [])))];
	if (bundleIdsInCart.length > 0) {
		for (const r of db
			.select({
				bundleId: bundleItems.bundleId,
				grams: sql<number>`SUM(${bundleItems.quantity} * ${products.weightGrams})`
			})
			.from(bundleItems)
			.innerJoin(products, eq(products.id, bundleItems.productId))
			.where(inArray(bundleItems.bundleId, bundleIdsInCart))
			.groupBy(bundleItems.bundleId)
			.all()) {
			bundleWeight.set(r.bundleId, Number(r.grams));
		}
	}

	const formattedItems = [];
	let subtotal = 0;
	let selectedUnits = 0;
	let selectedWeight = 0;

	for (const it of items) {
		const isProduct = Boolean(it.productId);
		const kind: CartKind = isProduct ? 'product' : 'bundle';
		const refId = (it.productId ?? it.bundleId)!;
		const name = (isProduct ? it.prodName : it.bundleName) ?? '(tidak tersedia)';
		const slug = (isProduct ? it.prodSlug : it.bundleSlug) ?? '';
		const price = isProduct ? (it.prodPrice ?? 0) : (it.bundlePrice ?? 0);
		const image = isProduct ? it.prodImage : it.bundleImage;
		const active = Boolean(isProduct ? it.prodActive : it.bundleActive);
		const deleted = Boolean(isProduct ? it.prodDeleted : it.bundleDeleted);
		const maxStock = stockSync(db, kind, refId, it.size);
		const sizeOk = checkSize(db, kind, refId, it.size).ok;

		const problem: CartProblem =
			!active || deleted ? 'nonaktif' : !sizeOk ? 'ukuran' : it.quantity > maxStock ? 'stok' : null;
		const lineSubtotal = price * it.quantity;
		// hanya baris yang dicentang DAN tanpa masalah yang ikut dihitung
		const unitWeight = isProduct ? (it.prodWeight ?? 0) : (bundleWeight.get(refId) ?? 0);
		if (it.isSelected && !problem) {
			subtotal += lineSubtotal;
			selectedUnits += it.quantity;
			selectedWeight += unitWeight * it.quantity;
		}

		// Tampilan ukuran: produk → "L"; bundling → [{ name, size }]
		const sizeParts = isProduct
			? it.size
				? [{ name: '', size: it.size }]
				: []
			: Object.entries(decodeSelection(it.size)).map(([pid, size]) => ({
					name: names.get(Number(pid)) ?? 'Produk',
					size
				}));

		formattedItems.push({
			id: it.id,
			isProduct,
			productId: it.productId,
			bundleId: it.bundleId,
			name,
			slug,
			price,
			image,
			quantity: it.quantity,
			size: it.size,
			isSelected: it.isSelected,
			unitWeight,
			sizeParts,
			maxStock,
			subtotal: lineSubtotal,
			problem,
			isAvailable: problem === null
		});
	}

	return {
		cartId: cart.id,
		items: formattedItems,
		/** Total baris yang dicentang & tanpa masalah (dasar checkout) */
		subtotal,
		/** Jumlah unit pada baris yang dicentang & tanpa masalah */
		selectedUnits,
		/** Berat total (gram) baris yang dicentang & tanpa masalah */
		selectedWeight,
		totalItems: formattedItems.reduce((acc, i) => acc + i.quantity, 0)
	};
}

export async function updateCartItemQuantity(userId: number, itemId: number, qty: number) {
	if (!Number.isInteger(qty) || qty < 1 || qty > MAX_CART_QTY) {
		return { ok: false as const, message: `Jumlah harus 1–${MAX_CART_QTY}` };
	}

	return transact((tx) => {
		const cart = getOrCreateCartSync(tx, userId);
		const item = tx
			.select()
			.from(cartItems)
			.where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)))
			.get();

		if (!item) return { ok: false as const, message: 'Item keranjang tidak ditemukan' };

		const kind: CartKind = item.productId ? 'product' : 'bundle';
		const max = stockSync(tx, kind, (item.productId ?? item.bundleId)!, item.size);

		if (max <= 0)
			return { ok: false as const, message: 'Stok habis. Hapus item ini dari keranjang.' };
		if (qty > max) return { ok: false as const, message: `Stok tersedia hanya ${max}` };

		// nilai absolut, bukan penambahan
		tx.update(cartItems).set({ quantity: qty }).where(eq(cartItems.id, item.id)).run();
		return { ok: true as const };
	});
}

export async function removeCartItem(userId: number, itemId: number) {
	const cart = await getOrCreateCart(userId);
	await db.delete(cartItems).where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)));
	return { ok: true as const };
}

/** Centang / lepas centang satu baris. Baris tak dikenal (atau milik orang lain) diabaikan. */
export async function setCartItemSelected(userId: number, itemId: number, selected: boolean) {
	const cart = await getOrCreateCart(userId);
	await db
		.update(cartItems)
		.set({ isSelected: selected })
		.where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)));
	return { ok: true as const };
}

/** Centang / lepas centang semua baris sekaligus. */
export async function setAllCartItemsSelected(userId: number, selected: boolean) {
	const cart = await getOrCreateCart(userId);
	await db.update(cartItems).set({ isSelected: selected }).where(eq(cartItems.cartId, cart.id));
	return { ok: true as const };
}

export async function clearCart(userId: number) {
	const cart = await getOrCreateCart(userId);
	await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
	return { ok: true as const };
}
