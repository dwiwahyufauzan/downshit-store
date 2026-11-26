<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { PAYMENT_METHODS, type PaymentMethod } from '#lib/constants';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);

	// Saklar metode bayar; metode online baru tampil di checkout bila Midtrans terkonfigurasi
	const PAY_FIELDS: Record<PaymentMethod, string> = {
		transfer_bank: 'payTransfer',
		ewallet: 'payEwallet',
		qris: 'payQris',
		va: 'payVa',
		minimarket: 'payMinimarket'
	};
	const payMethods = Object.keys(PAYMENT_METHODS) as PaymentMethod[];

	let s = $derived(
		form?.values
			? (form.values as Record<string, string | number | boolean>)
			: (data.settings as unknown as Record<string, string | number | boolean>)
	);
</script>

<svelte:head>
	<title>Pengaturan Toko - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Pengaturan toko" />

	{#if form?.errors}
		<div class="mt-6">
			<Alert
				type="error"
				message="Terdapat kesalahan pada input pengaturan. Silakan periksa kolom di bawah."
			/>
		</div>
	{/if}

	<form
		method="POST"
		class="mt-6 space-y-6"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<section class="panel space-y-4">
			<h2 class="panel-title border-b border-line pb-3">Informasi Umum &amp; Kontak</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label for="storeName" class="label">Nama Toko</label>
					<input
						id="storeName"
						name="storeName"
						type="text"
						maxlength="100"
						value={s.storeName ?? ''}
						required
					/>
					{#if form?.errors?.storeName}
						<p class="field-error">{form.errors.storeName[0]}</p>
					{/if}
				</div>
				<div>
					<label for="whatsapp" class="label">Nomor WhatsApp (CS)</label>
					<input
						id="whatsapp"
						name="whatsapp"
						type="text"
						placeholder="6283867358863"
						inputmode="numeric"
						maxlength="15"
						value={s.whatsapp ?? ''}
						required
					/>
					<p class="hint">Awali dengan 62 (contoh: 6283867358863)</p>
					{#if form?.errors?.whatsapp}
						<p class="field-error">{form.errors.whatsapp[0]}</p>
					{/if}
				</div>
			</div>
		</section>

		<section class="panel space-y-4">
			<h2 class="panel-title border-b border-line pb-3">Rekening Pembayaran Bank</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
				<div>
					<label for="bankName" class="label">Nama Bank</label>
					<input
						id="bankName"
						name="bankName"
						type="text"
						placeholder="BCA"
						value={s.bankName ?? ''}
						required
					/>
					{#if form?.errors?.bankName}
						<p class="field-error">{form.errors.bankName[0]}</p>
					{/if}
				</div>
				<div>
					<label for="bankNumber" class="label">Nomor Rekening</label>
					<input
						id="bankNumber"
						name="bankNumber"
						type="text"
						placeholder="1234567890"
						inputmode="numeric"
						maxlength="30"
						value={s.bankNumber ?? ''}
						required
					/>
					{#if form?.errors?.bankNumber}
						<p class="field-error">{form.errors.bankNumber[0]}</p>
					{/if}
				</div>
				<div>
					<label for="bankHolder" class="label">Atas Nama Rekening</label>
					<input
						id="bankHolder"
						name="bankHolder"
						type="text"
						placeholder="Store Downshit"
						value={s.bankHolder ?? ''}
						required
					/>
					{#if form?.errors?.bankHolder}
						<p class="field-error">{form.errors.bankHolder[0]}</p>
					{/if}
				</div>
			</div>
		</section>

		<section class="panel space-y-4">
			<h2 class="panel-title border-b border-line pb-3">Metode Pembayaran</h2>
			<p class="text-sm text-smoke">
				Pilih metode yang ditawarkan ke pelanggan saat checkout. Metode online (e-wallet, QRIS,
				Virtual Account, minimarket) diproses lewat Midtrans dan terkonfirmasi otomatis.
			</p>

			{#if data.gateway.mode === 'simulator'}
				<Alert
					type="warning"
					message="MODE SIMULASI aktif (PAYMENT_SIMULATOR=true): metode online memakai payment gateway tiruan mirip Midtrans, tanpa akun dan tanpa uang sungguhan. Untuk pembayaran asli, isi MIDTRANS_SERVER_KEY dan hapus PAYMENT_SIMULATOR."
				/>
			{:else if data.gateway.configured}
				<p class="text-xs font-semibold text-ok">
					Midtrans terhubung (mode {data.gateway.mode === 'production' ? 'Produksi' : 'Sandbox'}).
				</p>
			{:else}
				<Alert
					type="error"
					message="Midtrans belum dikonfigurasi. Isi MIDTRANS_SERVER_KEY di file .env server lalu restart aplikasi agar metode online bisa dipakai (atau set PAYMENT_SIMULATOR=true untuk demo tanpa akun). Sementara itu hanya transfer bank yang tampil di checkout."
				/>
			{/if}

			<div class="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2">
				{#each payMethods as m (m)}
					{@const field = PAY_FIELDS[m]}
					<label class="flex items-start gap-3 bg-paper p-4 text-sm">
						<input type="checkbox" name={field} class="mt-0.5" checked={!!s[field]} />
						<span>
							<span class="font-semibold">{PAYMENT_METHODS[m].label}</span>
							<span class="hint !mt-0 block">{PAYMENT_METHODS[m].hint}</span>
						</span>
					</label>
				{/each}
			</div>
			{#if form?.errors?.payTransfer}
				<p class="field-error">{form.errors.payTransfer[0]}</p>
			{/if}

			<p class="hint">
				URL notifikasi yang diisi di dashboard Midtrans (Settings → Configuration → Payment
				Notification URL): <code class="font-mono"
					>https://DOMAIN-ANDA/api/midtrans/notification</code
				>
			</p>
		</section>

		<section class="panel space-y-4">
			<h2 class="panel-title border-b border-line pb-3">
				Ongkir Otomatis (per tujuan &amp; berat)
			</h2>
			<p class="text-sm text-smoke">
				Pelanggan memilih kurir dan layanan di checkout; ongkir dihitung dari kode pos tujuan dan
				berat pesanan (Biteship). Kosongkan kode pos asal untuk memakai ongkir flat di bawah.
				{#if data.shippingApi}
					<strong class="text-ink">API key terpasang.</strong>
				{:else}
					<strong class="text-ink">Belum aktif:</strong> isi <code>BITESHIP_API_KEY</code> di .env server.
				{/if}
			</p>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label for="shippingOriginPostal" class="label">Kode pos asal (toko/gudang)</label>
					<input
						id="shippingOriginPostal"
						name="shippingOriginPostal"
						type="text"
						inputmode="numeric"
						maxlength="5"
						placeholder="41211"
						value={s.shippingOriginPostal ?? ''}
					/>
					{#if form?.errors?.shippingOriginPostal}
						<p class="field-error">{form.errors.shippingOriginPostal[0]}</p>
					{/if}
				</div>
				<div>
					<label for="shippingCouriers" class="label">Kurir yang ditawarkan</label>
					<input
						id="shippingCouriers"
						name="shippingCouriers"
						type="text"
						placeholder="jne,jnt,sicepat,anteraja"
						value={s.shippingCouriers ?? 'jne,jnt,sicepat,anteraja'}
					/>
					<p class="hint">Kode kurir Biteship, dipisah koma.</p>
					{#if form?.errors?.shippingCouriers}
						<p class="field-error">{form.errors.shippingCouriers[0]}</p>
					{/if}
				</div>
			</div>
		</section>

		<section class="panel space-y-4">
			<h2 class="panel-title border-b border-line pb-3">Biaya Ongkir &amp; Parameter Pesanan</h2>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
				<div>
					<label for="shippingCost" class="label">Ongkos Kirim Flat (Rp)</label>
					<input
						id="shippingCost"
						name="shippingCost"
						type="number"
						min="0"
						step="1"
						max="500000"
						value={s.shippingCost ?? 15000}
						required
					/>
					<p class="hint">Hanya berlaku untuk pesanan baru; pesanan lama tetap.</p>
					{#if form?.errors?.shippingCost}
						<p class="field-error">{form.errors.shippingCost[0]}</p>
					{/if}
				</div>
				<div>
					<label for="lowStock" class="label">Ambang Stok Menipis</label>
					<input
						id="lowStock"
						name="lowStock"
						type="number"
						min="0"
						max="1000"
						value={s.lowStock ?? 5}
						required
					/>
					<p class="hint">Stok ≤ angka ini ditandai kuning/menipis</p>
					{#if form?.errors?.lowStock}
						<p class="field-error">{form.errors.lowStock[0]}</p>
					{/if}
				</div>
				<div>
					<label for="paymentDeadlineHours" class="label">Batas Bayar (Jam)</label>
					<input
						id="paymentDeadlineHours"
						name="paymentDeadlineHours"
						type="number"
						min="1"
						max="168"
						value={s.paymentDeadlineHours ?? 24}
						required
					/>
					<p class="hint">Maks. waktu upload bukti bayar</p>
					{#if form?.errors?.paymentDeadlineHours}
						<p class="field-error">{form.errors.paymentDeadlineHours[0]}</p>
					{/if}
				</div>
				<div>
					<label for="maxUnpaidOrders" class="label">Maks Order Belum Bayar</label>
					<input
						id="maxUnpaidOrders"
						name="maxUnpaidOrders"
						type="number"
						min="1"
						max="20"
						value={s.maxUnpaidOrders ?? 3}
						required
					/>
					<p class="hint">Mencegah spam penimbunan stok</p>
					{#if form?.errors?.maxUnpaidOrders}
						<p class="field-error">{form.errors.maxUnpaidOrders[0]}</p>
					{/if}
				</div>
				<div>
					<label for="autoCompleteDays" class="label">Auto-Selesai (Hari)</label>
					<input
						id="autoCompleteDays"
						name="autoCompleteDays"
						type="number"
						min="1"
						max="60"
						value={s.autoCompleteDays ?? 7}
						required
					/>
					<p class="hint">Otomatis selesai setelah status terkirim</p>
					{#if form?.errors?.autoCompleteDays}
						<p class="field-error">{form.errors.autoCompleteDays[0]}</p>
					{/if}
				</div>
			</div>
		</section>

		<div class="flex justify-end">
			<button type="submit" class="btn btn-primary" disabled={busy}>
				{busy ? 'Menyimpan…' : 'Simpan Perubahan'}
			</button>
		</div>
	</form>
</div>
