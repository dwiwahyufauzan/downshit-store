<script lang="ts">
	import { thumbOf } from '#lib/utils/image';
	import Alert from '#lib/components/Alert.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatRupiah } from '#lib/utils/format';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash';
	import TriangleAlert from '@lucide/svelte/icons/triangle-exclamation-point';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Keranjang Belanja ({data.cart.totalItems}) - Store Downshit</title>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<PageHeader
		title="Keranjang"
		meta={data.cart.items.length > 0 ? `${data.cart.totalItems} item` : undefined}
	>
		{#snippet actions()}
			{#if data.cart.items.length > 0}
				<form method="POST" action="?/kosongkan">
					<button
						type="submit"
						onclick={(e) => {
							if (!confirm('Apakah Anda yakin ingin mengosongkan seluruh keranjang belanja?')) {
								e.preventDefault();
							}
						}}
						class="chip gap-1.5"
					>
						<Trash size={12} /> Kosongkan
					</button>
				</form>
			{/if}
		{/snippet}
	</PageHeader>

	{#if (form?.message && !form.success) || data.hasProblem}
		<div class="mt-6 space-y-3">
			{#if form?.message && !form.success}
				<Alert type="error" message={form.message} />
			{/if}

			{#if data.hasProblem}
				<Alert
					type="warning"
					message="Ada item yang melebihi sisa stok, belum punya ukuran valid, atau sudah tidak tersedia. Sesuaikan jumlah atau hapus item bertanda merah agar bisa lanjut ke checkout."
				/>
			{/if}
		</div>
	{/if}

	{#if data.cart.items.length === 0}
		<div class="mt-6">
			<EmptyState
				title="Keranjang masih kosong"
				description="Belum ada produk atau paket bundling yang ditambahkan. Buka katalog untuk melihat koleksi terbaru."
				actionUrl="/produk"
				actionLabel="Jelajahi produk"
			/>
		</div>
	{:else}
		<div
			class="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_26rem]"
		>
			<!-- Daftar item -->
			<ul class="divide-y divide-line border-b border-line">
				{#each data.cart.items as item (item.id)}
					<li class="flex gap-4 py-5 first:pt-0 sm:gap-6">
						<a
							href={item.isProduct ? `/produk/${item.slug}` : `/bundling/${item.slug}`}
							class="product-media block w-24 shrink-0 sm:w-32"
							tabindex="-1"
							aria-hidden="true"
						>
							{#if item.image}
								<img src={thumbOf(item.image)} alt="" />
							{:else}
								<span
									class="flex h-full w-full items-center justify-center text-[10px] font-bold tracking-[0.14em] text-smoke uppercase"
								>
									{item.isProduct ? 'Produk' : 'Paket'}
								</span>
							{/if}
						</a>

						<div class="flex min-w-0 flex-1 flex-col">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="eyebrow">{item.isProduct ? 'Produk' : 'Paket bundling'}</p>
									<h2 class="mt-1 text-sm font-bold tracking-[0.06em] uppercase">
										<a
											href={item.isProduct ? `/produk/${item.slug}` : `/bundling/${item.slug}`}
											class="hover:underline"
										>
											{item.name}
										</a>
									</h2>
									<p class="price mt-1 text-sm text-smoke">{formatRupiah(item.price)} / pcs</p>
									{#if item.sizeParts.length > 0}
										<p class="mt-1 text-xs font-semibold tracking-[0.08em] uppercase">
											{#if item.isProduct}
												Ukuran {item.size}
											{:else}
												{#each item.sizeParts as part, i (i)}{i > 0 ? ' · ' : ''}{part.name} ({part.size}){/each}
											{/if}
										</p>
									{/if}
								</div>

								<form method="POST" action="?/hapus">
									<input type="hidden" name="itemId" value={item.id} />
									<button
										type="submit"
										class="-mt-2 -mr-2 flex h-10 w-10 items-center justify-center text-smoke transition-colors hover:text-ink"
										aria-label="Hapus {item.name} dari keranjang"
									>
										<Trash size={16} />
									</button>
								</form>
							</div>

							{#if item.problem}
								<div
									class="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-4 border-danger bg-danger-bg px-3 py-2 text-xs font-semibold text-danger"
									role="alert"
								>
									<p class="flex items-start gap-2">
										<TriangleAlert size={14} class="mt-px shrink-0" />
										{#if item.problem === 'nonaktif'}
											Produk ini sudah tidak tersedia dan tidak dihitung. Hapus item ini untuk
											melanjutkan.
										{:else if item.problem === 'ukuran'}
											Ukuran belum dipilih atau sudah tidak tersedia. Hapus item ini lalu pilih
											ukuran di halaman {item.isProduct ? 'produk' : 'paket'}.
										{:else if item.maxStock <= 0}
											Stok habis. Hapus item ini untuk melanjutkan.
										{:else}
											Stok tersedia hanya {item.maxStock} (baris ini tidak dihitung). Kurangi jumlahnya.
										{/if}
									</p>
									{#if item.problem === 'stok' && item.maxStock > 0}
										<form method="POST" action="?/ubah">
											<input type="hidden" name="itemId" value={item.id} />
											<button type="submit" name="qty" value={item.maxStock} class="btn btn-sm">
												Sesuaikan ke {item.maxStock}
											</button>
										</form>
									{/if}
								</div>
							{/if}

							<div class="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
								<form method="POST" action="?/ubah">
									<input type="hidden" name="itemId" value={item.id} />
									<div class="inline-flex items-center border border-ink">
										<button
											type="submit"
											name="qty"
											value={item.quantity - 1}
											disabled={item.quantity <= 1}
											class="flex h-10 w-10 items-center justify-center transition-colors hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink"
											aria-label="Kurangi jumlah"
										>
											<Minus size={14} />
										</button>
										<span
											class="flex h-10 w-11 items-center justify-center border-x border-ink text-sm font-bold tabular-nums"
											aria-label="Jumlah {item.quantity}"
										>
											{item.quantity}
										</span>
										<button
											type="submit"
											name="qty"
											value={item.quantity + 1}
											disabled={item.quantity >= Math.min(item.maxStock, 99)}
											class="flex h-10 w-10 items-center justify-center transition-colors hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink"
											aria-label="Tambah jumlah"
										>
											<Plus size={14} />
										</button>
									</div>
								</form>

								<p class="price text-base">{formatRupiah(item.subtotal)}</p>
							</div>
						</div>
					</li>
				{/each}
			</ul>

			<!-- Ringkasan -->
			<aside class="panel lg:sticky lg:top-24">
				<h2 class="panel-title">Ringkasan belanja</h2>

				<dl class="mt-5 space-y-3 text-sm">
					<div class="flex items-center justify-between gap-4">
						<dt class="text-smoke">
							Subtotal{data.hasProblem
								? ' (tanpa baris bermasalah)'
								: ` (${data.cart.totalItems} item)`}
						</dt>
						<dd class="price">{formatRupiah(data.cart.subtotal)}</dd>
					</div>
					<div class="flex items-center justify-between gap-4">
						<dt class="text-smoke">Estimasi ongkir</dt>
						<dd class="price">{formatRupiah(data.shippingCost)}</dd>
					</div>
				</dl>

				<div class="divider mt-5 flex items-baseline justify-between gap-4 pt-5">
					<span class="text-xs font-bold tracking-[0.14em] uppercase">Total estimasi</span>
					<span class="price text-xl">{formatRupiah(data.estimatedTotal)}</span>
				</div>

				<div class="mt-6">
					{#if data.hasProblem}
						<button type="button" disabled class="btn btn-lg btn-block">
							Perbaiki item bermasalah
						</button>
					{:else}
						<a href="/checkout" class="btn btn-primary btn-lg btn-block">
							Lanjut ke checkout <ArrowRight size={16} />
						</a>
					{/if}
					<a href="/produk" class="btn btn-ghost btn-sm btn-block mt-2">Lanjut belanja</a>
				</div>

				<ul class="mt-6 space-y-1.5 border-t border-line pt-5 text-xs text-smoke">
					<li>Ongkos kirim flat, sama untuk semua tujuan.</li>
					<li>
						Stok ditahan {data.settings.paymentDeadlineHours} jam setelah pesanan dibuat untuk menunggu
						transfer pembayaran.
					</li>
				</ul>
			</aside>
		</div>
	{/if}
</div>
