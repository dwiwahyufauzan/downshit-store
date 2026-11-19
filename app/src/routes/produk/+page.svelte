<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ProductCard from '$lib/components/ProductCard.svelte';
	import { page } from '$app/state';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Tautan kategori & filter yang mempertahankan parameter aktif */
	function buildHref(opts: { kategori?: string; q?: string; urut?: string; page?: number }) {
		const k = opts.kategori !== undefined ? opts.kategori : data.filters.kategori;
		const query = opts.q !== undefined ? opts.q : data.filters.q;
		const sort = opts.urut !== undefined ? opts.urut : data.filters.urut;
		const parts: string[] = [];

		if (k) parts.push(`kategori=${encodeURIComponent(k)}`);
		if (query) parts.push(`q=${encodeURIComponent(query)}`);
		if (sort && sort !== 'terbaru') parts.push(`urut=${encodeURIComponent(sort)}`);
		if (opts.page && opts.page > 1) parts.push(`page=${opts.page}`);

		return parts.length ? `/produk?${parts.join('&')}` : '/produk';
	}

	const activeCategory = $derived(data.categories.find((c) => c.slug === data.filters.kategori));
	const hasFilter = $derived(Boolean(data.filters.q || data.filters.kategori));
</script>

<svelte:head>
	<title>Katalog Produk — Store Downshit Subang</title>
	<meta
		name="description"
		content="Koleksi streetwear otentik dari Downshit Store. Temukan kaos boxy, hoodie, celana, dan aksesoris terbaik."
	/>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<PageHeader
		title={activeCategory ? activeCategory.name : 'Semua produk'}
		meta="{data.pagination.totalItems} produk tersedia"
	/>

	<!-- Toolbar: tab kategori di kiri, pencarian & urutan di kanan -->
	<div class="border-b border-line py-3">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			{#if data.categories.length > 0}
				<nav class="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0" aria-label="Kategori">
					<a
						href={buildHref({ kategori: '', page: 1 })}
						class="chip {data.filters.kategori ? '' : 'chip-on'}"
						aria-current={data.filters.kategori ? undefined : 'page'}
					>
						Semua
					</a>
					{#each data.categories as cat (cat.id)}
						<a
							href={buildHref({ kategori: cat.slug, page: 1 })}
							class="chip {data.filters.kategori === cat.slug ? 'chip-on' : ''}"
							aria-current={data.filters.kategori === cat.slug ? 'page' : undefined}
						>
							{cat.name}
						</a>
					{/each}
					<a href="/bundling" class="chip">Bundling</a>
				</nav>
			{/if}

			<form method="GET" class="flex flex-wrap items-center gap-2">
				{#if data.filters.kategori}
					<input type="hidden" name="kategori" value={data.filters.kategori} />
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
					{#if data.filters.q}
						<a
							href={buildHref({ q: '', page: 1 })}
							class="absolute top-1/2 right-2 -translate-y-1/2 text-smoke hover:text-ink"
							aria-label="Hapus kata kunci pencarian"
						>
							<X size={12} />
						</a>
					{/if}
				</div>

				<select
					id="urut"
					name="urut"
					aria-label="Urutkan"
					class="field-sm"
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				>
					<option value="terbaru" selected={data.filters.urut === 'terbaru'}>Terbaru</option>
					<option value="termurah" selected={data.filters.urut === 'termurah'}>Termurah</option>
					<option value="termahal" selected={data.filters.urut === 'termahal'}>Termahal</option>
					<option value="terlaris" selected={data.filters.urut === 'terlaris'}>Terlaris</option>
					<option value="rating" selected={data.filters.urut === 'rating'}>Rating tertinggi</option>
				</select>

				<button type="submit" class="btn btn-primary btn-tool">Filter</button>

				{#if hasFilter}
					<a href="/produk" class="chip h-8" title="Reset filter">Reset</a>
				{/if}
			</form>
		</div>

		{#if hasFilter}
			<div
				class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/50 pt-2 text-[11px]"
			>
				<span class="text-smoke">Filter aktif:</span>
				{#if data.filters.kategori && activeCategory}
					<span class="tag">
						{activeCategory.name}
						<a
							href={buildHref({ kategori: '', page: 1 })}
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
							href={buildHref({ q: '', page: 1 })}
							class="text-smoke hover:text-ink"
							aria-label="Hapus filter pencarian"
						>
							<X size={11} />
						</a>
					</span>
				{/if}
				<a href="/produk" class="ml-1 text-smoke underline hover:text-ink">hapus semua</a>
			</div>
		{/if}
	</div>

	<!-- Grid Produk -->
	<div class="pt-8">
		{#if data.items.length === 0}
			<EmptyState
				title="Tidak ada produk ditemukan"
				description="Coba sesuaikan kata kunci pencarian atau pilih kategori lainnya."
				actionUrl={hasFilter ? '/produk' : undefined}
				actionLabel={hasFilter ? 'Lihat semua produk' : undefined}
			/>
		{:else}
			<div class="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
				{#each data.items as prod (prod.id)}
					<ProductCard
						href="/produk/{prod.slug}"
						name={prod.name}
						price={prod.price}
						imageUrl={prod.imageUrl}
						stock={prod.stock}
						label={prod.categoryName}
						rating={prod.rating}
						reviewCount={prod.reviewCount}
					/>
				{/each}
			</div>

			<div class="mt-14">
				<Pagination
					page={data.pagination.page}
					totalPages={data.pagination.totalPages}
					totalItems={data.pagination.totalItems}
					perPage={data.pagination.perPage}
					baseUrl={page.url.pathname + page.url.search}
				/>
			</div>
		{/if}
	</div>
</div>
