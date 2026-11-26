<script lang="ts">
	import { closePromoBar, promoBar, promoSignature } from '#lib/stores/promo-bar.svelte';
	import { promoCondition, promoExpiry, promoHeadline } from '#lib/utils/promo';
	import type { PromoVoucher } from '#lib/utils/promo';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import X from '@lucide/svelte/icons/x';
	import { fade } from 'svelte/transition';

	let {
		promos,
		now = new Date()
	}: {
		promos: PromoVoucher[];
		/** Disuntik agar tampilan "sisa hari" bisa diuji */
		now?: Date;
	} = $props();

	const sig = $derived(promoSignature(promos.map((p) => p.code)));
	const closed = $derived(promoBar.closedSig === sig);
	const hidden = $derived(closed);

	let index = $state(0);
	let paused = $state(false);
	const current = $derived(promos[index % Math.max(promos.length, 1)]);

	// Beberapa promo bergantian tiap 6 detik (berhenti saat disorot/difokus atau bila pengguna
	// memilih mengurangi animasi).
	$effect(() => {
		if (promos.length < 2 || paused || hidden) return;
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		const t = setInterval(() => (index = (index + 1) % promos.length), 6000);
		return () => clearInterval(t);
	});

	let copied = $state('');
	async function copy(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			copied = code;
			setTimeout(() => (copied = copied === code ? '' : copied), 1800);
		} catch {
			/* clipboard tidak tersedia: kode tetap terlihat di banner */
		}
	}
</script>

{#if promos.length > 0 && current}
	<!-- Lipat/buka lewat tinggi grid agar navbar di bawahnya bergeser halus -->
	<div
		class="grid transition-[grid-template-rows] duration-300 {hidden
			? 'grid-rows-[0fr]'
			: 'grid-rows-[1fr]'} print:hidden"
		data-testid="promo-bar"
		aria-hidden={hidden}
		inert={hidden}
	>
		<div class="min-h-0 overflow-hidden">
			<div
				class="bg-ink text-paper"
				role="region"
				aria-label="Promo"
				onmouseenter={() => (paused = true)}
				onmouseleave={() => (paused = false)}
				onfocusin={() => (paused = true)}
				onfocusout={() => (paused = false)}
			>
				<!-- Tiga kolom sejajar dengan navbar: info kiri · pesan tengah · tutup kanan -->
				<div
					class="container-shop grid h-9 grid-cols-[1fr_auto_1fr] items-center gap-3 text-[10px] font-semibold tracking-[0.16em] uppercase sm:text-[11px]"
				>
					<!-- Kiri: masa berlaku + penanda -->
					<div class="hidden items-center gap-4 md:flex">
						<span class="text-paper/55" data-testid="promo-expiry">
							{promoExpiry(current.endsAt, now)}
						</span>
						{#if promos.length > 1}
							<div class="flex items-center" role="group" aria-label="Pilih promo">
								{#each promos as _, i (i)}
									<button
										type="button"
										class="flex size-5 items-center justify-center"
										aria-label="Tampilkan promo {i + 1}"
										aria-current={i === index % promos.length}
										onclick={() => (index = i)}
									>
										<span
											class="block size-1.5 transition-colors {i === index % promos.length
												? 'bg-paper'
												: 'bg-paper/30'}"
										></span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
					<span class="md:hidden"></span>

					<!-- Tengah: pesan + kode -->
					{#key index}
						<p
							class="flex min-w-0 items-center justify-center gap-x-3 whitespace-nowrap"
							in:fade={{ duration: 220 }}
						>
							<span data-testid="promo-headline">{promoHeadline(current)}</span>
							<span class="hidden text-paper/30 lg:inline" aria-hidden="true">/</span>
							<span class="hidden font-medium text-paper/60 lg:inline">
								{promoCondition(current)}
							</span>
							<span class="text-paper/30" aria-hidden="true">/</span>
							<button
								type="button"
								class="group inline-flex items-center gap-1.5 underline decoration-paper/35 underline-offset-[5px] transition-colors hover:decoration-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paper"
								onclick={() => copy(current.code)}
								aria-label="Salin kode {current.code}"
							>
								<span class="font-mono tracking-[0.2em]" data-testid="promo-code"
									>{current.code}</span
								>
								{#if copied === current.code}
									<Check size={12} aria-hidden="true" />
									<span class="font-bold">Tersalin</span>
								{:else}
									<Copy size={12} class="text-paper/60 group-hover:text-paper" aria-hidden="true" />
								{/if}
							</button>
						</p>
					{/key}

					<!-- Kanan: tutup -->
					<div class="flex justify-end">
						<button
							type="button"
							class="-mr-2 flex size-8 items-center justify-center text-paper/60 transition-colors hover:text-paper focus-visible:outline-2 focus-visible:outline-paper"
							onclick={() => closePromoBar(sig)}
							aria-label="Tutup banner promo"
						>
							<X size={15} aria-hidden="true" />
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
