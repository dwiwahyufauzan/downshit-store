<script lang="ts">
	import Activity from '@lucide/svelte/icons/activity';
	import Boxes from '@lucide/svelte/icons/boxes';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Truck from '@lucide/svelte/icons/truck';
	import { page as pageState } from '$app/state';
	import Alert from '$lib/components/Alert.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import { PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABEL } from '$lib/constants';
	import { formatDate, formatRupiah } from '$lib/utils/format';
	import { waktuRelatif } from '$lib/utils/relative-time';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const JENIS = [
		{ id: '', label: 'Semua aktivitas' },
		{ id: 'penjualan', label: 'Penjualan' },
		{ id: 'pembayaran', label: 'Pembayaran' },
		{ id: 'pengiriman', label: 'Pengiriman' },
		{ id: 'pembelian', label: 'Restock pembelian' },
		{ id: 'stok', label: 'Penyesuaian stok' }
	];
	const PSTATUS = [
		{ id: '', label: 'Semua status' },
		{ id: 'menunggu', label: 'Menunggu verifikasi' },
		{ id: 'dikonfirmasi', label: 'Dikonfirmasi' },
		{ id: 'ditolak', label: 'Ditolak' },
		{ id: 'dikembalikan', label: 'Dikembalikan' }
	];

	/** Ikon per jenis aktivitas, dari awalan kode aksi (order.create, payment.confirm, ...) */
	const iconFor = (action: string) => {
		const kind = action.split('.')[0];
		return (
			{
				order: ShoppingCart,
				payment: CreditCard,
				shipment: Truck,
				purchase: PackagePlus,
				stock: Boxes
			}[kind] ?? Activity
		);
	};

	const rangeQs = $derived(`dari=${data.range.dari}&sampai=${data.range.sampai}`);
</script>

