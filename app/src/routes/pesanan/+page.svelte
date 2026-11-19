<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ProductShelf from '#lib/components/ProductShelf.svelte';
	import Pagination from '#lib/components/Pagination.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { page } from '$app/state';
	import { ORDER_STATUS, STATUS_LABEL } from '#lib/constants';
	import { formatDate, formatRupiah } from '#lib/utils/format';
	import { waktuRelatif } from '#lib/utils/relative-time';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Riwayat Pesanan Saya - Store Downshit</title>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<PageHeader title="Riwayat pesanan" meta="{data.pagination.totalItems} pesanan" />

	<!-- Toolbar: tab status -->
	<div class="border-b border-line py-3">
		<nav class="flex items-center gap-1.5 overflow-x-auto" aria-label="Status pesanan">
			<a
				href="/pesanan"
				class="chip {data.filters.status ? '' : 'chip-on'}"
				aria-current={data.filters.status ? undefined : 'page'}
			>
				Semua
			</a>
			{#each ORDER_STATUS as st (st)}
				<a
					href="/pesanan?status={st}"
					class="chip {data.filters.status === st ? 'chip-on' : ''}"
					aria-current={data.filters.status === st ? 'page' : undefined}
				>
					{STATUS_LABEL[st]}
				</a>
			{/each}
		</nav>
	</div>

	<div class="pt-6">
		{#if data.orders.length === 0}
			{#if data.filters.status}
				<EmptyState
					title="Tidak ada pesanan dengan status ini"
					description="Coba pilih status lain atau tampilkan semua pesanan."
					actionUrl="/pesanan"
					actionLabel="Semua pesanan"
				/>
			{:else}
				<EmptyState
					title="Belum ada pesanan"
					description="Kamu belum pernah membuat pesanan. Yuk temukan streetwear favoritmu."
					actionUrl="/produk"
					actionLabel="Mulai belanja"
				/>
			{/if}
		{:else}
			<ul class="divide-y divide-line border-b border-line">
				{#each data.orders as o (o.id)}
					<li>
						<a
							href="/pesanan/{o.code}"
							class="group -mx-1 grid items-center gap-x-6 gap-y-3 px-1 py-5 transition-colors hover:bg-mist sm:-mx-3 sm:grid-cols-[1fr_auto_auto] sm:px-3"
						>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-3">
									<span class="text-sm font-bold tracking-[0.1em] uppercase tabular-nums">
										{o.code}
									</span>
									<StatusBadge status={o.status} />
								</div>
								<p class="mt-1.5 text-xs text-smoke">
									Dipesan {formatDate(o.createdAt)} &middot; {o.itemCount} item
								</p>
								{#if o.status === 'menunggu_pembayaran' && o.expiresAt}
									<p class="mt-1 text-xs font-semibold text-warn">
										Bayar sebelum {formatDate(o.expiresAt)} ({waktuRelatif(o.expiresAt)})
									</p>
								{/if}
							</div>

							<div class="sm:text-right">
								<p class="eyebrow">Total</p>
								<p class="price mt-0.5 text-base">{formatRupiah(o.total)}</p>
							</div>

							<span
								class="hidden items-center gap-1.5 text-xs font-semibold tracking-[0.14em] uppercase sm:inline-flex"
							>
								Detail
								<ArrowRight size={14} class="transition-transform group-hover:translate-x-1" />
							</span>
						</a>
					</li>
				{/each}
			</ul>

			<div class="mt-8">
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

	<!-- Rekomendasi produk -->
	<div class="mt-16 space-y-14 border-t border-line pt-10">
		<ProductShelf
			title="Untukmu"
			items={data.recs.forYou}
			href="/produk"
			hrefLabel="Semua produk"
		/>
		<ProductShelf
			title="Terlaris"
			items={data.recs.bestSellers}
			href="/produk?urut=terlaris"
			showSold
		/>
		<ProductShelf title="Rating tertinggi" items={data.recs.topRated} href="/produk?urut=rating" />
	</div>
</div>
