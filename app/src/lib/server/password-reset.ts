import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { afterCommit, db, transact } from './db';
import { passwordResets, sessions, users } from './db/schema';
import { hashPassword } from './auth';
import { logActivity } from './activity';
import { envVar } from './config';
import { mailEnabled, sendMail, textToHtml } from './mail';
import { getSettings } from './settings';

/** Masa berlaku tautan reset. */
export const RESET_TTL_MS = 60 * 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const nowIso = () => new Date().toISOString();

/**
 * Minta tautan reset untuk email KONSUMEN aktif. Hasilnya sengaja tidak membedakan "email tidak ada"
 * (pemanggil selalu menampilkan pesan yang sama) agar daftar akun tidak bisa ditebak.
 * Akun staf tidak bisa direset lewat jalur ini (diatur Owner/CLI).
 */
export async function requestPasswordReset(rawEmail: string): Promise<boolean> {
	if (!mailEnabled()) return false;
	const email = rawEmail.trim().toLowerCase();
	const user = db
		.select({ id: users.id, name: users.name, email: users.email })
		.from(users)
		.where(and(eq(users.email, email), eq(users.role, 'konsumen'), eq(users.isActive, true)))
		.get();
	if (!user) return false;

	const token = randomBytes(32).toString('base64url');
	const cfg = await getSettings();
	const link = `${(envVar('ORIGIN') ?? '').replace(/\/$/, '')}/reset-password/${token}`;

	await transact((tx) => {
		// satu tautan aktif per akun: yang lama dibuang
		tx.delete(passwordResets)
			.where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)))
			.run();
		tx.insert(passwordResets)
			.values({
				userId: user.id,
				tokenHash: hashToken(token),
				expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString()
			})
			.run();
		logActivity(user.id, 'auth.reset_request', 'user', user.id, 'Permintaan reset password', tx);

		const text = [
			`Halo ${user.name},`,
			`Kami menerima permintaan mengatur ulang password akun ${cfg.storeName} milikmu. Buka tautan berikut (berlaku 1 jam, sekali pakai):`,
			link,
			'Jika bukan kamu yang meminta, abaikan email ini; password lamamu tetap aman.'
		].join('\n\n');
		afterCommit(tx, () =>
			sendMail({
				to: user.email,
				subject: `[${cfg.storeName}] Atur ulang password`,
				text,
				html: textToHtml(text)
			}).then(() => undefined)
		);
	});
	return true;
}

/** Tautan masih berlaku (belum dipakai, belum kedaluwarsa, akun aktif)? */
export function isResetTokenValid(token: string): boolean {
	return Boolean(findValid(token));
}

function findValid(token: string) {
	return db
		.select({ id: passwordResets.id, userId: passwordResets.userId })
		.from(passwordResets)
		.innerJoin(users, eq(users.id, passwordResets.userId))
		.where(
			and(
				eq(passwordResets.tokenHash, hashToken(token)),
				isNull(passwordResets.usedAt),
				gt(passwordResets.expiresAt, nowIso()),
				eq(users.isActive, true),
				eq(users.role, 'konsumen')
			)
		)
		.get();
}

/**
 * Tetapkan password baru lewat tautan. Sekali pakai; semua sesi lama akun dihapus (perangkat yang
 * mungkin dikuasai orang lain ikut keluar). false = tautan tidak valid / kedaluwarsa / sudah dipakai.
 */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
	if (!findValid(token)) return false;
	const passwordHash = await hashPassword(newPassword);

	return transact((tx) => {
		// diperiksa ulang di dalam transaksi: dua permintaan bersamaan tidak boleh sama-sama berhasil
		const row = tx
			.select({ id: passwordResets.id, userId: passwordResets.userId })
			.from(passwordResets)
			.where(
				and(
					eq(passwordResets.tokenHash, hashToken(token)),
					isNull(passwordResets.usedAt),
					gt(passwordResets.expiresAt, nowIso())
				)
			)
			.get();
		if (!row) return false;

		const now = nowIso();
		tx.update(users)
			.set({ passwordHash, mustChangePassword: false, updatedAt: now })
			.where(eq(users.id, row.userId))
			.run();
		tx.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, row.id)).run();
		tx.delete(sessions).where(eq(sessions.userId, row.userId)).run();
		logActivity(
			row.userId,
			'auth.reset_password',
			'user',
			row.userId,
			'Password diatur ulang lewat email',
			tx
		);
		return true;
	});
}

/** Hapus token kedaluwarsa/terpakai yang sudah lewat 1 hari (dipanggil job pemeliharaan). */
export async function purgePasswordResets(): Promise<number> {
	const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
	return db.delete(passwordResets).where(lt(passwordResets.expiresAt, cutoff)).run().changes;
}
