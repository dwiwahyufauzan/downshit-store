/**
 * Migrasi berversi (drizzle-kit generate → berkas SQL di ./drizzle). Dipakai skrip `npm run db:migrate`,
 * deploy.sh, dan tes. Tidak memakai modul `db` aplikasi (tanpa $app/env) supaya bisa jalan di luar SvelteKit.
 * Memakai `drizzle-orm` (dependensi runtime), bukan `drizzle-kit`, karena deploy membuang devDependencies.
 *
 * Tiga keadaan database:
 *  1. Kosong / belum ada tabel `users`  → semua migrasi dijalankan.
 *  2. Lama (ada `users`, belum ada tabel pencatat) → disusul `legacyCatchUp` sampai setara baseline,
 *     lalu baseline ditandai sudah diterapkan, kemudian migrasi sesudahnya dijalankan.
 *  3. Sudah dimigrasi → hanya migrasi yang belum tercatat.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { legacyCatchUp } from './legacy-catchup';

type Journal = { entries: { tag: string; when: number }[] };

const hasTable = (sqlite: Database.Database, name: string) =>
	Boolean(sqlite.prepare("select 1 from sqlite_master where type='table' and name = ?").get(name));

/** Tandai migrasi pertama (baseline) sebagai sudah diterapkan, persis seperti yang dicatat drizzle. */
function stampBaseline(sqlite: Database.Database, folder: string) {
	const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as Journal;
	const first = journal.entries[0];
	if (!first) throw new Error('drizzle/meta/_journal.json kosong: jalankan `npm run db:generate`');
	const hash = createHash('sha256')
		.update(readFileSync(join(folder, `${first.tag}.sql`), 'utf8'))
		.digest('hex');
	sqlite.exec(
		'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
	);
	sqlite
		.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
		.run(hash, first.when);
}

export function migrateDatabase(sqlite: Database.Database, folder = 'drizzle') {
	let legacy = false;
	let columnsAdded = 0;
	if (hasTable(sqlite, 'users') && !hasTable(sqlite, '__drizzle_migrations')) {
		legacy = true;
		columnsAdded = legacyCatchUp(sqlite);
		stampBaseline(sqlite, folder);
	}
	migrate(drizzle(sqlite), { migrationsFolder: folder });
	return { legacy, columnsAdded };
}
