<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import { formatRupiah } from '$lib/utils/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Riwayat Pembelian & Restock - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Pembelian & restock" meta="{data.pagination.totalItems} pembelian">
		{#snippet actions()}
			<a href="/admin/pembelian/baru" class="btn btn-primary btn-tool">+ Catat pembelian</a>
		{/snippet}
	</PageHeader>

	<!-- Tabel Pembelian -->
	<div class="space-y-4 pt-6">
		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>Kode</th>
						<th>Tanggal</th>
						<th>Supplier / Konveksi</th>
						<th>Status</th>
						<th class="text-right">Total Biaya Kulak</th>
						<th>Dicatat Oleh</th>
						<th class="relative"><span class="sr-only">Aksi</span></th>
					</tr>
				</thead>
				<tbody>
					{#if data.purchases.length === 0}
						<tr>
							<td colspan="7" class="py-12 text-center text-sm text-smoke">
								Belum ada riwayat pembelian / restock barang masuk.
							</td>
						</tr>
					{:else}
						{#each data.purchases as p (p.id)}
							<tr>
								<td class="font-mono text-xs font-bold">{p.code}</td>
								<td class="whitespace-nowrap">{p.purchaseDate}</td>
								<td>{p.supplierName ?? '-'}</td>
								<td>
									<span
										class="badge {p.status === 'diterima'
											? 'badge-ok'
											: p.status === 'dipesan'
												? 'badge-warn'
												: 'badge-muted'}"
									>
										{p.status}
									</span>
								</td>
								<td class="price text-right whitespace-nowrap">{formatRupiah(p.totalCost)}</td>
								<td class="text-xs text-smoke">{p.adminName ?? 'Admin'}</td>
								<td class="text-right">
									<a href="/admin/pembelian/{p.id}" class="btn btn-tool">Detail &rarr;</a>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>

		{#if data.pagination.totalPages > 1}
			<Pagination
				currentPage={data.pagination.page}
				totalPages={data.pagination.totalPages}
				totalItems={data.pagination.totalItems}
				perPage={data.pagination.perPage}
			/>
		{/if}
	</div>
</div>
