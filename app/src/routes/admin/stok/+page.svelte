<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pagination from '#lib/components/Pagination.svelte';
	import StockBadge from '#lib/components/StockBadge.svelte';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { formatRupiah, formatDate } from '#lib/utils/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type SizeOpt = { label: string; stock: number };
	let adjustingItem = $state<{
		kind: 'product' | 'bundle';
		id: number;
		name: string;
		stock: number;
		sizes: SizeOpt[];
	} | null>(null);

	let sizeInput = $state<string>('');
	let newStockInput = $state<number>(0);
	let noteInput = $state<string>('');

	// Stok tercatat yang disesuaikan: stok ukuran terpilih (produk ber-ukuran) atau stok item
	const currentStock = $derived(
		adjustingItem && adjustingItem.sizes.length > 0
			? (adjustingItem.sizes.find((s) => s.label === sizeInput)?.stock ?? 0)
			: (adjustingItem?.stock ?? 0)
	);
	const needSize = $derived((adjustingItem?.sizes.length ?? 0) > 0);

	function openAdjust(
		kind: 'product' | 'bundle',
		id: number,
		name: string,
		stock: number,
		sizes: SizeOpt[] = []
	) {
		adjustingItem = { kind, id, name, stock, sizes };
		sizeInput = '';
		newStockInput = sizes.length > 0 ? 0 : stock;
		noteInput = '';
	}

	function closeAdjust() {
		adjustingItem = null;
		sizeInput = '';
		newStockInput = 0;
		noteInput = '';
	}

	// Pilih ukuran → isian stok baru mulai dari stok ukuran itu
	function onSizeChange() {
		newStockInput = currentStock;
	}

	let busy = $state(false);

	// Gagal (validasi/server): buka lagi dialog dengan isian terakhir supaya pesan galat terlihat
	$effect(() => {
		const v = form?.values as
			{ kind?: string; id?: string; size?: string; newStock?: string; note?: string } | undefined;
		if (form && !form.success && v?.kind && v.id) {
			const id = Number(v.id);
			const found =
				v.kind === 'bundle'
					? data.overview.bundles.find((b) => b.id === id)
					: data.overview.products.find((p) => p.id === id);
			if (found && !untrack(() => adjustingItem)) {
				adjustingItem = {
					kind: v.kind as 'product' | 'bundle',
					id,
					name: found.name,
					stock: found.stock,
					sizes: 'sizes' in found ? found.sizes : []
				};
				sizeInput = String(v.size ?? '');
				newStockInput = Number(v.newStock ?? found.stock);
				noteInput = String(v.note ?? '');
			}
		}
	});

	const status = (stock: number) =>
		stock <= 0
			? { label: 'Habis', cls: 'badge-danger' }
			: stock <= data.overview.lowStock
				? { label: 'Menipis', cls: 'badge-warn' }
				: { label: 'Aman', cls: 'badge-ok' };

	const sizeTone = (stock: number) =>
		stock <= 0 ? 'text-danger' : stock <= data.overview.lowStock ? 'text-warn' : '';

	const noData = $derived(data.overview.summary.total === 0 && data.overview.bundles.length === 0);
	const hasFilter = $derived(Boolean(data.filters.q || data.filters.lowOnly));
	const hasMovementFilter = $derived(Boolean(data.filters.item || data.filters.type));

	/** Tautan tab "Semua" / "Menipis" dengan kata kunci ikut terbawa */
	const tabHref = (low: boolean, withQ = true) => {
		const parts: string[] = [];
		if (withQ && data.filters.q) parts.push(`q=${encodeURIComponent(data.filters.q)}`);
		if (low) parts.push('low=true');
		return parts.length ? `/admin/stok?${parts.join('&')}` : '/admin/stok';
	};
</script>

