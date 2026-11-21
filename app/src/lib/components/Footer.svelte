<script lang="ts">
	import { waLink } from '#lib/utils/whatsapp';
	import { storeInquiryMessage } from '#lib/utils/wa-messages';

	let {
		store
	}: {
		store?: {
			name?: string;
			whatsapp?: string;
			shippingCost?: number;
			bankName?: string;
		};
	} = $props();

	const waUrl = $derived(
		waLink(store?.whatsapp, storeInquiryMessage(store?.name ?? 'Downshit Store'))
	);
</script>

<footer class="mt-20 border-t border-line bg-ink text-paper print:hidden">
	<div class="container-shop py-10 sm:py-12">
		<div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
			<!-- Brand -->
			<div>
				<a
					href="/"
					class="brand-logo text-lg tracking-tight text-paper transition-opacity hover:opacity-80 sm:text-xl"
				>
					{store?.name ?? 'DOWNSHIT'}
				</a>
				<p class="mt-0.5 text-xs text-stone-400">Subang Streetwear &middot; Est. 2026</p>
			</div>

			<!-- Navigasi Minimalis (Satu Baris Bersih) -->
			<nav
				class="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-stone-400"
				aria-label="Footer Navigasi"
			>
				<a href="/produk" class="transition-colors hover:text-paper">Produk</a>
				<a href="/bundling" class="transition-colors hover:text-paper">Bundling</a>
				<a href="/kebijakan-privasi" class="transition-colors hover:text-paper">Kebijakan Privasi</a
				>
				{#if waUrl}
					<a
						href={waUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="transition-colors hover:text-paper"
					>
						WhatsApp
					</a>
				{/if}
			</nav>
		</div>

		<!-- Garis Bawah & Hak Cipta -->
		<div
			class="mt-8 flex flex-col items-start justify-between gap-2 border-t border-white/10 pt-6 text-[11px] text-stone-500 sm:flex-row sm:items-center"
		>
			<p>&copy; 2026 {store?.name ?? 'Store Downshit'}. Hak cipta dilindungi.</p>
			<p class="text-stone-400">Subang, Jawa Barat &middot; IDN</p>
		</div>
	</div>
</footer>
