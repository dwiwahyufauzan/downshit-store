<script lang="ts">
	import { page } from '$app/state';
	import { absoluteUrl } from '#lib/utils/seo';

	let {
		title,
		description,
		image,
		type = 'website',
		search = ''
	}: {
		title: string;
		description: string;
		/** Path situs (/uploads/..) atau URL penuh; kosong → ikon toko */
		image?: string | null;
		type?: 'website' | 'product';
		/** Query yang ikut kanonik (mis. "?page=2"); selain itu query dibuang agar tidak ada duplikat */
		search?: string;
	} = $props();

	const origin = $derived(page.data.origin ?? page.url.origin);
	const canonical = $derived(absoluteUrl(origin, page.url.pathname) + search);
	const img = $derived(absoluteUrl(origin, image || '/icon-512.png'));
	const siteName = $derived(page.data.store?.name ?? 'Downshit Store');
</script>

<svelte:head>
	<link rel="canonical" href={canonical} />
	<meta property="og:site_name" content={siteName} />
	<meta property="og:locale" content="id_ID" />
	<meta property="og:type" content={type === 'product' ? 'product' : 'website'} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={img} />
	<meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={img} />
</svelte:head>
