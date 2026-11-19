<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ProductCard from '#lib/components/ProductCard.svelte';
	import Seo from '#lib/components/Seo.svelte';
	import { formatRupiah } from '#lib/utils/format';
	import ProductGridSkeleton from '#lib/components/ProductGridSkeleton.svelte';
	import { nav } from '#lib/stores/navigation.svelte';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function buildHref(opts: { q?: string; urut?: string }) {
		const query = opts.q !== undefined ? opts.q : data.filters.q;
		const sort = opts.urut !== undefined ? opts.urut : data.filters.urut;
		const parts: string[] = [];

		if (query) parts.push(`q=${encodeURIComponent(query)}`);
		if (sort && sort !== 'terbaru') parts.push(`urut=${encodeURIComponent(sort)}`);

		return parts.length ? `/bundling?${parts.join('&')}` : '/bundling';
	}

	const hasFilter = $derived(
		Boolean(data.filters.q || (data.filters.urut && data.filters.urut !== 'terbaru'))
	);
</script>

<Seo
	title="Paket Bundling Hemat — Store Downshit Subang"
	description="Dapatkan kombinasi streetwear pilihan Downshit dengan harga bundling lebih hemat. Set kaos, celana, hoodie dengan potongan harga spesial."
/>
<svelte:head>
	<title>Paket Bundling Hemat — Store Downshit Subang</title>
	<meta
		name="description"
		content="Dapatkan kombinasi streetwear pilihan Downshit dengan harga bundling lebih hemat. Set kaos, celana, hoodie dengan potongan harga spesial."
	/>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<PageHeader title="Paket bundling" meta="{data.bundles.length} paket tersedia" />

	<!-- Toolbar: tab katalog di kiri, pencarian & urutan di kanan -->
	<div class="border-b border-line py-3">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<nav class="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0" aria-label="Katalog">
				<a href="/produk" class="chip">Semua produk</a>
				<a href="/bundling" class="chip chip-on" aria-current="page">Paket bundling</a>
			</nav>

			<form method="GET" class="flex flex-wrap items-center gap-2">
				<div class="relative w-full sm:w-56">
					<Search
						size={14}
						class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-smoke"
					/>
					<input
						type="search"
						name="q"
						value={data.filters.q}
						placeholder="Cari paket bundling…"
						aria-label="Cari paket bundling"
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
					<option value="hemat" selected={data.filters.urut === 'hemat'}>Paling Hemat</option>
				</select>

				<button type="submit" class="btn btn-primary btn-tool">Filter</button>

				{#if hasFilter}
					<a href="/bundling" class="chip h-8" title="Reset filter">Reset</a>
				{/if}
			</form>
		</div>

		{#if hasFilter}
			<div
				class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/50 pt-2 text-[11px]"
			>
				<span class="text-smoke">Filter aktif:</span>
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
				{#if data.filters.urut && data.filters.urut !== 'terbaru'}
					<span class="tag">
						Urut: {data.filters.urut}
						<a
							href={buildHref({ urut: 'terbaru' })}
							class="text-smoke hover:text-ink"
							aria-label="Hapus filter urutan"
						>
							<X size={11} />
						</a>
					</span>
				{/if}
				<a href="/bundling" class="ml-1 text-smoke underline hover:text-ink">hapus semua</a>
			</div>
		{/if}
	</div>

	<!-- Grid Produk Bundling -->
	<div class="pt-8">
		{#if nav.slowTo === '/bundling'}
			<ProductGridSkeleton />
		{:else if data.bundles.length === 0}
			<EmptyState
				title="Tidak ada paket bundling ditemukan"
				description={hasFilter
					? 'Coba sesuaikan kata kunci pencarian atau reset filter.'
					: 'Paket bundling sedang dalam persiapan. Sementara itu, lihat dulu katalog produk kami.'}
				actionUrl={hasFilter ? '/bundling' : '/produk'}
				actionLabel={hasFilter ? 'Lihat semua bundling' : 'Lihat katalog produk'}
			/>
		{:else}
			<div class="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
				{#each data.bundles as b (b.id)}
					<ProductCard
						href="/bundling/{b.slug}"
						name={b.name}
						price={b.price}
						oldPrice={b.savings > 0 ? b.normalPrice : null}
						imageUrl={b.imageUrl}
						stock={b.effectiveStock}
						label="Paket {b.totalPieces} item"
						badge={b.savings > 0 ? `Hemat ${formatRupiah(b.savings)}` : null}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>
