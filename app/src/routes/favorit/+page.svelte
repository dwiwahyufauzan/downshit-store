<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ProductCard from '#lib/components/ProductCard.svelte';
	import { enhanceInPlace } from '#lib/actions/form-enhance';
	import X from '@lucide/svelte/icons/x';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Favorit — Store Downshit</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<PageHeader title="Favorit" meta="{data.items.length} produk" />

	{#if form?.message && !form.success}
		<div class="mt-6"><Alert type="error" message={form.message} /></div>
	{/if}

	<div class="pt-8">
		{#if data.items.length === 0}
			<EmptyState
				title="Belum ada favorit"
				description="Tekan “Simpan ke favorit” di halaman produk untuk menyimpannya di sini."
				actionUrl="/produk"
				actionLabel="Lihat katalog"
			/>
		{:else}
			<div class="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
				{#each data.items as p (p.id)}
					<div>
						<ProductCard
							href="/produk/{p.slug}"
							name={p.name}
							price={p.price}
							imageUrl={p.imageUrl}
							stock={p.stock}
						/>
						<form
							method="POST"
							action="?/hapus"
							class="mt-3"
							use:enhance={enhanceInPlace(() => {})}
						>
							<input type="hidden" name="productId" value={p.id} />
							<button type="submit" class="btn btn-sm btn-block">
								<X size={12} aria-hidden="true" /> Hapus dari favorit
							</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
