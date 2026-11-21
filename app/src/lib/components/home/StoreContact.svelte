<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { reveal } from '#lib/actions/reveal';
	import { waDigits, waLink } from '#lib/utils/whatsapp';
	import { storeInquiryMessage } from '#lib/utils/wa-messages';
	import type { PageData } from '../../../routes/$types';

	let { store }: { store: PageData['store'] } = $props();

	/* ------------------------------------------------------------------
	 * STORE_CONTACT: Data section lokasi & kontak di beranda.
	 * Nomor WhatsApp diambil dari Pengaturan toko. Ganti alamat dan link sosial media
	 * di bawah dengan data Downshit yang sebenarnya.
	 * ------------------------------------------------------------------ */
	const STORE_CONTACT = {
		name: 'Downshit Market',
		address: 'Subang, Jawa Barat, Indonesia',
		mapLink: 'https://maps.app.goo.gl/RNEERKyx76i1eprH8',
		socials: [
			{ label: 'Instagram', href: 'https://instagram.com/downshit' },
			{ label: 'TikTok', href: 'https://tiktok.com/@downshit' }
		]
	};
	const MAP_EMBED_URL =
		'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3963.751962695073!2d107.68757647641142!3d-6.552966893440023!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x2e693d33b551db31%3A0xfc8dafef481952f2!2sDownshit%20Market!5e0!3m2!1sid!2sid!4v1794967974643!5m2!1sid!2sid';

	/** Nomor WhatsApp toko untuk tampilan +62 xxx-xxxx-xxxx dan tautan chat dengan pesan awal. */
	const waNumber = $derived(waDigits(store?.whatsapp));
	const waDisplay = $derived(
		waNumber
			? `+${waNumber.slice(0, 2)} ${waNumber.slice(2).replace(/(\d{3,4})(?=\d)/g, '$1-')}`
			: ''
	);
	const waUrl = $derived(waLink(store?.whatsapp, storeInquiryMessage(store?.name ?? 'Downshit')));
</script>

<!-- Lokasi & kontak -->
<section class="container-shop mt-10 sm:mt-14" aria-labelledby="kontak-title">
	<div class="mb-6 flex items-end justify-between gap-4">
		<div>
			<p class="eyebrow">Kunjungi kami</p>
			<h2 id="kontak-title" class="section-title mt-2">Lokasi & kontak</h2>
		</div>
		<p class="hidden max-w-[16rem] text-right text-sm text-smoke sm:block">
			Mampir langsung ke toko, atau chat dulu untuk tanya stok.
		</p>
	</div>

	<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
		<div class="flex flex-col gap-3">
			<!-- WhatsApp -->
			<a
				use:reveal
				href={waUrl ?? undefined}
				target="_blank"
				rel="noopener noreferrer"
				class="contact-tile group"
			>
				<span class="flex items-start justify-between gap-4">
					<span class="contact-label">01 · WhatsApp</span>
					<ArrowUpRight size={18} class="contact-arrow" />
				</span>
				<span class="display text-3xl tabular-nums sm:text-4xl">{waDisplay}</span>
				<span class="text-sm text-smoke transition-colors group-hover:text-paper/70">
					Tanya stok, ukuran, atau status pesanan.
				</span>
			</a>

			<!-- Alamat -->
			<a
				use:reveal={{ delay: 70 }}
				href={STORE_CONTACT.mapLink}
				target="_blank"
				rel="noopener noreferrer"
				class="contact-tile group"
			>
				<span class="flex items-start justify-between gap-4">
					<span class="contact-label">02 · Lokasi</span>
					<ArrowUpRight size={18} class="contact-arrow" />
				</span>
				<span class="display text-2xl sm:text-3xl">{STORE_CONTACT.name}</span>
				<span class="text-sm text-smoke transition-colors group-hover:text-paper/70">
					{STORE_CONTACT.address}
				</span>
			</a>

			<!-- Sosial media -->
			<ul class="grid grid-cols-2 gap-3">
				{#each STORE_CONTACT.socials as soc, i (soc.label)}
					<li use:reveal={{ delay: 140 + i * 70 }}>
						<a
							href={soc.href}
							target="_blank"
							rel="noopener noreferrer"
							class="contact-tile group !gap-8"
							aria-label={soc.label}
						>
							<span class="flex items-start justify-between gap-2">
								<svg viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor" aria-hidden="true">
									{#if soc.label === 'Instagram'}
										<path
											d="M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 4 2.4 7.2 2.3c1.2-.1 1.6-.1 4.8-.1zM12 0C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1 0 8.3 0 8.7 0 12s0 3.7.1 4.9c.2 4.4 2.6 6.8 7 7C8.3 24 8.7 24 12 24s3.7 0 4.9-.1c4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9s0-3.7-.1-4.9c-.2-4.4-2.6-6.8-7-7C15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.9 1.4 1.4 0 0 0 0-2.9z"
										/>
									{:else}
										<path
											d="M12.5 0h3.4c.2 1.9 1.3 4.1 3.4 5.1.9.5 1.9.7 2.7.8v3.5c-1.5 0-3-.4-4.1-1.1v6.9c0 3.9-3.1 7-7 7S4 19.1 4 15.2s3.2-7.2 7.3-7v3.7c-2-.2-3.6 1.2-3.6 3.3 0 1.9 1.6 3.3 3.4 3.3s3.4-1.4 3.4-3.4V0z"
										/>
									{/if}
								</svg>
								<ArrowUpRight size={18} class="contact-arrow" />
							</span>
							<span class="display text-xl sm:text-2xl">{soc.label}</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>

		<!-- Peta -->
		<div
			use:reveal={{ delay: 90 }}
			class="relative min-h-[20rem] overflow-hidden border border-ink bg-mist lg:min-h-[28rem]"
		>
			<iframe
				title="Peta lokasi {STORE_CONTACT.name}"
				src={MAP_EMBED_URL}
				class="absolute inset-0 h-full w-full border-0"
				loading="lazy"
				referrerpolicy="strict-origin-when-cross-origin"
				allowfullscreen
			></iframe>
		</div>
	</div>
</section>

<style>
	.contact-tile {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1.5rem;
		height: 100%;
		border: 1px solid var(--color-ink);
		background: var(--color-paper);
		padding: 1.25rem;
		transition:
			background-color 0.3s ease,
			color 0.3s ease;
	}
	@media (min-width: 640px) {
		.contact-tile {
			padding: 1.5rem;
		}
	}
	.contact-tile:hover {
		background: var(--color-ink);
		color: var(--color-paper);
	}
	.contact-label {
		font-size: 0.6875rem;
		font-weight: 300;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: var(--color-smoke);
		transition: color 0.3s ease;
	}
	.contact-tile:hover .contact-label {
		color: color-mix(in srgb, var(--color-paper) 65%, transparent);
	}
	.contact-tile :global(.contact-arrow) {
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}
	.contact-tile:hover :global(.contact-arrow) {
		transform: translate(2px, -2px);
	}
</style>
