import { vi } from 'vitest';

// Tes integrasi WAJIB memakai DB sementara. `.env` berisi DATABASE_URL asli, jadi modul env
// di-mock agar tidak pernah menyentuh downshit.db.
vi.mock('$app/env/private', () => ({
	DATABASE_URL: process.env.TEST_DB_PATH ?? 'tests/.tmp-test-missing.db',
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: './tests/.tmp-uploads',
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32)
}));
