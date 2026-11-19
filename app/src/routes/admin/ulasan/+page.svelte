<script lang="ts">
	import Alert from '$lib/components/Alert.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Stars from '$lib/components/Stars.svelte';
	import { page } from '$app/state';
	import { formatDate } from '$lib/utils/format';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Tautan filter yang mempertahankan parameter aktif */
	function href(o: { rating?: number; tampil?: string; q?: string }) {
		const rating = o.rating !== undefined ? o.rating : data.filters.rating;
		const tampil = o.tampil !== undefined ? o.tampil : data.filters.tampil;
		const q = o.q !== undefined ? o.q : data.filters.q;
		const parts: string[] = [];
		if (rating) parts.push(`rating=${rating}`);
		if (tampil) parts.push(`tampil=${tampil}`);
		if (q) parts.push(`q=${encodeURIComponent(q)}`);
		return parts.length ? `/admin/ulasan?${parts.join('&')}` : '/admin/ulasan';
	}

	const hasFilter = $derived(Boolean(data.filters.q || data.filters.rating || data.filters.tampil));
</script>

<svelte:head>
	<title>Ulasan Produk - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader
		title="Ulasan produk"
		meta="{data.totalAll} ulasan{data.hiddenCount ? ` · ${data.hiddenCount} disembunyikan` : ''}"
	/>

	<!-- Toolbar: tab status tampil + rating di kiri, pencarian di kanan -->
	<div class="border-b border-line py-3">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<nav
				class="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0"
				aria-label="Filter ulasan"
			>
				<a
					href={href({ tampil: '' })}
					class="chip {data.filters.tampil ? '' : 'chip-on'}"
					aria-current={data.filters.tampil ? undefined : 'page'}>Semua</a
				>
				<a
					href={href({ tampil: '1' })}
					class="chip {data.filters.tampil === '1' ? 'chip-on' : ''}"
					aria-current={data.filters.tampil === '1' ? 'page' : undefined}>Tampil</a
				>
				<a
					href={href({ tampil: '0' })}
					class="chip {data.filters.tampil === '0' ? 'chip-on' : ''}"
					aria-current={data.filters.tampil === '0' ? 'page' : undefined}>Tersembunyi</a
				>
				<span class="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true"></span>
				{#each [5, 4, 3, 2, 1] as star (star)}
					<a
						href={href({ rating: data.filters.rating === star ? 0 : star })}
						class="chip {data.filters.rating === star ? 'chip-on' : ''}"
						aria-label="Rating {star} bintang"
					>
						{star}&#9733;
					</a>
				{/each}
			</nav>

			<form method="GET" class="flex flex-wrap items-center gap-2">
				{#if data.filters.rating}<input
						type="hidden"
						name="rating"
						value={data.filters.rating}
					/>{/if}
				{#if data.filters.tampil}<input
						type="hidden"
						name="tampil"
						value={data.filters.tampil}
					/>{/if}
				<div class="relative w-full sm:w-64">
					<Search
						size={14}
						class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-smoke"
					/>
					<input
						type="search"
						name="q"
						value={data.filters.q}
						placeholder="Cari produk, pembeli, isi ulasan…"
						aria-label="Cari ulasan"
						class="field-sm pr-7 pl-8 placeholder:text-smoke"
					/>
					{#if data.filters.q}
						<a
							href={href({ q: '' })}
							class="absolute top-1/2 right-2 -translate-y-1/2 text-smoke hover:text-ink"
							aria-label="Hapus kata kunci"
						>
							<X size={12} />
						</a>
					{/if}
				</div>
				<button type="submit" class="btn btn-primary btn-tool">Filter</button>
				{#if hasFilter}
					<a href="/admin/ulasan" class="chip h-8" title="Reset filter">Reset</a>
				{/if}
			</form>
		</div>
	</div>

	{#if form?.success}
		<div class="mt-6"><Alert type="success" message={form.message ?? 'Tersimpan.'} /></div>
	{:else if form?.message}
		<div class="mt-6"><Alert type="error" message={form.message} /></div>
	{/if}

	<div class="pt-6">
		{#if data.reviews.length === 0}
			<EmptyState
				title="Tidak ada ulasan"
				description={hasFilter
					? 'Coba ubah atau reset filter.'
					: 'Ulasan muncul setelah pembeli menilai produk dari pesanan yang selesai.'}
				actionUrl={hasFilter ? '/admin/ulasan' : undefined}
				actionLabel={hasFilter ? 'Reset filter' : undefined}
			/>
		{:else}
			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Produk</th>
							<th>Rating</th>
							<th>Ulasan</th>
							<th>Pembeli</th>
							<th>Tanggal</th>
							<th class="text-right">Aksi</th>
						</tr>
					</thead>
					<tbody>
						{#each data.reviews as r (r.id)}
							<tr class={r.isVisible ? '' : 'opacity-60'}>
								<td class="font-bold">
									<a
										href="/produk/{r.productSlug}"
										class="hover:underline"
										target="_blank"
										rel="noopener"
									>
										{r.productName}
									</a>
									<div class="text-xs font-normal text-smoke">{r.orderCode}</div>
								</td>
								<td><Stars value={r.rating} size={13} /></td>
								<td class="max-w-xs text-sm text-smoke">
									{r.comment ?? '—'}
									{#if !r.isVisible}<span class="badge badge-muted ml-1">Tersembunyi</span>{/if}
								</td>
								<td class="text-sm whitespace-nowrap">{r.userName}</td>
								<td class="text-xs whitespace-nowrap text-smoke">{formatDate(r.createdAt)}</td>
								<td class="text-right">
									<form method="POST" action="?/toggle">
										<input type="hidden" name="id" value={r.id} />
										<input type="hidden" name="visible" value={r.isVisible ? '0' : '1'} />
										<button type="submit" class="btn btn-tool">
											{r.isVisible ? 'Sembunyikan' : 'Tampilkan'}
										</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="mt-6">
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
