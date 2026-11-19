import { describe, expect, it } from 'vitest';
import { isYmd, parseRange, todayWib, wibEnd, wibStamp, wibStart } from './time';

const url = (q: string) => new URL(`http://x/laporan?${q}`);

describe('batas hari WIB', () => {
	it('awal hari WIB = 17:00 UTC hari sebelumnya', () =>
		expect(wibStart('2026-11-01').toISOString()).toBe('2026-10-31T17:00:00.000Z'));
	it('akhir hari WIB = 16:59:59.999 UTC', () =>
		expect(wibEnd('2026-11-30').toISOString()).toBe('2026-11-30T16:59:59.999Z'));
	it('todayWib memakai WIB, bukan UTC', () =>
		expect(todayWib(new Date('2026-10-31T17:30:00Z'))).toBe('2026-11-01')); // 00:30 WIB
	it('todayWib masih hari yang sama sampai 16:59 UTC', () =>
		expect(todayWib(new Date('2026-10-31T16:59:59Z'))).toBe('2026-10-31'));
	it('wibStamp memformat YYYY-MM-DD HH:mm WIB', () => {
		expect(wibStamp(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11-01 00:00');
		expect(wibStamp('2026-10-31T16:59:59.999Z')).toBe('2026-10-31 23:59');
	});
	it('pesanan 00:00-07:00 WIB jatuh pada tanggal WIB, bukan tanggal UTC', () => {
		expect(wibStamp('2026-11-13T17:05:00.000Z')).toBe('2026-11-14 00:05');
		expect(wibStamp('2026-11-13T23:59:00.000Z')).toBe('2026-11-14 06:59');
	});
});

describe('isYmd', () => {
	it.each(['2026-11-01', '2028-02-29'])('menerima %s', (s) => expect(isYmd(s)).toBe(true));
	it.each(['2026-02-31', '2026-02-29', '2026-13-01', '2026-1-1', 'abc', '', null, undefined])(
		'menolak %j',
		(s) => expect(isYmd(s as never)).toBe(false)
	);
});

describe('parseRange', () => {
	const now = new Date('2026-11-14T03:00:00Z'); // 10:00 WIB
	it('default = awal bulan s/d hari ini (WIB)', () => {
		const r = parseRange(url(''), now);
		expect([r.dari, r.sampai, r.error]).toEqual(['2026-11-01', '2026-11-14', undefined]);
	});
	it('rentang valid', () => {
		const r = parseRange(url('dari=2026-11-01&sampai=2026-11-30'), now);
		expect(r.error).toBeUndefined();
		expect(r.from.toISOString()).toBe('2026-10-31T17:00:00.000Z');
		expect(r.to.toISOString()).toBe('2026-11-30T16:59:59.999Z');
	});
	it('satu hari (dari = sampai) valid', () => {
		const r = parseRange(url('dari=2026-11-05&sampai=2026-11-05'), now);
		expect(r.error).toBeUndefined();
		expect(r.to.getTime() - r.from.getTime()).toBe(86_400_000 - 1);
	});
	it('hanya salah satu parameter diisi: yang lain memakai bawaan', () => {
		expect(parseRange(url('dari=2026-11-10'), now).sampai).toBe('2026-11-14');
		expect(parseRange(url('sampai=2026-11-10'), now).dari).toBe('2026-11-01');
	});
	it('tanggal akhir < awal -> error + rentang bawaan (tidak melempar)', () => {
		const r = parseRange(url('dari=2026-11-10&sampai=2026-11-01'), now);
		expect(r.error).toMatch(/lebih awal/);
		expect([r.dari, r.sampai]).toEqual(['2026-11-01', '2026-11-14']);
	});
	it.each([
		'dari=abc&sampai=2026-11-01',
		'dari=2026-02-31&sampai=2026-03-01',
		'dari=2026-11-01&sampai=2026-11-31',
		'dari=%00&sampai=%27',
		"dari=2026-11-01';DROP TABLE orders;--&sampai=2026-11-02",
		'dari=11/01/2026&sampai=11/05/2026',
		'dari=2026-11-01T00:00:00&sampai=2026-11-02'
	])('format salah -> error, bukan crash: %s', (q) => {
		const r = parseRange(url(q), now);
		expect(r.error).toBeTruthy();
		expect(r.dari).toBe('2026-11-01');
	});
	it('rentang > 366 hari -> error; tepat 366 hari masih boleh', () => {
		expect(parseRange(url('dari=2024-01-01&sampai=2026-01-01'), now).error).toMatch(/366/);
		expect(parseRange(url('dari=2028-01-01&sampai=2028-12-31'), now).error).toBeUndefined(); // 366 (kabisat)
		expect(parseRange(url('dari=2026-01-01&sampai=2027-01-02'), now).error).toMatch(/366/); // 367 hari
	});
	it('default memakai tanggal WIB walau UTC masih bulan lalu', () => {
		const r = parseRange(url(''), new Date('2026-10-31T20:00:00Z')); // 1 Nov 03:00 WIB
		expect([r.dari, r.sampai]).toEqual(['2026-11-01', '2026-11-01']);
	});
});
