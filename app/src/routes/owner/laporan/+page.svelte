<script lang="ts">
	import Printer from '@lucide/svelte/icons/printer';
	import Download from '@lucide/svelte/icons/download';
	import { page as pageState } from '$app/state';
	import Alert from '$lib/components/Alert.svelte';
	import BarChart from '$lib/components/BarChart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { formatDate, formatRupiah } from '$lib/utils/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const STATUSES = [
		{ id: 'semua', label: 'Semua' },
		{ id: 'diproses', label: 'Diproses' },
		{ id: 'dikirim', label: 'Dikirim' },
		{ id: 'selesai', label: 'Selesai' }
	];

	const chartData = $derived(
		data.daily.map((d) => ({
			label: d.day,
			short: d.day.slice(5),
			value: d.revenue
		}))
	);
</script>

<svelte:head>
	<title>Laporan Penjualan - Owner Store Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Laporan penjualan" meta="{data.total} transaksi">
		{#snippet actions()}
			<div class="flex flex-wrap items-center gap-2 print:hidden">
				<button type="button" onclick={() => window.print()} class="btn btn-tool">
					<Printer size={12} /> Cetak
				</button>
				<a
					href="/owner/laporan/export?dari={data.range.dari}&sampai={data.range
						.sampai}&status={data.status}"
					class="btn btn-primary btn-tool"
				>
					<Download size={12} /> CSV (Excel)
				</a>
				<a
					href="/owner/laporan/export?dari={data.range.dari}&sampai={data.range
						.sampai}&status={data.status}&pemisah=koma"
					class="btn btn-tool"
				>
					CSV (koma)
				</a>
			</div>
		{/snippet}
	</PageHeader>
	<p class="mt-3 hidden text-xs text-smoke print:block">
		Periode {data.range.dari} s/d {data.range.sampai}
	</p>

	<!-- Toolbar: status pesanan di kiri, rentang tanggal (WIB) di kanan -->
	<div class="border-b border-line py-3 print:hidden">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<nav
				class="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0"
				aria-label="Status pesanan"
			>
				{#each STATUSES as st (st.id)}
					<a
						href="/owner/laporan?dari={data.range.dari}&sampai={data.range.sampai}&status={st.id}"
						class="chip {data.status === st.id ? 'chip-on' : ''}"
						aria-current={data.status === st.id ? 'page' : undefined}
					>
						{st.label}
					</a>
				{/each}
			</nav>

			<form method="GET" class="flex flex-wrap items-center gap-2">
				<input type="hidden" name="status" value={data.status} />
				<input
					type="date"
					name="dari"
					value={data.range.dari}
					aria-label="Tanggal dari (WIB)"
					class="field-sm w-auto"
				/>
				<span class="text-xs text-smoke" aria-hidden="true">s/d</span>
				<input
					type="date"
					name="sampai"
					value={data.range.sampai}
					aria-label="Tanggal sampai (WIB)"
					class="field-sm w-auto"
				/>
				<button type="submit" class="btn btn-primary btn-tool">Filter</button>
				{#if pageState.url.search}
					<a href="/owner/laporan" class="chip h-8" title="Reset filter">Reset</a>
				{/if}
			</form>
		</div>
	</div>

	<div class="space-y-6 pt-6">
		{#if data.range.error}
			<Alert type="error" message={data.range.error} />
		{/if}

		{#if data.total === 0}
			<EmptyState
				title="Laporan penjualan belum tersedia"
				description="Belum ada pesanan berstatus diproses, dikirim, atau selesai pada periode {data
					.range.dari} s/d {data.range.sampai}. Ubah rentang tanggal atau status."
			/>
		{:else}
			<!-- Ringkasan -->
			<div class="grid grid-cols-2 border-t border-l border-line lg:grid-cols-5">
				<div class="border-r border-b border-line p-4">
					<span class="eyebrow">Pendapatan penjualan</span>
					<p
						class="display mt-2 text-xl break-words sm:text-2xl lg:text-base lg:break-normal lg:whitespace-nowrap xl:text-lg"
					>
						{formatRupiah(data.summary.revenue)}
					</p>
					<span class="mt-1 block text-[11px] text-smoke">Murni nilai produk</span>
				</div>

				<div class="border-r border-b border-line p-4">
					<span class="eyebrow">Total ongkos kirim</span>
					<p
						class="display mt-2 text-xl break-words sm:text-2xl lg:text-base lg:break-normal lg:whitespace-nowrap xl:text-lg"
					>
						{formatRupiah(data.summary.shipping)}
					</p>
					<span class="mt-1 block text-[11px] text-smoke">Biaya kurir ekspedisi</span>
				</div>

				<div class="border-r border-b border-line p-4">
					<span class="eyebrow">Omzet total</span>
					<p
						class="display mt-2 text-xl break-words sm:text-2xl lg:text-base lg:break-normal lg:whitespace-nowrap xl:text-lg"
					>
						{formatRupiah(data.summary.gross)}
					</p>
					<span class="mt-1 block text-[11px] text-smoke">Pendapatan + ongkir</span>
				</div>

				<div class="border-r border-b border-line p-4">
					<span class="eyebrow">Jumlah pesanan</span>
					<p class="display mt-2 text-xl sm:text-2xl">{data.summary.orders}</p>
					<span class="mt-1 block text-[11px] text-smoke">Pesanan valid</span>
				</div>

				<div class="col-span-2 border-r border-b border-line p-4 lg:col-span-1">
					<span class="eyebrow">Rata-rata nilai barang</span>
					<p
						class="display mt-2 text-xl break-words sm:text-2xl lg:text-base lg:break-normal lg:whitespace-nowrap xl:text-lg"
					>
						{formatRupiah(data.summary.avg)}
					</p>
					<span class="mt-1 block text-[11px] text-smoke">Per transaksi</span>
				</div>
			</div>

			<!-- Grafik -->
			<section class="panel">
				<h2 class="panel-title">Grafik penjualan bersih harian</h2>
				<p class="mt-1 mb-4 text-xs text-smoke">
					Perkembangan nilai penjualan barang per hari WIB.
				</p>
				<BarChart data={chartData} title="Penjualan Harian" format={formatRupiah} />
			</section>

			<div class="grid grid-cols-1 gap-6 lg:grid-cols-5">
				<!-- Terlaris -->
				<section class="panel lg:col-span-3">
					<h2 class="panel-title">10 produk &amp; paket terlaris</h2>
					<p class="mt-1 text-xs text-smoke">
						Total kuantitas barang dan nilai penjualan yang dihasilkan.
					</p>

					<div class="table-wrap mt-4">
						<table class="data-table">
							<thead>
								<tr>
									<th>Item</th>
									<th class="text-center">Tipe</th>
									<th class="text-right">Unit</th>
									<th class="text-right">Pendapatan</th>
								</tr>
							</thead>
							<tbody>
								{#each data.top as t (`${t.type}-${t.productId ?? ''}-${t.bundleId ?? ''}`)}
									<tr>
										<td class="font-semibold">{t.name}</td>
										<td class="text-center">
											<span class="badge {t.type === 'product' ? 'badge-muted' : 'badge-outline'}">
												{t.type === 'product' ? 'Produk' : 'Bundling'}
											</span>
										</td>
										<td class="text-right tabular-nums">{t.qty}</td>
										<td class="text-right font-semibold whitespace-nowrap tabular-nums">
											{formatRupiah(t.revenue)}
										</td>
									</tr>
								{:else}
									<tr>
										<td colspan="4" class="py-8 text-center text-smoke">
											Belum ada penjualan pada periode ini.
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</section>

				<div class="space-y-6 lg:col-span-2">
					<!-- Porsi -->
					<section class="panel">
						<h2 class="panel-title">Pengaruh strategi bundling</h2>
						<p class="mt-1 text-xs text-smoke">
							Komparasi performa omzet paket bundling vs penjualan satuan.
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

					<!-- Unit fisik via bundling -->
					<section class="panel">
						<h2 class="panel-title">Produk fisik terjual lewat bundling</h2>
						<p class="mt-1 text-xs text-smoke">
							Total: <strong class="text-ink">{data.comp.total} unit produk</strong> terdistribusi melalui
							paket.
						</p>

						<div
							class="mt-3 max-h-48 divide-y divide-line overflow-y-auto border-t border-line text-xs"
						>
							{#each data.comp.rows as c (c.productId)}
								<div class="flex items-center justify-between gap-3 py-2">
									<span class="truncate font-medium">{c.name}</span>
									<span class="shrink-0 font-semibold tabular-nums">{c.units} pcs</span>
								</div>
							{/each}
						</div>
					</section>
				</div>
			</div>

			<!-- Tabel transaksi -->
			<section class="panel p-0">
				<div class="border-b border-line p-5 sm:p-6">
					<h2 class="panel-title">Daftar transaksi pesanan ({data.total} data)</h2>
				</div>

				<div class="table-wrap border-0">
					<table class="data-table">
						<thead>
							<tr>
								<th>Kode pesanan</th>
								<th>Tanggal (WIB)</th>
								<th>Pelanggan</th>
								<th>Status</th>
								<th class="text-right">Subtotal</th>
								<th class="text-right">Ongkir</th>
								<th class="text-right">Total omzet</th>
							</tr>
						</thead>
						<tbody>
							{#if data.rows.length === 0}
								<tr>
									<td colspan="7" class="py-10 text-center text-smoke">
										Tidak ada transaksi yang sesuai pada filter ini.
									</td>
								</tr>
							{:else}
								{#each data.rows as row (row.code)}
									<tr>
										<td class="font-mono font-bold whitespace-nowrap">{row.code}</td>
										<td class="whitespace-nowrap text-smoke">{formatDate(row.createdAt)}</td>
										<td class="font-medium">{row.customer}</td>
										<td><StatusBadge status={row.status} /></td>
										<td class="text-right whitespace-nowrap tabular-nums"
											>{formatRupiah(row.subtotal)}</td
										>
										<td class="text-right whitespace-nowrap text-smoke tabular-nums">
											{formatRupiah(row.shipping)}
										</td>
										<td class="text-right font-bold whitespace-nowrap tabular-nums">
											{formatRupiah(row.total)}
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</div>

				<div class="px-5 pb-5 sm:px-6 sm:pb-6 print:hidden">
					<Pagination
						baseUrl={pageState.url.pathname + pageState.url.search}
						page={data.page}
						totalPages={data.totalPages}
						totalItems={data.total}
						perPage={data.perPage}
					/>
				</div>
			</section>
		{/if}

		<!-- Catatan metodologi -->
		<div class="bg-mist p-4 text-xs text-smoke">
			<strong class="text-ink">Catatan metodologi:</strong> Laporan penjualan dihitung berdasarkan waktu
			pembuatan pesanan menurut zona waktu WIB (Asia/Jakarta). Transaksi yang masuk ke dalam perhitungan
			laporan hanyalah pesanan dengan status pembayaran yang sah (Diproses, Dikirim, atau Selesai). Pesanan
			yang dibatalkan tidak dimasukkan ke dalam pendapatan.
		</div>
	</div>
</div>

<style>
	@media print {
		/* Area staf bertema gelap: saat dicetak kembalikan token ke palet terang */
		:global(.theme-dark) {
			--color-ink: #0a0a0a;
			--color-paper: #ffffff;
			--color-mist: #f4f4f1;
			--color-line: #e2e2dd;
			--color-smoke: #6b6b66;
			--color-ok: #14693b;
			--color-ok-bg: #e7f4ec;
			--color-warn: #8a5a00;
			--color-warn-bg: #fdf1d6;
			--color-danger: #b3261e;
			--color-danger-bg: #fce8e6;
			--color-info: #1d4f91;
			--color-info-bg: #e6eefa;
			color-scheme: light;
		}
		:global(:root:has(.staff-area)),
		:global(body) {
			background: #fff;
		}
		:global(table) {
			font-size: 11px;
		}
		:global(tr),
		:global(figure) {
			break-inside: avoid;
		}
		:global(a) {
			text-decoration: none;
			color: inherit;
		}
	}
</style>
