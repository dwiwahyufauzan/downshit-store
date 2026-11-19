import { and, count, eq, gt, lt } from 'drizzle-orm';
import { db } from './db';
import { loginAttempts } from './db/schema';

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

/* ---------- Rate limit ringan di memori (registrasi, upload, ganti password) ---------- */

const hits = new Map<string, number[]>();

/**
 * Mengembalikan `true` bila DIBLOKIR (sudah `max` permintaan dalam `windowMs`).
 * Disimpan di memori proses: hilang saat restart dan tidak dibagi antar-proses
 * (cukup untuk satu instance Node).
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
	const now = Date.now();
	const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
	if (recent.length >= max) {
		hits.set(key, recent);
		return true;
	}
	recent.push(now);
	hits.set(key, recent);

	// Sapu entri basi agar Map tidak membengkak
	if (hits.size > 5000) {
		for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
	}
	return false;
}

/** Hanya untuk tes: kosongkan penghitung memori. */
export function resetRateLimits() {
	hits.clear();
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
