<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { hlsVideo } from '#lib/actions/hls';
	import { reveal } from '#lib/actions/reveal';
	import { thumbOf } from '#lib/utils/image';
	import { formatRupiah } from '#lib/utils/format';
	import type { PageData } from '../../../routes/$types';

	let {
		products,
		categories
	}: { products: PageData['products']; categories: PageData['categories'] } = $props();

	/* ------------------------------------------------------------------
	 * CATEGORY_BG_IMAGES: Background foto per kategori di beranda.
	 * Ubah tautan link gambar di bawah ini sesuai kebutuhan Anda.
	 * ------------------------------------------------------------------ */
	const CATEGORY_BG_IMAGES: Record<string, string> = {
		aksesoris: 'https://i.pinimg.com/736x/f1/28/21/f1282157af72ba4b73b031df5409fd43.jpg',
		celana:
			'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=800&q=80',
		hoodie: 'https://i.pinimg.com/736x/8f/a8/27/8fa827d64272020f88f40207c92e032e.jpg',
		kaos: 'https://i.pinimg.com/736x/c0/f4/2d/c0f42d80becc2f19c93c70b3b6267815.jpg'
	};

	/* ------------------------------------------------------------------
	 * FEATURED_BG_IMAGE: Foto/video latar produk sorotan di beranda.
	 * Mendukung format gambar (.jpg, .png, .webp) maupun video streaming (.m3u8, .mp4, .webm).
	 * ------------------------------------------------------------------ */
	const FEATURED_BG_IMAGE =
		'https://v1.pinimg.com/videos/iht/expMp4/ea/88/33/ea8833a2cd6061f3d0018835430f8ae0_720w.mp4';

	const isVideo = (url?: string | null) =>
		Boolean(url && /\.(m3u8|mp4|webm|mov)(\?.*)?$/i.test(url.trim()));

	const featured = $derived(products.find((p) => p.imageUrl) ?? products[0] ?? null);
	const featuredMedia = $derived(
		FEATURED_BG_IMAGE || (featured?.imageUrl ? thumbOf(featured.imageUrl) : '')
	);
	/** Foto produk: poster saat video memuat, dan pengganti bila video gagal / autoplay diblokir. */
	const featuredPoster = $derived(featured?.imageUrl ? thumbOf(featured.imageUrl) : '');
	let featuredVideoFailed = $state(false);

	// Pengguna yang meminta gerak dikurangi (prefers-reduced-motion) melihat foto poster, bukan video yang
	// berputar otomatis. Mengikuti perubahan pengaturan OS saat halaman terbuka.
	let reduceMotion = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduceMotion = mq.matches;
		const onChange = (e: MediaQueryListEvent) => (reduceMotion = e.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	const pad = (n: number) => String(n).padStart(2, '0');
</script>

<!-- Sorotan + kategori -->
{#if featured || categories.length > 0}
	<section class="container-shop mt-10 grid gap-3 sm:mt-14 lg:grid-cols-[1.35fr_1fr]">
		{#if featured}
			<a
				use:reveal
				href="/produk/{featured.slug}"
				class="group flex flex-col border border-ink {categories.length ? '' : 'lg:col-span-2'}"
			>
				<div
					class="product-media relative !aspect-[4/3] overflow-hidden bg-paper lg:!aspect-auto lg:min-h-[20rem] lg:flex-1 [&_img]:object-cover lg:[&_img]:absolute lg:[&_img]:inset-0 [&_video]:object-cover lg:[&_video]:absolute lg:[&_video]:inset-0"
				>
					{#if isVideo(featuredMedia) && !featuredVideoFailed && !reduceMotion}
						<!-- Video latar belakang produk sorotan (mendukung HLS .m3u8 / mp4) -->
						<video
							use:hlsVideo={featuredMedia}
							poster={featuredPoster || undefined}
							onerror={() => (featuredVideoFailed = true)}
							autoplay
							loop
							muted
							playsinline
							disablepictureinpicture
							disableremoteplayback
							tabindex="-1"
							class="video-bg h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
						></video>
					{:else if isVideo(featuredMedia) ? featuredPoster : featuredMedia}
						<img
							src={isVideo(featuredMedia) ? featuredPoster : featuredMedia}
							alt={featured.name}
							class="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
						/>
					{:else}
						<div class="flex h-full w-full items-center justify-center">
							<span class="display text-6xl text-ink/10">DOWNSHIT</span>
						</div>
					{/if}
				</div>
				<div
					class="flex items-center justify-between gap-4 border-t border-ink bg-mist px-4 py-3.5 sm:px-5"
				>
					<h2 class="display text-2xl sm:text-3xl">{featured.name}</h2>
					<p class="display shrink-0 bg-sale px-3 py-1.5 text-xl text-paper sm:text-2xl">
						{formatRupiah(featured.price)}
					</p>
				</div>
			</a>
		{/if}

		{#if categories.length > 0}
			<ul class="grid auto-rows-fr grid-cols-2 gap-3">
				{#each categories as cat, i (cat.id)}
					{@const bgImage = CATEGORY_BG_IMAGES[cat.slug]}
					<li use:reveal={{ delay: i * 70 }}>
						<a
							href="/produk?kategori={cat.slug}"
							class="group relative flex aspect-[5/4] h-full w-full flex-col justify-between overflow-hidden border border-ink p-4 transition-all duration-300 sm:p-5 lg:aspect-auto {bgImage
								? 'text-white'
								: 'hover:bg-ink hover:text-paper'}"
						>
							{#if isVideo(bgImage)}
								<!-- Background video kategori dari link (.m3u8, .mp4, dll) -->
								<video
									use:hlsVideo={bgImage}
									autoplay
									loop
									muted
									playsinline
									disablepictureinpicture
									disableremoteplayback
									tabindex="-1"
									class="video-bg absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
								></video>
								<!-- Overlay gradasi gelap agar teks terbaca tajam & jelas -->
								<div
									class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/25 transition-colors duration-300 group-hover:from-black/90 group-hover:via-black/55"
								></div>
							{:else if bgImage}
								<!-- Background gambar kategori dari link -->
								<img
									src={bgImage}
									alt="Kategori {cat.name}"
									class="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
									loading="lazy"
								/>
								<!-- Overlay gradasi gelap agar teks terbaca tajam & jelas -->
								<div
									class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/25 transition-colors duration-300 group-hover:from-black/90 group-hover:via-black/55"
								></div>
							{/if}

							<span class="relative z-10 flex items-start justify-between">
								<span
									class="text-xs font-light tracking-wider tabular-nums {bgImage
										? 'text-white/90'
										: ''}">{pad(cat.total)}</span
								>
								<ArrowUpRight
									size={18}
									class="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 {bgImage
										? 'text-white'
										: ''}"
								/>
							</span>
							<span
								class="display relative z-10 text-base tracking-wider sm:text-lg md:text-xl {bgImage
									? 'text-white'
									: ''}">{cat.name}</span
							>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	/* Video latar: tanpa kontrol / tombol play-pause bawaan browser (termasuk overlay play di iOS) */
	.video-bg {
		pointer-events: none;
	}
	:global(.video-bg::-webkit-media-controls),
	:global(.video-bg::-webkit-media-controls-panel),
	:global(.video-bg::-webkit-media-controls-play-button),
	:global(.video-bg::-webkit-media-controls-start-playback-button),
	:global(.video-bg::-webkit-media-controls-overlay-play-button),
	:global(.video-bg::-webkit-media-controls-enclosure) {
		display: none !important;
		-webkit-appearance: none;
		opacity: 0;
	}
</style>
