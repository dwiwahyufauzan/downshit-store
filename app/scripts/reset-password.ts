/**
 * Reset password akun (terutama staf: owner/admin) lewat CLI. Tidak ada reset staf lewat web
 * (mencegah pengambilalihan akun). BR-24: akun ditandai `must_change_password` dan semua
 * sesinya dihapus. Skrip ini TIDAK mengimpor `$lib`/`$app` (dijalankan `tsx`, bukan Vite).
 *
 * Pakai:  npm run db:reset-password -- <email>
 *    atau npx tsx scripts/reset-password.ts <email>
 * Opsional: RESET_PASSWORD_TEMP="..." untuk menentukan password sementara (≥ 8, huruf + angka).
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
	console.error('Pemakaian: npm run db:reset-password -- <email>');
	process.exit(1);
}

// Password sementara acak (12 karakter, pasti mengandung huruf & angka agar lolos aturan password)
function tempPassword(): string {
	for (;;) {
		const p = randomBytes(12).toString('base64url').slice(0, 12);
		if (/[A-Za-z]/.test(p) && /[0-9]/.test(p)) return p;
	}
}

const custom = process.env.RESET_PASSWORD_TEMP;
if (custom && (custom.length < 8 || !/[A-Za-z]/.test(custom) || !/[0-9]/.test(custom))) {
	console.error('RESET_PASSWORD_TEMP minimal 8 karakter dan harus mengandung huruf dan angka.');
	process.exit(1);
}
const temp = custom || tempPassword();
const passwordHash = await hash(temp, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

const dbPath = process.env.DATABASE_URL || 'downshit.db';
const sqlite = new Database(dbPath, { fileMustExist: true });
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

try {
	const user = sqlite
		.prepare('SELECT id, role, is_active FROM users WHERE email = ?')
		.get(email) as { id: number; role: string; is_active: number } | undefined;
	if (!user) {
		console.error(`Akun dengan email "${email}" tidak ditemukan.`);
		process.exit(1);
	}

	sqlite.transaction(() => {
		sqlite
			.prepare(
				`UPDATE users SET password_hash = ?, must_change_password = 1,
				   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
			)
			.run(passwordHash, user.id);
		sqlite.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
		sqlite
			.prepare(
				`INSERT INTO activity_logs (user_id, action, entity, entity_id, description)
				 VALUES (?, 'auth.reset_password', 'user', ?, 'Password direset via CLI')`
			)
			.run(user.id, user.id);
	})();

	console.log(`Password ${email} (${user.role}) direset. Semua sesi lamanya dihapus.`);
	if (!user.is_active) console.log('Catatan: akun ini NONAKTIF, belum bisa login.');
	console.log(`Password sementara: ${temp}`);
	console.log('Pengguna WAJIB menggantinya saat login pertama. Sampaikan lewat kanal aman.');
} finally {
	sqlite.close();
}
