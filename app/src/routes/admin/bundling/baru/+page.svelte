<script lang="ts">
	import BundleForm from '#lib/components/BundleForm.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Buat Paket Bundling Baru - Admin Downshit</title>
</svelte:head>

<div>
	<Breadcrumb
		home={{ label: 'Admin', href: '/admin' }}
		items={[{ label: 'Bundling', href: '/admin/bundling' }, { label: 'Buat paket' }]}
	/>
	<PageHeader title="Buat paket bundling baru" />

	<div class="mt-6">
		<BundleForm
			mode="create"
			products={data.products}
			{form}
			initial={{
				name: '',
				description: '',
				price: '',
				stock: 20,
				isActive: true,
				items: []
			}}
		/>
	</div>
</div>
