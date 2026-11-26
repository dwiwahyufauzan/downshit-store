<script lang="ts">
	import { trackingPageFor } from '#lib/utils/courier';
	import { formatDate } from '#lib/utils/format';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import type { PageData } from '../../routes/pesanan/[kode]/$types';

	/** Panel pengiriman: ekspedisi, nomor resi (bisa disalin), tautan pelacakan, tanggal kirim/terima. */
	let { shipment }: { shipment: PageData['shipment'] } = $props();

	const trackUrl = $derived(trackingPageFor(shipment?.courier));
	let copied = $state(false);

	function copyResi() {
		if (!navigator.clipboard || !shipment?.trackingNumber) return;
		navigator.clipboard.writeText(shipment.trackingNumber);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

{#if shipment && shipment.status !== 'belum_dikirim' && shipment.trackingNumber}
	<section class="panel">
		<h2 class="panel-title">Pengiriman</h2>
		<dl class="mt-5 space-y-4 text-sm">
			<div>
				<dt class="eyebrow">Ekspedisi</dt>
				<dd class="mt-1 font-semibold uppercase">{shipment.courier ?? '-'}</dd>
			</div>
			<div>
				<dt class="eyebrow">Nomor resi</dt>
				<dd class="mt-1 flex flex-wrap items-center justify-between gap-3">
					<span class="text-base font-bold tracking-[0.04em] tabular-nums">
						{shipment.trackingNumber ?? '-'}
					</span>
					{#if shipment.trackingNumber}
						<button type="button" onclick={() => copyResi()} class="btn btn-sm">
							{#if copied}
								<Check size={14} /> Tersalin
							{:else}
								<Copy size={14} /> Salin resi
							{/if}
						</button>
					{/if}
				</dd>
				{#if trackUrl}
					<dd class="mt-3">
						<a
							href={trackUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="btn btn-sm btn-block"
						>
							<ExternalLink size={14} /> Lacak di situs {shipment.courier}
						</a>
						<p class="hint">Salin nomor resi di atas, lalu tempel di halaman pelacakan kurir.</p>
					</dd>
				{/if}
			</div>
			{#if shipment.shippedAt}
				<div>
					<dt class="eyebrow">Dikirim</dt>
					<dd class="mt-1 text-smoke">{formatDate(shipment.shippedAt)}</dd>
				</div>
			{/if}
			{#if shipment.deliveredAt}
				<div>
					<dt class="eyebrow">Diterima</dt>
					<dd class="mt-1 text-smoke">{formatDate(shipment.deliveredAt)}</dd>
				</div>
			{/if}
		</dl>
	</section>
{:else}
	<section class="panel">
		<h2 class="panel-title">Pengiriman</h2>
		<p class="mt-4 text-sm text-smoke">Informasi pengiriman belum tersedia.</p>
	</section>
{/if}
