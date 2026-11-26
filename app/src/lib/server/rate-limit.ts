import { and, count, eq, gt, lt } from 'drizzle-orm';
import { db } from './db';
import { loginAttempts, rateHits } from './db/schema';

const WINDOW_MIN = 15;
const MAX_ATTEMPTS = 5;

export async function tooManyAttempts(identifier: string, max = MAX_ATTEMPTS): Promise<boolean> {
	const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
	const [r] = await db
		.select({ n: count() })
		.from(loginAttempts)
		.where(and(eq(loginAttempts.identifier, identifier), gt(loginAttempts.createdAt, since)));

	return (r?.n ?? 0) >= max;
}

export async function recordFailure(identifier: string) {
	await db.insert(loginAttempts).values({ identifier });
}

export async function clearFailures(identifier: string) {
	await db.delete(loginAttempts).where(eq(loginAttempts.identifier, identifier));
}

export async function purgeOldAttempts(): Promise<number> {
	const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
	return db.delete(loginAttempts).where(lt(loginAttempts.createdAt, cutoff)).run().changes;
}

export const purgeOld = purgeOldAttempts;

/* ---------- Rate limit jendela geser, disimpan di database (dibagi antar-proses) ---------- */

let sincePurge = 0;

/**
 * Mengembalikan `true` bila DIBLOKIR (sudah `max` permintaan dalam `windowMs`).
 * Hitungan ada di tabel `rate_hits` sehingga dibagi antar-proses/instance yang memakai database yang sama
 * dan tidak hilang saat restart. Sinkron (better-sqlite3) dan atomik (BEGIN IMMEDIATE): dua permintaan
 * bersamaan tidak bisa sama-sama lolos di batas. Permintaan yang diblokir tidak menambah hitungan.
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
	const now = Date.now();
	const blocked = db.transaction(
		(tx) => {
			const since = now - windowMs;
			tx.delete(rateHits)
				.where(and(eq(rateHits.key, key), lt(rateHits.at, since)))
				.run();
			const hit = tx.select({ n: count() }).from(rateHits).where(eq(rateHits.key, key)).get();
			if ((hit?.n ?? 0) >= max) return true;
			tx.insert(rateHits).values({ key, at: now }).run();
			return false;
		},
		{ behavior: 'immediate' }
	);

	// kunci yang tidak pernah dipakai lagi tidak terhapus oleh pembersihan per kunci di atas
	if (++sincePurge >= 500) {
		sincePurge = 0;
		purgeRateHits();
	}
	return blocked;
}

/** Hapus catatan lebih dari 1 hari (batas jendela terpanjang yang dipakai aplikasi jauh di bawah ini). */
export function purgeRateHits(): number {
	return db
		.delete(rateHits)
		.where(lt(rateHits.at, Date.now() - 24 * 3600_000))
		.run().changes;
}

/** Hanya untuk tes: kosongkan penghitung. */
export function resetRateLimits() {
	db.delete(rateHits).run();
}

let warnedClientAddress = false;

/**
 * IP klien untuk kunci rate limit. `getClientAddress()` melempar error bila `ADDRESS_HEADER`
 * diset tetapi header-nya tidak ada (mis. akses langsung tanpa proxy): jangan sampai itu
 * membuat login/registrasi 500. Cadangan: kunci bersama "unknown" (lebih ketat, bukan lebih longgar).
 */
export function clientIp(getClientAddress: () => string): string {
	try {
		return getClientAddress();
	} catch (e) {
		if (!warnedClientAddress) {
			warnedClientAddress = true;
			console.warn(
				'[rate-limit] getClientAddress() gagal; periksa ADDRESS_HEADER/XFF_DEPTH dan proxy.',
				e instanceof Error ? e.message : e
			);
		}
		return 'unknown';
	}
}
