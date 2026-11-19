import { describe, expect, it } from 'vitest';
import { MAX_PRICE_FILTER, escapeLike, pageParam, priceParam } from './sql';

const u = (qs: string) => new URL(`http://x/produk${qs}`);

describe('priceParam', () => {
	it('bilangan bulat tidak negatif', () => {
		expect(priceParam(u('?min=0'), 'min')).toBe(0);
		expect(priceParam(u('?min=150000'), 'min')).toBe(150_000);
		expect(priceParam(u('?max= 75000 '), 'max')).toBe(75_000);
	});

	it('kosong / tidak ada / bukan angka bulat / negatif / berlebihan → null', () => {
		for (const qs of [
			'',
			'?min=',
			'?min=abc',
			'?min=-1',
			'?min=1.5',
			'?min=1e5',
			'?min=%2B5',
			'?min=0x10'
		]) {
			expect(priceParam(u(qs), 'min'), qs).toBeNull();
		}
		expect(priceParam(u(`?min=${MAX_PRICE_FILTER}`), 'min')).toBe(MAX_PRICE_FILTER);
		expect(priceParam(u(`?min=${MAX_PRICE_FILTER + 1}`), 'min')).toBeNull();
		expect(priceParam(u('?min=99999999999'), 'min')).toBeNull(); // > 10 digit
	});
});

describe('helper sql lain', () => {
	it('escapeLike & pageParam tetap berperilaku seperti semula', () => {
		expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
		expect(pageParam(u('?page=3'))).toBe(3);
		expect(pageParam(u('?page=-4'))).toBe(1);
		expect(pageParam(u('?page=abc'))).toBe(1);
		expect(pageParam(u('?page=999999999'))).toBe(100_000);
	});
});
