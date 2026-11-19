<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TempPasswordCard from '#lib/components/TempPasswordCard.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { formatRupiah, formatDate } from '#lib/utils/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let c = $derived(data.customer);
	// Query server me-LEFT JOIN pembayaran/pengiriman, jadi satu pesanan bisa muncul lebih dari sekali.
	let orders = $derived(
		data.orders.filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i)
	);
</script>

<svelte:head>
	<title>Profil Pelanggan: {c.name} - Admin Downshit</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<Breadcrumb
			home={{ label: 'Admin', href: '/admin' }}
			items={[{ label: 'Pelanggan', href: '/admin/pelanggan' }, { label: c.name }]}
		/>
		<PageHeader title={c.name} meta="Terdaftar {formatDate(c.createdAt)}">
			{#snippet actions()}
				<form
					method="POST"
					action="?/toggle"
					onsubmit={(e) => {
						if (!confirm(`${c.isActive ? 'Nonaktifkan' : 'Aktifkan'} akun "${c.name}"?`))
							e.preventDefault();
					}}
				>
					<input type="hidden" name="active" value={String(!c.isActive)} />
					<button type="submit" class="btn btn-tool {c.isActive ? 'btn-danger-outline' : ''}">
						{c.isActive ? 'Nonaktifkan akun' : 'Aktifkan kembali'}
					</button>
				</form>
				<form
					method="POST"
					action="?/reset"
					onsubmit={(e) => {
						if (!confirm(`Reset password untuk "${c.name}"? Password sementara akan dibuat.`))
							e.preventDefault();
					}}
				>
					<button type="submit" class="btn btn-tool">Reset password</button>
				</form>
			{/snippet}
		</PageHeader>
	</div>

	{#if form?.resetSuccess && form.tempPassword}
		<TempPasswordCard
			customerName={form.customerName ?? ''}
			tempPassword={form.tempPassword}
			customerPhone={form.customerPhone}
		/>
	{/if}
	{#if form?.success}
		<Alert type="success" message={form.message ?? 'Perubahan tersimpan.'} />
	{:else if form?.message}
		<Alert type="error" message={form.message} />
	{/if}

	<!-- Info Profil Pelanggan -->
	<dl class="panel grid grid-cols-1 gap-5 sm:grid-cols-2">
		<div>
			<dt class="eyebrow">Email</dt>
			<dd class="mt-1 text-sm font-bold break-all">{c.email}</dd>
		</div>

		<div>
			<dt class="eyebrow">Nomor Telepon</dt>
			<dd class="mt-1 text-sm font-bold">{c.phone ?? '-'}</dd>
		</div>

		<div>
			<dt class="eyebrow">Status Akun</dt>
			<dd class="mt-1.5">
				{#if c.isActive}
					<span class="badge badge-ok">Aktif</span>
				{:else}
					<span class="badge badge-danger">Nonaktif</span>
				{/if}
			</dd>
		</div>

		<div>
			<dt class="eyebrow">Terdaftar Sejak</dt>
			<dd class="mt-1 text-sm">{formatDate(c.createdAt)}</dd>
		</div>

		<div>
			<dt class="eyebrow">Total Belanja (sudah dibayar)</dt>
			<dd class="price mt-1 text-sm font-bold">{formatRupiah(data.totalSpent)}</dd>
		</div>

		<div class="sm:col-span-2">
			<dt class="eyebrow">Alamat Pengiriman Utama</dt>
			<dd class="mt-1 text-sm">{c.address ?? '-'}</dd>
		</div>
	</dl>

	<!-- Riwayat Pesanan Konsumen -->
	<section class="space-y-3">
		<h2 class="panel-title">Riwayat Pesanan ({orders.length} Transaksi)</h2>

		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>Kode Pesanan</th>
						<th>Tanggal</th>
						<th class="text-right">Total Belanja</th>
						<th>Status</th>
						<th class="relative"><span class="sr-only">Aksi</span></th>
					</tr>
				</thead>
				<tbody>
					{#if orders.length === 0}
						<tr>
							<td colspan="5" class="py-10 text-center text-sm text-smoke">
								Pelanggan ini belum pernah melakukan pemesanan.
							</td>
						</tr>
					{:else}
						{#each orders as o (o.id)}
							<tr>
								<td class="font-mono text-xs font-bold">{o.code}</td>
								<td class="text-xs whitespace-nowrap text-smoke">{formatDate(o.createdAt)}</td>
								<td class="price text-right whitespace-nowrap">{formatRupiah(o.total)}</td>
								<td><StatusBadge status={o.status} /></td>
								<td class="text-right">
									<a href="/admin/pesanan/{o.code}" class="btn btn-tool">Detail &rarr;</a>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</section>
</div>
