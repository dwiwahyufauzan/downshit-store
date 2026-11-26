import { beforeEach, describe, expect, it, vi } from 'vitest';

const vars = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('./config', () => ({ envVar: (n: string) => vars[n] }));

import { buildEvent, reportError, resetErrorReporting } from './error-report';

const DSN = 'https://pubkey123@sentry.example.com/42';

function boom(msg = 'kaboom') {
	const e = new Error(msg);
	e.stack = `Error: ${msg}\n    at doThing (/app/src/a.ts:10:5)\n    at /app/src/b.ts:3:1`;
	return e;
}

const okFetch = () => vi.fn(async (_u: string, _i?: RequestInit) => ({ ok: true, status: 200 }));

beforeEach(() => {
	resetErrorReporting();
	for (const k of Object.keys(vars)) delete vars[k];
	vars.LOG_LEVEL = 'error';
	vars.LOG_FORMAT = 'json';
	vi.unstubAllGlobals();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('buildEvent', () => {
	it('frame stack berurutan terlama → terbaru; user & tag terisi; extra disamarkan', () => {
		const ev = buildEvent(boom(), {
			path: '/checkout',
			method: 'POST',
			userId: 7,
			status: 500,
			requestId: 'rid1',
			extra: { token: 'x', n: 1 }
		});
		const frames = ev.exception.values[0].stacktrace.frames;
		expect(frames.map((f) => f.filename)).toEqual(['/app/src/b.ts', '/app/src/a.ts']);
		expect(frames[1]).toMatchObject({ function: 'doThing', lineno: 10, colno: 5 });
		expect(ev.event_id).toMatch(/^[0-9a-f]{32}$/);
		expect(ev.user).toEqual({ id: '7' });
		expect(ev.tags).toMatchObject({ source: 'server', status: '500' });
		expect(ev.extra).toMatchObject({ requestId: 'rid1', token: '[disamarkan]', n: 1 });
	});
});

describe('reportError', () => {
	it('tanpa DSN: hanya log, tidak ada panggilan jaringan', async () => {
		const f = okFetch();
		vi.stubGlobal('fetch', f);
		expect(await reportError(boom())).toBe(false);
		expect(f).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalled();
	});

	it('dengan DSN: envelope 3 baris ke endpoint proyek dengan kunci publik', async () => {
		vars.SENTRY_DSN = DSN;
		const f = okFetch();
		vi.stubGlobal('fetch', f);
		expect(await reportError(boom(), { path: '/x', requestId: 'r1' })).toBe(true);

		const [url, init] = f.mock.calls[0];
		expect(url).toBe('https://sentry.example.com/api/42/envelope/');
		expect((init!.headers as Record<string, string>)['x-sentry-auth']).toContain(
			'sentry_key=pubkey123'
		);
		const lines = (init!.body as string).split('\n');
		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[1])).toEqual({ type: 'event' });
		const ev = JSON.parse(lines[2]);
		expect(ev.exception.values[0]).toMatchObject({ type: 'Error', value: 'kaboom' });
		expect(ev.request.url).toBe('/x');
	});

	it('galat yang sama dalam semenit hanya dikirim sekali; galat berbeda tetap dikirim', async () => {
		vars.SENTRY_DSN = DSN;
		const f = okFetch();
		vi.stubGlobal('fetch', f);
		expect(await reportError(boom('a'))).toBe(true);
		expect(await reportError(boom('a'))).toBe(false);
		expect(await reportError(boom('b'))).toBe(true);
		expect(f).toHaveBeenCalledTimes(2);
	});

	it('maks. 30 laporan per menit (banjir galat tidak menghabiskan kuota)', async () => {
		vars.SENTRY_DSN = DSN;
		const f = okFetch();
		vi.stubGlobal('fetch', f);
		for (let i = 0; i < 40; i++) await reportError(boom(`e${i}`));
		expect(f).toHaveBeenCalledTimes(30);
	});

	it('Sentry error / jaringan putus / DSN rusak → false tanpa melempar', async () => {
		vars.SENTRY_DSN = DSN;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 429 }))
		);
		expect(await reportError(boom('x1'))).toBe(false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('putus')))
		);
		expect(await reportError(boom('x2'))).toBe(false);
		vars.SENTRY_DSN = 'bukan-url';
		expect(await reportError(boom('x3'))).toBe(false);
	});
});
