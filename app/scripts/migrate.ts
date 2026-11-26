/**
 * Terapkan migrasi berversi ke database (./drizzle). Aman dijalankan berulang: hanya migrasi yang
 * belum tercatat yang dijalankan. Database lama (sebelum ada migrasi berversi) disusul otomatis.
 *   npm run db:migrate
 * Membuat migrasi baru setelah mengubah schema.ts:  npm run db:generate  (lalu commit folder drizzle/)
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../src/lib/server/db/migrator';

const dbPath = process.env.DATABASE_URL || 'downshit.db';
const sqlite = new Database(dbPath);
sqlite.pragma('busy_timeout = 5000'); // deploy berjalan saat aplikasi lama masih menulis
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

let result: ReturnType<typeof migrateDatabase>;
try {
	result = migrateDatabase(sqlite);
} catch (e) {
	console.error(`✗ Migrasi gagal: ${e instanceof Error ? (e.cause ?? e) : e}`);
	console.error(
		'  Bila pesannya "already exists": database ini dibuat dengan `db:push` dari skema yang lebih baru\n' +
			'  daripada folder drizzle/. Database pengembangan: hapus lalu buat ulang (`npm run db:migrate`).\n' +
			'  Database berisi data penting: JANGAN dipaksa, cadangkan dulu dan periksa tabel/kolom yang bentrok.'
	);
	process.exit(1);
}
const { legacy, columnsAdded } = result;
if (legacy) {
	console.log(`  database lama disusul ke baseline (${columnsAdded} kolom ditambahkan)`);
}
console.log(`✓ ${dbPath} sudah di versi migrasi terbaru.`);
sqlite.close();
