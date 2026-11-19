/**
 * SRS-NF-003 (basis data terstruktur) + jalur instal produksi:
 *  - skema hasil `drizzle-kit export --sql` (dipakai deploy.sh pada instal pertama) HARUS identik dengan
 *    skema hasil `drizzle-kit push` (dipakai tes & dev): tabel, kolom, tipe, default, indeks, kunci asing.
 *  - 22 tabel aplikasi, FK konsisten, tanpa data yatim pada data sintetis.
 * Tidak memakai modul db aplikasi; hanya berkas template kosong dari tests/global-setup.ts.
 */
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const template = process.env.TEST_DB_TEMPLATE;

const APP_TABLES = [
	'activity_logs',
	'bundle_items',
	'bundles',
	'cart_items',
	'carts',
	'categories',
	'login_attempts',
	'order_item_components',
	'order_items',
	'orders',
	'payments',
	'product_images',
	'product_sizes',
	'products',
	'purchase_items',
	'purchases',
	'reviews',
	'sessions',
	'settings',
	'shipments',
	'stock_movements',
	'users'
];

function describeDb(db: Database.Database) {
	const tables = (
		db
			.prepare(
				"select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"
			)
			.all() as { name: string }[]
	).map((t) => t.name);
	const out: Record<string, unknown> = {};
	for (const t of tables) {
		out[t] = {
			columns: db.prepare(`pragma table_info(${t})`).all(),
			indexes: (
				db.prepare(`pragma index_list(${t})`).all() as {
					name: string;
					unique: number;
					origin: string;
				}[]
			)
				.filter((i) => i.origin !== 'pk')
				.map((i) => ({
					name: i.name,
					unique: i.unique,
					cols: (db.prepare(`pragma index_info(${i.name})`).all() as { name: string }[]).map(
						(c) => c.name
					)
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
			fks: (db.prepare(`pragma foreign_key_list(${t})`).all() as Record<string, unknown>[])
				.map(({ from, table, to, on_delete }) => ({ from, table, to, on_delete }))
				.sort((a, b) => String(a.from).localeCompare(String(b.from)))
		};
	}
	return { tables, detail: out };
}

describe('skema database (NF-03)', () => {
	it('template (drizzle-kit push) tersedia', () => {
		expect(template, 'tests/global-setup.ts harus menyetel TEST_DB_TEMPLATE').toBeTruthy();
	});

	it('berisi tepat 22 tabel aplikasi', () => {
		const db = new Database(template!, { readonly: true });
		expect(describeDb(db).tables).toEqual(APP_TABLES);
		db.close();
	});

	it('`drizzle-kit export --sql` (instal pertama produksi) == skema hasil `push`', () => {
		const sql = execSync('npx drizzle-kit export --sql', {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const fresh = new Database(':memory:');
		fresh.exec(sql);
		const pushed = new Database(template!, { readonly: true });
		expect(describeDb(fresh)).toEqual(describeDb(pushed));
		fresh.close();
		pushed.close();
	});

	it('semua kunci asing merujuk tabel & kolom yang ada', () => {
		const db = new Database(template!, { readonly: true });
		const { tables, detail } = describeDb(db);
		for (const t of tables) {
			for (const fk of (detail[t] as { fks: { from: string; table: string; to: string }[] }).fks) {
				expect(tables, `${t}.${fk.from} -> ${fk.table}`).toContain(fk.table);
				const cols = db.prepare(`pragma table_info(${fk.table})`).all() as { name: string }[];
				expect(cols.map((c) => c.name)).toContain(fk.to);
			}
		}
		db.close();
	});

	it('indeks yang dipakai laporan owner ada (idx_orders_created, idx_orders_status, idx_oi_order)', () => {
		const db = new Database(template!, { readonly: true });
		const idx = (
			db.prepare("select name from sqlite_master where type='index'").all() as { name: string }[]
		).map((i) => i.name);
		expect(idx).toEqual(
			expect.arrayContaining([
				'idx_orders_created',
				'idx_orders_status',
				'idx_oi_order',
				'idx_oic_item',
				'idx_al_created',
				'idx_pay_status'
			])
		);
		db.close();
	});
});
