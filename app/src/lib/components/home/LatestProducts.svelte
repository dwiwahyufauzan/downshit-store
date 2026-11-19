<script lang="ts">
	import ProductCard from '#lib/components/ProductCard.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { PageData } from '../../../routes/$types';

	let { products }: { products: PageData['products'] } = $props();

	/* ---------- Karusel produk terbaru ---------- */
	let shelf: HTMLDivElement | undefined = $state();

	function slideShelf(dir: 1 | -1) {
		if (!shelf) return;
		shelf.scrollBy({ left: dir * shelf.clientWidth * 0.8, behavior: 'smooth' });
	}
</script>

<!-- Produk terbaru -->
<section class="pt-10 sm:pt-14">
	<div class="container-shop mb-6 flex items-end justify-between gap-4">
		<h2 class="section-title">Produk terbaru</h2>
		<div class="flex items-center gap-5">
			<a
				href="/produk"
				class="more link hidden items-center gap-1.5 text-sm font-semibold sm:inline-flex"
			>
				Lihat semua <ArrowRight size={14} class="arrow" />
			</a>
			{#if products.length > 4}
				<div class="hidden lg:flex">
					<button
						type="button"
						class="shelf-btn"
						onclick={() => slideShelf(-1)}
						aria-label="Geser ke kiri"
					>
						<ChevronLeft size={18} />
					</button>
					<button
						type="button"
						class="shelf-btn -ml-px"
						onclick={() => slideShelf(1)}
						aria-label="Geser ke kanan"
					>
						<ChevronRight size={18} />
					</button>
				</div>
			{/if}
		</div>
	</div>

	{#if products.length === 0}
		<div class="container-shop">
			<div class="border border-dashed border-line py-20 text-center text-sm text-smoke">
				Belum ada produk. Segera hadir.
			</div>
		</div>
	{:else}
		<div
			bind:this={shelf}
			class="track flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 sm:scroll-px-6 sm:gap-4 sm:px-6 lg:scroll-px-10 lg:px-10"
		>
			{#each products as p, i (p.id)}
				<div class="w-[62%] shrink-0 snap-start sm:w-[34%] lg:w-[calc((100%-3*1rem)/4.25)]">
					<ProductCard
						href="/produk/{p.slug}"
						name={p.name}
						price={p.price}
						imageUrl={p.imageUrl}
						stock={p.stock}
						label={p.categoryName}
						badge={i < 3 ? 'Baru' : null}
						rating={p.rating}
						reviewCount={p.reviewCount}
					/>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.track {
		scrollbar-width: none;
	}
	.track::-webkit-scrollbar {
		display: none;
	}

	.shelf-btn {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid var(--color-ink);
		transition:
			background-color 0.2s ease,
			color 0.2s ease;
	}
	.shelf-btn:hover {
		background: var(--color-ink);
		color: var(--color-paper);
	}
</style>
