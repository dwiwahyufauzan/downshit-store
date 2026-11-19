<script lang="ts">
	import { page as pageState } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	let {
		page = 1,
		currentPage,
		totalPages = 1,
		baseUrl = '',
		totalItems,
		perPage
	}: {
		page?: number;
		currentPage?: number;
		totalPages: number;
		/** Opsional: URL dasar manual; default memakai URL halaman saat ini (query q/filter ikut terbawa, juga saat SSR). */
		baseUrl?: string | URL;
		totalItems?: number;
		perPage?: number;
	} = $props();

	const cur = $derived(currentPage ?? page);

	/** Tautan halaman p dengan SEMUA query lain dipertahankan (hash dibuang, kecuali diberikan lewat baseUrl). */
	function getUrl(p: number) {
		const u = baseUrl ? new URL(String(baseUrl), pageState.url.href) : new URL(pageState.url.href);
		u.searchParams.set('page', String(p));
		return `${u.pathname}${u.search}${u.hash}`;
	}
</script>

{#if totalPages > 1}
	<nav
		class="flex items-center justify-between gap-4 border-t border-line pt-5"
		aria-label="Halaman"
	>
		<p class="text-xs text-smoke">
			Halaman <span class="font-bold text-ink">{cur}</span> / {totalPages}
			{#if totalItems}
				{#if perPage}
					&middot; {Math.min(totalItems, (cur - 1) * perPage + 1)}–{Math.min(
						totalItems,
						cur * perPage
					)} dari {totalItems}
				{:else}
					&middot; {totalItems} data
				{/if}
			{/if}
		</p>
		<div class="flex gap-2">
			{#if cur > 1}
				<a href={getUrl(cur - 1)} class="btn btn-sm"><ArrowLeft size={14} /> Sebelumnya</a>
			{/if}
			{#if cur < totalPages}
				<a href={getUrl(cur + 1)} class="btn btn-sm">Berikutnya <ArrowRight size={14} /></a>
			{/if}
		</div>
	</nav>
{/if}
