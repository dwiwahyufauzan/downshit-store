import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { MAX_PRICE_FILTER, contains, escapeLike, pageParam, priceParam } from './sql';

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

describe('contains (LIKE literal dengan ESCAPE)', () => {
	const t = sqliteTable('t', { name: text('name') });
	const sqlite = new Database(':memory:');
	sqlite.exec('create table t (name text)');
	const db = drizzle(sqlite);
	db.insert(t)
		.values(
			['Diskon 50% Hoodie', 'Diskon 500 Hoodie', 'a_b kaos', 'axb kaos', 'back\\slash'].map(
				(name) => ({ name })
			)
		)
		.run();
	const find = (q: string) =>
		db
			.select()
			.from(t)
			.where(contains(t.name, q))
			.all()
			.map((r) => r.name);

	it('% dan _ dicari apa adanya, bukan wildcard', () => {
		expect(find('50%')).toEqual(['Diskon 50% Hoodie']);
		expect(find('a_b')).toEqual(['a_b kaos']);
		expect(find('\\')).toEqual(['back\\slash']);
	});
	it('pencarian biasa tetap mencocokkan sebagian kata', () => {
		expect(find('hoodie')).toHaveLength(2);
		expect(find('tidak-ada')).toEqual([]);
	});
});