<svelte:head>
	<title>Log Aktivitas & Riwayat Transaksi - Owner Store Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Log aktivitas" meta="{data.total} catatan" />

	<!-- Toolbar: tab log + rentang tanggal; baris kedua: filter jenis / status -->
	<div class="border-b border-line py-3">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<nav class="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0" aria-label="Jenis log">
				<a
					href="/owner/aktivitas?tab=aktivitas&{rangeQs}"
					aria-current={data.tab === 'aktivitas' ? 'page' : undefined}
					class="chip {data.tab === 'aktivitas' ? 'chip-on' : ''}"
				>
					Aktivitas sistem
				</a>
				<a
					href="/owner/aktivitas?tab=transaksi&{rangeQs}"
					aria-current={data.tab === 'transaksi' ? 'page' : undefined}
					class="chip {data.tab === 'transaksi' ? 'chip-on' : ''}"
				>
					Transaksi pembayaran
				</a>
			</nav>

			<form method="GET" class="flex flex-wrap items-center gap-2">
				<input type="hidden" name="tab" value={data.tab} />
				{#if data.tab === 'aktivitas' && data.jenis}
					<input type="hidden" name="jenis" value={data.jenis} />
				{/if}
				{#if data.tab === 'transaksi' && data.status}
					<input type="hidden" name="status" value={data.status} />
				{/if}
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
				{#if data.jenis || data.status}
					<a href="/owner/aktivitas?tab={data.tab}&{rangeQs}" class="chip h-8" title="Reset filter">
						Reset
					</a>
				{/if}
			</form>
		</div>

		<nav
			class="mt-2.5 flex items-center gap-1.5 overflow-x-auto border-t border-line/50 pt-2.5"
			aria-label={data.tab === 'aktivitas' ? 'Filter jenis aktivitas' : 'Filter status pembayaran'}
		>
			{#if data.tab === 'aktivitas'}
				{#each JENIS as cat (cat.id)}
					{@const aktif = (data.jenis ?? '') === cat.id}
					<a
						href="/owner/aktivitas?tab=aktivitas&{rangeQs}{cat.id ? `&jenis=${cat.id}` : ''}"
						aria-current={aktif ? 'true' : undefined}
						class="chip {aktif ? 'chip-on' : ''}"
					>
						{cat.label}
					</a>
				{/each}
			{:else}
				{#each PSTATUS as st (st.id)}
					{@const aktif = (data.status ?? '') === st.id}
					<a
						href="/owner/aktivitas?tab=transaksi&{rangeQs}{st.id ? `&status=${st.id}` : ''}"
						aria-current={aktif ? 'true' : undefined}
						class="chip {aktif ? 'chip-on' : ''}"
					>
						{st.label}
					</a>
				{/each}
			{/if}
		</nav>
	</div>

	<div class="space-y-6 pt-6">
		{#if data.range.error}
			<Alert type="error" message={data.range.error} />
		{/if}

		{#if data.tab === 'aktivitas'}
			<!-- TAB 1: Aktivitas sistem -->
			<div class="card">
				{#if data.rows.length === 0}
					<div class="py-12 text-center text-sm text-smoke">
						Aktivitas belum tersedia pada periode yang dipilih.
					</div>
				{:else}
					<ol class="divide-y divide-line">
						{#each data.rows as act (act.id)}
							{@const Icon = iconFor(act.action)}
							<li
								class="flex flex-col gap-2 p-4 text-xs hover:bg-mist/60 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
							>
								<div class="flex min-w-0 gap-3">
									<span
										class="mt-0.5 flex size-8 shrink-0 items-center justify-center border border-line text-smoke"
										aria-hidden="true"
									>
										<Icon size={15} />
									</span>
									<div class="min-w-0 space-y-1.5">
										<div class="flex flex-wrap items-center gap-2">
											<span class="badge badge-muted font-mono">{act.action}</span>
											<span class="font-semibold">{act.actor ?? 'Sistem'}</span>
										</div>
										<p class="text-sm text-smoke">{act.description}</p>
									</div>
								</div>

								<time
									class="shrink-0 font-medium text-smoke"
									datetime={act.at}
									title="{formatDate(act.at)} WIB"
								>
									{waktuRelatif(act.at)}
								</time>
							</li>
						{/each}
					</ol>
				{/if}

				<div class="px-4 pb-4">
					<Pagination
						baseUrl={pageState.url.pathname + pageState.url.search}
						page={data.page}
						totalPages={data.totalPages}
						totalItems={data.total}
						perPage={data.perPage}
					/>
				</div>
			</div>
		{:else}
			<!-- TAB 2: Transaksi pembayaran (satu baris per percobaan upload bukti) -->
			<div class="card">
				<div class="table-wrap border-0">
					<table class="data-table">
						<thead>
							<tr>
								<th>Pesanan</th>
								<th>Pelanggan</th>
								<th class="text-right">Nominal</th>
								<th class="text-center">Status</th>
								<th>Waktu unggah</th>
								<th>Waktu konfirmasi</th>
								<th>Diverifikasi oleh</th>
								<th>Catatan / alasan</th>
							</tr>
						</thead>
						<tbody>
							{#each data.rows as p (p.id)}
								<tr>
									<td class="font-mono font-bold whitespace-nowrap">{p.orderCode}</td>
									<td class="font-medium whitespace-nowrap">{p.customer}</td>
									<td class="text-right font-semibold whitespace-nowrap tabular-nums">
										{formatRupiah(p.amount)}
									</td>
									<td class="text-center">
										<span class="badge {PAYMENT_STATUS_BADGE[p.status] ?? 'badge-muted'}">
											{PAYMENT_STATUS_LABEL[p.status] ?? p.status}
										</span>
									</td>
									<td class="whitespace-nowrap text-smoke">{formatDate(p.uploadedAt)}</td>
									<td class="whitespace-nowrap text-smoke">
										{p.confirmedAt ? formatDate(p.confirmedAt) : '-'}
									</td>
									<td>{p.confirmedBy ?? '-'}</td>
									<td class="min-w-40 text-smoke italic">{p.note ?? '-'}</td>
								</tr>
							{:else}
								<tr>
									<td colspan="8" class="py-10 text-center text-smoke">
										Tidak ada riwayat percobaan pembayaran pada periode ini.
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="px-4 pb-4">
					<Pagination
						baseUrl={pageState.url.pathname + pageState.url.search}
						page={data.page}
						totalPages={data.totalPages}
						totalItems={data.total}
						perPage={data.perPage}
					/>
				</div>
			</div>
		{/if}
	</div>
</div>
