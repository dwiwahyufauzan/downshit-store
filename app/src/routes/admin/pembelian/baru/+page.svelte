<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/Alert.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { formatRupiah } from '$lib/utils/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type ItemRow = { productId: number; size: string; quantity: number; unitCost: number };

	// Gagal validasi tanpa JS: pulihkan isian terakhir dari server (dibaca sekali saat dibuat)
	const saved = untrack(() => form?.values) as
		| {
				supplierName?: string;
				purchaseDate?: string;
				note?: string;
				status?: string;
				items?: ItemRow[];
		  }
		| undefined;

	const firstProduct = untrack(() => data.products[0]);
	let items = $state<ItemRow[]>(
		saved?.items?.length
			? saved.items.map((i) => ({
					productId: Number(i.productId),
					size: String(i.size ?? ''),
					quantity: Number(i.quantity),
					unitCost: Number(i.unitCost)
				}))
			: firstProduct
				? [{ productId: firstProduct.id, size: '', quantity: 1, unitCost: 0 }]
				: []
	);
	let busy = $state(false);
	let status = $state<'diterima' | 'dipesan'>(saved?.status === 'dipesan' ? 'dipesan' : 'diterima');

	function addItem() {
		const nextUnused = data.products.find((p) => !items.some((i) => i.productId === p.id));
		items.push({
			productId: nextUnused?.id ?? data.products[0]?.id ?? 0,
			size: '',
			quantity: 1,
			unitCost: 0
		});
	}

	const sizesOf = (productId: number) => data.products.find((p) => p.id === productId)?.sizes ?? [];

	function removeItem(idx: number) {
		if (items.length > 1) {
			items.splice(idx, 1);
		}
	}

	const grandTotal = $derived(
		items.reduce((s, it) => s + (it.quantity || 0) * (it.unitCost || 0), 0)
	);
</script>

<svelte:head>
	<title>Catat Pembelian Baru - Admin Downshit</title>
</svelte:head>

