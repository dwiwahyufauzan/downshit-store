<script lang="ts">
	import './layout.css';
	import Navbar from '#lib/components/Navbar.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';

	let { data, children } = $props();

	const isStaffArea = $derived(
		page.url.pathname.startsWith('/admin') || page.url.pathname.startsWith('/owner')
	);
	const isAuthPage = $derived(page.url.pathname === '/login' || page.url.pathname === '/register');
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
</svelte:head>

<div
	class="flex min-h-screen flex-col bg-paper font-sans text-ink {isStaffArea
		? 'theme-dark staff-area'
		: ''}"
>
	{#if !isAuthPage}
		<Navbar user={data.user} cartCount={data.cartCount} store={data.store} />
	{/if}

	<main class="flex-1">
		{@render children()}
	</main>

	{#if !isStaffArea && !isAuthPage}
		<Footer store={data.store} />
	{/if}
</div>
