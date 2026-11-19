<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { page } from '$app/state';
	import {
		ORDER_STATUS,
		PAYMENT_STATUS_BADGE,
		PAYMENT_STATUS_LABEL,
		STATUS_LABEL
	} from '$lib/constants';
	import { formatRupiah, formatDate } from '$lib/utils/format';
	import X from '@lucide/svelte/icons/x';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Tautan filter yang mempertahankan pencarian & rentang tanggal (q bisa dikosongkan) */
	function buildHref(status: string, q = data.filters.q) {
		const parts: string[] = [];
		if (status) parts.push(`status=${status}`);
		if (q) parts.push(`q=${encodeURIComponent(q)}`);
		if (data.filters.dari) parts.push(`dari=${data.filters.dari}`);
		if (data.filters.sampai) parts.push(`sampai=${data.filters.sampai}`);
		return parts.length ? `/admin/pesanan?${parts.join('&')}` : '/admin/pesanan';
	}

	const hasFilter = $derived(
		Boolean(data.filters.q || data.filters.status || data.filters.dari || data.filters.sampai)
	);
</script>

<svelte:head>
	<title>Kelola Pesanan - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Pesanan masuk" meta="{data.pagination.totalItems} pesanan" />

	<!-- Toolbar: Baris 1 Tab Status, Baris 2 Pencarian & Filter Tanggal -->
	<div class="border-b border-line py-3">
		<!-- Baris 1: Status Pesanan (full width, tidak terpotong) -->
		<nav
			class="flex flex-wrap items-center gap-1.5 border-b border-line/50 pb-3"
			aria-label="Status pesanan"
		>
			<a
				href={buildHref('')}
				class="chip {data.filters.status ? '' : 'chip-on'}"
				aria-current={data.filters.status ? undefined : 'page'}
			>
				Semua
			</a>
			{#each ORDER_STATUS as st (st)}
				<a
					href={buildHref(st)}
					class="chip {data.filters.status === st ? 'chip-on' : ''}"
					aria-current={data.filters.status === st ? 'page' : undefined}
				>
					{STATUS_LABEL[st]}
				</a>
			{/each}
		</nav>

		<!-- Baris 2: Pencarian & Rentang Tanggal -->
		<form method="GET" class="flex flex-col gap-2 pt-3 sm:flex-row sm:flex-wrap sm:items-center">
			{#if data.filters.status}
				<input type="hidden" name="status" value={data.filters.status} />
			{/if}
			<input
				id="f-q"
				type="search"
				name="q"
				value={data.filters.q}
				placeholder="Kode atau nama konsumen…"
				aria-label="Cari kode order atau nama konsumen"
				class="field-sm w-full placeholder:text-smoke sm:w-64 md:w-80"
			/>
			<div class="flex items-center gap-1.5">
				<input
					id="f-dari"
					type="date"
					name="dari"
					value={data.filters.dari}
					aria-label="Dari tanggal"
					class="field-sm w-auto"
				/>
				<span class="text-xs font-medium text-smoke">s/d</span>
				<input
					id="f-sampai"
					type="date"
					name="sampai"
					value={data.filters.sampai}
					aria-label="Sampai tanggal"
					class="field-sm w-auto"
				/>
			</div>
			<div class="flex items-center gap-1.5">
				<button type="submit" class="btn btn-primary btn-tool">Filter</button>
				{#if hasFilter}
					<a href="/admin/pesanan" class="chip h-8" title="Reset filter">Reset</a>
				{/if}
			</div>
		</form>

		{#if data.filters.q || data.filters.dari || data.filters.sampai}
			<div
				class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/50 pt-2 text-[11px]"
			>
				<span class="text-smoke">Filter aktif:</span>
				{#if data.filters.q}
					<span class="tag">
						"{data.filters.q}"
						<a
							href={buildHref(data.filters.status ?? '', '')}
							class="text-smoke hover:text-ink"
							aria-label="Hapus filter pencarian"
						>
							<X size={11} />
						</a>
					</span>
				{/if}
				{#if data.filters.dari || data.filters.sampai}
					<span class="tag">
						{data.filters.dari || '…'} &rarr; {data.filters.sampai || '…'}
					</span>
				{/if}
				<a href="/admin/pesanan" class="ml-1 text-smoke underline hover:text-ink">hapus semua</a>
			</div>
		{/if}
	</div>

	<!-- Tabel Pesanan -->
	<div class="pt-6">
		{#if data.orders.length === 0}
			<EmptyState
				title={hasFilter ? 'Tidak ada pesanan yang sesuai' : 'Belum terdapat transaksi'}
				description={hasFilter
					? 'Coba ubah atau reset filter pencarian.'
					: 'Pesanan akan muncul di sini setelah konsumen checkout.'}
				actionUrl={hasFilter ? '/admin/pesanan' : undefined}
				actionLabel={hasFilter ? 'Lihat semua pesanan' : undefined}
			/>
		{:else}
			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Kode &amp; Tanggal</th>
							<th>Pelanggan / Penerima</th>
							<th class="text-right">Total</th>
							<th>Status</th>
							<th>Pembayaran</th>
							<th class="relative"><span class="sr-only">Aksi</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.orders as o (o.id)}
							<tr class={o.status === 'menunggu_konfirmasi' ? 'bg-warn-bg/40' : ''}>
								<td>
									<div class="font-mono text-xs font-bold">{o.code}</div>
									<div class="text-[11px] text-smoke">{formatDate(o.createdAt)}</div>
								</td>
								<td>
									<div class="font-semibold">{o.recipientName}</div>
									<div class="text-xs text-smoke">Akun: {o.customerName}</div>
								</td>
								<td class="price text-right whitespace-nowrap">
									{formatRupiah(o.total)}
								</td>
								<td>
									<StatusBadge status={o.status} />
								</td>
								<td>
									<span class="badge {PAYMENT_STATUS_BADGE[o.paymentStatus] ?? 'badge-muted'}">
										{#if o.hasProof && o.paymentStatus === 'menunggu'}
											<span class="h-1.5 w-1.5 animate-pulse bg-warn" aria-hidden="true"></span>
										{/if}
										{PAYMENT_STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus}
									</span>
								</td>
								<td class="text-right">
									<a href="/admin/pesanan/{o.code}" class="btn btn-tool">Proses &rarr;</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if data.pagination.totalPages > 1}
				<div class="mt-6">
					<Pagination
						currentPage={data.pagination.page}
						totalPages={data.pagination.totalPages}
						totalItems={data.pagination.totalItems}
						perPage={data.pagination.perPage}
						baseUrl={page.url.pathname + page.url.search}
					/>
				</div>
			{/if}
		{/if}
	</div>
</div>
