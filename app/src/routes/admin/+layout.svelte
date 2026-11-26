<script lang="ts">
	import StaffSidebar from '#lib/components/StaffSidebar.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const totalBadge = $derived((data?.badge?.konfirmasi ?? 0) + (data?.badge?.proses ?? 0));

	const items = $derived([
		{ label: 'Dashboard', href: '/admin', exact: true },
		{ label: 'Pesanan', href: '/admin/pesanan', badge: totalBadge },
		{ label: 'Produk', href: '/admin/produk' },
		{ label: 'Kategori', href: '/admin/kategori' },
		{ label: 'Bundling', href: '/admin/bundling' },
		{ label: 'Pembelian', href: '/admin/pembelian' },
		{ label: 'Stok', href: '/admin/stok' },
		{ label: 'Voucher', href: '/admin/voucher' },
		{ label: 'Ulasan', href: '/admin/ulasan' },
		{ label: 'Pelanggan', href: '/admin/pelanggan' },
		{ label: 'Pengaturan', href: '/admin/pengaturan' },
		{ label: 'Profil akun', href: '/admin/profil' }
	]);
</script>

<div class="container-shop flex flex-col gap-6 py-6 md:flex-row md:gap-10 md:py-10">
	<StaffSidebar title="Admin" {items} />
	<div class="min-w-0 flex-1">
		{@render children()}
	</div>
</div>
