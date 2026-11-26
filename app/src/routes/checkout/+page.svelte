<script lang="ts">
	import { thumbOf } from '#lib/utils/image';
	import AddressFields from '#lib/components/AddressFields.svelte';
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import PaymentMethodPicker from '#lib/components/PaymentMethodPicker.svelte';
	import ShippingPicker from '#lib/components/ShippingPicker.svelte';
	import VoucherBox from '#lib/components/VoucherBox.svelte';
	import type { PaymentMethod } from '#lib/constants';
	import { formatRupiah } from '#lib/utils/format';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Clock from '@lucide/svelte/icons/clock';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let v = $derived((form?.values as Record<string, string | undefined>) ?? data.userProfile);
	const deadline = $derived(data.settings.paymentDeadlineHours);

	// isian alamat baru: dari formulir yang dikembalikan karena galat, atau dari profil
	let av = $derived((form?.values as Record<string, string | undefined>) ?? data.newAddress);
	// default: pakai alamat profil bila ada; setelah galat, pilihan sebelumnya dipertahankan
	// svelte-ignore state_referenced_locally
	let addressMode = $state<'profil' | 'baru'>(
		(form?.values as { addressMode?: 'profil' | 'baru' } | undefined)?.addressMode ??
			(data.defaultAddress ? 'profil' : 'baru')
	);

	// pilihan sebelumnya dipertahankan bila formulir dikembalikan karena galat (nilai awal saja)
	// svelte-ignore state_referenced_locally
	let method = $state<PaymentMethod>(
		(form?.values as { paymentMethod?: PaymentMethod } | undefined)?.paymentMethod ??
			data.paymentOptions[0]?.method ??
			'transfer_bank'
	);
	const online = $derived(method !== 'transfer_bank');

	// kode pos tujuan: dari isian alamat baru (nilai awal dari profil / formulir yang dikembalikan)
	// svelte-ignore state_referenced_locally
	let postal = $state(String((av as Record<string, string | undefined>).postalCode ?? ''));
	// kode pos yang berlaku: alamat default profil, atau isian kode pos alamat baru
	const activePostal = $derived(
		addressMode === 'profil' && data.defaultAddress ? data.defaultAddress.postalCode : postal
	);

	// diisi ShippingPicker: ongkir terpilih & alasan tombol "Buat pesanan" belum boleh ditekan
	let shippingCost = $state(0);
	let blocker = $state<'none' | 'waiting' | 'pick' | 'failed'>('none');
	// diisi VoucherBox
	let voucher = $state<{ code: string; discount: number } | null>(null);
	const discount = $derived(voucher?.discount ?? 0);
	const total = $derived(data.subtotal - discount + shippingCost);
</script>