<svelte:head>
	<title>Kelola Stok & Stock Opname - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader
		title="Stok"
		meta="{data.overview.summary.total} produk · {data.overview.bundles.length} paket"
	>
		{#snippet actions()}
			<a href="/admin/pembelian/baru" class="btn btn-primary btn-tool">+ Catat pembelian</a>
		{/snippet}
	</PageHeader>

	{#if form?.message && !form.success}
		<div class="mt-6"><Alert type="error" message={form.message} /></div>
	{:else if form?.errors}
		<div class="mt-6">
			<Alert type="error" message="Penyesuaian stok gagal disimpan. Periksa isian pada dialog." />
		</div>
	{/if}

	{#if noData && !hasFilter}
		<div class="mt-6">
			<EmptyState
				title="Data stok belum tersedia"
				description="Belum ada produk maupun paket bundling. Tambahkan produk lebih dulu."
				actionHref="/admin/produk/baru"
				actionText="Tambah produk"
			/>
		</div>
	{:else}
		<!-- Ringkasan Inventaris -->
		<dl class="mt-6 grid grid-cols-2 border border-line lg:grid-cols-4">
			<div class="min-w-0 border-r border-b border-line p-4 lg:border-b-0">
				<dt class="eyebrow">Total SKU Produk</dt>
				<dd class="price mt-1 text-2xl">
					{data.overview.summary.total} <span class="text-xs font-normal text-smoke">item</span>
				</dd>
			</div>

			<div class="min-w-0 border-b border-line p-4 lg:border-r lg:border-b-0">
				<dt class="eyebrow text-danger">Stok Habis (0)</dt>
				<dd class="price mt-1 text-2xl text-danger">
					{data.overview.summary.empty} <span class="text-xs font-normal text-smoke">item</span>
				</dd>
			</div>

			<div class="min-w-0 border-r border-line p-4">
				<dt class="eyebrow text-warn">Stok Menipis (1–{data.overview.lowStock})</dt>
				<dd class="price mt-1 text-2xl text-warn">
					{data.overview.summary.low} <span class="text-xs font-normal text-smoke">item</span>
				</dd>
			</div>

			<div class="min-w-0 p-4">
				<dt class="eyebrow">Nilai Persediaan</dt>
				<dd class="price mt-1 text-xl break-words sm:text-2xl">
					{formatRupiah(data.overview.summary.inventoryValue)}
				</dd>
			</div>
		</dl>

		<!-- Toolbar: tab status di kiri, pencarian di kanan -->
		<div class="mt-6 border-b border-line py-3">
			<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<nav
					class="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0"
					aria-label="Status stok"
				>
					<a
						href={tabHref(false)}
						class="chip {data.filters.lowOnly ? '' : 'chip-on'}"
						aria-current={data.filters.lowOnly ? undefined : 'page'}
					>
						Semua
					</a>
					<a
						href={tabHref(true)}
						class="chip {data.filters.lowOnly ? 'chip-on' : ''}"
						aria-current={data.filters.lowOnly ? 'page' : undefined}
					>
						Menipis / habis (&le; {data.overview.lowStock})
					</a>
				</nav>

				<form method="GET" class="flex flex-wrap items-center gap-2">
					{#if data.filters.lowOnly}<input type="hidden" name="low" value="true" />{/if}
					<div class="relative w-full sm:w-56">
						<Search
							size={14}
							class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-smoke"
						/>
						<input
							id="q"
							type="search"
							name="q"
							value={data.filters.q}
							placeholder="Cari produk…"
							aria-label="Cari produk"
							class="field-sm pr-7 pl-8 placeholder:text-smoke"
						/>
						{#if data.filters.q}
							<a
								href={tabHref(data.filters.lowOnly, false)}
								class="absolute top-1/2 right-2 -translate-y-1/2 text-smoke hover:text-ink"
								aria-label="Hapus kata kunci pencarian"
							>
								<X size={12} />
							</a>
						{/if}
					</div>
					<button type="submit" class="btn btn-primary btn-tool">Filter</button>
					{#if hasFilter}
						<a href="/admin/stok" class="chip h-8" title="Reset filter">Reset</a>
					{/if}
				</form>
			</div>

			{#if hasFilter}
				<div
					class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/50 pt-2 text-[11px]"
				>
					<span class="text-smoke">Filter aktif:</span>
					{#if data.filters.q}<span class="tag">"{data.filters.q}"</span>{/if}
					{#if data.filters.lowOnly}<span class="tag">Menipis / habis</span>{/if}
					<a href="/admin/stok" class="ml-1 text-smoke underline hover:text-ink">hapus semua</a>
				</div>
			{/if}
		</div>

		<!-- Tabel Stok Produk -->
		<section class="mt-8 space-y-3">
			<h2 class="panel-title">Daftar Stok Produk Fisik</h2>
			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Nama Produk</th>
							<th>Kategori</th>
							<th class="text-right">Harga Satuan</th>
							<th>Stok Fisik (per ukuran)</th>
							<th>Status</th>
							<th class="text-right">Nilai Total</th>
							<th class="relative"><span class="sr-only">Aksi</span></th>
						</tr>
					</thead>
					<tbody>
						{#if data.overview.products.length === 0}
							<tr>
								<td colspan="7" class="!py-10 text-center text-sm text-smoke">
									{hasFilter
										? 'Tidak ada produk yang cocok dengan pencarian/filter.'
										: 'Belum ada produk.'}
								</td>
							</tr>
						{/if}
						{#each data.overview.products as prod (prod.id)}
							<tr>
								<td class="font-bold">
									{prod.name}
									{#if !prod.isActive}<span class="badge badge-muted ml-1">Nonaktif</span>{/if}
								</td>
								<td class="text-xs text-smoke">{prod.category ?? '-'}</td>
								<td class="price text-right whitespace-nowrap">{formatRupiah(prod.price)}</td>
								<td>
									<StockBadge stock={prod.stock} lowStockThreshold={data.overview.lowStock} />
									{#if prod.sizes.length > 0}
										<div class="mt-1.5 flex flex-wrap gap-1">
											{#each prod.sizes as sz (sz.label)}
												<span class="tag tabular-nums {sizeTone(sz.stock)}"
													>{sz.label} {sz.stock}</span
												>
											{/each}
										</div>
									{/if}
								</td>
								<td
									><span class="badge {status(prod.stock).cls}">{status(prod.stock).label}</span
									></td
								>
								<td class="price text-right whitespace-nowrap">
									{formatRupiah(prod.price * prod.stock)}
								</td>
								<td class="text-right">
									<button
										type="button"
										onclick={() =>
											openAdjust('product', prod.id, prod.name, prod.stock, prod.sizes)}
										class="btn btn-tool"
									>
										Sesuaikan Stok
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<!-- Tabel Kuota Bundling -->
		<section class="mt-8 space-y-3">
			<h2 class="panel-title">Kuota Alokasi Paket Bundling</h2>
			<p class="text-xs text-smoke">
				Kuota = batas jual paket yang ditetapkan admin. Stok efektif yang bisa dibeli konsumen =
				min(kuota, stok komponen ÷ jumlah per paket).
			</p>
			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Paket Bundling</th>
							<th class="text-right">Harga Paket</th>
							<th>Kuota Saat Ini</th>
							<th>Stok Efektif</th>
							<th class="relative"><span class="sr-only">Aksi</span></th>
						</tr>
					</thead>
					<tbody>
						{#if data.overview.bundles.length === 0}
							<tr>
								<td colspan="5" class="!py-10 text-center text-sm text-smoke">
									Belum ada paket bundling.
								</td>
							</tr>
						{/if}
						{#each data.overview.bundles as b (b.id)}
							<tr>
								<td class="font-bold">
									{b.name}
									{#if !b.isActive}<span class="badge badge-muted ml-1">Nonaktif</span>{/if}
								</td>
								<td class="price text-right whitespace-nowrap">{formatRupiah(b.price)}</td>
								<td class="font-bold whitespace-nowrap">{b.stock} unit</td>
								<td class="whitespace-nowrap">
									<span class="font-bold">{b.effectiveStock} unit</span>
									{#if b.blocked}
										<span class="badge badge-danger ml-1">Komponen nonaktif</span>
									{:else if b.stock > b.effectiveStock}
										<span class="badge badge-warn ml-1">Kuota &gt; stok komponen</span>
									{/if}
								</td>
								<td class="text-right">
									<button
										type="button"
										onclick={() => openAdjust('bundle', b.id, b.name, b.stock)}
										class="btn btn-tool"
									>
										Sesuaikan Kuota
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<!-- Riwayat Mutasi Stok -->
		<section class="mt-8 space-y-3" id="riwayat">
			<div>
				<h2 class="panel-title">Riwayat Mutasi Stok</h2>
				<p class="mt-1 text-xs text-smoke">
					Catatan kronologis (audit trail) setiap kali stok bertambah atau berkurang.
				</p>
			</div>

			<div class="border-b border-line py-3">
				<form method="GET" action="#riwayat" class="flex flex-wrap items-center gap-2">
					<input type="hidden" name="q" value={data.filters.q} />
					{#if data.filters.lowOnly}<input type="hidden" name="low" value="true" />{/if}
					<select id="m-item" name="item" aria-label="Produk / paket" class="field-sm max-w-64">
						<option value="">Semua item</option>
						{#each data.itemOptions as o (o.value)}
							<option value={o.value} selected={data.filters.item === o.value}>{o.label}</option>
						{/each}
					</select>
					<select id="m-type" name="type" aria-label="Tipe mutasi" class="field-sm">
						<option value="">Semua tipe</option>
						{#each data.movementTypes as t (t)}
							<option value={t} selected={data.filters.type === t}>{t}</option>
						{/each}
					</select>
					<button type="submit" class="btn btn-primary btn-tool">Filter</button>
					{#if hasMovementFilter}
						<a
							href="?{new URLSearchParams({
								...(data.filters.q ? { q: data.filters.q } : {}),
								...(data.filters.lowOnly ? { low: 'true' } : {})
							})}#riwayat"
							class="chip h-8"
							title="Reset filter"
						>
							Reset
						</a>
					{/if}
				</form>
			</div>

			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Waktu</th>
							<th>Item</th>
							<th>Tipe</th>
							<th class="text-right">Perubahan</th>
							<th class="text-right">Stok Akhir</th>
							<th>Keterangan</th>
							<th>Oleh</th>
						</tr>
					</thead>
					<tbody>
						{#if data.movements.length === 0}
							<tr>
								<td colspan="7" class="py-10 text-center text-sm text-smoke">
									{hasMovementFilter
										? 'Tidak ada mutasi yang cocok dengan filter.'
										: 'Belum ada riwayat mutasi stok.'}
								</td>
							</tr>
						{:else}
							{#each data.movements as m (m.id)}
								<tr>
									<td class="text-xs whitespace-nowrap text-smoke">{formatDate(m.createdAt)}</td>
									<td class="min-w-40 text-xs font-bold">
										{m.productName ??
											(m.bundleName ? `Paket: ${m.bundleName}` : null) ??
											(m.productId ? `Produk #${m.productId}` : `Bundling #${m.bundleId}`)}
										{#if m.size}<span class="tag ml-1 font-semibold">{m.size}</span>{/if}
									</td>
									<td>
										<span
											class="badge {m.type === 'pembelian'
												? 'badge-info'
												: m.type === 'penjualan'
													? 'badge-outline'
													: m.type === 'pembatalan'
														? 'badge-ok'
														: 'badge-muted'}"
										>
											{m.type}
										</span>
									</td>
									<td
										class="price text-right text-xs {m.quantityChange > 0
											? 'text-ok'
											: 'text-danger'}"
									>
										{m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
									</td>
									<td class="price text-right text-xs">{m.stockAfter}</td>
									<td class="min-w-48 text-xs text-smoke">{m.note ?? '-'}</td>
									<td class="text-xs text-smoke">{m.adminName ?? 'Sistem'}</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<Pagination
				currentPage={data.pagination.page}
				totalPages={data.pagination.totalPages}
				totalItems={data.pagination.totalItems}
				perPage={data.pagination.perPage}
			/>
		</section>
	{/if}

	<!-- Form Penyesuaian Stok (Stock Opname) -->
	{#if adjustingItem}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-paper/80 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="opname-title"
		>
			<div class="panel w-full max-w-xl !border-ink">
				<div class="flex items-start justify-between gap-3 border-b border-line pb-3">
					<div>
						<h2 id="opname-title" class="panel-title">Stock Opname: {adjustingItem.name}</h2>
						<p class="mt-1 text-xs text-smoke">
							Jenis: {adjustingItem.kind === 'product' ? 'Produk Fisik' : 'Kuota Bundling'} &bull; Stok
							Tercatat: {needSize
								? sizeInput
									? `${currentStock} (ukuran ${sizeInput})`
									: `${adjustingItem.stock} total`
								: currentStock}
						</p>
					</div>
					<button type="button" onclick={closeAdjust} class="btn btn-tool btn-ghost">Tutup</button>
				</div>

				{#if form && !form.success && (form.message || form.errors)}
					<div class="mt-4">
						<Alert
							type="error"
							message={form.message ??
								form.errors?.newStock?.[0] ??
								form.errors?.note?.[0] ??
								form.errors?.id?.[0] ??
								form.errors?.size?.[0] ??
								form.errors?.kind?.[0] ??
								'Isian tidak valid.'}
						/>
					</div>
				{/if}

				<form
					method="POST"
					action="?/adjust"
					class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3"
					use:enhance={() => {
						busy = true;
						return async ({ result, update }) => {
							await update({ reset: false });
							busy = false;
							if (result.type === 'success') closeAdjust();
						};
					}}
				>
					<input type="hidden" name="kind" value={adjustingItem.kind} />
					<input type="hidden" name="id" value={adjustingItem.id} />

					{#if needSize}
						<div class="sm:col-span-3">
							<label for="size" class="label">Ukuran yang disesuaikan</label>
							<select id="size" name="size" bind:value={sizeInput} onchange={onSizeChange} required>
								<option value="" disabled>Pilih ukuran…</option>
								{#each adjustingItem.sizes as sz (sz.label)}
									<option value={sz.label}>{sz.label} (stok {sz.stock})</option>
								{/each}
							</select>
						</div>
					{/if}

					<div>
						<label for="newStock" class="label">Stok Baru (Hitung Fisik)</label>
						<input
							id="newStock"
							name="newStock"
							type="number"
							min="0"
							max="100000"
							bind:value={newStockInput}
							required
							disabled={needSize && !sizeInput}
							class="font-bold"
						/>
						<p class="hint">
							Selisih: {newStockInput - currentStock > 0 ? '+' : ''}{newStockInput - currentStock}
						</p>
					</div>

					<div class="sm:col-span-2">
						<label for="note" class="label">Alasan Penyesuaian (min. 5 karakter)</label>
						<input
							id="note"
							name="note"
							type="text"
							minlength="5"
							maxlength="200"
							placeholder="Contoh: Selisih stock opname mingguan / barang rusak saat display"
							bind:value={noteInput}
							required
						/>
					</div>

					<div class="flex justify-end gap-2 pt-2 sm:col-span-3">
						<button type="button" onclick={closeAdjust} class="btn btn-tool">Batal</button>
						<button
							type="submit"
							class="btn btn-tool btn-primary"
							disabled={busy || (needSize && !sizeInput)}
						>
							{busy ? 'Menyimpan…' : 'Simpan Penyesuaian Stok'}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>
