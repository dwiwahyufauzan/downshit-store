<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Printer from '@lucide/svelte/icons/printer';
	import { PAYMENT_STATUS_LABEL, STATUS_LABEL, type OrderStatus } from '#lib/constants';
	import { formatDate, formatRupiah } from '#lib/utils/format';
	import { waDigits } from '#lib/utils/whatsapp';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const o = $derived(data.order);
	const isLabel = $derived(data.jenis === 'label');
	const waShown = $derived(
		waDigits(data.store.whatsapp) ? `+${waDigits(data.store.whatsapp)}` : ''
	);
	const totalUnits = $derived(data.items.reduce((n, it) => n + it.quantity, 0));
	const base = $derived(`/admin/pesanan/${o.code}/cetak`);

	// Label A6 hanya memuat sebagian baris agar selalu satu halaman; selengkapnya ada di nota
	const MAX_LABEL_ITEMS = 6;
	const shownItems = $derived(data.items.slice(0, MAX_LABEL_ITEMS));
	const hiddenItems = $derived(Math.max(0, data.items.length - MAX_LABEL_ITEMS));
</script>

<svelte:head>
	<title>{isLabel ? 'Label' : 'Nota'} {o.code} – {data.store.name}</title>
	<meta name="robots" content="noindex" />
	<!-- Ukuran kertas mengikuti jenis cetakan: label A6, nota A4 -->
	{#if isLabel}
		<style>
			@page {
				size: 105mm 148mm;
				margin: 5mm;
			}
		</style>
	{:else}
		<style>
			@page {
				size: A4;
				margin: 14mm;
			}
		</style>
	{/if}
</svelte:head>

<div class="min-h-screen bg-mist py-6 print:bg-white print:py-0">
	<!-- Bilah alat: tidak ikut tercetak -->
	<div
		class="mx-auto mb-4 flex max-w-[820px] flex-wrap items-center justify-between gap-3 px-4 print:hidden"
	>
		<a href="/admin/pesanan/{o.code}" class="btn btn-sm">
			<ArrowLeft size={14} /> Kembali ke pesanan
		</a>
		<div class="flex flex-wrap items-center gap-2">
			<nav class="flex" aria-label="Jenis cetakan">
				<a
					href={base}
					class="btn btn-sm {isLabel ? '' : 'btn-primary'}"
					aria-current={isLabel ? undefined : 'page'}>Nota</a
				>
				<a
					href="{base}?jenis=label"
					class="btn btn-sm -ml-px {isLabel ? 'btn-primary' : ''}"
					aria-current={isLabel ? 'page' : undefined}>Label pengiriman</a
				>
			</nav>
			<button type="button" class="btn btn-sm btn-primary" onclick={() => window.print()}>
				<Printer size={14} /> Cetak
			</button>
		</div>
	</div>

	{#if isLabel}
		<!-- ===================== LABEL PENGIRIMAN (A6) ===================== -->
		<section
			class="mx-auto w-[105mm] max-w-full border-2 border-ink bg-white p-3.5 text-ink print:w-full print:max-w-none print:break-inside-avoid"
			aria-label="Label pengiriman {o.code}"
		>
			<div class="flex items-center justify-between gap-2 border-b-2 border-ink pb-2">
				<p class="brand-logo text-base">{data.store.name}</p>
				<p class="text-right text-[11px] leading-tight font-bold whitespace-nowrap">
					{o.code}
					{#if data.shipment?.courier}<br />{data.shipment.courier}{/if}
				</p>
			</div>

			<div class="py-2.5">
				<p class="eyebrow">Kepada</p>
				<p class="mt-0.5 text-lg leading-tight font-extrabold uppercase">{o.recipientName}</p>
				<p class="text-[14px] font-semibold">{o.recipientPhone}</p>
				<p class="mt-1 text-[13px] leading-snug whitespace-pre-line">{o.shippingAddress}</p>
			</div>

			<div class="grid grid-cols-2 gap-3 border-t border-dashed border-ink py-2.5">
				<div>
					<p class="eyebrow">Pengirim</p>
					<p class="mt-0.5 text-[13px] leading-snug font-semibold">{data.store.name}</p>
					{#if waShown}<p class="text-[12px]">{waShown}</p>{/if}
				</div>
				<div>
					<p class="eyebrow">No. resi</p>
					<p class="mt-0.5 font-mono text-[13px] font-bold tracking-wide break-all">
						{data.shipment?.trackingNumber ?? '—'}
					</p>
				</div>
			</div>

			<div class="border-t border-dashed border-ink pt-2.5">
				<p class="eyebrow">Isi paket · {totalUnits} pcs</p>
				<ul class="mt-0.5 space-y-0.5 text-[12px] leading-snug">
					{#each shownItems as it (it.id)}
						<li>
							{it.quantity}× {it.itemName}{#if it.itemType === 'product' && it.size}
								({it.size}){/if}
							{#if it.components.length > 0}
								<span class="block text-[11px] text-smoke print:text-ink">
									{it.components
										.map(
											(c) =>
												`${c.productName}${c.size ? ` (${c.size})` : ''}${c.quantity > 1 ? ` ×${c.quantity}` : ''}`
										)
										.join(', ')}
								</span>
							{/if}
						</li>
					{/each}
					{#if hiddenItems > 0}
						<li class="font-semibold">+ {hiddenItems} baris lainnya (lihat nota)</li>
					{/if}
				</ul>
				{#if o.notes}
					<p class="mt-2 border border-ink px-2 py-1 text-[11px] leading-snug">
						<strong>Catatan:</strong>
						{o.notes.length > 140 ? o.notes.slice(0, 140) + '…' : o.notes}
					</p>
				{/if}
			</div>
		</section>
	{:else}
		<!-- ===================== NOTA (A4) ===================== -->
		<section
			class="mx-auto max-w-[820px] bg-white p-8 text-ink shadow-sm print:max-w-none print:p-0 print:shadow-none"
			aria-label="Nota pesanan {o.code}"
		>
			<header class="flex items-start justify-between gap-6 border-b-2 border-ink pb-5">
				<div>
					<p class="brand-logo text-3xl">{data.store.name}</p>
					{#if waShown}<p class="mt-1 text-sm text-smoke">WhatsApp {waShown}</p>{/if}
				</div>
				<div class="text-right">
					<p class="eyebrow">Nota pesanan</p>
					<p class="mt-1 text-xl font-bold">{o.code}</p>
					<p class="text-sm">{formatDate(o.createdAt)}</p>
				</div>
			</header>

			<div class="grid grid-cols-2 gap-8 py-6 text-sm">
				<div>
					<p class="eyebrow">Penerima</p>
					<p class="mt-1 font-semibold">{o.recipientName}</p>
					<p>{o.recipientPhone}</p>
					<p class="mt-1 whitespace-pre-line">{o.shippingAddress}</p>
					{#if o.notes}<p class="mt-2 text-smoke">Catatan: {o.notes}</p>{/if}
				</div>
				<div>
					<p class="eyebrow">Status</p>
					<p class="mt-1">
						Pesanan: <strong>{STATUS_LABEL[o.status as OrderStatus] ?? o.status}</strong>
					</p>
					<p>
						Pembayaran:
						<strong>{PAYMENT_STATUS_LABEL[data.paymentStatus] ?? data.paymentStatus}</strong>
					</p>
					{#if data.shipment?.courier || data.shipment?.trackingNumber}
						<p class="mt-2">
							Pengiriman: <strong>{data.shipment?.courier ?? '-'}</strong>
							{#if data.shipment?.trackingNumber}
								· Resi <span class="font-mono">{data.shipment.trackingNumber}</span>
							{/if}
						</p>
					{/if}
				</div>
			</div>

			<table class="w-full text-sm">
				<thead>
					<tr class="border-y border-ink text-left text-[11px] tracking-[0.14em] uppercase">
						<th class="py-2 pr-2 font-semibold">Barang</th>
						<th class="px-2 py-2 text-right font-semibold">Harga</th>
						<th class="px-2 py-2 text-right font-semibold">Jml</th>
						<th class="py-2 pl-2 text-right font-semibold">Subtotal</th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as it (it.id)}
						<tr class="break-inside-avoid border-b border-line align-top">
							<td class="py-2.5 pr-2">
								<p class="font-semibold">{it.itemName}</p>
								{#if it.itemType === 'product' && it.size}
									<p class="text-xs text-smoke">Ukuran {it.size}</p>
								{/if}
								{#if it.components.length > 0}
									<ul class="mt-0.5 text-xs text-smoke">
										{#each it.components as c (c.id)}
											<li>
												{c.productName}{c.size ? ` (${c.size})` : ''} ×{c.quantity}
											</li>
										{/each}
									</ul>
								{/if}
							</td>
							<td class="px-2 py-2.5 text-right whitespace-nowrap">{formatRupiah(it.unitPrice)}</td>
							<td class="px-2 py-2.5 text-right">{it.quantity}</td>
							<td class="py-2.5 pl-2 text-right whitespace-nowrap">{formatRupiah(it.subtotal)}</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<dl class="mt-4 ml-auto w-full max-w-xs break-inside-avoid space-y-1 text-sm">
				<div class="flex justify-between">
					<dt>Subtotal</dt>
					<dd>{formatRupiah(o.subtotal)}</dd>
				</div>
				<div class="flex justify-between">
					<dt>Ongkos kirim</dt>
					<dd>{formatRupiah(o.shippingCost)}</dd>
				</div>
				<div class="flex justify-between border-t-2 border-ink pt-2 text-base font-bold">
					<dt>Total</dt>
					<dd>{formatRupiah(o.total)}</dd>
				</div>
			</dl>

			<p class="mt-10 border-t border-line pt-4 text-center text-xs text-smoke">
				Terima kasih telah berbelanja di {data.store.name}.
			</p>
		</section>
	{/if}
</div>
