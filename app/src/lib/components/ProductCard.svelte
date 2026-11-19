<script lang="ts">
	import { thumbOf } from '$lib/utils/image';
	import { formatRupiah } from '$lib/utils/format';
	import Star from '@lucide/svelte/icons/star';

	let {
		href,
		name,
		price,
		imageUrl = null,
		stock,
		label = null,
		oldPrice = null,
		badge = null,
		rating = null,
		reviewCount = 0,
		sold = null
	}: {
		href: string;
		name: string;
		price: number;
		imageUrl?: string | null;
		stock: number;
		/** Teks kecil di atas nama (kategori, "Paket 3 item", dll.) */
		label?: string | null;
		/** Harga coret (mis. harga normal bundling) */
		oldPrice?: number | null;
		/** Penanda di pojok foto (mis. "Hemat 20%") */
		badge?: string | null;
		/** Rating rata-rata & jumlah ulasan (kosong bila belum ada ulasan) */
		rating?: number | null;
		reviewCount?: number;
		/** Jumlah terjual (ditampilkan bila diisi, mis. pada rak "Terlaris") */
		sold?: number | null;
	} = $props();

	const soldOut = $derived(stock <= 0);
</script>

<a {href} class="group block">
	<!-- Kotak persegi + object-contain: foto produk ditampilkan utuh (tidak terpotong), berapa pun rasionya -->
	<div class="product-media !aspect-square !bg-transparent [&_img]:!object-contain">
		{#if imageUrl}
			<img src={thumbOf(imageUrl)} alt={name} loading="lazy" />
		{:else}
			<div class="flex h-full w-full items-center justify-center">
				<span class="display text-[clamp(1.5rem,5vw,2.5rem)] text-ink/10">DOWNSHIT</span>
			</div>
		{/if}

		{#if badge && !soldOut}
			<span class="badge badge-sale absolute top-2 left-2">{badge}</span>
		{/if}
		{#if soldOut}
			<div class="absolute inset-0 flex items-end bg-paper/55 p-2">
				<span class="badge badge-ink">Habis</span>
			</div>
		{:else if stock <= 5}
			<span class="badge absolute top-2 right-2 bg-paper text-ink">
				Sisa {stock}
			</span>
		{/if}

		{#if !soldOut}
			<span class="product-quick" aria-hidden="true">
				Lihat produk <span>&rarr;</span>
			</span>
		{/if}
	</div>

	<div class="mt-3 space-y-1">
		{#if label}<p class="eyebrow">{label}</p>{/if}
		<h3
			class="text-[13px] leading-snug font-semibold tracking-wide uppercase group-hover:underline"
		>
			{name}
		</h3>
		<p class="flex items-baseline gap-2 text-sm">
			<span class="price {oldPrice ? 'text-sale' : ''}">{formatRupiah(price)}</span>
			{#if oldPrice && oldPrice > price}
				<span class="price-old text-xs">{formatRupiah(oldPrice)}</span>
			{/if}
		</p>
		{#if (rating !== null && reviewCount > 0) || (sold !== null && sold > 0)}
			<p class="flex items-center gap-2 text-xs text-smoke">
				{#if rating !== null && reviewCount > 0}
					<span class="inline-flex items-center gap-1">
						<Star size={12} class="fill-ink text-ink" />
						<span class="font-semibold text-ink tabular-nums">{rating.toFixed(1)}</span>
						<span class="tabular-nums">({reviewCount})</span>
					</span>
				{/if}
				{#if sold !== null && sold > 0}
					{#if rating !== null && reviewCount > 0}<span aria-hidden="true">&middot;</span>{/if}
					<span class="tabular-nums">{sold} terjual</span>
				{/if}
			</p>
		{/if}
	</div>
</a>