<div>
	<Breadcrumb
		home={{ label: 'Admin', href: '/admin' }}
		items={[{ label: 'Pembelian', href: '/admin/pembelian' }, { label: 'Baru' }]}
	/>
	<PageHeader title="Catat pembelian" />

	<div class="max-w-3xl space-y-6 pt-6">
		{#if form?.message}
			<Alert type="error" message={form.message} />
		{/if}

		{#if form?.errors}
			<Alert type="error" message="Terdapat kesalahan pada input formulir pembelian." />
		{/if}

		{#if data.products.length === 0}
			<EmptyState
				title="Belum ada produk"
				description="Tambahkan produk lebih dulu sebelum mencatat pembelian/restock."
				actionHref="/admin/produk/baru"
				actionText="Tambah produk"
			/>
		{:else}
			<form
				method="POST"
				class="space-y-6"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						await update({ reset: false });
						busy = false;
					};
				}}
			>
				<input type="hidden" name="items" value={JSON.stringify(items)} />

				<div class="panel grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="supplierName" class="label">Supplier / Vendor Konveksi</label>
						<input
							id="supplierName"
							name="supplierName"
							type="text"
							placeholder="Contoh: CV Tekstil Jaya Bandung"
							maxlength="120"
							value={saved?.supplierName ?? ''}
						/>
						{#if form?.errors?.supplierName}
							<p class="field-error">{form.errors.supplierName[0]}</p>
						{/if}
					</div>

					<div>
						<label for="purchaseDate" class="label">Tanggal Pembelian</label>
						<input
							id="purchaseDate"
							name="purchaseDate"
							type="date"
							value={saved?.purchaseDate ?? data.today}
							required
						/>
						{#if form?.errors?.purchaseDate}
							<p class="field-error">{form.errors.purchaseDate[0]}</p>
						{/if}
					</div>

					<fieldset class="sm:col-span-2">
						<legend class="label">Status barang</legend>
						<div class="flex flex-wrap gap-2">
							<label class="chip cursor-pointer" class:chip-on={status === 'diterima'}>
								<input
									type="radio"
									name="status"
									value="diterima"
									bind:group={status}
									class="sr-only"
								/>
								Sudah diterima (stok langsung bertambah)
							</label>
							<label class="chip cursor-pointer" class:chip-on={status === 'dipesan'}>
								<input
									type="radio"
									name="status"
									value="dipesan"
									bind:group={status}
									class="sr-only"
								/>
								Baru dipesan (stok bertambah saat barang tiba)
							</label>
						</div>
						{#if form?.errors?.status}
							<p class="field-error">{form.errors.status[0]}</p>
						{/if}
					</fieldset>

					<div class="sm:col-span-2">
						<label for="note" class="label">Catatan Pengadaan</label>
						<input
							id="note"
							name="note"
							type="text"
							maxlength="255"
							value={saved?.note ?? ''}
							placeholder="Restock batch sablon batch ke-3..."
						/>
						{#if form?.errors?.note}
							<p class="field-error">{form.errors.note[0]}</p>
						{/if}
					</div>
				</div>

				<!-- Daftar Item Barang Masuk -->
				<section class="panel space-y-4">
					<div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
						<div>
							<h2 class="panel-title">Daftar Barang Masuk</h2>
							<p class="mt-1 text-xs text-smoke">
								Stok otomatis bertambah. Pilih produk (dan ukuran bila ada), lalu isi jumlah dan
								harga kulak per unit.
							</p>
						</div>
						<button type="button" onclick={addItem} class="btn btn-tool">+ Tambah item</button>
					</div>

					<div class="space-y-3">
						{#each items as it, idx (idx)}
							<div
								class="flex flex-col gap-3 border border-line bg-mist/40 p-3 sm:flex-row sm:flex-wrap sm:items-end"
							>
								<div class="sm:basis-full">
									<label for="it-prod-{idx}" class="label">Produk</label>
									<select
										id="it-prod-{idx}"
										bind:value={it.productId}
										onchange={() => (it.size = '')}
									>
										{#each data.products as prod (prod.id)}
											<option value={prod.id}>
												{prod.name} (Stok sekarang: {prod.stock})
											</option>
										{/each}
									</select>
								</div>

								{#if sizesOf(it.productId).length > 0}
									<div class="sm:w-32">
										<label for="it-size-{idx}" class="label">Ukuran</label>
										<select id="it-size-{idx}" bind:value={it.size} required>
											<option value="" disabled>Pilih…</option>
											{#each sizesOf(it.productId) as sz (sz.label)}
												<option value={sz.label}>{sz.label} (stok {sz.stock})</option>
											{/each}
										</select>
									</div>
								{/if}

								<div class="sm:w-24">
									<label for="it-qty-{idx}" class="label">Jumlah (Pcs)</label>
									<input
										id="it-qty-{idx}"
										type="number"
										min="1"
										max="100000"
										step="1"
										bind:value={it.quantity}
									/>
								</div>

								<div class="sm:w-36">
									<label for="it-cost-{idx}" class="label">Kulak/Pcs (Rp)</label>
									<input
										id="it-cost-{idx}"
										type="number"
										min="0"
										step="1"
										bind:value={it.unitCost}
									/>
								</div>

								<div class="flex items-center justify-between gap-3 sm:block sm:w-32 sm:text-right">
									<span class="label sm:mb-1">Subtotal</span>
									<span class="price block text-sm sm:py-3">
										{formatRupiah((it.quantity || 0) * (it.unitCost || 0))}
									</span>
								</div>

								<button
									type="button"
									onclick={() => removeItem(idx)}
									disabled={items.length <= 1}
									class="btn btn-tool btn-danger-outline"
								>
									Hapus
								</button>
							</div>
						{/each}
					</div>

					{#if form?.errors?.items}
						<p class="field-error">{form.errors.items[0]}</p>
					{/if}

					<div class="flex items-end justify-between gap-3 border-t border-ink pt-4">
						<span class="eyebrow">Total Pengeluaran Pembelian</span>
						<span class="price text-xl">{formatRupiah(grandTotal)}</span>
					</div>
				</section>

				<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<a href="/admin/pembelian" class="btn">Batal</a>
					<button type="submit" class="btn btn-primary" disabled={busy}>
						{busy
							? 'Menyimpan…'
							: status === 'diterima'
								? 'Simpan Pembelian & Tambah Stok'
								: 'Simpan Pesanan Pembelian'}
					</button>
				</div>
			</form>
		{/if}
	</div>
</div>
