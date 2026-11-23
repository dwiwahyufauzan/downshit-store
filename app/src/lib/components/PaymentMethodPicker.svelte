<script lang="ts">
	import type { PaymentMethod } from '#lib/constants';
	import Landmark from '@lucide/svelte/icons/landmark';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Store from '@lucide/svelte/icons/store';

	type Option = { method: PaymentMethod; label: string; hint: string };

	let {
		options,
		value = $bindable(),
		name = 'paymentMethod',
		legend = 'Metode pembayaran'
	}: { options: Option[]; value: PaymentMethod; name?: string; legend?: string } = $props();

	const icons = {
		transfer_bank: Landmark,
		ewallet: Smartphone,
		qris: QrCode,
		va: CreditCard,
		minimarket: Store
	} as const;
</script>

<fieldset class="min-w-0">
	<legend class="label">{legend}</legend>
	<div class="mt-2 grid gap-px border border-line bg-line sm:grid-cols-2">
		{#each options as o (o.method)}
			{@const Icon = icons[o.method]}
			<label
				class="flex cursor-pointer items-start gap-3 p-4 text-sm transition-colors has-[:checked]:bg-ink has-[:checked]:text-paper {value ===
				o.method
					? 'bg-ink text-paper'
					: 'bg-paper'}"
			>
				<input type="radio" {name} value={o.method} bind:group={value} class="sr-only" />
				<Icon size={18} class="mt-0.5 shrink-0" />
				<span class="min-w-0">
					<span class="block font-bold tracking-[0.04em] uppercase">{o.label}</span>
					<span class="mt-0.5 block text-xs {value === o.method ? 'text-paper/80' : 'text-smoke'}">
						{o.hint}
					</span>
				</span>
			</label>
		{/each}
	</div>
</fieldset>
