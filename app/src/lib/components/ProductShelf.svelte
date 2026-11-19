<script lang="ts">
	import ProductCard from '#lib/components/ProductCard.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import type { RecProduct } from '#lib/server/recommendations';

	/** Rak rekomendasi: judul + deretan kartu produk (4 kolom di desktop, 2 di mobile). */
	let {
		title,
		items,
		href,
		hrefLabel = 'Lihat semua',
		showSold = false
	}: {
		title: string;
		items: RecProduct[];
		href?: string;
		hrefLabel?: string;
		showSold?: boolean;
	} = $props();
</script>

{#if items.length > 0}
	<section>
		<div class="mb-5 flex items-end justify-between gap-4">
			<h2 class="section-title">{title}</h2>
			{#if href}
				<a {href} class="link inline-flex items-center gap-1.5 text-sm font-semibold">
					{hrefLabel}
					<ArrowRight size={14} />
				</a>
			{/if}
		</div>
		<div class="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
			{#each items as p (p.id)}
				<ProductCard
					href="/produk/{p.slug}"
					name={p.name}
					price={p.price}
					imageUrl={p.imageUrl}
					stock={p.stock}
					label={p.categoryName}
					rating={p.rating}
					reviewCount={p.reviewCount}
					sold={showSold ? p.sold : null}
				/>
			{/each}
		</div>
	</section>
{/if}
