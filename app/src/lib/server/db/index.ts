import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { DATABASE_URL } from '$app/env/private';
import { withRetry } from './retry';

const dbPath = DATABASE_URL || 'downshit.db';
const sqlite = new Database(dbPath);
// busy_timeout lebih dulu: pragma WAL pun bisa SQLITE_BUSY bila proses lain (mis. build) sedang membuka DB
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

// Pekerjaan yang baru boleh jalan SETELAH transaksi benar-benar commit (mis. kirim email).
const commitQueues = new WeakMap<object, (() => void | Promise<void>)[]>();

/**
 * Jadwalkan `fn` setelah transaksi `tx` commit. Bila transaksi di-rollback, `fn` dibuang.
 * Di luar transaksi (executor = `db`) langsung dijalankan. `fn` boleh async; galatnya hanya dicatat.
 */
export function afterCommit(exec: typeof db | Tx, fn: () => void | Promise<void>) {
	const q = commitQueues.get(exec);
	if (q) q.push(fn);
	else void run(fn);
}

async function run(fn: () => void | Promise<void>) {
	try {
		await fn();
	} catch (e) {
		console.error('[afterCommit]', e instanceof Error ? e.message : e);
	}
}

/**
 * Transaksi atomik. Driver better-sqlite3 bersifat SINKRON: callback TIDAK boleh `async`/`await`
 * (melempar "Transaction function cannot return a promise"). Di dalam callback pakai
 * `.get()`, `.all()`, `.run()`. `BEGIN IMMEDIATE` mengunci tulis sejak awal sehingga
 * pengecekan stok lalu pengurangannya tidak bisa disela proses lain (setara `FOR UPDATE`).
 * Melempar error di dalam callback otomatis me-rollback. Pekerjaan `afterCommit` berjalan setelah commit.
 */
export async function transact<T>(fn: (tx: Tx) => T): Promise<T> {
	let queue: (() => void | Promise<void>)[] = [];
	const result = await withRetry(async () =>
		db.transaction(
			(tx) => {
				queue = []; // percobaan ulang (deadlock/busy) mulai dari antrean kosong
				commitQueues.set(tx, queue);
				return fn(tx);
			},
			{ behavior: 'immediate' }
		)
	);
	for (const job of queue) void run(job);
	return result;
}
