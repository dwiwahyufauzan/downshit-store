/**
 * SRS-NF-003 (basis data terstruktur) + jalur instal produksi:
 *  - skema hasil MIGRASI berversi (./drizzle, dipakai deploy.sh & `npm run db:migrate`) HARUS identik dengan
 *    skema hasil `drizzle-kit push` dari schema.ts (dipakai tes & dev): tabel, kolom, tipe, default, indeks, FK.
 *  - database LAMA (tanpa tabel pencatat migrasi) disusul ke baseline dan hasilnya juga identik.
 *  - 30 tabel aplikasi, FK konsisten, tanpa data yatim pada data sintetis.
 * Tidak memakai modul db aplikasi; hanya berkas template kosong dari tests/global-setup.ts.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
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
	'password_resets',
	'payment_simulations',
	'payments',
	'product_images',
	'product_sizes',
	'products',
	'purchase_items',
	'purchases',
	'rate_hits',
	'review_images',
	'reviews',
	'sessions',
	'settings',
	'shipments',
	'stock_movements',
	'stock_subscriptions',
	'users',
	'voucher_redemptions',
	'vouchers',
	'wishlists'
];

function describeDb(db: Database.Database) {
	const tables = (
		db
			.prepare(
				"select name from sqlite_master where type='table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name"
			)
			.all() as { name: string }[]
	).map((t) => t.name);
	const out: Record<string, unknown> = {};
	for (const t of tables) {
		out[t] = {
			// urutan kolom tidak berarti (ALTER TABLE ADD COLUMN selalu menambah di akhir)
			columns: (db.prepare(`pragma table_info(${t})`).all() as { cid: number; name: string }[])
				.map(({ name, type, notnull, dflt_value, pk }: Record<string, unknown>) => ({
					name,
					type,
					notnull,
					dflt_value,
					pk
				}))
				.sort((a, b) => String(a.name).localeCompare(String(b.name))),
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

	it('berisi tepat 30 tabel aplikasi', () => {
		const db = new Database(template!, { readonly: true });
		expect(describeDb(db).tables).toEqual(APP_TABLES);
		db.close();
	});

	const tmp = () => mkdtempSync(path.join(tmpdir(), 'dws-schema-'));
	const migrateScript = (file: string) =>
		execSync('npx tsx scripts/migrate.ts', {
			env: { ...process.env, DATABASE_URL: file },
			stdio: 'pipe'
		});

	it('migrasi berversi pada DB kosong (instal pertama produksi) == skema hasil `push`', () => {
		const file = path.join(tmp(), 'fresh.db');
		migrateScript(file);
		const migrated = new Database(file, { readonly: true });
		const pushed = new Database(template!, { readonly: true });
		expect(describeDb(migrated)).toEqual(describeDb(pushed));
		const applied = migrated.prepare('select count(*) n from __drizzle_migrations').get() as {
			n: number;
		};
		expect(applied.n).toBeGreaterThan(0);
		migrated.close();
		pushed.close();
	});

	it('menjalankan migrasi dua kali aman (tidak ada yang diterapkan ulang)', () => {
		const file = path.join(tmp(), 'twice.db');
		migrateScript(file);
		const before = new Database(file, { readonly: true });
		const n1 = (
			before.prepare('select count(*) n from __drizzle_migrations').get() as { n: number }
		).n;
		before.close();
		migrateScript(file);
		const after = new Database(file, { readonly: true });
		expect(
			(after.prepare('select count(*) n from __drizzle_migrations').get() as { n: number }).n
		).toBe(n1);
		after.close();
	});

	it('DB lama (setara baseline, tanpa tabel pencatat; tabel & kolom belakangan belum ada) disusul ke skema terbaru', () => {
		// DB produksi lama: strukturnya setara baseline (0000) tetapi belum punya beberapa tabel/kolom yang
		// ditambahkan sebelum migrasi berversi ada. deploy.sh menyusulnya otomatis lalu menerapkan migrasi baru.
		const copy = path.join(tmp(), 'old.db');
		const old = new Database(copy);
		old.exec(
			readFileSync('drizzle/0000_baseline.sql', 'utf8').replaceAll('--> statement-breakpoint', '')
		);
		for (const t of ['wishlists', 'reviews', 'product_sizes', 'product_images']) {
			old.exec(`drop table ${t}`);
		}
		old.exec('alter table cart_items drop column is_selected');
		for (const c of ['province', 'city', 'district', 'village', 'detail']) {
			old.exec(`alter table users drop column address_${c}`);
		}
		old.close();

		migrateScript(copy);

		const migrated = new Database(copy, { readonly: true });
		const pushed = new Database(template!, { readonly: true });
		expect(describeDb(migrated)).toEqual(describeDb(pushed));
		migrated.close();
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
