import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { products, stockSubscriptions, users } from './db/schema';
import { getSizes } from './sizes';
import { mailEnabled, sendMail, textToHtml } from './mail';
import { envVar } from './config';
import { getSettings } from './settings';
import { normalizeSize } from '#lib/utils/sizes';

/** Batas permintaan menunggu per pengguna (mencegah tabel membengkak oleh skrip). */
export const MAX_PENDING_ALERTS = 50;

type Result = { ok: true } | { ok: false; message: string };

/** Stok yang bisa dibeli untuk satu varian (ukuran '' = produk tanpa ukuran). */
function variantStock(productId: number, size: string): number {
	const p = db
		.select({ stock: products.stock, active: products.isActive, deletedAt: products.deletedAt })
		.from(products)
		.where(eq(products.id, productId))
		.get();
	if (!p || !p.active || p.deletedAt) return 0;
	const sizes = getSizes(db, productId);
	if (sizes.length === 0) return size === '' ? p.stock : 0;
	if (size === '') return p.stock; // "salah satu ukuran" = total stok
	return sizes.find((s) => s.label === size)?.stock ?? 0;
}

/**
 * Minta dikabari saat varian ini tersedia lagi. Hanya varian yang SEKARANG habis yang bisa didaftarkan
 * (produk nonaktif/terhapus ditolak). Mendaftar ulang setelah pernah dikabari mengaktifkannya kembali.
 */
export function subscribeStockAlert(userId: number, productId: number, rawSize: string): Result {
	const prod = db
		.select({ id: products.id, active: products.isActive, deletedAt: products.deletedAt })
		.from(products)
		.where(eq(products.id, productId))
		.get();
	if (!prod || !prod.active || prod.deletedAt)
		return { ok: false, message: 'Produk tidak ditemukan.' };

	const sizes = getSizes(db, productId);
	let size = '';
	if (sizes.length > 0) {
		size = normalizeSize(rawSize);
		if (!sizes.some((s) => s.label === size)) {
			return { ok: false, message: 'Pilih ukuran yang stoknya habis.' };
		}
	}
	if (variantStock(productId, size) > 0) {
		return { ok: false, message: 'Stok masih tersedia, silakan langsung beli.' };
	}

	const pending = db
		.select({ id: stockSubscriptions.id })
		.from(stockSubscriptions)
		.where(and(eq(stockSubscriptions.userId, userId), isNull(stockSubscriptions.notifiedAt)))
		.all().length;
	const existing = db
		.select()
		.from(stockSubscriptions)
		.where(
			and(
				eq(stockSubscriptions.userId, userId),
				eq(stockSubscriptions.productId, productId),
				eq(stockSubscriptions.size, size)
			)
		)
		.get();
	if (!existing && pending >= MAX_PENDING_ALERTS) {
		return { ok: false, message: `Maksimal ${MAX_PENDING_ALERTS} pengingat stok.` };
	}

	db.insert(stockSubscriptions)
		.values({ userId, productId, size })
		.onConflictDoUpdate({
			target: [stockSubscriptions.userId, stockSubscriptions.productId, stockSubscriptions.size],
			set: { notifiedAt: null }
		})
		.run();
	return { ok: true };
}

export function unsubscribeStockAlert(userId: number, productId: number, size: string) {
	db.delete(stockSubscriptions)
		.where(
			and(
				eq(stockSubscriptions.userId, userId),
				eq(stockSubscriptions.productId, productId),
				eq(stockSubscriptions.size, normalizeSize(size))
			)
		)
		.run();
}

/** Varian produk ini yang sedang ditunggu pengguna (size '' = produk tanpa ukuran). */
export function pendingAlertSizes(userId: number, productId: number): string[] {
	return db
		.select({ size: stockSubscriptions.size })
		.from(stockSubscriptions)
		.where(
			and(
				eq(stockSubscriptions.userId, userId),
				eq(stockSubscriptions.productId, productId),
				isNull(stockSubscriptions.notifiedAt)
			)
		)
		.all()
		.map((r) => r.size);
}

/**
 * Kirim email untuk permintaan yang variannya sudah tersedia lagi, lalu tandai terkirim (tiap permintaan
 * hanya sekali). Dipanggil job pemeliharaan, jadi tidak perlu dikaitkan ke setiap jalur penambah stok.
 * Tanpa email terkonfigurasi: tidak melakukan apa pun (permintaan tetap menunggu). Mengembalikan jumlah email.
 */
export async function notifyRestocked(): Promise<number> {
	if (!mailEnabled()) return 0;

	const pending = db
		.select({
			id: stockSubscriptions.id,
			userId: stockSubscriptions.userId,
			productId: stockSubscriptions.productId,
			size: stockSubscriptions.size,
			email: users.email,
			userName: users.name,
			productName: products.name,
			slug: products.slug
		})
		.from(stockSubscriptions)
		.innerJoin(users, eq(users.id, stockSubscriptions.userId))
		.innerJoin(products, eq(products.id, stockSubscriptions.productId))
		.where(and(isNull(stockSubscriptions.notifiedAt), eq(users.isActive, true)))
		.all()
		.filter((s) => variantStock(s.productId, s.size) > 0);
	if (pending.length === 0) return 0;

	// satu email per pengguna per produk (beberapa ukuran digabung)
	const groups = new Map<string, typeof pending>();
	for (const s of pending) {
		const k = `${s.userId}:${s.productId}`;
		groups.set(k, [...(groups.get(k) ?? []), s]);
	}

	const cfg = await getSettings();
	const origin = (envVar('ORIGIN') ?? '').replace(/\/$/, '');
	let sent = 0;
	for (const list of groups.values()) {
		const s = list[0];
		const sizes = list.map((x) => x.size).filter(Boolean);
		const what = `${s.productName}${sizes.length ? ` (ukuran ${sizes.join(', ')})` : ''}`;
		const text = [
			`Halo ${s.userName},`,
			`Kabar baik: ${what} sudah tersedia lagi di ${cfg.storeName}. Stok terbatas, buruan sebelum habis lagi.`,
			`${origin}/produk/${s.slug}`
		].join('\n\n');
		const ok = await sendMail({
			to: s.email,
			subject: `[${cfg.storeName}] ${s.productName} tersedia lagi`,
			text,
			html: textToHtml(text)
		});
		if (!ok) continue; // coba lagi pada putaran berikutnya
		const now = new Date().toISOString();
		for (const x of list) {
			db.update(stockSubscriptions)
				.set({ notifiedAt: now })
				.where(eq(stockSubscriptions.id, x.id))
				.run();
		}
		sent++;
	}
	return sent;
}
