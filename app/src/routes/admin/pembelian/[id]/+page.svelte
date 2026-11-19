<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '$lib/components/Alert.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { formatDate, formatRupiah } from '$lib/utils/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let p = $derived(data.purchase);
	let busy = $state(false);
	let showCancel = $state(false);
</script>

<svelte:head>
	<title>Detail Pembelian {p.code} - Admin Downshit</title>
</svelte:head>

<div>
	<Breadcrumb
		home={{ label: 'Admin', href: '/admin' }}
		items={[{ label: 'Pembelian', href: '/admin/pembelian' }, { label: p.code }]}
	/>
	<PageHeader title={p.code} meta={p.purchaseDate}>
		{#snippet actions()}
			<span
				class="badge {p.status === 'diterima'
					? 'badge-ok'
					: p.status === 'dipesan'
						? 'badge-warn'
						: 'badge-muted'}"
			>
				{p.status}
			</span>
		{/snippet}
	</PageHeader>

	<div class="mt-6 space-y-3 empty:hidden">
		{#if form?.message}
			<Alert type="error" message={form.message} />
		{/if}
		{#if page.url.searchParams.get('baru') === '1'}
			<Alert
				type="success"
				message={p.status === 'diterima'
					? 'Pembelian tersimpan. Stok tiap produk di bawah sudah bertambah dan tercatat di riwayat mutasi stok.'
					: 'Pesanan pembelian tersimpan. Stok belum bertambah sampai Anda menandai barang diterima.'}
			/>
		{/if}
		{#if page.url.searchParams.get('diterima') === '1'}
			<Alert
				type="success"
				message="Barang ditandai diterima. Stok tiap produk di bawah sudah bertambah."
			/>
		{/if}
		{#if page.url.searchParams.get('dibatalkan') === '1'}
			<Alert type="success" message="Pembelian dibatalkan." />
		{/if}
	</div>

	<!-- Info Utama Pembelian -->
	<dl class="panel mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
		<div>
			<dt class="eyebrow">Supplier / Konveksi</dt>
			<dd class="mt-1 text-base font-bold">{p.supplierName ?? '-'}</dd>
		</div>
		<div>
			<dt class="eyebrow">Tanggal Pembelian</dt>
			<dd class="mt-1 text-base font-bold">{p.purchaseDate}</dd>
		</div>
		<div>
			<dt class="eyebrow">Dicatat Oleh</dt>
			<dd class="mt-1 text-sm">{p.adminName ?? 'Admin'} &middot; {formatDate(p.createdAt)}</dd>
		</div>
		<div>
			<dt class="eyebrow">Catatan</dt>
			<dd class="mt-1 text-sm">{p.note ?? '-'}</dd>
		</div>
	</dl>

	{#if p.status === 'dibatalkan'}
		<p class="mt-4 text-xs text-smoke">
			Dibatalkan {p.cancelledAt ? formatDate(p.cancelledAt) : ''}{p.cancelNote
				? ` — ${p.cancelNote}`
				: ''}. Pembelian yang sudah dibatalkan tidak dapat diubah lagi.
		</p>
	{:else}
		<div class="panel mt-4 space-y-3">
			{#if p.status === 'dipesan'}
				<p class="text-sm">
					Barang belum tiba, jadi stok <strong>belum</strong> bertambah. Tandai diterima saat barang sudah
					di tangan.
				</p>
			{:else}
				<p class="text-sm text-smoke">
					Diterima{p.receivedAt ? ` ${formatDate(p.receivedAt)}` : ''}. Bila salah input, batalkan
					pembelian ini (stok ditarik kembali) atau koreksi lewat
					<a href="/admin/stok" class="link font-semibold">penyesuaian stok</a>.
				</p>
			{/if}

			<div class="flex flex-wrap items-start gap-3">
				{#if p.status === 'dipesan'}
					<form
						method="POST"
						action="?/receive"
						use:enhance={() => {
							busy = true;
							return async ({ update }) => {
								await update();
								busy = false;
							};
						}}
					>
						<button type="submit" class="btn btn-primary btn-tool" disabled={busy}>
							Tandai diterima &amp; tambah stok
						</button>
					</form>
				{/if}
				<button type="button" class="btn btn-tool" onclick={() => (showCancel = !showCancel)}>
					{p.status === 'dipesan' ? 'Batalkan pesanan' : 'Batalkan pembelian'}
				</button>
			</div>

			{#if showCancel}
				<form
					method="POST"
					action="?/cancel"
					class="space-y-3 border-t border-line pt-3"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							await update();
							busy = false;
						};
					}}
				>
					{#if p.status === 'diterima'}
						<p class="text-xs text-smoke">
							Stok tiap baris di bawah akan dikurangi kembali. Bila sebagian sudah terjual,
							pembatalan ditolak.
						</p>
					{/if}
					<label for="reason" class="label">Alasan (opsional)</label>
					<input id="reason" name="reason" type="text" maxlength="255" />
					<button type="submit" class="btn btn-danger btn-tool" disabled={busy}>
						Ya, batalkan
					</button>
				</form>
			{/if}
		</div>
	{/if}

	<!-- Tabel Item Pembelian -->
	<div class="table-wrap mt-6">
		<table class="data-table">
			<thead>
				<tr>
					<th>Produk</th>
					<th class="text-right">Jumlah</th>
					<th class="text-right">Harga Kulak/Pcs</th>
					<th class="text-right">Subtotal</th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as item (item.id)}
					<tr>
						<td class="font-bold">
							{item.productName}
							{#if item.size}<span class="tag ml-1 font-semibold">{item.size}</span>{/if}
						</td>
						<td class="text-right whitespace-nowrap">{item.quantity} pcs</td>
						<td class="price text-right whitespace-nowrap">{formatRupiah(item.unitCost)}</td>
						<td class="price text-right whitespace-nowrap">
							{formatRupiah(item.quantity * item.unitCost)}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="bg-mist">
					<td
						colspan="3"
						class="px-4 py-3 text-right text-xs font-bold tracking-[0.12em] uppercase"
					>
						Total Biaya Pengadaan
					</td>
					<td class="price px-4 py-3 text-right text-base whitespace-nowrap">
						{formatRupiah(p.totalCost)}
					</td>
				</tr>
			</tfoot>
		</table>
	</div>
</div>
