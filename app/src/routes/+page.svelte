<script lang="ts">
	import Seo from '#lib/components/Seo.svelte';
	import WhatsAppShortcut from '#lib/components/WhatsAppShortcut.svelte';
	import BundleShowcase from '#lib/components/home/BundleShowcase.svelte';
	import FeaturedAndCategories from '#lib/components/home/FeaturedAndCategories.svelte';
	import HeroTrain from '#lib/components/home/HeroTrain.svelte';
	import LatestProducts from '#lib/components/home/LatestProducts.svelte';
	import ModelAlbum from '#lib/components/home/ModelAlbum.svelte';
	import StoreContact from '#lib/components/home/StoreContact.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Downshit — Streetwear Lokal Subang</title>
	<meta
		name="description"
		content="Toko online resmi Downshit Subang. Kaos boxy, hoodie, celana, dan paket bundling hemat."
	/>
</svelte:head>
<Seo
	title="Downshit — Streetwear Lokal Subang"
	description="Toko online resmi Downshit Subang. Kaos boxy, hoodie, celana, dan paket bundling hemat."
/>

<!-- Hero: Gerbong Kereta Berjalan Halus (Continuous Train Conveyor) -->
<HeroTrain />

<!-- Produk terbaru -->
<LatestProducts products={data.products} />

<!-- Sorotan + kategori -->
<FeaturedAndCategories products={data.products} categories={data.categories} />

<!-- Bundling -->
<BundleShowcase bundles={data.bundles} />

<!-- Galeri model + lightbox -->
<ModelAlbum />

<!-- Lokasi & kontak -->
<StoreContact store={data.store} />

<!-- Pintasan WhatsApp mengambang untuk beranda pelanggan -->
<WhatsAppShortcut store={data.store} />
