import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	APP_DIR,
	BUILD_DIR,
	ORIGIN,
	PID_FILE,
	SERVER_LOG,
	UPLOAD_DIR,
	WORK_DIR,
	serverEnv
} from './env';

function run(label: string, cmd: string, args: string[], env: NodeJS.ProcessEnv) {
	console.log(`[e2e] ${label}`);
	const r = spawnSync(cmd, args, { cwd: APP_DIR, env, stdio: 'inherit' });
	if (r.status !== 0) throw new Error(`[e2e] langkah gagal: ${label} (kode ${r.status})`);
}

async function waitForHealth(timeoutMs = 60_000) {
	const t0 = Date.now();
	for (;;) {
		try {
			const res = await fetch(`${ORIGIN}/api/health`);
			if (res.ok) return;
		} catch {
			/* server belum siap */
		}
		if (Date.now() - t0 > timeoutMs) {
			throw new Error(
				`[e2e] server tidak sehat dalam ${timeoutMs / 1000} dtk. Lihat ${SERVER_LOG}`
			);
		}
		await new Promise((r) => setTimeout(r, 400));
	}
}

export default async function globalSetup() {
	// data sementara selalu baru; build dipakai ulang bila E2E_SKIP_BUILD=1 (iterasi lokal)
	rmSync(path.join(WORK_DIR, 'data'), { recursive: true, force: true });
	mkdirSync(UPLOAD_DIR, { recursive: true });

	const env = { ...process.env, ...serverEnv } as NodeJS.ProcessEnv;
	if (!(process.env.E2E_SKIP_BUILD === '1' && existsSync(path.join(BUILD_DIR, 'index.js')))) {
		rmSync(BUILD_DIR, { recursive: true, force: true });
		run('build aplikasi', 'npx', ['vite', 'build'], { ...env, BUILD_OUT: BUILD_DIR });
	}

	// migrasi + data dasar (akun, kategori, produk contoh) dengan perintah yang sama seperti deploy sungguhan
	const seedEnv = { ...env, NODE_ENV: 'development' } as NodeJS.ProcessEnv;
	run('migrasi database', 'npx', ['tsx', 'scripts/migrate.ts'], seedEnv);
	run('seed dasar', 'npx', ['tsx', 'scripts/seed.ts'], seedEnv);
	run('seed E2E', 'npx', ['tsx', 'e2e/seed-e2e.ts'], seedEnv);

	console.log(`[e2e] menjalankan server di ${ORIGIN}`);
	const log = openSync(SERVER_LOG, 'w');
	const server = spawn('node', [path.join(BUILD_DIR, 'index.js')], {
		cwd: APP_DIR,
		env,
		stdio: ['ignore', log, log]
	});
	closeSync(log);
	if (!server.pid) throw new Error('[e2e] server gagal dijalankan');
	writeFileSync(PID_FILE, String(server.pid));
	server.unref();
	await waitForHealth();
}
