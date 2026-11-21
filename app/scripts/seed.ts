import 'dotenv/config';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';
import * as s from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';

const dbPath = process.env.DATABASE_URL || 'downshit.db';
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema: s });

const argon = (p: string) => hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const isProd = process.env.NODE_ENV === 'production';
// Dev: boleh memakai password contoh. Produksi: WAJIB diisi eksplisit (lihat pengaman di seed()).
const defaultPassword = process.env.SEED_DEFAULT_PASSWORD || (isProd ? '' : 'Ganti-Password-123!');

async function seed() {
	console.log('🌱 Memulai proses seeding database SQLite...');

	// Password contoh bersifat publik (ada di .env.example): jangan dipakai di produksi tanpa sengaja
	if (isProd) {
		if (process.env.SEED_ALLOW_PROD !== 'true') {
			throw new Error(
				'Seed di produksi ditolak. Set SEED_ALLOW_PROD=true bila benar-benar disengaja.'
			);
		}
		if (defaultPassword.length < 12 || defaultPassword === 'Ganti-Password-123!') {
			throw new Error(
				'Di produksi, SEED_DEFAULT_PASSWORD wajib unik, minimal 12 karakter, dan bukan password contoh.'
			);
		}
	}
	if (defaultPassword.length < 8) throw new Error('SEED_DEFAULT_PASSWORD minimal 8 karakter.');

	// 1. Pengaturan Toko
	const defaultSettings: Record<string, string> = {
		auto_complete_days: '7',
		payment_deadline_hours: '24',
		max_unpaid_orders: '3',
		low_stock_threshold: '5',
		store_name: 'Downshit Store',
		store_whatsapp: '6283867358863',
		shipping_flat_cost: '15000',
		bank_name: 'BCA',
		bank_account_number: '1234567890',
		bank_account_holder: 'Downshit Store'
	};

	for (const [key, value] of Object.entries(defaultSettings)) {
		await db.insert(s.settings).values({ key, value }).onConflictDoUpdate({
			target: s.settings.key,
			set: { value }
		});
	}
	console.log('  ✓ Pengaturan toko berhasil disimpan');

	// 2. Akun Pengguna (Owner, Admin, Konsumen)
	const passwordHash = await argon(defaultPassword);

	const initialUsers = [
		{
			name: 'Farhat',
			email: process.env.SEED_OWNER_EMAIL || 'owner@downshit.local',
			role: 'owner' as const,
			mustChangePassword: isProd,
			passwordHash,
			phone: '081200000001',
			address: 'Dawuan, Subang'
		},
		{
			name: 'Arnold',
			email: process.env.SEED_ADMIN_EMAIL || 'admin@downshit.local',
			role: 'admin' as const,
			mustChangePassword: isProd,
			passwordHash,
			phone: '081200000002',
			address: 'Dawuan, Subang'
		},
		// Akun demo hanya untuk development (tidak dibuat di produksi)
		...(isProd
			? []
			: [
					{
						name: 'Konsumen Demo',
						email: 'konsumen@downshit.local',
						role: 'konsumen' as const,
						mustChangePassword: false,
						passwordHash,
						phone: '081234567890',
						address: 'Jl. Otto Iskandardinata No. 12, Subang'
					}
				])
	];

	for (const u of initialUsers) {
		const [existing] = await db.select().from(s.users).where(eq(s.users.email, u.email)).limit(1);
		if (!existing) {
			await db.insert(s.users).values(u);
		}
	}
	console.log('  ✓ Akun Owner, Admin, dan Konsumen berhasil dibuat');

	// 3. Kategori Produk
	const initialCategories = [
		{
			name: 'Kaos',
			slug: 'kaos',
			description: 'Kaos oversized dan regular cut dengan sablon plastisol'
		},
		{ name: 'Hoodie', slug: 'hoodie', description: 'Hoodie dan sweater fleece tebal 320gsm' },
		{ name: 'Celana', slug: 'celana', description: 'Celana cargo, denim, dan sweatpants' },
		{
			name: 'Aksesoris',
			slug: 'aksesoris',
			description: 'Topi dad hat, tote bag, gantungan kunci, dan kaos kaki'
		}
	];

	for (const c of initialCategories) {
		const [existing] = await db
			.select()
			.from(s.categories)
			.where(eq(s.categories.slug, c.slug))
			.limit(1);
		if (!existing) {
			await db.insert(s.categories).values(c);
		}
	}
	console.log('  ✓ 4 Kategori produk berhasil disiapkan');

	// 4-5. Produk & bundling contoh: hanya development (produksi diisi lewat halaman admin)
	if (!isProd) {
		// 4. Produk Contoh
		const cats = await db.select().from(s.categories);
		const catMap = Object.fromEntries(cats.map((c) => [c.slug, c.id]));

		const sampleProducts = [
			{
				categoryId: catMap['kaos'],
				name: 'Kaos Downshit Classic Hitam',
				slug: 'kaos-downshit-classic-hitam',
				description: 'Bahan Cotton Combed 24s premium dengan sablon plastisol tahan lama.',
				price: 99000,
				stock: 50
			},
			{
				categoryId: catMap['kaos'],
				name: 'Kaos Downshit Logo Putih',
				slug: 'kaos-downshit-logo-putih',
				description: 'Kaos putih bersih bahan sejuk cocok untuk cuaca tropis Subang.',
				price: 99000,
				stock: 40
			},
			{
				categoryId: catMap['hoodie'],
				name: 'Hoodie Downshit Heavy',
				slug: 'hoodie-downshit-heavy',
				description: 'Fleece tebal 320gsm dengan bordir rapi dan saku kanguru.',
				price: 249000,
				stock: 25
			},
			{
				categoryId: catMap['celana'],
				name: 'Celana Cargo Downshit',
				slug: 'celana-cargo-downshit',
				description: 'Twill premium dengan banyak saku fungsional berdesain streetwear.',
				price: 219000,
				stock: 20
			},
			{
				categoryId: catMap['aksesoris'],
				name: 'Topi Downshit Dad Hat',
				slug: 'topi-downshit-dad-hat',
				description: 'Topi katun kanvas dengan strap buckle logam dan bordir logo timbul.',
				price: 69000,
				stock: 60
			}
		];

		for (const p of sampleProducts) {
			const [existing] = await db
				.select()
				.from(s.products)
				.where(eq(s.products.slug, p.slug))
				.limit(1);
			if (!existing) {
				await db.insert(s.products).values(p);
			}
		}
		console.log('  ✓ 5 Produk awal berhasil ditambahkan');

		// 5. Paket Bundling Contoh
		const prods = await db.select().from(s.products);
		const prodMap = Object.fromEntries(prods.map((p) => [p.slug, p.id]));

		const bundleSlug = 'paket-hemat-kaos-topi';
		const [existingBundle] = await db
			.select()
			.from(s.bundles)
			.where(eq(s.bundles.slug, bundleSlug))
			.limit(1);

		if (
			!existingBundle &&
			prodMap['kaos-downshit-classic-hitam'] &&
			prodMap['topi-downshit-dad-hat']
		) {
			const [b] = await db
				.insert(s.bundles)
				.values({
					name: 'Paket Hemat Kaos + Topi',
					slug: bundleSlug,
					description:
						'Kombinasi Kaos Classic Hitam dan Topi Dad Hat Downshit. Lebih hemat Rp 19.000 dibanding beli satuan!',
					price: 149000, // Harga normal 99k + 69k = 168k
					stock: 15
				})
				.returning({ id: s.bundles.id });

			if (b) {
				await db.insert(s.bundleItems).values([
					{ bundleId: b.id, productId: prodMap['kaos-downshit-classic-hitam'], quantity: 1 },
					{ bundleId: b.id, productId: prodMap['topi-downshit-dad-hat'], quantity: 1 }
				]);
				console.log(
					'  ✓ 1 Paket Bundling ("Paket Hemat Kaos + Topi") beserta item komponen berhasil disiapkan'
				);
			}
		}
	} else {
		console.log('  - Produk & bundling contoh dilewati di produksi');
	}

	console.log('\n🎉 Seeding selesai dengan sukses!');
	console.log('Informasi Akun:');
	// Jangan mencetak password produksi ke log/terminal
	const shownPw = isProd
		? '(sesuai SEED_DEFAULT_PASSWORD; WAJIB diganti saat login pertama)'
		: defaultPassword;
	console.log(
		`- Owner   : ${process.env.SEED_OWNER_EMAIL || 'owner@downshit.local'} (Password: ${shownPw})`
	);
	console.log(
		`- Admin   : ${process.env.SEED_ADMIN_EMAIL || 'admin@downshit.local'} (Password: ${shownPw})`
	);
	if (!isProd) console.log(`- Konsumen: konsumen@downshit.local (Password: ${shownPw})`);
}

seed().catch((err) => {
	console.error('❌ Gagal seeding:', err);
	process.exit(1);
});