<svelte:head>
	<title>Checkout Pesanan - Store Downshit</title>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<Breadcrumb items={[{ label: 'Keranjang', href: '/keranjang' }, { label: 'Checkout' }]} />
	<PageHeader title="Checkout" meta="{data.totalItems} item" />

	{#if form?.message}
		<div class="mt-6">
			<Alert type="error" message={form.message} />
		</div>
	{/if}

	<form
		method="POST"
		class="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start"
	>
		<!-- Kiri: formulir & pembayaran -->
		<div class="space-y-8">
			<section class="panel">
				<h2 class="panel-title">Alamat tujuan pengiriman</h2>

				<div class="mt-6 space-y-5">
					<div>
						<label for="recipientName" class="label">Nama penerima</label>
						<input
							type="text"
							id="recipientName"
							name="recipientName"
							value={v.recipientName ?? ''}
							placeholder="Nama lengkap penerima paket"
							required
							autocomplete="name"
							aria-invalid={form?.errors?.recipientName ? 'true' : undefined}
							aria-describedby={form?.errors?.recipientName ? 'err-recipientName' : undefined}
						/>
						{#if form?.errors?.recipientName}
							<p id="err-recipientName" class="field-error">{form.errors.recipientName[0]}</p>
						{/if}
					</div>

					<div>
						<label for="recipientPhone" class="label">Nomor WhatsApp / HP aktif</label>
						<input
							type="tel"
							id="recipientPhone"
							name="recipientPhone"
							value={v.recipientPhone ?? ''}
							placeholder="Contoh: 081234567890"
							required
							autocomplete="tel"
							aria-invalid={form?.errors?.recipientPhone ? 'true' : undefined}
							aria-describedby="hint-recipientPhone{form?.errors?.recipientPhone
								? ' err-recipientPhone'
								: ''}"
						/>
						<p id="hint-recipientPhone" class="hint">
							Digunakan kurir untuk konfirmasi dan pengiriman resi via WhatsApp.
						</p>
						{#if form?.errors?.recipientPhone}
							<p id="err-recipientPhone" class="field-error">{form.errors.recipientPhone[0]}</p>
						{/if}
					</div>

					<fieldset>
						<legend class="label">Alamat pengiriman</legend>

						{#if data.defaultAddress}
							<div class="mt-2 grid gap-3 sm:grid-cols-2">
								<label
									class="flex cursor-pointer items-start gap-3 border p-4 text-sm {addressMode ===
									'profil'
										? 'border-ink'
										: 'border-line'}"
								>
									<input
										type="radio"
										name="addressMode"
										value="profil"
										bind:group={addressMode}
										class="mt-0.5"
									/>
									<span class="font-bold">Pakai alamat default profil</span>
								</label>
								<label
									class="flex cursor-pointer items-start gap-3 border p-4 text-sm {addressMode ===
									'baru'
										? 'border-ink'
										: 'border-line'}"
								>
									<input
										type="radio"
										name="addressMode"
										value="baru"
										bind:group={addressMode}
										class="mt-0.5"
									/>
									<span class="font-bold">Masukkan alamat baru</span>
								</label>
							</div>
							{#if form?.errors?.addressMode}
								<p class="field-error">{form.errors.addressMode[0]}</p>
							{/if}
						{:else}
							<input type="hidden" name="addressMode" value="baru" />
						{/if}

						{#if addressMode === 'profil' && data.defaultAddress}
							<div class="mt-4 border border-line bg-mist/50 p-4 text-sm">
								<p class="eyebrow">Dikirim ke</p>
								<p class="mt-1">{data.defaultAddress.text}</p>
								<a href="/profil" class="mt-2 inline-block text-xs underline">Ubah alamat default</a
								>
							</div>
						{:else}
							<div class="mt-4">
								<AddressFields
									values={av}
									errors={form?.errors ?? {}}
									onpostal={(p) => (postal = p)}
								/>
							</div>
						{/if}
					</fieldset>

					<div>
						<label for="notes" class="label">Catatan tambahan (opsional)</label>
						<input
							type="text"
							id="notes"
							name="notes"
							value={v.notes ?? ''}
							placeholder="Misal: titipkan ke pos satpam jika tidak ada orang di rumah"
							aria-invalid={form?.errors?.notes ? 'true' : undefined}
							aria-describedby={form?.errors?.notes ? 'err-notes' : undefined}
						/>
						{#if form?.errors?.notes}
							<p id="err-notes" class="field-error">{form.errors.notes[0]}</p>
						{/if}
					</div>

					{#if addressMode === 'baru'}
						<label class="flex items-start gap-3 text-sm">
							<input
								type="checkbox"
								name="saveToProfile"
								class="mt-0.5"
								checked={!data.defaultAddress || data.userProfile.recipientPhone === ''}
							/>
							<span>
								Simpan alamat &amp; nomor HP ini sebagai default di profil
								<span class="hint !mt-0 block">
									{data.defaultAddress
										? 'Akan menggantikan alamat default yang tersimpan sekarang.'
										: 'Jadi pilihan "alamat default" di checkout berikutnya.'}
								</span>
							</span>
						</label>
					{/if}
				</div>
			</section>

			<ShippingPicker
				shippingApi={data.shippingApi}
				flatCost={data.shippingCost}
				weightGrams={data.weightGrams}
				postal={activePostal}
				initialOption={(form?.values as { shippingOption?: string } | undefined)?.shippingOption ??
					''}
				error={form?.errors?.shippingOption?.[0]}
				bind:cost={shippingCost}
				bind:blocker
			/>

			<!-- Pembayaran -->
			<section class="panel bg-mist/50">
				<h2 class="panel-title">Metode pembayaran</h2>

				<div class="mt-5">
					<PaymentMethodPicker options={data.paymentOptions} bind:value={method} />
					{#if form?.errors?.paymentMethod}
						<p class="field-error">{form.errors.paymentMethod[0]}</p>
					{/if}
				</div>

				{#if online}
					{#if data.simulator}
						<p
							class="mt-5 border-l-4 border-warn bg-warn-bg px-3 py-2 text-xs font-semibold text-warn"
						>
							MODE SIMULASI: pembayaran online memakai payment gateway tiruan (mirip Midtrans),
							tanpa uang sungguhan.
						</p>
					{/if}
					<p class="mt-5 text-sm text-smoke">
						Setelah menekan <strong class="text-ink">Buat pesanan</strong>, kamu diarahkan ke
						halaman pembayaran {data.simulator ? 'simulasi' : 'Midtrans yang aman'}. Pesanan
						otomatis diproses begitu pembayaran berhasil, tanpa perlu unggah bukti.
					</p>
				{:else}
					<p class="mt-5 text-sm text-smoke">
						Setelah pesanan dibuat, transfer total pembayaran ke rekening resmi toko berikut.
					</p>

					<dl class="mt-4 grid gap-px border border-line bg-line sm:grid-cols-2">
						<div class="bg-paper p-4">
							<dt class="eyebrow">Bank tujuan</dt>
							<dd class="mt-1 text-base font-bold">{data.settings.bankName ?? 'BCA'}</dd>
						</div>
						<div class="bg-paper p-4">
							<dt class="eyebrow">Atas nama</dt>
							<dd class="mt-1 text-base font-bold uppercase">
								{data.settings.bankHolder ?? 'DOWNSHIT STORE'}
							</dd>
						</div>
						<div class="bg-paper p-4 sm:col-span-2">
							<dt class="eyebrow">Nomor rekening</dt>
							<dd class="display mt-1 text-2xl tracking-[0.04em] tabular-nums">
								{data.settings.bankNumber ?? '-'}
							</dd>
						</div>
					</dl>
				{/if}

				<p class="mt-4 flex items-center gap-2 text-xs text-smoke">
					<Clock size={14} class="shrink-0" />
					<span>
						Batas waktu pembayaran <strong class="text-ink">{deadline} jam</strong> sejak pesanan dibuat.
					</span>
				</p>
			</section>
		</div>

		<!-- Kanan: ringkasan -->
		<aside class="panel lg:sticky lg:top-24">
			<h2 class="panel-title">Ringkasan pesanan ({data.totalItems} item)</h2>

			<ul class="mt-5 max-h-72 divide-y divide-line overflow-y-auto border-y border-line">
				{#each data.items as item (item.id)}
					<li class="flex items-center gap-3 py-3">
						<div class="product-media !aspect-square w-12 shrink-0 [&_img]:!object-contain">
							{#if item.image}
								<img src={thumbOf(item.image)} alt="" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-bold tracking-[0.06em] uppercase">{item.name}</p>
							<p class="mt-0.5 text-xs text-smoke">
								{item.quantity} &times; {formatRupiah(item.price)}
							</p>
							{#if item.sizeParts.length > 0}
								<p class="mt-0.5 text-xs font-semibold tracking-[0.06em] uppercase">
									{#if item.isProduct}
										Ukuran {item.size}
									{:else}
										{#each item.sizeParts as part, i (i)}{i > 0 ? ' · ' : ''}{part.name} ({part.size}){/each}
									{/if}
								</p>
							{/if}
						</div>
						<span class="price shrink-0 text-sm">{formatRupiah(item.subtotal)}</span>
					</li>
				{/each}
			</ul>

			<VoucherBox
				initialCode={(form?.values as { voucherCode?: string } | undefined)?.voucherCode ?? ''}
				error={form?.errors?.voucherCode?.[0]}
				bind:applied={voucher}
			/>

			<dl class="mt-5 space-y-3 text-sm">
				<div class="flex items-center justify-between gap-4">
					<dt class="text-smoke">Subtotal produk</dt>
					<dd class="price">{formatRupiah(data.subtotal)}</dd>
				</div>
				{#if discount > 0}
					<div class="flex items-center justify-between gap-4">
						<dt class="text-smoke">Voucher {voucher?.code}</dt>
						<dd class="price">−{formatRupiah(discount)}</dd>
					</div>
				{/if}
				<div class="flex items-center justify-between gap-4">
					<dt class="text-smoke">Ongkos kirim</dt>
					<dd class="price">
						{#if blocker === 'pick'}<span class="text-smoke">Pilih kurir</span>{:else}{formatRupiah(
								shippingCost
							)}{/if}
					</dd>
				</div>
			</dl>

			<div class="divider mt-5 flex items-baseline justify-between gap-4 pt-5">
				<span class="text-xs font-bold tracking-[0.14em] uppercase">Total pembayaran</span>
				<span class="price text-2xl">{formatRupiah(total)}</span>
			</div>

			<button
				type="submit"
				disabled={data.shippingApi && blocker !== 'none'}
				class="btn btn-primary btn-lg btn-block mt-6"
			>
				{#if data.shippingApi && blocker === 'waiting'}Menghitung ongkir…{:else if data.shippingApi && blocker === 'pick'}Pilih
					layanan pengiriman{:else}Buat pesanan <ArrowRight size={16} />{/if}
			</button>

			<p class="mt-4 text-center text-xs text-smoke">
				Dengan membuat pesanan, stok produk direservasi untukmu selama {deadline} jam.
			</p>
		</aside>
	</form>
</div>
