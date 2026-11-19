<script lang="ts">
	import './layout.css';
	import Navbar from '#lib/components/Navbar.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import Toaster from '#lib/components/Toaster.svelte';
	import ProductDetailSkeleton from '#lib/components/ProductDetailSkeleton.svelte';
	import { navigating, page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { onPageShow, onSubmit } from '#lib/actions/submit-guard';
	import { toast, toastFromForm } from '#lib/stores/toast.svelte';
	import { DETAIL_ROUTES, SLOW_NAV_MS, nav } from '#lib/stores/navigation.svelte';

	let { data, children } = $props();

	const isStaffArea = $derived(
		page.url.pathname.startsWith('/admin') || page.url.pathname.startsWith('/owner')
	);
	const isAuthPage = $derived(page.url.pathname === '/login' || page.url.pathname === '/register');
	// Halaman cetak (nota/label): kertas putih polos tanpa navbar, footer, maupun tema gelap staf
	const isPrintView = $derived(page.route.id?.endsWith('/cetak') ?? false);
	const staffTheme = $derived(isStaffArea && !isPrintView);

	// Tujuan navigasi yang belum selesai setelah SLOW_NAV_MS → bar progres + kerangka (skeleton)
	$effect(() => {
		const to = navigating.to?.route.id ?? null;
		if (!to) {
			nav.slowTo = null;
			return;
		}
		const timer = setTimeout(() => (nav.slowTo = to), SLOW_NAV_MS);
		return () => clearTimeout(timer);
	});
	const detailLoading = $derived(
		nav.slowTo !== null && (DETAIL_ROUTES as readonly string[]).includes(nav.slowTo)
	);

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
	class="flex min-h-screen flex-col bg-paper font-sans text-ink {staffTheme
		? 'theme-dark staff-area'
		: ''}"
>
	{#if !isAuthPage && !isPrintView}
		<Navbar user={data.user} cartCount={data.cartCount} store={data.store} />
	{/if}

	{#if nav.slowTo}
		<div
			class="fixed inset-x-0 top-0 z-[70] h-0.5 bg-ink motion-safe:animate-pulse print:hidden"
			role="progressbar"
			aria-label="Memuat halaman"
		></div>
	{/if}

	<main class="flex-1">
		{#if detailLoading}
			<ProductDetailSkeleton />
		{:else}
			{@render children()}
		{/if}
	</main>

	{#if !isStaffArea && !isAuthPage && !isPrintView}
		<Footer store={data.store} />
	{/if}

	<Toaster />
</div>
