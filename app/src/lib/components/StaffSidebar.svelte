<script lang="ts">
	import { page } from '$app/state';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import Shirt from '@lucide/svelte/icons/shirt';
	import Tag from '@lucide/svelte/icons/tag';
	import Ticket from '@lucide/svelte/icons/ticket';
	import Layers from '@lucide/svelte/icons/layers';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Users from '@lucide/svelte/icons/users';
	import Settings from '@lucide/svelte/icons/settings';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import Activity from '@lucide/svelte/icons/activity';
	import User from '@lucide/svelte/icons/user';

	type Item = { label: string; href: string; badge?: number; exact?: boolean };
	let { title = 'Portal', items = [] }: { title?: string; items?: Item[] } = $props();

	const pathname = $derived(page?.url?.pathname ?? '');
	const isActive = (i: Item) =>
		i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + '/');
</script>

<aside class="w-full shrink-0 md:sticky md:top-24 md:w-60 md:self-start print:hidden">
	<!-- Header menu sidebar di desktop -->
	<div class="mb-3 hidden items-center justify-between md:flex">
		<p class="eyebrow text-smoke">Menu {title}</p>
		<span class="font-mono text-[10px] text-smoke">{(items ?? []).length} menu</span>
	</div>

	<!-- Navigasi sidebar: horizontal scroll di mobile, list vertikal rapi di desktop -->
	<nav
		aria-label="Menu {title}"
		class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2 md:mx-0 md:flex-col md:gap-1 md:px-0 md:pb-0"
	>
		{#each items ?? [] as i (i.href)}
			{@const active = isActive(i)}
			<a
				href={i.href}
				aria-current={active ? 'page' : undefined}
				class="group flex items-center justify-between gap-3 border px-3.5 py-2.5 text-xs font-semibold tracking-[0.12em] whitespace-nowrap uppercase transition-all duration-150 {active
					? 'border-ink bg-ink text-paper shadow-sm'
					: 'border-transparent text-smoke hover:border-line hover:bg-mist/30 hover:text-ink'}"
			>
				<div class="flex min-w-0 items-center gap-2.5">
					{#if i.href === '/admin' || i.href === '/owner'}
						<LayoutDashboard
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('pesanan')}
						<ShoppingBag
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('produk')}
						<Shirt
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('voucher')}
						<Ticket
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('kategori')}
						<Tag
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('bundling')}
						<Layers
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('pembelian')}
						<ShoppingCart
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('stok')}
						<Boxes
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('pelanggan')}
						<Users
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('pengaturan')}
						<Settings
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.endsWith('/profil')}
						<User
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('laporan')}
						<TrendingUp
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else if i.href.includes('aktivitas')}
						<Activity
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{:else}
						<LayoutDashboard
							size={16}
							class="shrink-0 transition-colors {active
								? 'text-paper'
								: 'text-smoke group-hover:text-ink'}"
						/>
					{/if}
					<span class="truncate">{i.label}</span>
				</div>
				{#if i.badge && i.badge > 0}
					<span
						class="shrink-0 bg-sale px-1.5 py-0.5 text-[10px] leading-none font-bold text-paper"
					>
						{i.badge}
					</span>
				{/if}
			</a>
		{/each}
	</nav>

	<!-- Footer status sidebar di desktop -->
	<div class="mt-6 hidden border-t border-line/60 pt-4 md:block">
		<div class="flex items-center gap-2 text-[11px] text-smoke">
			<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-ok"></span>
			<span class="font-mono text-[10px] tracking-wider uppercase">Downshit Ops</span>
		</div>
	</div>
</aside>
