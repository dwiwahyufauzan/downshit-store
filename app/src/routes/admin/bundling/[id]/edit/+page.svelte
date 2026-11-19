<script lang="ts">
	import BundleForm from '#lib/components/BundleForm.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Edit Bundling: {data.bundle.name} - Admin Downshit</title>
</svelte:head>

<div>
	<Breadcrumb
		home={{ label: 'Admin', href: '/admin' }}
		items={[{ label: 'Bundling', href: '/admin/bundling' }, { label: data.bundle.name }]}
	/>
	<PageHeader title="Ubah paket bundling" meta={data.bundle.name} />

	<div class="mt-6">
		{#key data.bundle.id}
			<BundleForm
				mode="edit"
				products={data.products}
				{form}
				initial={{
					name: data.bundle.name,
					description: data.bundle.description ?? '',
					price: data.bundle.price,
					stock: data.bundle.stock,
					isActive: data.bundle.isActive,
					imageUrl: data.bundle.imageUrl,
					items: data.bundleItems
				}}
			/>
		{/key}
	</div>
</div>
