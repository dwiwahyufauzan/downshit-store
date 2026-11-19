<script lang="ts">
	import { page as pageState } from '$app/state';
	import Alert from '#lib/components/Alert.svelte';
	import BarChart from '#lib/components/BarChart.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { formatDate, formatRupiah } from '#lib/utils/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const chartData = $derived(
		data.daily.map((d) => ({
			label: d.day,
			short: d.day.slice(5),
			value: d.revenue
		}))
	);
</script>

<svelte:head>
	<title>Dashboard Owner - Store Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Ringkasan bisnis" meta="{data.range.dari} s/d {data.range.sampai}" />

	<!-- Toolbar: rentang tanggal -->
	<div class="border-b border-line py-3">
		<form method="GET" class="flex flex-wrap items-center gap-2">
			<input
				type="date"
				name="dari"
				value={data.range.dari}
				aria-label="Tanggal dari"
				class="field-sm w-auto"
			/>
			<span class="text-xs text-smoke" aria-hidden="true">s/d</span>
			<input
				type="date"
				name="sampai"
				value={data.range.sampai}
				aria-label="Tanggal sampai"
				class="field-sm w-auto"
			/>
			<button type="submit" class="btn btn-primary btn-tool">Filter</button>
			{#if pageState.url.search}
				<a href="/owner" class="chip h-8" title="Kembali ke rentang bawaan">Reset</a>
			{/if}
		</form>
	</div>

	<div class="space-y-6 pt-6">
		{#if data.range.error}
			<Alert type="error" message={data.range.error} />
		{/if}

		<!-- Kartu ringkasan (grid bergaris) -->
		<div class="grid grid-cols-1 border-t border-l border-line sm:grid-cols-2 xl:grid-cols-4">
			<div class="flex flex-col border-r border-b border-line p-5">
				<span class="eyebrow">Pendapatan penjualan</span>
				<p class="display mt-3 text-2xl break-words sm:text-3xl xl:text-2xl">
					{formatRupiah(data.summary.revenue)}
				</p>
				<div class="mt-auto space-y-0.5 border-t border-line pt-3 text-xs text-smoke">
					<p>
						Omzet total: <span class="text-ink tabular-nums"
							>{formatRupiah(data.summary.gross)}</span
						>
					</p>
					<p>
						Ongkir: <span class="text-ink tabular-nums">{formatRupiah(data.summary.shipping)}</span>
					</p>
				</div>
			</div>

			<div class="flex flex-col border-r border-b border-line p-5">
				<span class="eyebrow">Pesanan sukses / diproses</span>
				<p class="display mt-3 text-2xl sm:text-3xl xl:text-2xl">
					{data.summary.orders}
					<span class="text-sm tracking-[0.14em] text-smoke">Pesanan</span>
				</p>
				<div class="mt-auto border-t border-line pt-3 text-xs text-smoke">
					Rata-rata: <span class="text-ink tabular-nums">{formatRupiah(data.summary.avg)}</span> / pesanan
				</div>
			</div>

			<div class="flex flex-col border-r border-b border-line p-5">
				<span class="eyebrow">Unit terjual</span>
				<p class="display mt-3 text-2xl sm:text-3xl xl:text-2xl">
					{data.units}
					<span class="text-sm tracking-[0.14em] text-smoke">Pcs / paket</span>
				</p>
				<div class="mt-auto border-t border-line pt-3 text-xs text-smoke">
					<span class={data.waiting > 0 ? 'font-bold text-warn' : ''}>
						{data.waiting} pesanan menunggu pembayaran / konfirmasi
					</span>
				</div>
			</div>

			<div class="flex flex-col border-r border-b border-line p-5">
				<span class="eyebrow">Status stok gudang</span>
				<div class="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<span class="display text-2xl text-danger sm:text-3xl">{data.stock.habis}</span>
					<span class="text-xs text-smoke">habis</span>
					<span class="display ml-2 text-2xl text-warn sm:text-3xl">{data.stock.menipis}</span>
					<span class="text-xs text-smoke">menipis (&le; {data.stock.threshold})</span>
				</div>
				{#if data.stock.ukuranHabis > 0}
					<p class="mt-2 text-[11px] text-smoke">
						+ {data.stock.ukuranHabis} ukuran habis di produk yang stoknya masih ada
					</p>
				{/if}
				<div class="mt-auto border-t border-line pt-3 text-xs">
					<a href="/owner/stok" class="link font-semibold">Lihat rincian inventaris &rarr;</a>
				</div>
			</div>
		</div>

		<!-- Grafik -->
		<section class="panel">
			<h2 class="panel-title">Tren pendapatan harian</h2>
			<p class="mt-1 mb-4 text-xs text-smoke">
				Grafik penjualan bersih produk per hari menurut Waktu Indonesia Barat.
			</p>
			<BarChart data={chartData} title="Pendapatan Harian" format={formatRupiah} />
		</section>

		<div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
			<!-- Terlaris -->
			<section class="panel lg:col-span-7">
				<h2 class="panel-title">5 produk &amp; paket terlaris periode ini</h2>
				<p class="mt-1 text-xs text-smoke">
					Peringkat berdasarkan kuantitas unit yang dipesan oleh konsumen.
				</p>

				<div class="mt-4 divide-y divide-line border-t border-line">
					{#if data.top.length === 0}
						<p class="py-8 text-center text-sm text-smoke">
							Belum ada data penjualan pada rentang tanggal ini.
						</p>
					{:else}
						{#each data.top as it, idx (`${it.type}-${it.productId ?? ''}-${it.bundleId ?? ''}`)}
							<div class="flex items-center gap-4 py-3">
								<span class="display w-6 shrink-0 text-lg text-smoke">{idx + 1}</span>
								<div class="min-w-0 flex-1">
									<span class="badge {it.type === 'product' ? 'badge-muted' : 'badge-outline'}">
										{it.type === 'product' ? 'Produk' : 'Bundling'}
									</span>
									<p class="mt-1 truncate text-sm font-semibold">{it.name}</p>
									<span class="text-xs text-smoke">{it.qty} unit terjual</span>
								</div>
								<p class="price shrink-0 text-right text-sm">{formatRupiah(it.revenue)}</p>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<div class="space-y-6 lg:col-span-5">
				<!-- Bundling vs satuan -->
				<section class="panel">
					<h2 class="panel-title">Porsi penjualan: bundling vs satuan</h2>
					<p class="mt-1 text-xs text-smoke">
						Kontribusi paket hemat terhadap total pendapatan penjualan.
					</p>

					<div class="mt-4 space-y-4">
						{#each data.split as sp (sp.type)}
							<div>
								<div class="flex items-center justify-between gap-3 text-xs font-semibold">
									<span class="tracking-[0.12em] uppercase">
										{sp.type === 'product' ? 'Produk satuan' : 'Paket bundling'}
									</span>
									<span class="tabular-nums">{sp.share}% ({formatRupiah(sp.revenue)})</span>
								</div>
								<div class="mt-2 h-2 w-full bg-mist">
									<div
										class="h-full {sp.type === 'product' ? 'bg-ink' : 'bg-smoke'}"
										style="width: {sp.share}%"
									></div>
								</div>
								<p class="mt-1 text-xs text-smoke">{sp.qty} unit terjual</p>
							</div>
						{/each}
					</div>
				</section>

				<!-- Pesanan terbaru -->
				<section class="panel">
					<div class="flex items-center justify-between gap-3">
						<h2 class="panel-title">Pesanan terbaru</h2>
						<a href="/owner/laporan" class="link text-xs font-semibold">Semua &rarr;</a>
					</div>

					<div class="mt-3 divide-y divide-line border-t border-line">
						{#each data.recent as o (o.code)}
							<div class="flex items-center justify-between gap-3 py-3 text-xs">
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-2">
										<span class="font-mono font-bold">{o.code}</span>
										<StatusBadge status={o.status} />
									</div>
									<p class="mt-1 text-smoke">{o.customer} &bull; {formatDate(o.createdAt)}</p>
								</div>
								<span class="price shrink-0 text-sm">{formatRupiah(o.total)}</span>
							</div>
						{/each}
					</div>
				</section>
			</div>
		</div>
	</div>
</div>
