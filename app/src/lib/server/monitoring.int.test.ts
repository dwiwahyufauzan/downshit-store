/**
 * Pemantauan: /api/health (DB + cron pemeliharaan) dan /api/client-error (galat peramban → Sentry/log).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-orders-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file, uploads: `./tests/.tmp-uploads-orders-${rand}` };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: env.uploads,
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

vi.mock('./config', () => ({
	envVar: (n: string) =>
		({
			SENTRY_DSN: 'https://k@sentry.test/9',
			LOG_LEVEL: 'error'
		})[n as 'LOG_LEVEL']
}));

import { db } from './db';
import { settings } from './db/schema';
import { resetErrorReporting } from './error-report';
import { resetRateLimits } from './rate-limit';
import * as health from '../../routes/api/health/+server';
import * as clientError from '../../routes/api/client-error/+server';
import * as maintenance from '../../routes/internal/maintenance/+server';
import { useOrdersFixture } from './orders.fixture';

useOrdersFixture();

beforeEach(() => {
	resetErrorReporting();
	resetRateLimits();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

const getHealth = async () => {
	const res = (await (health.GET as never as () => Promise<Response>)()) as Response;
	return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') };
};

describe('GET /api/health', () => {
	it('sehat: 200 ok, tanpa cache, memuat versi; instal baru (belum ada jejak cron) tidak dianggap macet', async () => {
		const r = await getHealth();
		expect(r.status).toBe(200);
		expect(r.cache).toBe('no-store');
		expect(r.body).toMatchObject({ status: 'ok', maintenance: { lastRunAt: null, stale: false } });
		expect(r.body.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	it('cron macet > 2 jam → degraded (tetap 200); baru berjalan → ok', async () => {
		const set = (iso: string) =>
			db
				.insert(settings)
				.values({ key: 'maintenance_last_run', value: iso })
				.onConflictDoUpdate({ target: settings.key, set: { value: iso } })
				.run();
		set(new Date(Date.now() - 3 * 3600_000).toISOString());
		const stale = await getHealth();
		expect(stale.status).toBe(200);
		expect(stale.body).toMatchObject({ status: 'degraded', maintenance: { stale: true } });

		set(new Date(Date.now() - 60_000).toISOString());
		expect((await getHealth()).body.status).toBe('ok');
	});

	it('database tidak terbaca → 503 down', async () => {
		db.$client.exec('alter table settings rename to settings_x');
		try {
			const r = await getHealth();
			expect(r.status).toBe(503);
			expect(r.body).toEqual({ status: 'down' });
		} finally {
			db.$client.exec('alter table settings_x rename to settings');
		}
	});

	it('endpoint pemeliharaan menulis jejak yang dibaca health', async () => {
		const res = (await (maintenance.POST as never as (e: unknown) => Promise<Response>)({
			request: new Request('http://x', {
				method: 'POST',
				headers: { authorization: `Bearer ${'x'.repeat(32)}` }
			})
		})) as Response;
		expect(res.status).toBe(200);
		const r = await getHealth();
		expect(Date.now() - Date.parse(r.body.maintenance.lastRunAt)).toBeLessThan(10_000);
	});
});

describe('POST /api/client-error', () => {
	const post = (body: unknown, ip = '1.1.1.1', raw?: string) =>
		(clientError.POST as never as (e: unknown) => Promise<Response>)({
			request: new Request('http://x/api/client-error', {
				method: 'POST',
				body: raw ?? JSON.stringify(body)
			}),
			getClientAddress: () => ip,
			locals: { user: null, requestId: 'rid-test' }
		}) as Promise<Response>;

	it('diteruskan ke Sentry sebagai ClientError, query string dibuang dari path', async () => {
		const f = vi.fn(async (_u: string, _i?: RequestInit) => ({ ok: true, status: 200 }));
		vi.stubGlobal('fetch', f);
		const res = await post({
			message: 'x is undefined',
			stack: 'TypeError: x\n    at a (app.js:1:1)',
			path: '/checkout?token=rahasia'
		});
		expect(res.status).toBe(202);
		await new Promise((r) => setTimeout(r, 10));
		const ev = JSON.parse((f.mock.calls[0][1]!.body as string).split('\n')[2]);
		expect(ev.exception.values[0]).toMatchObject({ type: 'ClientError', value: 'x is undefined' });
		expect(ev.request.url).toBe('/checkout'); // tanpa ?token=
		expect(ev.tags.source).toBe('client');
		expect(JSON.stringify(ev)).not.toContain('rahasia');
	});

	it('badan terlalu besar → 413; bukan JSON → 400; per IP maks. 10/menit → 429', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, status: 200 }))
		);
		expect((await post(null, '2.2.2.2', 'x'.repeat(5000))).status).toBe(413);
		expect((await post(null, '2.2.2.2', '{rusak')).status).toBe(400);

		const codes: number[] = [];
		for (let i = 0; i < 12; i++) codes.push((await post({ message: `e${i}` }, '3.3.3.3')).status);
		expect(codes.filter((c) => c === 202)).toHaveLength(10);
		expect(codes.slice(10)).toEqual([429, 429]);
		expect((await post({ message: 'lain' }, '4.4.4.4')).status).toBe(202); // IP lain tak terpengaruh
	});
});
