import { expect, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ADMIN, ORIGIN, PASSWORD, SERVER_LOG } from '../env';

/** PNG 1x1 valid untuk unggahan bukti transfer / foto ulasan. */
export const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

let seq = 0;
export const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}-${seq++}@example.com`;

/** Daftar akun pelanggan lewat form /register; pengguna otomatis masuk. */
export async function registerCustomer(page: Page, email: string, name = 'Pelanggan Uji') {
	await page.goto('/register');
	await page.locator('input[name="name"]').fill(name);
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="phone"]').fill('081234567890');
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.locator('input[name="confirmPassword"]').fill(PASSWORD);
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.startsWith('/register'));
}

/** Konteks peramban terpisah (cookie sendiri) yang sudah masuk sebagai admin lewat portal staf. */
export async function adminPage(browser: Browser) {
	// konteks manual tidak mewarisi `use` dari konfigurasi, jadi baseURL & zona waktu dipasang di sini
	const ctx = await browser.newContext({
		baseURL: ORIGIN,
		locale: 'id-ID',
		timezoneId: 'Asia/Jakarta'
	});
	const page = await ctx.newPage();
	await page.goto('/staff/login');
	await page.locator('input[name="email"]').fill(ADMIN.email);
	await page.locator('input[name="password"]').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Masuk ke portal' }).click();
	await page.waitForURL(/\/admin/);
	return { page, ctx };
}

/** Pilih alamat bertingkat (data wilayah resmi) lalu isi kode pos & detail. */
export async function fillAddress(page: Page) {
	await expect(page.locator('#province option', { hasText: 'Jawa Barat' })).toBeAttached();
	await page.selectOption('#province', 'Jawa Barat');
	await expect(page.locator('#city option', { hasText: 'Kabupaten Subang' })).toBeAttached();
	await page.selectOption('#city', 'Kabupaten Subang');
	await expect(page.locator('#district option', { hasText: /^Subang$/ })).toBeAttached();
	await page.selectOption('#district', 'Subang');
	await expect(page.locator('#village option', { hasText: 'Soklat' })).toBeAttached();
	await page.selectOption('#village', 'Soklat');
	await page.locator('#postalCode').fill('41211');
	await page.locator('#addressDetail').fill('Jl. Raya Otista No. 12, RT 02/RW 05');
}

/** Tambah produk ke keranjang dari halaman detailnya (ukuran opsional). */
export async function addToCart(page: Page, slug: string, size?: string) {
	await page.goto(`/produk/${slug}`);
	if (size)
		await page
			.locator('label', { hasText: new RegExp(`^\\s*${size}\\s*$`) })
			.first()
			.click();
	await page.getByRole('button', { name: 'Tambah ke keranjang' }).click();
	await expect(page.getByText('berhasil ditambahkan ke keranjang')).toBeVisible();
}

/** Isi pesan log server (MAIL_PROVIDER=log mencetak email di sini). */
export const serverLog = () => readFileSync(SERVER_LOG, 'utf8');

/** Kode pesanan "DWN-YYMMDD-XXXXXX" dari teks halaman. */
export const orderCodeIn = (text: string) => /DWN-\d{6}-[0-9A-F]{6}/.exec(text)?.[0] ?? '';
