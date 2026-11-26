import { expect, test } from '@playwright/test';
import {
	adminPage,
	addToCart,
	fillAddress,
	orderCodeIn,
	PNG,
	registerCustomer,
	uniqueEmail
} from './helpers';

/**
 * Alur utama pelanggan: daftar → belanja 2 produk → centang sebagian → alamat bertingkat → voucher →
 * bayar QRIS (simulator) → admin kirim + resi → pelanggan konfirmasi terima → ulasan berfoto.
 */
test('daftar → keranjang (centang sebagian) → checkout QRIS + voucher → kirim → selesai → ulasan', async ({
	page,
	browser
}) => {
	await registerCustomer(page, uniqueEmail('online'));

	// 1) belanja: kaos ber-ukuran + topi tanpa ukuran
	await addToCart(page, 'kaos-downshit-logo-putih', 'M');
	await addToCart(page, 'topi-downshit-dad-hat');

	// 2) keranjang: lepas centang topi → hanya kaos yang masuk ringkasan & checkout
	await page.goto('/keranjang');
	await expect(page.getByText('Kaos Downshit Logo Putih').first()).toBeVisible();
	await expect(page.getByText('Topi Downshit Dad Hat').first()).toBeVisible();
	await expect(page.getByText('2 item dipilih')).toBeVisible();
	await page.getByRole('checkbox', { name: 'Pilih Topi Downshit Dad Hat untuk checkout' }).click();
	await expect(
		page.getByRole('checkbox', { name: 'Pilih Topi Downshit Dad Hat untuk checkout' })
	).toHaveAttribute('aria-checked', 'false');
	await expect(page.getByText('1 item dipilih')).toBeVisible();

	// 3) checkout
	await page.getByRole('link', { name: /Lanjut ke checkout/ }).click();
	await expect(page).toHaveURL(/\/checkout/);
	await expect(page.getByText('Kaos Downshit Logo Putih')).toBeVisible();
	await expect(page.getByText('Topi Downshit Dad Hat')).toHaveCount(0); // tidak dicentang
	await page.locator('#recipientPhone').fill('081234567890');
	await fillAddress(page);

	// voucher dari banner (E2E10 = 10% dari Rp 99.000 = Rp 9.900)
	await page.locator('#voucher-input').fill('e2e10');
	await page.getByRole('button', { name: 'Pakai', exact: true }).click();
	await expect(page.getByText(/hemat Rp\s?9\.900/)).toBeVisible();

	await page.locator('label', { hasText: 'QRIS' }).first().click();
	await page.getByRole('button', { name: /Buat pesanan/ }).click();

	// 4) simulator gateway: pilih saluran, lalu bayar → kembali ke halaman pesanan dengan status diproses
	await expect(page).toHaveURL(/\/simulasi-bayar\//);
	await page.getByRole('button', { name: 'QRIS', exact: true }).click();
	await page.locator('button[name="outcome"][value="settlement"]').click();

	// 5) status pesanan: dibayar → diproses, potongan voucher tercatat
	await expect(page).toHaveURL(/\/pesanan\/DWN-/);
	const code = orderCodeIn(page.url());
	expect(code).toMatch(/^DWN-/);
	await expect(page.getByText('Pembayaran berhasil diterima')).toBeVisible();
	await expect(page.getByText('Diproses').first()).toBeVisible();
	await expect(page.getByText('Voucher E2E10')).toBeVisible();

	// 6) admin mengirim barang dengan nomor resi
	const admin = await adminPage(browser);
	await admin.page.goto(`/admin/pesanan/${code}`);
	await admin.page.locator('#courier').selectOption({ index: 0 });
	await admin.page.locator('#trackingNumber').fill('E2E-RESI-0001');
	await admin.page.getByRole('button', { name: /Simpan Resi/ }).click();
	await expect(admin.page.getByText('E2E-RESI-0001').first()).toBeVisible();

	// 7) pelanggan melihat resi dan menandai pesanan diterima
	await page.goto(`/pesanan/${code}`);
	await expect(page.getByText('E2E-RESI-0001')).toBeVisible();
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: /Pesanan sudah diterima/ }).click();
	await expect(page.getByText('Beri ulasan')).toBeVisible();

	// 8) ulasan dengan foto
	await page.locator('label:has(input[name="rating"][value="5"])').first().click();
	await page.locator('textarea[name="comment"]').first().fill('Bahan adem, jahitan rapi. Mantap!');
	await page
		.locator('input[name="photos"]')
		.first()
		.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
	await page.getByRole('button', { name: 'Kirim ulasan' }).first().click();
	await expect(page.getByText('Terima kasih! Ulasan untuk')).toBeVisible();

	// ulasan tampil publik (tamu) lengkap dengan foto
	const guest = await browser.newContext({ baseURL: page.url().split('/pesanan')[0] });
	const gp = await guest.newPage();
	await gp.goto('/produk/kaos-downshit-logo-putih');
	await expect(gp.getByText('Bahan adem, jahitan rapi. Mantap!')).toBeVisible();
	await expect(gp.locator('img[alt^="Foto dari"]')).toHaveCount(1);
	await guest.close();

	// 9) item yang tidak dicentang tetap di keranjang, kuota voucher terpakai tercatat di admin
	await page.goto('/keranjang');
	await expect(page.getByText('Topi Downshit Dad Hat').first()).toBeVisible();
	await admin.page.goto('/admin/voucher');
	const row = admin.page.locator('tr', { hasText: 'E2E10' });
	await expect(row).toContainText('1 / 5');
	await admin.ctx.close();
});
