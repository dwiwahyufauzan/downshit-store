import { expect, test } from '@playwright/test';
import { PASSWORD, ORIGIN } from '../env';
import { registerCustomer, serverLog, uniqueEmail } from './helpers';

test('banner promo di beranda menampilkan voucher yang ditandai admin (tamu)', async ({ page }) => {
	await page.goto('/');
	const banner = page.getByTestId('promo-banner');
	await expect(banner).toBeVisible();
	await expect(banner.getByTestId('promo-code')).toHaveText('E2E10');
	await expect(banner).toContainText('Diskon 10%');
	await expect(banner.getByRole('link', { name: 'Masuk' })).toBeVisible();
});

test('lupa password: tautan dari email (log) → password baru → login; tautan sekali pakai', async ({
	page,
	context
}) => {
	const email = uniqueEmail('lupa');
	await registerCustomer(page, email, 'Pelanggan Lupa');
	await context.clearCookies(); // keluar

	await page.goto('/lupa-password');
	await page.locator('input[name="email"]').fill(email);
	await page.getByRole('button', { name: 'Kirim tautan reset' }).click();
	await expect(page.getByText('tautan untuk mengatur ulang password sudah dikirim')).toBeVisible();

	// MAIL_PROVIDER=log mencetak email ke log server
	await expect.poll(() => serverLog().includes(email), { timeout: 10_000 }).toBe(true);
	const links = [...serverLog().matchAll(/\/reset-password\/([\w-]+)/g)];
	const link = links[links.length - 1][0];
	expect(link).toBeTruthy();

	const NEW = 'Password-Baru-456';
	await page.goto(`${ORIGIN}${link}`);
	await page.locator('input[name="password"]').fill(NEW);
	await page.locator('input[name="confirmPassword"]').fill(NEW);
	await page.getByRole('button', { name: 'Simpan password baru' }).click();
	await expect(page).toHaveURL(/\/login\?reset=1/);
	await expect(page.getByText('Password berhasil diubah')).toBeVisible();

	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(NEW);
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.startsWith('/login'));

	// tautan yang sama tidak bisa dipakai lagi (setelah keluar; pengguna yang masuk dialihkan ke beranda)
	await context.clearCookies();
	await page.goto(`${ORIGIN}${link}`);
	await expect(page.getByText('Tautan tidak valid atau sudah kedaluwarsa')).toBeVisible();
	expect(PASSWORD).not.toBe(NEW);
});

test('keamanan dasar: halaman berlogin dialihkan, area admin tertutup untuk pelanggan', async ({
	page
}) => {
	await page.goto('/checkout');
	await expect(page).toHaveURL(/\/login\?next=/);
	await registerCustomer(page, uniqueEmail('akses'));
	// cookie pelanggan tidak berlaku di portal staf: diarahkan ke login staf, bukan melihat halaman admin
	await page.goto('/admin/pesanan');
	await expect(page).toHaveURL(/\/staff\/login/);
});
