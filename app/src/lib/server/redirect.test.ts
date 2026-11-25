import { describe, expect, it } from 'vitest';
import { safeNext } from './redirect';

describe('safeNext (anti open-redirect, TC-001-13)', () => {
	it('menerima path internal', () => {
		expect(safeNext('/pesanan?x=1', '/produk')).toBe('/pesanan?x=1');
		expect(safeNext('/admin', '/produk')).toBe('/admin');
		expect(safeNext('/produk/kaos#ukuran', '/produk')).toBe('/produk/kaos#ukuran');
	});

	it('menolak open redirect dan varian normalisasinya', () => {
		for (const bad of [
			'//evil.com',
			'/\\evil.com',
			'https://evil.com',
			'javascript:alert(1)',
			'/a\\b',
			'/a\nb',
			'/\t/evil.com',
			'/login',
			'/login?next=/x',
			'/staff/login',
			'/staff/login?next=/admin',
			'/a/../staff/login',
			'/register',
			'/logout',
			'/.//evil.com',
			'/..//evil.com',
			'/a/..//evil.com',
			'/a/../login',
			'evil.com',
			'',
			'  /x'
		]) {
			expect(safeNext(bad, '/produk'), JSON.stringify(bad)).toBe('/produk');
		}
	});

	it('fallback bila kosong/null/undefined', () => {
		expect(safeNext(null, '/produk')).toBe('/produk');
		expect(safeNext(undefined, '/produk')).toBe('/produk');
	});

	it('tidak pernah menghasilkan URL berawalan // atau berskema', () => {
		const attempts = ['/.//a.b', '/%2F/a.b', '/x/..//a.b', '/%5Ca.b', '/./\\a.b', '/\u0000/a.b'];
		for (const a of attempts) {
			const out = safeNext(a, '/');
			expect(out.startsWith('//'), a).toBe(false);
			expect(out.startsWith('/'), a).toBe(true);
		}
	});
});
