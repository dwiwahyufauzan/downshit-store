/**
 * Uji skrip backup.sh + offsite.sh dengan rclone/curl PALSU (tidak ada jaringan, tidak menyentuh DB asli).
 * Dilewati bila sqlite3 CLI tidak terpasang.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

const hasSqlite = spawnSync('sqlite3', ['-version']).status === 0;
const SCRIPTS = path.resolve('deploy/scripts');

const FAKE_RCLONE = `#!/usr/bin/env bash
cmd=$1; shift
echo "rclone $cmd $*" >> "$FAKE_LOG"
size() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1"; }
dest() { echo "$FAKE_REMOTE/\${1#fake:}"; }
case $cmd in
  copyto)
    [ -n "\${FAKE_FAIL_UPLOAD:-}" ] && { echo "boom" >&2; exit 1; }
    mkdir -p "$(dirname "$(dest "$2")")"
    cp "$1" "$(dest "$2")"
    [ -n "\${FAKE_TRUNCATE:-}" ] && head -c 10 "$1" > "$(dest "$2")"
    ;;
  lsf)
    p=$(dest "\${@: -1}")
    [ -f "$p" ] && echo "$(basename "$p");$(size "$p")"
    ;;
  delete) ;;
esac
exit 0
`;
const FAKE_CURL = `#!/usr/bin/env bash
echo "curl $*" >> "$FAKE_LOG"
exit 0
`;

let dir: string;
let env: Record<string, string>;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'dws-backup-'));
	for (const d of ['bin', 'data', 'uploads/products', 'backups', 'remote'])
		mkdirSync(path.join(dir, d), { recursive: true });
	for (const [n, body] of [
		['rclone', FAKE_RCLONE],
		['curl', FAKE_CURL]
	]) {
		writeFileSync(path.join(dir, 'bin', n), body);
		chmodSync(path.join(dir, 'bin', n), 0o755);
	}
	writeFileSync(path.join(dir, 'uploads/products/a.webp'), 'gambar');

	const db = new Database(path.join(dir, 'data/downshit.db'));
	db.exec('create table orders (id integer primary key, code text, note text)');
	const ins = db.prepare('insert into orders (code, note) values (?, ?)');
	for (let i = 0; i < 400; i++) ins.run(`DWN-${i}`, Math.random().toString(36).repeat(8));
	db.close();

	writeFileSync(path.join(dir, 'log.txt'), '');
	env = {
		PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
		DOWNSHIT_BASE: dir,
		ENV_FILE: path.join(dir, 'tidak-ada.env'),
		DB_FILE: path.join(dir, 'data/downshit.db'),
		UPLOAD_DIR: path.join(dir, 'uploads'),
		BACKUP_DIR: path.join(dir, 'backups'),
		FAKE_LOG: path.join(dir, 'log.txt'),
		FAKE_REMOTE: path.join(dir, 'remote')
	};
});

const run = (extra: Record<string, string> = {}) =>
	spawnSync('bash', [path.join(SCRIPTS, 'backup.sh')], {
		env: { ...env, ...extra },
		encoding: 'utf8'
	});
const log = () => readFileSync(path.join(dir, 'log.txt'), 'utf8');
const local = () => readdirSync(path.join(dir, 'backups')).sort();
const remote = () =>
	existsSync(path.join(dir, 'remote')) ? readdirSync(path.join(dir, 'remote')).sort() : [];

describe.skipIf(!hasSqlite)('backup.sh + offsite.sh', () => {
	it('tanpa OFFSITE_RCLONE_REMOTE: backup lokal dibuat dan ada peringatan "hanya di server ini"', () => {
		const r = run();
		expect(r.status).toBe(0);
		expect(local().filter((f) => /^db-.*\.sqlite\.gz$/.test(f))).toHaveLength(1);
		expect(local().filter((f) => /^uploads-.*\.tar\.gz$/.test(f))).toHaveLength(1);
		expect(r.stdout).toMatch(/HANYA ada di server ini/);
		expect(log()).not.toMatch(/rclone/);
	});

	it('dengan offsite: kedua arsip terunggah & terverifikasi ukurannya; retensi remote dipanggil; heartbeat terkirim', () => {
		const r = run({
			OFFSITE_RCLONE_REMOTE: 'fake:bucket/downshit',
			OFFSITE_KEEP_DAYS: '30',
			BACKUP_HEARTBEAT_URL: 'https://hc.example/ping/abc'
		});
		expect(r.status, r.stderr + r.stdout).toBe(0);
		expect(remote()).toEqual(['bucket']); // tujuan palsu: FAKE_REMOTE/bucket/downshit/...
		const uploaded = readdirSync(path.join(dir, 'remote/bucket/downshit')).sort();
		expect(uploaded).toEqual(local());
		expect(r.stdout).toMatch(/offsite OK\s+db-/);
		expect(r.stdout).toMatch(/offsite OK\s+uploads-/);
		expect(log()).toMatch(
			/rclone delete fake:bucket\/downshit --min-age 30d --include db-\*\.sqlite\.gz --include uploads-\*\.tar\.gz/
		);
		expect(log()).toMatch(/curl .*https:\/\/hc\.example\/ping\/abc/);
	});

	it('unggahan gagal: skrip gagal (non-nol), backup lokal TETAP ada, heartbeat TIDAK dikirim', () => {
		const r = run({
			OFFSITE_RCLONE_REMOTE: 'fake:bucket',
			FAKE_FAIL_UPLOAD: '1',
			BACKUP_HEARTBEAT_URL: 'https://hc.example/ping/abc'
		});
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/gagal mengunggah/);
		expect(local().length).toBeGreaterThanOrEqual(2);
		expect(log()).not.toMatch(/curl/);
	});

	it('berkas di tujuan terpotong (ukuran beda) → verifikasi GAGAL, non-nol, tanpa heartbeat', () => {
		const r = run({
			OFFSITE_RCLONE_REMOTE: 'fake:bucket',
			FAKE_TRUNCATE: '1',
			BACKUP_HEARTBEAT_URL: 'https://hc.example/ping/abc'
		});
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/verifikasi GAGAL/);
		expect(local().length).toBeGreaterThanOrEqual(2);
		expect(log()).not.toMatch(/curl/);
	});

	it('offsite.sh menolak dijalankan tanpa tujuan atau tanpa arsip', () => {
		const a = spawnSync('bash', [path.join(SCRIPTS, 'offsite.sh'), 'x'], { env, encoding: 'utf8' });
		expect(a.status).not.toBe(0);
		expect(a.stderr).toMatch(/OFFSITE_RCLONE_REMOTE kosong/);
		const b = spawnSync('bash', [path.join(SCRIPTS, 'offsite.sh')], {
			env: { ...env, OFFSITE_RCLONE_REMOTE: 'fake:x' },
			encoding: 'utf8'
		});
		expect(b.status).not.toBe(0);
		expect(b.stderr).toMatch(/pemakaian/);
		expect(() => execFileSync('bash', ['-n', path.join(SCRIPTS, 'offsite.sh')])).not.toThrow();
	});
});
