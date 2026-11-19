<script lang="ts">
	import StaffSidebar from '#lib/components/StaffSidebar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const items = [
		{ label: 'Dashboard', href: '/owner', exact: true },
		{ label: 'Laporan penjualan', href: '/owner/laporan' },
		{ label: 'Ringkasan stok', href: '/owner/stok' },
		{ label: 'Log aktivitas', href: '/owner/aktivitas' }
	];
</script>

<div class="container-shop flex flex-col gap-6 py-6 md:flex-row md:gap-10 md:py-10">
	<StaffSidebar title="Owner" {items} />
	<div class="min-w-0 flex-1">
		{@render children()}
	</div>
</div>
