import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { DATABASE_URL } from '$app/env/private';
import { withRetry } from './retry';

const dbPath = DATABASE_URL || 'downshit.db';
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Transaksi atomik. Driver better-sqlite3 bersifat SINKRON: callback TIDAK boleh `async`/`await`
 * (melempar "Transaction function cannot return a promise"). Di dalam callback pakai
 * `.get()`, `.all()`, `.run()`. `BEGIN IMMEDIATE` mengunci tulis sejak awal sehingga
 * pengecekan stok lalu pengurangannya tidak bisa disela proses lain (setara `FOR UPDATE`).
 * Melempar error di dalam callback otomatis me-rollback.
 */
export function transact<T>(fn: (tx: Tx) => T): Promise<T> {
	return withRetry(async () => db.transaction((tx) => fn(tx), { behavior: 'immediate' }));
}
