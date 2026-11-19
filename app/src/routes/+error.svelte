<script lang="ts">
	import { page } from '$app/state';

	const titles: Record<number, string> = {
		400: 'Permintaan tidak valid',
		401: 'Silakan masuk dulu',
		403: 'Akses ditolak',
		404: 'Halaman tidak ditemukan',
		405: 'Metode tidak diizinkan',
		413: 'Data terlalu besar',
		429: 'Terlalu banyak permintaan'
	};

	const status = $derived(page.status);
	const title = $derived(titles[status] ?? (status >= 500 ? 'Terjadi kendala' : 'Ada yang salah'));
	const user = $derived((page.data as { user?: { role: 'owner' | 'admin' | 'konsumen' } }).user);
	// Tombol utama: kembali ke halaman utama sesuai peran (staf → dashboard, lainnya → toko)
	const home = $derived(
		user?.role === 'admin' ? '/admin' : user?.role === 'owner' ? '/owner' : '/'
	);
</script>

<svelte:head>
	<title>{status} – {title} – Downshit Store</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="container-shop py-16 sm:py-24">
	<div class="mx-auto max-w-xl text-center">
		<p class="eyebrow">Kesalahan {status}</p>
		<p class="display mt-3 text-[clamp(6rem,24vw,12rem)] leading-none">{status}</p>
		<h1 class="section-title mt-6">{title}</h1>
		<p class="mx-auto mt-4 max-w-md text-sm leading-relaxed text-smoke" role="alert">
			{page.error?.message ?? 'Terjadi kesalahan yang tidak terduga.'}
		</p>
		{#if status >= 500 && page.error?.code}
			<p class="mt-3 text-xs text-smoke">
				Kode kesalahan: <span class="font-semibold tracking-wider text-ink">{page.error.code}</span>
				&middot; sebutkan kode ini bila menghubungi admin.
			</p>
		{/if}

		<div class="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
			{#if status === 401 || (status === 403 && !user)}
				<a
					href="/login?next={encodeURIComponent(page.url.pathname + page.url.search)}"
					class="btn btn-primary"
				>
					Masuk
				</a>
			{:else}
				<a href={home} class="btn btn-primary">
					{user && user.role !== 'konsumen' ? 'Ke dashboard' : 'Kembali ke beranda'}
				</a>
			{/if}
			{#if !user || user.role === 'konsumen'}
				<a href="/produk" class="btn">Lihat produk</a>
			{/if}
		</div>
	</div>
</div>
