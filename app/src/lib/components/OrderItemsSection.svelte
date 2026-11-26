<script lang="ts">
	import { formatRupiah } from '#lib/utils/format';
	import type { PageData } from '../../routes/pesanan/[kode]/$types';

	/** Rincian item pesanan + ringkasan biaya (subtotal, voucher, ongkir, total). */
	let { order, items }: { order: PageData['order']; items: PageData['items'] } = $props();
</script>

<!-- Item pesanan -->
<section>
	<h2 class="panel-title mb-4">Item pesanan</h2>
	<ul class="divide-y divide-line border-y border-line">
		{#each items as item (item.id)}
			<li class="py-5">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0">
						<p class="eyebrow">{item.itemType === 'product' ? 'Produk' : 'Paket bundling'}</p>
						<h3 class="mt-1 text-sm font-bold tracking-[0.06em] uppercase">
							{item.itemName}
						</h3>
						<p class="mt-1 text-xs text-smoke">
							{item.quantity} &times; {formatRupiah(item.unitPrice)}
						</p>
						{#if item.size && item.itemType === 'product'}
							<p class="mt-1 text-xs font-semibold tracking-[0.08em] uppercase">
								Ukuran {item.size}
							</p>
						{/if}
					</div>
					<p class="price shrink-0 text-sm">{formatRupiah(item.subtotal)}</p>
				</div>

				{#if item.components && item.components.length > 0}
					<div class="mt-3 border-l-2 border-ink bg-mist px-4 py-3">
						<p class="eyebrow">Isi paket</p>
						<ul class="mt-2 space-y-1">
							{#each item.components as comp (comp.id)}
								<li class="flex items-center justify-between gap-4 text-xs text-smoke">
									<span>
										{comp.productName}
										{#if comp.size}<strong class="text-ink">({comp.size})</strong>{/if}
										&times; {comp.quantity}
									</span>
									<span class="tabular-nums">
										{formatRupiah(comp.productPrice * comp.quantity)}
									</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</li>
		{/each}
	</ul>

	<dl class="mt-5 ml-auto max-w-sm space-y-3 text-sm">
		<div class="flex items-center justify-between gap-4">
			<dt class="text-smoke">Subtotal item</dt>
			<dd class="price">{formatRupiah(order.subtotal)}</dd>
		</div>
		{#if order.discount > 0}
			<div class="flex items-center justify-between gap-4">
				<dt class="text-smoke">Voucher {order.voucherCode}</dt>
				<dd class="price">−{formatRupiah(order.discount)}</dd>
			</div>
		{/if}
		<div class="flex items-center justify-between gap-4">
			<dt class="text-smoke">
				Ongkos kirim
				{#if order.shippingService}
					<span class="block text-xs"
						>{order.shippingService}{order.shippingEtd ? ` · est. ${order.shippingEtd}` : ''}</span
					>
				{/if}
			</dt>
			<dd class="price">{formatRupiah(order.shippingCost)}</dd>
		</div>
		<div class="divider flex items-baseline justify-between gap-4 pt-3">
			<dt class="text-xs font-bold tracking-[0.14em] uppercase">Total pembayaran</dt>
			<dd class="price text-xl">{formatRupiah(order.total)}</dd>
		</div>
	</dl>
</section>
