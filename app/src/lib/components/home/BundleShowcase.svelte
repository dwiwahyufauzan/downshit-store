<script lang="ts">
	import ProductCard from '#lib/components/ProductCard.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { reveal } from '#lib/actions/reveal';
	import { thumbOf } from '#lib/utils/image';
	import { formatRupiah } from '#lib/utils/format';
	import type { PageData } from '../../../routes/$types';

	let { bundles }: { bundles: PageData['bundles'] } = $props();
</script>

<!-- Bundling -->
{#if bundles.length > 0}
	<section class="mt-10 bg-mist py-10 sm:mt-14 sm:py-14">
		<div class="container-shop">
			<div class="mb-6 flex items-end justify-between gap-4">
				<h2 class="section-title">Paket bundling</h2>
				<a
					href="/bundling"
					class="more link inline-flex items-center gap-1.5 text-sm font-semibold"
				>
					Semua paket <ArrowRight size={14} class="arrow" />
				</a>
			</div>

			{#if bundles.length <= 2}
				<!-- Sedikit paket: tampil sebagai kartu lebar supaya baris tidak kosong -->
				<div use:reveal class="grid gap-3 md:grid-cols-2">
					{#each bundles as b (b.id)}
						<a
							href="/bundling/{b.slug}"
							class="group grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] border border-ink bg-paper"
						>
							<div class="product-media !aspect-square sm:!aspect-[4/3] md:!aspect-square">
								{#if b.imageUrl}
									<img src={thumbOf(b.imageUrl)} alt={b.name} />
								{:else}
									<div class="flex h-full w-full items-center justify-center">
										<span class="display text-3xl text-ink/10">DOWNSHIT</span>
									</div>
								{/if}
							</div>
							<div class="flex flex-col justify-between gap-6 border-l border-ink p-4 sm:p-5">
								<p class="eyebrow">Paket {b.itemCount} produk</p>
								<div>
									<h3 class="display text-2xl sm:text-3xl">{b.name}</h3>
									<p class="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm">
										<span class="price {b.savings > 0 ? 'text-sale' : ''}"
											>{formatRupiah(b.price)}</span
										>
										{#if b.savings > 0}
											<span class="price-old text-xs">{formatRupiah(b.normalPrice)}</span>
										{/if}
									</p>
									{#if b.savings > 0}
										<p class="badge badge-sale mt-3">Hemat {formatRupiah(b.savings)}</p>
									{/if}
								</div>
							</div>
						</a>
					{/each}
				</div>
			{:else}
				<div
					use:reveal
					class="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4 [&_.product-media]:bg-paper"
				>
					{#each bundles as b (b.id)}
						<ProductCard
							href="/bundling/{b.slug}"
							name={b.name}
							price={b.price}
							oldPrice={b.savings > 0 ? b.normalPrice : null}
							imageUrl={b.imageUrl}
							stock={b.effectiveStock}
							label="Paket {b.itemCount} produk"
							badge={b.savings > 0 ? `Hemat ${formatRupiah(b.savings)}` : null}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</section>
{/if}
