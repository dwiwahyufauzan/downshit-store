import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const APP_DIR = path.resolve(here, '..');
/** Folder kerja sementara (build, database, unggahan, log server). Ada di .gitignore. */
export const WORK_DIR = path.join(APP_DIR, '.e2e');
export const PORT = Number(process.env.E2E_PORT ?? 4173);
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const DB_FILE = path.join(WORK_DIR, 'data', 'e2e.db');
export const UPLOAD_DIR = path.join(WORK_DIR, 'data', 'uploads');
export const SERVER_LOG = path.join(WORK_DIR, 'server.log');
export const PID_FILE = path.join(WORK_DIR, 'server.pid');
export const BUILD_DIR = path.join(WORK_DIR, 'build');

export const PASSWORD = 'Rahasia-E2E-123';
export const ADMIN = { email: 'admin@downshit.local', password: PASSWORD };
export const CRON_SECRET = 'e2e-secret-'.padEnd(40, 'x');

/** Variabel lingkungan server (meniru produksi, dengan simulator pembayaran & email ke log). */
export const serverEnv = {
	NODE_ENV: 'production',
	HOST: '127.0.0.1',
	PORT: String(PORT),
	ORIGIN,
	DATABASE_URL: DB_FILE,
	UPLOAD_DIR,
	BODY_SIZE_LIMIT: '3M',
	CRON_SECRET,
	PAYMENT_SIMULATOR: 'true',
	PAYMENT_SIMULATOR_ALLOW_PROD: 'true',
	MAIL_PROVIDER: 'log',
	MAIL_FROM: 'Downshit E2E <e2e@example.com>',
	SEED_DEFAULT_PASSWORD: PASSWORD,
	LOG_FORMAT: 'pretty'
};
