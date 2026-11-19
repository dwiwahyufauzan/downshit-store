<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import StockBadge from '#lib/components/StockBadge.svelte';
	import { formatRupiah, formatDate } from '#lib/utils/format';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Admin Dashboard - Store Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Dashboard" />

	<!-- Kartu metrik -->
	<div class="mt-6 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
		<a
			href="/admin/pesanan?status=menunggu_konfirmasi"
			class="group flex flex-col bg-paper p-5 transition-colors hover:bg-mist"
		>
			<div class="flex items-start justify-between gap-2">
				<span class="eyebrow">Perlu konfirmasi</span>
				<ArrowUpRight size={16} class="text-smoke group-hover:text-ink" />
			</div>
			<div class="display mt-4 text-5xl">{data.metrics.toConfirm}</div>
			<p class="mt-3 text-xs text-smoke">Bukti transfer baru diunggah konsumen</p>
		</a>

		<a
			href="/admin/pesanan?status=diproses"
			class="group flex flex-col bg-paper p-5 transition-colors hover:bg-mist"
		>
			<div class="flex items-start justify-between gap-2">
				<span class="eyebrow">Perlu dikirim</span>
				<ArrowUpRight size={16} class="text-smoke group-hover:text-ink" />
			</div>
			<div class="display mt-4 text-5xl">{data.metrics.toShip}</div>
			<p class="mt-3 text-xs text-smoke">Pembayaran terverifikasi, siap dipacking (input resi)</p>
		</a>

		<a
			href="/admin/stok?low=true"
			class="group flex flex-col bg-paper p-5 transition-colors hover:bg-mist"
		>
			<div class="flex items-start justify-between gap-2">
				<span class="eyebrow">Stok menipis / habis</span>
				<ArrowUpRight size={16} class="text-smoke group-hover:text-ink" />
			</div>
			<div class="display mt-4 text-5xl">{data.metrics.low + data.metrics.empty}</div>
			<p class="mt-3 text-xs text-smoke">
				{data.metrics.empty} habis, {data.metrics.low} menipis (&le; {data.lowStock})
			</p>
		</a>

		<div class="flex flex-col bg-paper p-5">
			<span class="eyebrow">Pesanan hari ini</span>
			<div class="display mt-4 text-5xl">{data.metrics.today}</div>
			<p class="mt-3 text-xs text-smoke">Total pesanan dibuat sejak 00:00 WIB</p>
		</div>
	</div>

	<div class="mt-6 grid gap-6 lg:grid-cols-2">
		<!-- Pesanan terbaru -->
		<section class="card min-w-0">
			<div class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
				<h2 class="panel-title">Pesanan terbaru</h2>
				<a href="/admin/pesanan" class="link text-xs font-semibold tracking-[0.14em] uppercase">
					Lihat semua
				</a>
			</div>
			<div class="divide-y divide-line">
				{#if data.recent.length === 0}
					<div class="p-8 text-center text-sm text-smoke">Belum ada pesanan masuk.</div>
				{:else}
					{#each data.recent as o (o.id)}
						<a
							href="/admin/pesanan/{o.code}"
							class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-mist"
						>
							<div class="min-w-0">
								<div class="font-mono text-xs font-bold">{o.code}</div>
								<div class="truncate text-xs text-smoke">
									{o.customer} &bull; {formatDate(o.createdAt)}
								</div>
							</div>
							<div class="shrink-0 text-right">
								<div class="price text-sm">{formatRupiah(o.total)}</div>
								<div class="mt-1"><StatusBadge status={o.status} /></div>
							</div>
						</a>
					{/each}
				{/if}
			</div>
		</section>

		<!-- Stok terendah -->
		<section class="card min-w-0">
			<div class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
				<h2 class="panel-title">Peringatan stok terendah</h2>
				<a href="/admin/stok" class="link text-xs font-semibold tracking-[0.14em] uppercase">
					Kelola stok
				</a>
			</div>
			<div class="divide-y divide-line">
				{#if data.lowest.length === 0}
					<div class="p-8 text-center text-sm text-smoke">Belum ada produk terdaftar.</div>
				{:else}
					{#each data.lowest as prod (prod.id)}
						<div class="flex items-center justify-between gap-3 px-4 py-3">
							<div class="min-w-0">
								<div class="truncate text-sm font-bold">{prod.name}</div>
								<div class="price text-xs text-smoke">{formatRupiah(prod.price)}</div>
								{#if (prod.soldOutSizes?.length ?? 0) > 0 || (prod.lowSizes?.length ?? 0) > 0}
									<div class="mt-1.5 flex flex-wrap gap-1">
										{#each prod.soldOutSizes ?? [] as label (label)}
											<span class="badge badge-danger" title="Ukuran {label} habis"
												>{label} habis</span
											>
										{/each}
										{#each prod.lowSizes ?? [] as s (s.label)}
											<span class="badge badge-warn" title="Ukuran {s.label} menipis">
												{s.label} &middot; {s.stock}
											</span>
										{/each}
									</div>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-3">
								<StockBadge stock={prod.stock} lowStockThreshold={data.lowStock} />
								<a href="/admin/pembelian/baru" class="btn btn-tool">Restock</a>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</section>
	</div>
</div>
