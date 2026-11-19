import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const exts = ['', '-wal', '-shm'];

/**
 * Membuat DB SQLite kosong dari schema.ts sebelum tes dijalankan.
 * - TEST_DB_PATH: DB bersama untuk tes integrasi lama (satu file per proses vitest).
 * - TEST_DB_TEMPLATE: salinan skema kosong yang TIDAK pernah ditulis; berkas tes yang butuh
 *   DB terisolasi (mis. reports.int.test.ts) menyalinnya ke berkasnya sendiri.
 */
export default function setup() {
	// Satu file DB per proses vitest supaya beberapa `npm test` bisa jalan paralel tanpa bentrok
	const TEST_DB = path.resolve(`tests/.tmp-test-${process.pid}.db`);
	const TEMPLATE = path.resolve(`tests/.tmp-template-${process.pid}.db`);
	// Dengan beberapa project, globalSetup dipanggil lebih dari sekali: jangan bangun ulang.
	if (process.env.TEST_DB_PATH === TEST_DB && existsSync(TEMPLATE))
		return teardown(TEST_DB, TEMPLATE);

	process.env.TEST_DB_PATH = TEST_DB;
	process.env.TEST_DB_TEMPLATE = TEMPLATE;
	for (const ext of exts) rmSync(TEST_DB + ext, { force: true });
	for (const ext of exts) rmSync(TEMPLATE + ext, { force: true });
	execSync('npx drizzle-kit push --force', {
		stdio: 'pipe',
		env: { ...process.env, DATABASE_URL: TEST_DB }
	});
	copyFileSync(TEST_DB, TEMPLATE);
	return teardown(TEST_DB, TEMPLATE);
}

function teardown(testDb: string, template: string) {
	return () => {
		for (const ext of exts) rmSync(testDb + ext, { force: true });
		for (const ext of exts) rmSync(template + ext, { force: true });
	};
}
