import { expect, test } from '@playwright/test';
import { adminPage, addToCart, fillAddress, PNG, registerCustomer, uniqueEmail } from './helpers';

/** Transfer bank manual: unggah bukti → admin mengonfirmasi → pesanan diproses; admin juga menolak bukti keliru. */
test('transfer bank: unggah bukti → admin tolak → unggah ulang → admin konfirmasi', async ({
	page,
	browser
}) => {
	await registerCustomer(page, uniqueEmail('transfer'), 'Pelanggan Transfer');
	await addToCart(page, 'kaos-downshit-logo-putih', 'L');

	await page.goto('/checkout');
	await page.locator('#recipientPhone').fill('081234567890');
	await fillAddress(page);
	await page
		.locator('label', { hasText: /transfer bank/i })
		.first()
		.click();
	await page.getByRole('button', { name: /Buat pesanan/ }).click();

	await expect(page).toHaveURL(/\/pesanan\/DWN-/);
	const code = page.url().match(/DWN-[0-9]{6}-[0-9A-F]{6}/)![0];
	await expect(page.getByText('Menunggu pembayaran').first()).toBeVisible();

	// unggah bukti
	const upload = async () => {
		await page
			.locator('input[name="proofImage"]')
			.setInputFiles({ name: 'bukti.png', mimeType: 'image/png', buffer: PNG });
		await page.getByRole('button', { name: /Kirim bukti/i }).click();
	};
	await upload();
	await expect(page.getByText('Menunggu konfirmasi').first()).toBeVisible();

	// admin menolak (alasan wajib), pelanggan melihat alasannya
	const admin = await adminPage(browser);
	await admin.page.goto(`/admin/pesanan/${code}`);
	await admin.page.getByRole('button', { name: /Tolak Bukti Transfer/ }).click(); // membuka dialog alasan
	await admin.page.locator('#reject-reason').fill('Nominal transfer tidak sesuai tagihan');
	await admin.page.getByRole('button', { name: 'Kirim Penolakan' }).click();
	await expect(admin.page.getByText('Nominal transfer tidak sesuai tagihan').first()).toBeVisible();
	await page.goto(`/pesanan/${code}`);
	await expect(page.getByText('Nominal transfer tidak sesuai tagihan').first()).toBeVisible();

	// unggah ulang → admin konfirmasi
	await upload();
	await expect(page.getByText('Menunggu konfirmasi').first()).toBeVisible();
	await admin.page.goto(`/admin/pesanan/${code}`);
	await admin.page.locator('form[action="?/konfirmasi"] button[type="submit"]').click();
	await page.goto(`/pesanan/${code}`);
	await expect(page.getByText('Diproses').first()).toBeVisible();
	await admin.ctx.close();
});
