<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pagination from '#lib/components/Pagination.svelte';
	import TempPasswordCard from '#lib/components/TempPasswordCard.svelte';
	import { formatDate, formatRupiah } from '#lib/utils/format';
	import Search from '@lucide/svelte/icons/search';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Kelola Pelanggan - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Pelanggan" meta="{data.pagination.totalItems} pelanggan" />

	<!-- Toolbar pencarian -->
	<div class="border-b border-line py-3">
		<form method="GET" class="flex flex-wrap items-center gap-2">
			<div class="relative w-full sm:w-72">
				<Search
					size={14}
					class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-smoke"
				/>
				<input
					id="f-q"
					type="search"
					name="q"
					value={data.filters.q}
					placeholder="Nama, email, atau nomor HP…"
					aria-label="Cari pelanggan"
					class="field-sm pl-8 placeholder:text-smoke"
				/>
			</div>
			<button type="submit" class="btn btn-primary btn-tool">Cari</button>
			{#if data.filters.q}
				<a href="/admin/pelanggan" class="chip h-8" title="Reset pencarian">Reset</a>
			{/if}
		</form>
	</div>

	{#if form?.resetSuccess && form.tempPassword}
		<div class="mt-6">
			<TempPasswordCard
				customerName={form.customerName ?? ''}
				tempPassword={form.tempPassword}
				customerPhone={form.customerPhone}
			/>
		</div>
	{/if}

	{#if form?.message && !form.success}
		<div class="mt-6"><Alert type="error" message={form.message} /></div>
	{/if}

	<!-- Tabel Pelanggan -->
	<div class="pt-6">
		{#if data.customers.length === 0}
			<EmptyState
				title={data.totalAll === 0 ? 'Belum ada pelanggan' : 'Tidak ada pelanggan yang cocok'}
				description={data.totalAll === 0
					? 'Pelanggan muncul di sini setelah mendaftar.'
					: 'Coba ubah kata kunci pencarian.'}
				actionUrl={data.filters.q ? '/admin/pelanggan' : undefined}
				actionLabel={data.filters.q ? 'Lihat semua pelanggan' : undefined}
			/>
		{:else}
			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Pelanggan</th>
							<th>No. HP</th>
							<th>Terdaftar</th>
							<th class="text-right">Pesanan</th>
							<th class="text-right">Total Belanja</th>
							<th>Status</th>
							<th class="relative"><span class="sr-only">Aksi</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.customers as cust (cust.id)}
							<tr>
								<td>
									<div class="font-bold">{cust.name}</div>
									<div class="text-xs text-smoke">{cust.email}</div>
								</td>
								<td class="whitespace-nowrap">{cust.phone ?? '-'}</td>
								<td class="text-xs whitespace-nowrap text-smoke">{formatDate(cust.createdAt)}</td>
								<td class="text-right whitespace-nowrap">{cust.orderCount} order</td>
								<td class="price text-right whitespace-nowrap">{formatRupiah(cust.totalSpent)}</td>
								<td>
									{#if cust.isActive}
										<span class="badge badge-ok">Aktif</span>
									{:else}
										<span class="badge badge-danger">Nonaktif</span>
									{/if}
								</td>
								<td class="min-w-56">
									<div class="flex flex-wrap items-center justify-end gap-2">
										<a href="/admin/pelanggan/{cust.id}" class="btn btn-tool">Detail</a>

										<form
											method="POST"
											action="?/toggle"
											onsubmit={(e) => {
												if (
													!confirm(
														`${cust.isActive ? 'Nonaktifkan' : 'Aktifkan'} akun "${cust.name}"?`
													)
												)
													e.preventDefault();
											}}
										>
											<input type="hidden" name="id" value={cust.id} />
											<input type="hidden" name="active" value={String(!cust.isActive)} />
											<button
												type="submit"
												class="btn btn-tool {cust.isActive ? 'btn-danger-outline' : ''}"
											>
												{cust.isActive ? 'Nonaktifkan' : 'Aktifkan'}
											</button>
										</form>

										<form
											method="POST"
											action="?/reset"
											onsubmit={(e) => {
												if (
													!confirm(
														`Reset password untuk "${cust.name}"? Password sementara akan dibuat.`
													)
												)
													e.preventDefault();
											}}
										>
											<input type="hidden" name="id" value={cust.id} />
											<button type="submit" class="btn btn-tool">Reset pass</button>
										</form>
									</div>
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
					/>
				</div>
			{/if}
		{/if}
	</div>
</div>
