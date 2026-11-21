import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { transact } from './db';
import { sessions, users } from './db/schema';
import { hashPassword } from './auth';
import { logActivity } from './activity';

export type CustomerActionResult =
	| {
			ok: true;
			name: string;
			email: string;
			phone: string | null;
			isActive: boolean;
			tempPassword?: string;
	  }
	| { ok: false; status: number; message: string };

/**
 * Aktifkan/nonaktifkan akun KONSUMEN. Admin/owner tidak bisa disentuh lewat jalur ini (WHERE role='konsumen').
 * Nonaktif → semua sesi dihapus (SRS-F-007, TC-007-04) dalam satu transaksi.
 * `to` = status tujuan; bila kosong, dibalik dari status sekarang.
 */
export async function setCustomerActive(
	adminId: number,
	id: number,
	to?: boolean
): Promise<CustomerActionResult> {
	return transact((tx): CustomerActionResult => {
		const cust = tx
			.select()
			.from(users)
			.where(and(eq(users.id, id), eq(users.role, 'konsumen')))
			.get();
		if (!cust) return { ok: false, status: 404, message: 'Pelanggan tidak ditemukan.' };

		const next = to ?? !cust.isActive;
		if (next !== cust.isActive) {
			tx.update(users)
				.set({ isActive: next })
				.where(and(eq(users.id, id), eq(users.role, 'konsumen')))
				.run();
			if (!next) tx.delete(sessions).where(eq(sessions.userId, id)).run();
			logActivity(
				adminId,
				next ? 'user.activate' : 'user.deactivate',
				'user',
				id,
				`Akun pelanggan ${cust.name} ${next ? 'diaktifkan kembali' : 'dinonaktifkan'}`,
				tx
			);
		}
		return { ok: true, name: cust.name, email: cust.email, phone: cust.phone, isActive: next };
	});
}

/**
 * Reset password KONSUMEN: password sementara acak (12 karakter), `must_change_password = true`,
 * semua sesi dihapus. Password polos hanya dikembalikan ke pemanggil (ditampilkan sekali) — TIDAK dicatat ke log.
 */
export async function resetCustomerPassword(
	adminId: number,
	id: number
): Promise<CustomerActionResult> {
	const temp = randomBytes(9).toString('base64url');
	const passwordHash = await hashPassword(temp); // async (argon2) → di luar transaksi sinkron

	return transact((tx): CustomerActionResult => {
		const cust = tx
			.select()
			.from(users)
			.where(and(eq(users.id, id), eq(users.role, 'konsumen')))
			.get();
		if (!cust) return { ok: false, status: 404, message: 'Pelanggan tidak ditemukan.' };

		tx.update(users)
			.set({ passwordHash, mustChangePassword: true })
			.where(and(eq(users.id, id), eq(users.role, 'konsumen')))
			.run();
		tx.delete(sessions).where(eq(sessions.userId, id)).run();
		logActivity(
			adminId,
			'user.reset_password',
			'user',
			id,
			`Password pelanggan ${cust.name} direset oleh admin`,
			tx
		);
		return {
			ok: true,
			name: cust.name,
			email: cust.email,
			phone: cust.phone,
			isActive: cust.isActive,
			tempPassword: temp
		};
	});
}
