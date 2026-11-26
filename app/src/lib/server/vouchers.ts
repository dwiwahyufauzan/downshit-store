import { and, count, eq, sql } from 'drizzle-orm';
import { db, type Tx } from './db';
import { voucherRedemptions, vouchers } from './db/schema';
import type { PromoVoucher } from '#lib/utils/promo';

type Exec = typeof db | Tx;
export type Voucher = typeof vouchers.$inferSelect;

/** Kode voucher dinormalkan: huruf besar, tanpa spasi di tepi. */
export const normalizeVoucherCode = (raw: string) => raw.trim().toUpperCase();

export type VoucherCheck =
	{ ok: true; voucher: Voucher; discount: number } | { ok: false; message: string };

/** Potongan (Rp) untuk subtotal tertentu; tidak pernah melebihi subtotal. */
export function computeDiscount(
	v: Pick<Voucher, 'type' | 'value' | 'maxDiscount'>,
	subtotal: number
) {
	const raw = v.type === 'percent' ? Math.floor((subtotal * v.value) / 100) : v.value;
	const capped = v.type === 'percent' && v.maxDiscount ? Math.min(raw, v.maxDiscount) : raw;
	return Math.max(0, Math.min(capped, subtotal));
}

/** Satu pesan untuk semua penyebab "tidak bisa dipakai" agar tidak membocorkan detail voucher. */
const INVALID = 'Kode voucher tidak valid atau sudah tidak berlaku.';

/**
 * Periksa voucher untuk pengguna & subtotal tertentu: aktif, dalam periode, kuota total & per pengguna,
 * dan minimum belanja. Murni baca; pemakaian sebenarnya dicatat `redeemVoucher` di dalam transaksi pesanan.
 */
export function checkVoucher(
	ex: Exec,
	rawCode: string,
	userId: number,
	subtotal: number,
	now = new Date()
): VoucherCheck {
	const code = normalizeVoucherCode(rawCode);
	if (!code) return { ok: false, message: 'Masukkan kode voucher.' };
	const v = ex.select().from(vouchers).where(eq(vouchers.code, code)).get();
	if (!v || !v.isActive) return { ok: false, message: INVALID };

	const t = now.toISOString();
	if ((v.startsAt && t < v.startsAt) || (v.endsAt && t > v.endsAt)) {
		return { ok: false, message: INVALID };
	}
	if (v.usageLimit !== null && v.usedCount >= v.usageLimit) {
		return { ok: false, message: 'Kuota voucher ini sudah habis.' };
	}
	const mine = ex
		.select({ n: count() })
		.from(voucherRedemptions)
		.where(and(eq(voucherRedemptions.voucherId, v.id), eq(voucherRedemptions.userId, userId)))
		.get();
	if ((mine?.n ?? 0) >= v.perUserLimit) {
		return { ok: false, message: 'Voucher ini sudah kamu pakai.' };
	}
	if (subtotal < v.minSubtotal) {
		return {
			ok: false,
			message: `Minimal belanja Rp ${v.minSubtotal.toLocaleString('id-ID')} untuk voucher ini.`
		};
	}
	const discount = computeDiscount(v, subtotal);
	if (discount <= 0) return { ok: false, message: INVALID };
	return { ok: true, voucher: v, discount };
}

/**
 * Catat pemakaian di dalam transaksi pesanan. Kenaikan `used_count` bersyarat (kuota) sehingga dua pesanan
 * bersamaan tidak bisa sama-sama mengambil kuota terakhir. false = kuota baru saja habis.
 */
export function redeemVoucher(tx: Tx, voucherId: number, userId: number, orderId: number): boolean {
	const res = tx
		.update(vouchers)
		.set({ usedCount: sql`${vouchers.usedCount} + 1` })
		.where(
			and(
				eq(vouchers.id, voucherId),
				sql`(${vouchers.usageLimit} IS NULL OR ${vouchers.usedCount} < ${vouchers.usageLimit})`
			)
		)
		.run();
	if (res.changes === 0) return false;
	tx.insert(voucherRedemptions).values({ voucherId, userId, orderId }).run();
	return true;
}

/** Pesanan dibatalkan/kedaluwarsa: kuota voucher dikembalikan. Aman dipanggil untuk pesanan tanpa voucher. */
export function releaseVoucher(tx: Tx, orderId: number): void {
	const r = tx
		.select()
		.from(voucherRedemptions)
		.where(eq(voucherRedemptions.orderId, orderId))
		.get();
	if (!r) return;
	tx.delete(voucherRedemptions).where(eq(voucherRedemptions.id, r.id)).run();
	tx.update(vouchers)
		.set({ usedCount: sql`MAX(${vouchers.usedCount} - 1, 0)` })
		.where(eq(vouchers.id, r.voucherId))
		.run();
}

/* ---------------------------------------------------------------- tampilan admin */

export type VoucherStatus = 'aktif' | 'nonaktif' | 'belum_mulai' | 'kedaluwarsa' | 'habis';
export const VOUCHER_STATUSES: readonly VoucherStatus[] = [
	'aktif',
	'nonaktif',
	'belum_mulai',
	'kedaluwarsa',
	'habis'
];

/**
 * Status efektif voucher untuk daftar admin. Urutan prioritas: dimatikan admin → kuota habis →
 * kedaluwarsa → belum mulai → aktif (hanya "aktif" yang bisa dipakai pelanggan saat ini).
 */
export function voucherStatus(
	v: Pick<Voucher, 'isActive' | 'startsAt' | 'endsAt' | 'usageLimit' | 'usedCount'>,
	now = new Date()
): VoucherStatus {
	const t = now.toISOString();
	if (!v.isActive) return 'nonaktif';
	if (v.usageLimit !== null && v.usedCount >= v.usageLimit) return 'habis';
	if (v.endsAt && t > v.endsAt) return 'kedaluwarsa';
	if (v.startsAt && t < v.startsAt) return 'belum_mulai';
	return 'aktif';
}

/**
 * Voucher yang ditampilkan sebagai banner di beranda: aktif sekarang, ditandai `showOnHome`, dan belum
 * habis dipakai oleh pelanggan yang sedang melihat (userId null = tamu). Yang paling cepat berakhir lebih dulu.
 */
export function listHomeVouchers(
	ex: Exec,
	userId: number | null,
	now = new Date(),
	limit = 3
): PromoVoucher[] {
	const rows = ex.select().from(vouchers).where(eq(vouchers.showOnHome, true)).all();
	const used = new Map<number, number>();
	if (userId !== null) {
		for (const r of ex
			.select({ id: voucherRedemptions.voucherId, n: count() })
			.from(voucherRedemptions)
			.where(eq(voucherRedemptions.userId, userId))
			.groupBy(voucherRedemptions.voucherId)
			.all()) {
			used.set(r.id, r.n);
		}
	}
	return rows
		.filter((v) => voucherStatus(v, now) === 'aktif')
		.filter((v) => (used.get(v.id) ?? 0) < v.perUserLimit)
		.sort((a, b) => (a.endsAt ?? '9999').localeCompare(b.endsAt ?? '9999') || b.id - a.id)
		.slice(0, limit)
		.map((v) => ({
			code: v.code,
			description: v.description,
			type: v.type,
			value: v.value,
			minSubtotal: v.minSubtotal,
			maxDiscount: v.maxDiscount,
			endsAt: v.endsAt,
			remaining: v.usageLimit === null ? null : Math.max(0, v.usageLimit - v.usedCount)
		}));
}
