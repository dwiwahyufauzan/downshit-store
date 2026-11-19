<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatRupiah } from '#lib/utils/format';
	import { thumbOf } from '#lib/utils/image';
	import Plus from '@lucide/svelte/icons/plus';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Kelola Bundling - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Kelola paket bundling" meta="{data.bundles.length} paket">
		{#snippet actions()}
			<a href="/admin/bundling/baru" class="btn btn-primary btn-tool">
				<Plus size={12} /> Buat paket bundling
			</a>
		{/snippet}
	</PageHeader>

	{#if form?.success}
		<div class="mt-6">
			<Alert type="success" message={form.message ?? 'Paket bundling berhasil diperbarui.'} />
		</div>
	{:else if form?.message}
		<div class="mt-6"><Alert type="error" message={form.message} /></div>
	{/if}

	<!-- Daftar bundling -->
	{#if data.bundles.length === 0}
		<div class="mt-6">
			<EmptyState
				title="Belum ada paket bundling"
				description="Buat paket hemat dari minimal 2 produk yang diizinkan masuk bundling."
				actionHref="/admin/bundling/baru"
				actionText="Buat paket bundling"
			/>
		</div>
	{:else}
		<div class="mt-6 grid gap-6 xl:grid-cols-2">
			{#each data.bundles as b (b.id)}
				<div class="card flex flex-col justify-between">
					<div class="p-5">
						<div class="flex items-start justify-between gap-4">
							<div class="flex min-w-0 items-center gap-4">
								{#if b.imageUrl}
									<img
										src={thumbOf(b.imageUrl)}
										alt={b.name}
										loading="lazy"
										class="h-20 w-16 shrink-0 border border-line object-cover"
									/>
								{:else}
									<div
										class="flex h-20 w-16 shrink-0 items-center justify-center bg-mist text-center text-[10px] leading-tight text-smoke uppercase"
									>
										Tanpa foto
									</div>
								{/if}
								<div class="min-w-0">
									<h2 class="text-base font-bold tracking-[0.04em] uppercase">{b.name}</h2>
									<div class="mt-2 flex flex-wrap items-center gap-2">
										{#if b.isActive}
											<span class="badge badge-ink">Aktif</span>
										{:else}
											<span class="badge badge-muted">Nonaktif</span>
										{/if}
										{#if b.savings > 0}
											<span class="badge badge-sale">Hemat {formatRupiah(b.savings)}</span>
										{:else}
											<span class="badge badge-warn">Tidak hemat</span>
										{/if}
									</div>
								</div>
							</div>

							<div class="shrink-0 text-right">
								<div class="price text-lg">{formatRupiah(b.price)}</div>
								{#if b.normalPrice > b.price}
									<div class="price-old text-xs">{formatRupiah(b.normalPrice)}</div>
								{/if}
							</div>
						</div>

						<!-- Komponen produk -->
						<div class="mt-5 bg-mist p-3">
							<p class="eyebrow">Komponen paket ({b.items.length} produk)</p>
							<ul class="mt-2 space-y-1 text-xs">
								{#each b.items as item (item.productId)}
									<li class="flex items-center justify-between gap-3">
										<span>&bull; {item.productName} ({item.quantity}x)</span>
										<span class="shrink-0 text-smoke">Stok fisik: {item.productStock}</span>
									</li>
								{/each}
							</ul>
						</div>

						<!-- Kuota vs stok efektif -->
						<div class="mt-4 grid grid-cols-2 gap-px border border-line bg-line">
							<div class="bg-paper p-3">
								<p class="eyebrow">Kuota alokasi admin</p>
								<p class="display mt-1 text-2xl">
									{b.stock} <span class="eyebrow">unit</span>
								</p>
							</div>
							<div class="bg-paper p-3">
								<p class="eyebrow">Stok efektif dijual</p>
								<p class="display mt-1 text-2xl">
									{b.effectiveStock} <span class="eyebrow">unit</span>
								</p>
							</div>
						</div>

						{#if b.unavailable.length > 0}
							<div
								class="mt-3 border-l-4 border-danger bg-danger-bg p-2 text-xs font-medium text-danger"
							>
								Komponen nonaktif: {b.unavailable.join(', ')}. Paket ini tidak bisa dibeli sampai
								komponen diaktifkan kembali atau diganti.
							</div>
						{/if}

						{#if b.stock > b.effectiveStock}
							<div class="mt-3 border-l-4 border-warn bg-warn-bg p-2 text-xs font-medium text-warn">
								Stok paket ({b.stock}) melebihi stok komponen; yang efektif dijual = {b.effectiveStock}.
							</div>
						{/if}
					</div>

					<div class="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
						<span class="truncate font-mono text-xs text-smoke">/{b.slug}</span>
						<div class="flex shrink-0 gap-2">
							<a href="/admin/bundling/{b.id}/edit" class="btn btn-tool">Ubah</a>
							<form
								method="POST"
								action="?/delete"
								onsubmit={(e) => {
									if (
										!confirm(
											`Hapus paket bundling "${b.name}"? Bila sudah punya riwayat pesanan/stok, paket hanya dinonaktifkan.`
										)
									)
										e.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={b.id} />
								<button type="submit" class="btn btn-tool btn-danger-outline">Hapus</button>
							</form>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
