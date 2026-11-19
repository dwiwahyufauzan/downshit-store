<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fade } from 'svelte/transition';
	import Search from '@lucide/svelte/icons/search';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import User from '@lucide/svelte/icons/user';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Settings from '@lucide/svelte/icons/settings';
	import Heart from '@lucide/svelte/icons/heart';
	import type { SessionUser } from '../../app';

	let {
		user,
		cartCount = 0,
		store = { name: 'Downshit Store' }
	}: {
		user: SessionUser | null;
		cartCount?: number;
		store?: { name: string };
	} = $props();

	let menuOpen = $state(false);
	let accountOpen = $state(false);
	let accountEl: HTMLElement | undefined = $state();
	let accountBtn: HTMLButtonElement | undefined = $state();
	let searchOpen = $state(false);
	let q = $state('');
	let y = $state(0);
	let innerWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);
	const isMobile = $derived(innerWidth < 768);

	const isStaff = $derived(user?.role === 'admin' || user?.role === 'owner');
	const pathname = $derived(page.url.pathname);
	const isHome = $derived(pathname === '/');
	const isTransparent = $derived(isHome && y < 50 && !menuOpen && !searchOpen);

	const shopLinks = [
		{ name: 'Shop', href: '/produk' },
		{ name: 'Bundling', href: '/bundling' }
	];
	const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

	const adminNavLinks = [
		{ label: 'Dashboard', href: '/admin', exact: true },
		{ label: 'Pesanan', href: '/admin/pesanan' },
		{ label: 'Produk', href: '/admin/produk' },
		{ label: 'Kategori', href: '/admin/kategori' },
		{ label: 'Bundling', href: '/admin/bundling' },
		{ label: 'Pembelian', href: '/admin/pembelian' },
		{ label: 'Stok', href: '/admin/stok' },
		{ label: 'Pelanggan', href: '/admin/pelanggan' },
		{ label: 'Pengaturan', href: '/admin/pengaturan' }
	];

	const ownerNavLinks = [
		{ label: 'Dashboard', href: '/owner', exact: true },
		{ label: 'Laporan penjualan', href: '/owner/laporan' },
		{ label: 'Ringkasan stok', href: '/owner/stok' },
		{ label: 'Log aktivitas', href: '/owner/aktivitas' }
	];

	const staffNavItems = $derived(
		user?.role === 'admin' ? adminNavLinks : user?.role === 'owner' ? ownerNavLinks : []
	);

	const isStaffItemActive = (it: { href: string; exact?: boolean }) =>
		it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + '/');

	function submitSearch(e: SubmitEvent) {
		e.preventDefault();
		const term = q.trim();
		searchOpen = false;
		menuOpen = false;
		goto(term ? `/produk?q=${encodeURIComponent(term)}` : '/produk');
	}

	const accountItem =
		'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[12px] font-semibold tracking-[0.14em] uppercase transition-colors hover:bg-mist';

	function toggleAccount() {
		accountOpen = !accountOpen;
		if (accountOpen) {
			searchOpen = false;
			menuOpen = false;
		}
	}

	// Klik di luar menu akun atau tekan Escape menutupnya (Escape mengembalikan fokus ke tombol)
	function onWindowClick(e: MouseEvent) {
		if (accountOpen && accountEl && !accountEl.contains(e.target as Node)) accountOpen = false;
	}
	function onWindowKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && accountOpen) {
			accountOpen = false;
			accountBtn?.focus();
		}
	}

	// Tutup panel saat berpindah halaman
	$effect(() => {
		void pathname;
		menuOpen = false;
		searchOpen = false;
		accountOpen = false;
	});

	// Tutup menu mobile jika viewport membesar ke ukuran desktop
	$effect(() => {
		if (!isMobile && menuOpen) {
			menuOpen = false;
		}
	});

	// Kunci scroll body saat menu mobile dropdown terbuka agar halaman belakang tidak bergeser
	$effect(() => {
		if (typeof document === 'undefined') return;
		const isAnyOpen = isMobile && (menuOpen || searchOpen || accountOpen);
		if (isAnyOpen) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = prev;
			};
		}
	});
</script>

<svelte:window bind:scrollY={y} bind:innerWidth onclick={onWindowClick} onkeydown={onWindowKey} />

