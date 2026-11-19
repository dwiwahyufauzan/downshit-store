import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
	it('teks biasa dikutip', () => expect(csvCell('Budi')).toBe('"Budi"'));
	it('menggandakan tanda kutip', () => expect(csvCell('a"b')).toBe('"a""b"'));
	it('angka asli tidak diubah (termasuk negatif)', () => {
		expect(csvCell(15000)).toBe('15000');
		expect(csvCell(-5)).toBe('-5');
		expect(csvCell(0)).toBe('0');
	});
	it('NaN/Infinity -> sel kosong', () => {
		expect(csvCell(NaN)).toBe('""');
		expect(csvCell(Infinity)).toBe('""');
	});
	it('null/undefined -> sel kosong', () => {
		expect(csvCell(null)).toBe('""');
		expect(csvCell(undefined)).toBe('""');
	});
	it.each(['=1+1', '+62812', '-5', '@SUM(A1)', '\tx', '\rx', '=HYPERLINK("http://x.test")'])(
		'menetralkan sel rumus %j dengan awalan apostrof',
		(v) => expect(csvCell(v)).toBe(`"'${v.replace(/"/g, '""')}"`)
	);
	it('teks yang kebetulan berisi = di tengah tidak diubah', () =>
		expect(csvCell('a=b')).toBe('"a=b"'));
	it('pemisah/koma/titik koma/baris baru di dalam sel tetap aman karena dikutip', () => {
		expect(csvCell('Jl. A, No. 1; RT 2')).toBe('"Jl. A, No. 1; RT 2"');
		expect(csvCell('baris1\nbaris2')).toBe('"baris1\nbaris2"');
	});
	it('boolean/objek diubah ke teks', () => expect(csvCell(true)).toBe('"true"'));
});

describe('toCsv', () => {
	it('baris dipisah CRLF dan pemisah dapat diatur', () => {
		expect(
			toCsv([
				['a', 1],
				['b', 2]
			])
		).toBe('"a",1\r\n"b",2');
		expect(toCsv([['a', 1]], ';')).toBe('"a";1');
	});
	it('tabel kosong -> string kosong', () => expect(toCsv([])).toBe(''));
});
