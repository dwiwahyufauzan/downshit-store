<script lang="ts">
	import './layout.css';
	import Navbar from '#lib/components/Navbar.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import Toaster from '#lib/components/Toaster.svelte';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { onPageShow, onSubmit } from '#lib/actions/submit-guard';
	import { toast, toastFromForm } from '#lib/stores/toast.svelte';

	let { data, children } = $props();

	const isStaffArea = $derived(
		page.url.pathname.startsWith('/admin') || page.url.pathname.startsWith('/owner')
	);
	const isAuthPage = $derived(page.url.pathname === '/login' || page.url.pathname === '/register');

	// Hasil form action yang sukses → toast. Satu objek `form` hanya ditampilkan sekali
	// (efek ini juga berjalan ulang saat data lain berubah).
	let shownForm: unknown;
	$effect(() => {
		const form = page.form;
		if (form === shownForm) return;
		shownForm = form;
		const t = toastFromForm(form);
		if (t) toast.success(t.message, { action: t.action });
	});
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
</svelte:head>

<!-- Form POST biasa: tombol nonaktif + "Memproses…" sampai halaman berpindah (anti klik ganda) -->
<svelte:document onsubmit={onSubmit} />
<svelte:window onpageshow={onPageShow} />

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

	<Toaster />
</div>