{#if isStaff && user}
	<!-- Bar staf: konsisten h-16 dengan beranda, navigasi ada di sidebar, tanpa 'Lihat toko' -->
	<header
		class="theme-dark sticky top-0 z-50 border-b border-line bg-paper/95 text-ink backdrop-blur print:hidden"
	>
		<div class="container-shop grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-4">
			<!-- Kiri: Menu mobile toggle & Portal Badge di desktop -->
			<div class="flex items-center gap-3">
				<button
					type="button"
					class="-ml-2 p-2 text-ink transition-colors md:hidden"
					aria-label={menuOpen ? 'Tutup menu portal' : 'Buka menu portal'}
					aria-expanded={menuOpen}
					onclick={() => (menuOpen = !menuOpen)}
				>
					{#if menuOpen}<X size={22} />{:else}<Menu size={22} />{/if}
				</button>
				<div class="hidden items-center gap-2 md:flex">
					<span
						class="border border-line bg-mist/60 px-2.5 py-1 text-[11px] font-bold tracking-[0.16em] text-smoke uppercase"
					>
						{user.role === 'admin' ? 'Portal Admin' : 'Portal Owner'}
					</span>
				</div>
			</div>

			<!-- Tengah: Logo brand DOWNSHIT konsisten dengan halaman beranda -->
			<a
				href={user.role === 'admin' ? '/admin' : '/owner'}
				class="brand-logo text-center text-2xl tracking-tight text-ink transition-colors sm:text-3xl"
				aria-label="DOWNSHIT {user.role === 'admin' ? 'Admin' : 'Owner'}"
			>
				DOWNSHIT
			</a>

			<!-- Kanan: Info profil & tombol keluar (tanpa "lihat toko") -->
			<div
				class="flex items-center justify-end gap-3 text-xs font-semibold tracking-wider uppercase sm:gap-5"
			>
				<span class="badge border-line text-smoke md:hidden">
					{user.role === 'admin' ? 'Admin' : 'Owner'}
				</span>
				<a
					href="/profil"
					class="hidden items-center gap-1.5 text-smoke transition-colors hover:text-ink sm:inline-flex"
					title="Pengaturan profil"
				>
					<User size={16} />
					<span class="max-w-[140px] truncate">{user.name}</span>
				</a>
				<form method="POST" action="/logout">
					<button
						type="submit"
						class="flex cursor-pointer items-center gap-1.5 text-smoke transition-colors hover:text-danger"
						title="Keluar dari akun"
					>
						<LogOut size={16} />
						<span class="hidden sm:inline">Keluar</span>
					</button>
				</form>
			</div>
		</div>

		<!-- Menu mobile drawer untuk navigasi portal admin & owner -->
		{#if menuOpen}
			<nav
				class="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-b border-line bg-paper text-ink shadow-2xl md:hidden"
				aria-label="Menu portal seluler"
			>
				<div class="container-shop divide-y divide-line/40 py-4">
					<!-- Info akun staf -->
					<div class="flex items-center justify-between pb-3">
						<div>
							<p class="text-xs font-bold tracking-wider text-ink uppercase">{user.name}</p>
							<p class="font-mono text-[11px] text-smoke">{user.email}</p>
						</div>
						<span
							class="border border-line bg-mist/60 px-2 py-0.5 text-[10px] font-bold tracking-widest text-smoke uppercase"
						>
							{user.role}
						</span>
					</div>

					<!-- Navigasi halaman portal -->
					<div class="space-y-1 py-2.5">
						{#each staffNavItems as it (it.href)}
							<a
								href={it.href}
								class="flex items-center justify-between px-3 py-2.5 text-xs font-semibold tracking-[0.14em] uppercase transition-colors {isStaffItemActive(
									it
								)
									? 'bg-ink font-bold text-paper'
									: 'text-smoke hover:bg-mist/40 hover:text-ink'}"
								onclick={() => (menuOpen = false)}
							>
								<span>{it.label}</span>
							</a>
						{/each}
					</div>

					<!-- Link profil & keluar -->
					<div class="flex items-center justify-between pt-3 text-xs">
						<a
							href="/profil"
							class="flex items-center gap-1.5 font-semibold tracking-wider text-smoke uppercase hover:text-ink"
							onclick={() => (menuOpen = false)}
						>
							<Settings size={14} /> Pengaturan profil
						</a>
						<form method="POST" action="/logout">
							<button
								type="submit"
								class="flex cursor-pointer items-center gap-1.5 font-semibold tracking-wider text-danger uppercase"
							>
								<LogOut size={14} /> Keluar
							</button>
						</form>
					</div>
				</div>
			</nav>
		{/if}
	</header>

	{#if menuOpen}
		<!-- Overlay gelap dan blur di mobile saat menu dropdown portal terbuka -->
		<button
			type="button"
			transition:fade={{ duration: 150 }}
			class="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-md md:hidden"
			aria-label="Tutup menu portal"
			tabindex="-1"
			onclick={() => (menuOpen = false)}
		></button>
	{/if}
{:else}
	<div
		class="{isHome
			? 'fixed inset-x-0 top-0 z-50'
			: 'sticky top-0 z-50'} transition-all duration-300"
	>
		<header
			class="transition-all duration-300 {isTransparent
				? 'border-transparent bg-transparent text-white'
				: 'border-b border-line bg-paper/95 text-ink backdrop-blur'}"
		>
			<div class="container-shop grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-4">
				<!-- Kiri: menu -->
				<div class="flex items-center">
					<button
						type="button"
						class="-ml-2 p-2 transition-colors {isTransparent
							? 'text-white'
							: 'text-ink'} md:hidden"
						aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
						aria-expanded={menuOpen}
						onclick={() => (menuOpen = !menuOpen)}
					>
						{#if menuOpen}<X size={22} />{:else}<Menu size={22} />{/if}
					</button>
					<nav class="hidden items-center gap-7 md:flex" aria-label="Utama">
						{#each shopLinks as l (l.href)}
							<a
								href={l.href}
								class="text-[12px] font-semibold tracking-[0.16em] uppercase underline-offset-[10px] hover:underline {isTransparent
									? 'text-white/90 hover:text-white'
									: 'text-ink/90 hover:text-ink'} {isActive(l.href) ? 'underline' : ''}"
							>
								{l.name}
							</a>
						{/each}
						{#if user?.role === 'konsumen'}
							<a
								href="/pesanan"
								class="text-[12px] font-semibold tracking-[0.16em] uppercase underline-offset-[10px] hover:underline {isTransparent
									? 'text-white/90 hover:text-white'
									: 'text-ink/90 hover:text-ink'} {isActive('/pesanan') ? 'underline' : ''}"
							>
								Pesanan
							</a>
						{/if}
					</nav>
				</div>

				<!-- Tengah: logo -->
				<a
					href="/"
					class="brand-logo text-center text-2xl tracking-tight transition-colors sm:text-3xl {isTransparent
						? 'text-white'
						: 'text-ink'}"
					aria-label={store?.name ?? 'Downshit Store'}
				>
					DOWNSHIT
				</a>

				<!-- Kanan: aksi -->
				<div class="flex items-center justify-end gap-1 sm:gap-2">
					<button
						type="button"
						class="p-2 transition-colors hover:opacity-75 {isTransparent
							? 'text-white'
							: 'text-ink'}"
						aria-label="Cari produk"
						aria-expanded={searchOpen}
						onclick={() => (searchOpen = !searchOpen)}
					>
						<Search size={20} />
					</button>

					{#if user}
						<!-- Menu akun: pengaturan profil, sesi login, keluar (logout harus POST, bukan tautan GET) -->
						<div class="relative" bind:this={accountEl}>
							<button
								type="button"
								bind:this={accountBtn}
								class="p-2 transition-colors hover:opacity-75 {isTransparent
									? 'text-white'
									: 'text-ink'}"
								aria-label="Menu akun"
								aria-expanded={accountOpen}
								aria-controls="account-menu"
								onclick={toggleAccount}
							>
								<User size={20} />
							</button>

							{#if accountOpen}
								<div
									id="account-menu"
									class="absolute top-[calc(100%+0.75rem)] right-0 z-50 w-64 border border-ink bg-paper text-ink shadow-2xl"
								>
									<div class="border-b border-line px-4 py-3">
										<p class="truncate text-sm font-bold">{user.name}</p>
										<p class="truncate text-xs text-smoke">{user.email}</p>
									</div>
									<nav class="py-1" aria-label="Akun">
										{#if user.role === 'konsumen'}
											<a
												href="/favorit"
												class={accountItem}
												aria-current={pathname === '/favorit' ? 'page' : undefined}
											>
												<Heart size={16} /> Favorit
											</a>
										{/if}
										<a
											href="/profil"
											class={accountItem}
											aria-current={pathname === '/profil' ? 'page' : undefined}
										>
											<Settings size={16} /> Pengaturan profil
										</a>
										<a
											href="/profil/sesi"
											class={accountItem}
											aria-current={pathname === '/profil/sesi' ? 'page' : undefined}
										>
											<Monitor size={16} /> Sesi login
										</a>
									</nav>
									<form method="POST" action="/logout" class="border-t border-line py-1">
										<button type="submit" class="{accountItem} text-danger">
											<LogOut size={16} /> Keluar
										</button>
									</form>
								</div>
							{/if}
						</div>
					{:else}
						<a
							href="/login"
							class="hidden px-2 text-[12px] font-semibold tracking-[0.16em] uppercase hover:underline sm:inline {isTransparent
								? 'text-white'
								: 'text-ink'}"
						>
							Masuk
						</a>
						<a
							href="/login"
							class="p-2 transition-colors hover:opacity-75 sm:hidden {isTransparent
								? 'text-white'
								: 'text-ink'}"
							aria-label="Masuk"
						>
							<User size={20} />
						</a>
					{/if}

					<a
						href="/keranjang"
						class="relative p-2 transition-colors hover:opacity-75 {isTransparent
							? 'text-white'
							: 'text-ink'}"
						aria-label="Keranjang ({cartCount})"
					>
						<ShoppingBag size={20} />
						{#if cartCount > 0}
							<span
								class="absolute top-0.5 right-0 flex h-4 min-w-4 items-center justify-center px-1 text-[10px] font-bold transition-colors {isTransparent
									? 'bg-white text-ink'
									: 'bg-ink text-paper'}"
							>
								{cartCount}
							</span>
						{/if}
					</a>
				</div>
			</div>

			<!-- Panel pencarian -->
			{#if searchOpen}
				<div class="border-t border-b border-line bg-paper text-ink shadow-2xl">
					<form
						class="container-shop flex items-center gap-3 py-3"
						onsubmit={submitSearch}
						role="search"
					>
						<Search size={18} class="shrink-0 text-smoke" />
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="search"
							bind:value={q}
							placeholder="Cari kaos, hoodie, celana…"
							class="!border-0 bg-transparent !p-0 text-ink !shadow-none placeholder:text-smoke"
							aria-label="Kata kunci"
							autofocus
						/>
						<button type="submit" class="btn btn-sm btn-primary">Cari</button>
					</form>
				</div>
			{/if}

			<!-- Menu mobile -->
			{#if menuOpen}
				<nav
					class="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-b border-line bg-paper text-ink shadow-2xl md:hidden"
					aria-label="Menu seluler"
				>
					<div class="container-shop divide-y divide-line">
						{#each shopLinks as l (l.href)}
							<a href={l.href} class="block py-4 text-sm font-semibold tracking-[0.16em] uppercase">
								{l.name}
							</a>
						{/each}
						{#if user?.role === 'konsumen'}
							<a
								href="/pesanan"
								class="block py-4 text-sm font-semibold tracking-[0.16em] uppercase"
							>
								Pesanan saya
							</a>
							<a
								href="/favorit"
								class="block py-4 text-sm font-semibold tracking-[0.16em] uppercase"
							>
								Favorit
							</a>
						{/if}
						{#if !user}
							<div class="grid grid-cols-2 gap-3 py-4">
								<a href="/login" class="btn btn-block">Masuk</a>
								<a href="/register" class="btn btn-primary btn-block">Daftar</a>
							</div>
						{/if}
					</div>
				</nav>
			{/if}
		</header>
	</div>

	{#if menuOpen || searchOpen || accountOpen}
		<!-- Overlay gelap dan blur di mobile saat menu dropdown / drawer terbuka -->
		<button
			type="button"
			transition:fade={{ duration: 150 }}
			class="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-md md:hidden"
			aria-label="Tutup menu"
			tabindex="-1"
			onclick={() => {
				menuOpen = false;
				searchOpen = false;
				accountOpen = false;
			}}
		></button>
	{/if}
{/if}
