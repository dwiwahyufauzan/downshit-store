<script lang="ts">
	import Alert from '$lib/components/Alert.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StockBadge from '$lib/components/StockBadge.svelte';
	import { formatRupiah } from '$lib/utils/format';
	import { thumbOf } from '$lib/utils/image';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Tautan filter yang mempertahankan parameter aktif (kategori, kata kunci, stok menipis) */
	function buildHref(opts: { cat?: number | null; q?: string; low?: boolean }) {
		const cat = opts.cat !== undefined ? opts.cat : data.filters.categoryId;
		const q = opts.q !== undefined ? opts.q : data.filters.q;
		const low = opts.low !== undefined ? opts.low : data.filters.lowOnly;
		const parts: string[] = [];
		if (cat) parts.push(`cat=${cat}`);
		if (q) parts.push(`q=${encodeURIComponent(q)}`);
		if (low) parts.push('low=true');
		return parts.length ? `/admin/produk?${parts.join('&')}` : '/admin/produk';
	}

	const activeCategory = $derived(data.categories.find((c) => c.id === data.filters.categoryId));
	const hasFilter = $derived(
		Boolean(data.filters.q || data.filters.categoryId || data.filters.lowOnly)
	);
</script>

<svelte:head>
	<title>Kelola Produk - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Kelola produk" meta="{data.pagination.totalItems} produk">
		{#snippet actions()}
			<a href="/admin/produk/baru" class="btn btn-primary btn-tool">
				<Plus size={12} /> Tambah produk
			</a>
		{/snippet}
	</PageHeader>

	{#if form?.success}
		<div class="mt-6">
			<Alert type="success" message={form.message ?? 'Produk berhasil diperbarui.'} />
		</div>
	{:else if form?.message}
		<div class="mt-6"><Alert type="error" message={form.message} /></div>
	{/if}

	{#if data.totalAll === 0}
		<div class="mt-6">
			<EmptyState
				title="Belum ada produk"
				description="Katalog masih kosong. Tambahkan produk pertama agar bisa dijual."
				actionHref="/admin/produk/baru"
				actionText="Tambah produk"
			/>
		</div>
	{:else}
		<!-- Toolbar: tab kategori di kiri, pencarian di kanan -->
		<div class="border-b border-line py-3">
			<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<nav class="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0" aria-label="Kategori">
					<a
						href={buildHref({ cat: null })}
						class="chip {data.filters.categoryId ? '' : 'chip-on'}"
						aria-current={data.filters.categoryId ? undefined : 'page'}
					>
						Semua
					</a>
					{#each data.categories as cat (cat.id)}
						<a
							href={buildHref({ cat: cat.id })}
							class="chip {data.filters.categoryId === cat.id ? 'chip-on' : ''}"
							aria-current={data.filters.categoryId === cat.id ? 'page' : undefined}
						>
							{cat.name}
						</a>
					{/each}
					<a
						href={buildHref({ low: !data.filters.lowOnly })}
						class="chip ml-2 {data.filters.lowOnly ? 'chip-on' : ''}"
						aria-current={data.filters.lowOnly ? 'true' : undefined}
					>
						Stok menipis (&le; {data.lowStock})
					</a>
				</nav>

				<form method="GET" class="flex flex-wrap items-center gap-2">
					{#if data.filters.categoryId}
						<input type="hidden" name="cat" value={data.filters.categoryId} />
					{/if}
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
							placeholder="Cari nama produk…"
							aria-label="Cari produk"
							class="field-sm pr-7 pl-8 placeholder:text-smoke"
						/>
						{#if data.filters.q}
							<a
								href={buildHref({ q: '' })}
								class="absolute top-1/2 right-2 -translate-y-1/2 text-smoke hover:text-ink"
								aria-label="Hapus kata kunci pencarian"
							>
								<X size={12} />
							</a>
						{/if}
					</div>

					<button type="submit" class="btn btn-primary btn-tool">Filter</button>
					{#if hasFilter}
						<a href="/admin/produk" class="chip h-8" title="Reset filter">Reset</a>
					{/if}
				</form>
			</div>

			{#if hasFilter}
				<div
					class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/50 pt-2 text-[11px]"
				>
					<span class="text-smoke">Filter aktif:</span>
					{#if activeCategory}
						<span class="tag">
							{activeCategory.name}
							<a
								href={buildHref({ cat: null })}
								class="text-smoke hover:text-ink"
								aria-label="Hapus filter kategori"
							>
								<X size={11} />
							</a>
						</span>
					{/if}
					{#if data.filters.q}
						<span class="tag">
							"{data.filters.q}"
							<a
								href={buildHref({ q: '' })}
								class="text-smoke hover:text-ink"
								aria-label="Hapus filter pencarian"
							>
								<X size={11} />
							</a>
						</span>
					{/if}
					{#if data.filters.lowOnly}
						<span class="tag">
							Stok menipis
							<a
								href={buildHref({ low: false })}
								class="text-smoke hover:text-ink"
								aria-label="Hapus filter stok menipis"
							>
								<X size={11} />
							</a>
						</span>
					{/if}
					<a href="/admin/produk" class="ml-1 text-smoke underline hover:text-ink">hapus semua</a>
				</div>
			{/if}
		</div>

		<!-- Tabel produk -->
		<div class="space-y-4 pt-6">
			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Gambar</th>
							<th>Nama &amp; kategori</th>
							<th class="text-right">Harga satuan</th>
							<th>Stok</th>
							<th>Bundling</th>
							<th>Status</th>
							<th class="text-right">Aksi</th>
						</tr>
					</thead>
					<tbody>
						{#if data.products.length === 0}
							<tr>
								<td colspan="7" class="!py-12 text-center text-sm text-smoke">
									Tidak ada produk yang cocok dengan pencarian/filter. Coba ubah atau reset filter.
								</td>
							</tr>
						{:else}
							{#each data.products as prod (prod.id)}
								<tr>
									<td>
										{#if prod.imageUrl}
											<img
												src={thumbOf(prod.imageUrl)}
												alt={prod.name}
												loading="lazy"
												class="h-14 w-12 border border-line object-cover"
											/>
										{:else}
											<div
												class="flex h-14 w-12 items-center justify-center bg-mist text-center text-[10px] leading-tight text-smoke uppercase"
											>
												Tanpa foto
											</div>
										{/if}
									</td>
									<td>
										<div class="font-bold">{prod.name}</div>
										<div class="text-xs text-smoke">
											{prod.categoryName ?? 'Tanpa Kategori'}
										</div>
									</td>
									<td class="price text-right whitespace-nowrap">
										{formatRupiah(prod.price)}
									</td>
									<td>
										<StockBadge stock={prod.stock} lowStockThreshold={data.lowStock} />
										{#if prod.sizes.length > 0}
											<div class="mt-1.5 flex max-w-56 flex-wrap gap-1">
												{#each prod.sizes as sz (sz.label)}
													<span
														class="tag !px-1.5 !py-0.5 tabular-nums {sz.stock === 0
															? '!text-danger'
															: sz.stock <= data.lowStock
																? '!text-warn'
																: ''}"
														title="Ukuran {sz.label}: stok {sz.stock}"
													>
														{sz.label}
														{sz.stock}
													</span>
												{/each}
											</div>
										{/if}
									</td>
									<td>
										{#if prod.isBundleable}
											<span class="badge badge-outline">Paket</span>
										{:else}
											<span class="text-xs text-smoke">-</span>
										{/if}
									</td>
									<td>
										{#if prod.isActive}
											<span class="badge badge-ink">Aktif</span>
										{:else}
											<span class="badge badge-muted">Nonaktif</span>
										{/if}
									</td>
									<td>
										<div class="flex justify-end gap-2">
											<a href="/admin/produk/{prod.id}/edit" class="btn btn-tool">Ubah</a>
											<form
												method="POST"
												action="?/delete"
												onsubmit={(e) => {
													if (
														!confirm(
															`Hapus produk "${prod.name}"? Bila sudah pernah dipesan/dibeli, produk hanya dinonaktifkan agar riwayat tetap aman.`
														)
													)
														e.preventDefault();
												}}
											>
												<input type="hidden" name="id" value={prod.id} />
												<button type="submit" class="btn btn-tool btn-danger-outline">Hapus</button>
											</form>
										</div>
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
	{/if}
</div>
