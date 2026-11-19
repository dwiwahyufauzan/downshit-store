<script lang="ts">
	import { page as pageState } from '$app/state';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pagination from '#lib/components/Pagination.svelte';
	import StockBadge from '#lib/components/StockBadge.svelte';
	import Search from '@lucide/svelte/icons/search';
	import { formatDate, formatRupiah } from '#lib/utils/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Ringkasan Stok Inventaris - Owner Store Downshit</title>
</svelte:head>

<div>
	<!-- Owner hanya membaca; restock lewat menu Pembelian, penyesuaian lewat menu Stok (Admin) -->
	<PageHeader title="Inventaris" meta="{data.summary.total} produk · hanya baca" />

	<!-- Ringkasan -->
	<div class="mt-6 grid grid-cols-2 border-t border-l border-line lg:grid-cols-4">
		<div class="border-r border-b border-line p-4 sm:p-5">
			<span class="eyebrow">Total macam produk</span>
			<p class="display mt-3 text-3xl">{data.summary.total}</p>
			<span class="mt-1 block text-[11px] text-smoke">Item terdaftar di katalog</span>
		</div>

		<div class="border-r border-b border-line p-4 sm:p-5">
			<span class="eyebrow">Stok habis (0 pcs)</span>
			<p class="display mt-3 text-3xl {data.summary.empty > 0 ? 'text-danger' : ''}">
				{data.summary.empty}
			</p>
			<span class="mt-1 block text-[11px] text-smoke">Perlu restock segera</span>
		</div>

		<div class="border-r border-b border-line p-4 sm:p-5">
			<span class="eyebrow">Stok menipis (&le; {data.lowStock})</span>
			<p class="display mt-3 text-3xl {data.summary.low > 0 ? 'text-warn' : ''}">
				{data.summary.low}
			</p>
			<span class="mt-1 block text-[11px] text-smoke">Batas threshold sistem</span>
		</div>

		<div class="border-r border-b border-line p-4 sm:p-5">
			<span class="eyebrow">Valuasi nilai inventaris</span>
			<p class="display mt-3 text-xl break-words sm:text-2xl">
				{formatRupiah(data.summary.inventoryValue)}
			</p>
			<span class="mt-1 block text-[11px] text-smoke">Total nilai stok produk</span>
		</div>
	</div>

	<!-- Toolbar: tab tampilan di kiri, pencarian di kanan -->
	<div class="mt-6 border-b border-line py-3">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<nav
				class="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0"
				aria-label="Tampilan stok"
			>
				<a
					href={data.filters.q
						? `/owner/stok?q=${encodeURIComponent(data.filters.q)}`
						: '/owner/stok'}
					class="chip {data.filters.lowOnly ? '' : 'chip-on'}"
					aria-current={data.filters.lowOnly ? undefined : 'page'}
				>
					Semua
				</a>
				<a
					href="/owner/stok?low=true{data.filters.q
						? `&q=${encodeURIComponent(data.filters.q)}`
						: ''}"
					class="chip {data.filters.lowOnly ? 'chip-on' : ''}"
					aria-current={data.filters.lowOnly ? 'page' : undefined}
				>
					Menipis / habis
				</a>
			</nav>

			<form method="GET" class="flex flex-wrap items-center gap-2">
				{#if data.filters.lowOnly}
					<input type="hidden" name="low" value="true" />
				{/if}
				<div class="relative w-full sm:w-56">
					<Search
						size={14}
						class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-smoke"
					/>
					<input
						type="search"
						name="q"
						value={data.filters.q}
						placeholder="Cari produk…"
						aria-label="Cari produk"
						class="field-sm pr-7 pl-8 placeholder:text-smoke"
					/>
				</div>
				<button type="submit" class="btn btn-primary btn-tool">Filter</button>
				{#if data.filters.q || data.filters.lowOnly}
					<a href="/owner/stok" class="chip h-8" title="Reset filter">Reset</a>
				{/if}
			</form>
		</div>

		{#if data.filters.q}
			<div
				class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/50 pt-2 text-[11px]"
			>
				<span class="text-smoke">Filter aktif:</span>
				<span class="tag">"{data.filters.q}"</span>
			</div>
		{/if}
	</div>

	<!-- Stok produk -->
	<section class="pt-6">
		<h2 class="panel-title mb-3">Stok produk ({data.products.length} item)</h2>
		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>Nama produk</th>
						<th>Kategori</th>
						<th class="text-right">Harga jual</th>
						<th class="text-center">Stok fisik</th>
						<th class="text-right">Nilai total stok</th>
						<th class="text-center">Status</th>
					</tr>
				</thead>
				<tbody>
					{#if data.products.length === 0}
						<tr>
							<td colspan="6" class="py-8 text-center text-smoke">
								Tidak ada produk yang sesuai dengan kriteria filter.
							</td>
						</tr>
					{:else}
						{#each data.products as prod (prod.id)}
							<tr>
								<td class="font-semibold">{prod.name}</td>
								<td class="text-smoke">{prod.category ?? '-'}</td>
								<td class="text-right whitespace-nowrap tabular-nums">{formatRupiah(prod.price)}</td
								>
								<td class="text-center">
									<StockBadge stock={prod.stock} lowStockThreshold={data.lowStock} />
									{#if prod.sizes.length > 0}
										<div class="mt-1.5 flex flex-wrap justify-center gap-1">
											{#each prod.sizes as sz (sz.id)}
												<span
													class="tag tabular-nums {sz.stock === 0
														? 'text-danger'
														: sz.stock <= data.lowStock
															? 'text-warn'
															: ''}"
													title="Ukuran {sz.label}: {sz.stock} pcs"
												>
													{sz.label}
													{sz.stock}
												</span>
											{/each}
										</div>
									{/if}
								</td>
								<td class="text-right font-semibold whitespace-nowrap tabular-nums">
									{formatRupiah(prod.price * prod.stock)}
								</td>
								<td class="text-center">
									<span class="badge {prod.isActive ? 'badge-ok' : 'badge-muted'}">
										{prod.isActive ? 'Aktif' : 'Nonaktif'}
									</span>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Kuota bundling -->
	<section class="pt-8">
		<h2 class="panel-title mb-3">Kuota paket bundling ({data.bundles.length} paket)</h2>
		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>Nama paket bundling</th>
						<th class="text-right">Harga paket</th>
						<th class="text-center">Kuota paket</th>
						<th class="text-center">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each data.bundles as b (b.id)}
						<tr>
							<td class="font-semibold">{b.name}</td>
							<td class="text-right font-semibold whitespace-nowrap tabular-nums">
								{formatRupiah(b.price)}
							</td>
							<td class="text-center tabular-nums">{b.stock} paket</td>
							<td class="text-center">
								<span class="badge {b.isActive ? 'badge-ok' : 'badge-muted'}">
									{b.isActive ? 'Aktif' : 'Nonaktif'}
								</span>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="4" class="py-8 text-center text-smoke">Belum ada paket bundling.</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Riwayat mutasi stok (hanya baca) -->
	<section class="space-y-3 pt-8">
		<h2 class="panel-title">Riwayat mutasi stok ({data.totalMovements} catatan)</h2>
		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>Waktu</th>
						<th>Item</th>
						<th>Tipe</th>
						<th class="text-right">Perubahan</th>
						<th class="text-right">Stok akhir</th>
						<th>Keterangan</th>
						<th>Oleh</th>
					</tr>
				</thead>
				<tbody>
					{#each data.movements as m (m.id)}
						<tr>
							<td class="text-xs whitespace-nowrap text-smoke">{formatDate(m.createdAt)}</td>
							<td class="min-w-40 text-xs font-bold">
								{m.productName ??
									m.bundleName ??
									(m.productId ? `Produk #${m.productId}` : `Bundling #${m.bundleId}`)}
								{#if m.size}<span class="tag ml-1">{m.size}</span>{/if}
							</td>
							<td>
								<span
									class="badge {m.type === 'pembelian'
										? 'badge-info'
										: m.type === 'penjualan'
											? 'badge-outline'
											: m.type === 'pembatalan'
												? 'badge-ok'
												: 'badge-muted'}"
								>
									{m.type}
								</span>
							</td>
							<td
								class="price text-right text-xs {m.quantityChange > 0 ? 'text-ok' : 'text-danger'}"
							>
								{m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
							</td>
							<td class="price text-right text-xs">{m.stockAfter ?? '-'}</td>
							<td class="min-w-48 text-xs text-smoke">{m.note ?? '-'}</td>
							<td class="text-xs text-smoke">{m.actor ?? 'Sistem'}</td>
						</tr>
					{:else}
						<tr>
							<td colspan="7" class="py-10 text-center text-sm text-smoke">
								Belum ada riwayat mutasi stok.
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<Pagination
			baseUrl={pageState.url.pathname + pageState.url.search}
			page={data.page}
			totalPages={data.totalPages}
			totalItems={data.totalMovements}
			perPage={data.perPage}
		/>
	</section>
</div>
