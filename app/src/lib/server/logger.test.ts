import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vars = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('./config', () => ({ envVar: (n: string) => vars[n] }));

import { log, scrub } from './logger';

let out: string[] = [];
beforeEach(() => {
	out = [];
	for (const k of Object.keys(vars)) delete vars[k];
	for (const m of ['log', 'warn', 'error'] as const) {
		vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
	}
});
afterEach(() => vi.restoreAllMocks());

describe('scrub', () => {
	it('menyamarkan kunci rahasia pada objek bertingkat & array, tanpa mengubah aslinya', () => {
		const src = {
			user: 'budi',
			password: 'rahasia',
			headers: { Authorization: 'Bearer x', cookie: 'a=b', accept: 'json' },
			list: [{ apiKey: 'k', ok: 1 }],
			MIDTRANS_SERVER_KEY: 'sb-mid'
		};
		const safe = scrub(src) as Record<string, unknown>;
		expect(safe.user).toBe('budi');
		expect(safe.password).toBe('[disamarkan]');
		expect(safe.headers).toEqual({
			Authorization: '[disamarkan]',
			cookie: '[disamarkan]',
			accept: 'json'
		});
		expect(safe.list).toEqual([{ apiKey: '[disamarkan]', ok: 1 }]);
		expect(src.password).toBe('rahasia');
	});

	it('Error menjadi name/message/stack; objek sangat dalam dipotong', () => {
		const e = scrub(new TypeError('boom')) as { name: string; message: string };
		expect(e).toMatchObject({ name: 'TypeError', message: 'boom' });
		const deep = { a: { b: { c: { d: { e: 1 } } } } };
		expect(JSON.stringify(scrub(deep))).toContain('[dalam]');
	});
});

describe('log', () => {
	it('format json: satu baris JSON valid berisi time/level/msg + konteks tersamar', () => {
		vars.LOG_FORMAT = 'json';
		log.info('halo', { requestId: 'r1', token: 'abc' });
		const line = JSON.parse(out[0]);
		expect(line).toMatchObject({
			level: 'info',
			msg: 'halo',
			requestId: 'r1',
			token: '[disamarkan]'
		});
		expect(Date.parse(line.time)).not.toBeNaN();
	});

	it('format pretty memuat level & konteks; level di bawah minimum dibuang', () => {
		vars.LOG_FORMAT = 'pretty';
		log.debug('diam');
		expect(out).toHaveLength(0);
		log.warn('perhatian', { n: 1 });
		expect(out[0]).toMatch(/WARN perhatian \{"n":1\}/);
		vars.LOG_LEVEL = 'error';
		log.warn('tidak muncul');
		log.error('muncul');
		expect(out).toHaveLength(2);
	});
});
