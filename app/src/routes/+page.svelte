<script lang="ts">
	import { fade } from 'svelte/transition';
	import Hls from 'hls.js';
	import Seo from '#lib/components/Seo.svelte';
	import ProductCard from '#lib/components/ProductCard.svelte';
	import WhatsAppShortcut from '#lib/components/WhatsAppShortcut.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import X from '@lucide/svelte/icons/x';
	import { thumbOf } from '#lib/utils/image';
	import { formatRupiah } from '#lib/utils/format';
	import { reveal } from '#lib/actions/reveal';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Photo = { src: string; alt: string };
	type Slide = Photo & { title: string; href: string; cta: string; tag?: string };

	/* ------------------------------------------------------------------
	 * HERO_TRAIN_SLIDES : Gerbong galeri hero yang bergerak ke samping
	 * secara halus & kontinu seperti kereta (continuous train conveyor).
	 * Anda dapat mengubah atau menambah link foto, judul, dan kategori di bawah.
	 * ------------------------------------------------------------------ */
	const HERO_TRAIN_SLIDES: Slide[] = [
		{
			src: 'https://i.pinimg.com/1200x/b0/a1/ac/b0a1acc7e73cf74d3c5a7ab80177f4f7.jpg',
			alt: 'Downshit Streetwear - Urban Oversized Heavy Fabric',
			tag: 'Koleksi Terbaru',
			title: 'Baru turun',
			href: '/produk',
			cta: 'Belanja'
		},
		{
			src: 'https://i.pinimg.com/736x/92/e0/7c/92e07c0125d708262a8c241189424dc3.jpg',
			alt: 'Downshit Heavy Cotton Boxy Tee & Oversized Collection',
			tag: 'Signature Tee',
			title: 'Kaos boxy 24s',
			href: '/produk?kategori=kaos',
			cta: 'Lihat kaos'
		},
		{
			src: 'https://i.pinimg.com/1200x/b6/d5/ef/b6d5efb228a0a31c9055c4b7236b2659.jpg',
			alt: 'Downshit Streetwear Lookbook & Bundling Series',
			tag: 'Paket Kombo',
			title: 'Bundling hemat',
			href: '/bundling',
			cta: 'Lihat paket'
		},
		{
			src: 'https://i.pinimg.com/1200x/b6/0d/d4/b60dd42a4cb57a2ae041575226097a36.jpg',
			alt: 'Downshit Raw Street Culture & Casual Outfits',
			tag: 'Heavyweight Fleece',
			title: 'Hoodie heavy',
			href: '/produk?kategori=hoodie',
			cta: 'Lihat hoodie'
		},
		{
			src: 'https://i.pinimg.com/1200x/c6/6e/88/c66e888cef9729899bac9dd11823d54f.jpg',
			alt: 'Downshit Streetwear Urban Subang Culture',
			tag: 'Subang Raw Culture',
			title: 'Koleksi esensial',
			href: '/produk',
			cta: 'Eksplor produk'
		},
		{
			src: 'https://i.pinimg.com/1200x/fe/78/99/fe78994af171d9997959d5e2a8eea173.jpg',
			alt: 'Downshit Denim & Outerwear Series',
			tag: 'Outerwear Series',
			title: 'Jaket & celana',
			href: '/produk?kategori=celana',
			cta: 'Lihat celana'
		}
	];
	/* ------------------------------------------------------------------
	 * MODEL_PHOTOS : galeri model. Foto sementara dari Unsplash, ganti dengan
	 * foto model Downshit. `cls` mengatur lebar kolom, rasio, dan geser vertikal
	 * (mobile: grid 6 kolom, md ke atas: 12 kolom) agar susunannya tidak seragam.
	 * ------------------------------------------------------------------ */
	type Shot = Photo & { cls: string; pos?: string };
	const MODEL_PHOTOS: Shot[] = [
		{
			src: 'https://i.pinimg.com/1200x/c6/6e/88/c66e888cef9729899bac9dd11823d54f.jpg',
			alt: 'Model memakai kaos hitam',
			cls: 'col-span-4 aspect-[4/5] md:col-span-5'
		},
		{
			src: 'https://i.pinimg.com/1200x/fe/78/99/fe78994af171d9997959d5e2a8eea173.jpg',
			alt: 'Model memakai hoodie dan jaket denim',
			cls: 'col-span-2 aspect-[2/3] self-end md:col-span-3 md:aspect-[3/4] md:mt-16 md:self-start'
		},
		{
			src: 'https://i.pinimg.com/1200x/46/3a/e6/463ae67e403f7047702f5acd84ea6a88.jpg',
			alt: 'Model memakai kaos putih',
			cls: 'col-span-3 aspect-[3/4] md:col-span-4 md:aspect-[4/5] md:mt-6'
		},
		{
			src: 'https://i.pinimg.com/736x/d8/40/41/d8404157f293bb18ce068d7160f3e584.jpg',
			alt: 'Model memakai jaket kulit',
			cls: 'col-span-3 aspect-[3/4] md:col-span-3'
		},
		{
			src: 'https://down-id.img.susercontent.com/file/id-11134207-8224y-mile98e88s1u03_tn',
			alt: 'Model duduk di dinding berlubang bulat',
			cls: 'col-span-6 aspect-[16/10] md:col-span-5 md:aspect-[4/3] md:mt-10'
		},
		{
			src: 'https://i.pinimg.com/736x/60/dc/cf/60dccf19e7b8cb3789f250785c1e253d.jpg',
			alt: 'Model memakai kaos merah dan jaket hitam',
			cls: 'col-span-6 aspect-[3/2] md:col-span-4 md:aspect-[4/5]',
			pos: 'object-[50%_25%]'
		}
	];
	const album = MODEL_PHOTOS;

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

	const featured = $derived(data.products.find((p) => p.imageUrl) ?? data.products[0] ?? null);
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

	/**
	 * Svelte Action untuk memutar video HLS (.m3u8) maupun format native (.mp4/.webm)
	 * secara responsif, looping, muted, dan autoplay di semua browser modern & mobile.
	 */
	function setupHls(node: HTMLVideoElement, src: string) {
		if (!src) return;
		node.muted = true;
		node.playsInline = true;
		node.controls = false;
		node.disablePictureInPicture = true;
		let hls: Hls | null = null;

		const play = () => {
			const p = node.play();
			if (p !== undefined) {
				p.catch(() => {});
			}
		};

		// Latar belakang tanpa kontrol: kalau browser menahan autoplay (mode hemat daya, tab baru
		// dibuka, dll.) putar lagi begitu siap, tab kembali terlihat, atau pada sentuhan pertama.
		const resume = () => {
			if (node.paused && !node.ended) play();
		};
		const onVisible = () => {
			if (!document.hidden) resume();
		};
		node.addEventListener('canplay', resume);
		node.addEventListener('pause', resume);
		document.addEventListener('visibilitychange', onVisible);
		window.addEventListener('pointerdown', resume, { once: true, passive: true });
		window.addEventListener('scroll', resume, { once: true, passive: true });

		if (node.canPlayType('application/vnd.apple.mpegurl')) {
			// Safari macOS & iOS native HLS
			node.src = src;
			play();
		} else if (Hls.isSupported() && src.includes('.m3u8')) {
			// Chrome, Firefox, Edge, Android HLS
			hls = new Hls({
				enableWorker: true,
				lowLatencyMode: true
			});
			hls.loadSource(src);
			hls.attachMedia(node);
			hls.on(Hls.Events.MANIFEST_PARSED, () => {
				play();
			});
		} else {
			node.src = src;
			play();
		}

		return {
			update(newSrc: string) {
				if (newSrc === src) return;
				src = newSrc;
				if (hls) {
					hls.destroy();
					hls = null;
				}
				if (node.canPlayType('application/vnd.apple.mpegurl')) {
					node.src = src;
					play();
				} else if (Hls.isSupported() && src.includes('.m3u8')) {
					hls = new Hls({
						enableWorker: true,
						lowLatencyMode: true
					});
					hls.loadSource(src);
					hls.attachMedia(node);
					hls.on(Hls.Events.MANIFEST_PARSED, () => {
						play();
					});
				} else {
					node.src = src;
					play();
				}
			},
			destroy() {
				node.removeEventListener('canplay', resume);
				node.removeEventListener('pause', resume);
				document.removeEventListener('visibilitychange', onVisible);
				window.removeEventListener('pointerdown', resume);
				window.removeEventListener('scroll', resume);
				if (hls) {
					hls.destroy();
					hls = null;
				}
			}
		};
	}

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

	/** Nomor WhatsApp toko dalam format 62xxx (untuk wa.me) dan tampilan +62 xxx-xxxx-xxxx. */
	const waDigits = $derived.by(() => {
		const d = (data.store?.whatsapp ?? '').replace(/\D/g, '') || '6281234567890';
		return d.startsWith('0') ? '62' + d.slice(1) : d;
	});
	const waDisplay = $derived(
		`+${waDigits.slice(0, 2)} ${waDigits.slice(2).replace(/(\d{3,4})(?=\d)/g, '$1-')}`
	);
	const waLink = $derived(
		`https://wa.me/${waDigits}?text=${encodeURIComponent(`Halo ${data.store?.name ?? 'Downshit'}, saya ingin bertanya seputar produk dan ketersediaan stok.`)}`
	);

	const pad = (n: number) => String(n).padStart(2, '0');

	/* ---------- Hero Train (Gerbong Kereta) ---------- */
	/** Kecepatan putaran kereta hero (dalam detik). 42 detik = sangat halus, tenang, & tidak terlalu cepat */
	const TRAIN_SPEED_SECONDS = 42;

	/* ---------- Karusel produk terbaru ---------- */
	let shelf: HTMLDivElement | undefined = $state();

	function slideShelf(dir: 1 | -1) {
		if (!shelf) return;
		shelf.scrollBy({ left: dir * shelf.clientWidth * 0.8, behavior: 'smooth' });
	}

	/* ---------- Lightbox album ---------- */
	let lightbox: number | null = $state(null);

	function onKey(e: KeyboardEvent) {
		if (lightbox === null) return;
		if (e.key === 'Escape') {
			lightbox = null;
			return;
		}
		if (e.key === 'ArrowRight') lightbox = (lightbox + 1) % album.length;
		if (e.key === 'ArrowLeft') lightbox = (lightbox - 1 + album.length) % album.length;
	}

	$effect(() => {
		document.body.style.overflow = lightbox === null ? '' : 'hidden';
		return () => (document.body.style.overflow = '');
	});
</script>

<svelte:head>
	<title>Downshit — Streetwear Lokal Subang</title>
	<meta
		name="description"
		content="Toko online resmi Downshit Subang. Kaos boxy, hoodie, celana, dan paket bundling hemat."
	/>
</svelte:head>
<Seo
	title="Downshit — Streetwear Lokal Subang"
	description="Toko online resmi Downshit Subang. Kaos boxy, hoodie, celana, dan paket bundling hemat."
/>

<svelte:window onkeydown={onKey} />

<!-- Hero: Gerbong Kereta Berjalan Halus (Continuous Train Conveyor) -->
<section
	class="hero-train-container group relative overflow-hidden bg-ink select-none"
	aria-label="Banner Galeri Downshit"
>
	<h1 class="sr-only">Downshit — Streetwear Lokal Subang</h1>

	<!-- Lintasan Gerbong Kereta: Dua rangkaian identik untuk perulangan mulus tanpa jeda (100% infinite loop) -->
	<div
		class="hero-train-track flex h-[min(88svh,780px)] min-h-[460px] w-max select-none"
		style:animation-duration="{TRAIN_SPEED_SECONDS}s"
	>
		{#each [0, 1] as repeat (repeat)}
			<div
				class="flex h-full shrink-0 items-stretch"
				aria-hidden={repeat === 1 ? 'true' : undefined}
			>
				{#each HERO_TRAIN_SLIDES as s, i (i)}
					<div
						class="train-car group/car relative flex h-full w-[80vw] shrink-0 overflow-hidden border-r border-paper/15 bg-ink sm:w-[55vw] md:w-[45vw] lg:w-[35vw] xl:w-[30vw]"
					>
						<!-- Foto gerbong bersih tanpa keterangan teks -->
						<img
							src={s.src}
							alt={s.alt}
							class="h-full w-full object-cover transition-transform duration-700 ease-out group-hover/car:scale-105"
							loading={i < 3 && repeat === 0 ? 'eager' : 'lazy'}
							draggable="false"
						/>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</section>

<!-- Produk terbaru -->
<section class="pt-10 sm:pt-14">
	<div class="container-shop mb-6 flex items-end justify-between gap-4">
		<h2 class="section-title">Produk terbaru</h2>
		<div class="flex items-center gap-5">
			<a
				href="/produk"
				class="more link hidden items-center gap-1.5 text-sm font-semibold sm:inline-flex"
			>
				Lihat semua <ArrowRight size={14} class="arrow" />
			</a>
			{#if data.products.length > 4}
				<div class="hidden lg:flex">
					<button
						type="button"
						class="shelf-btn"
						onclick={() => slideShelf(-1)}
						aria-label="Geser ke kiri"
					>
						<ChevronLeft size={18} />
					</button>
					<button
						type="button"
						class="shelf-btn -ml-px"
						onclick={() => slideShelf(1)}
						aria-label="Geser ke kanan"
					>
						<ChevronRight size={18} />
					</button>
				</div>
			{/if}
		</div>
	</div>

	{#if data.products.length === 0}
		<div class="container-shop">
			<div class="border border-dashed border-line py-20 text-center text-sm text-smoke">
				Belum ada produk. Segera hadir.
			</div>
		</div>
	{:else}
		<div
			bind:this={shelf}
			class="track flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 sm:scroll-px-6 sm:gap-4 sm:px-6 lg:scroll-px-10 lg:px-10"
		>
			{#each data.products as p, i (p.id)}
				<div class="w-[62%] shrink-0 snap-start sm:w-[34%] lg:w-[calc((100%-3*1rem)/4.25)]">
					<ProductCard
						href="/produk/{p.slug}"
						name={p.name}
						price={p.price}
						imageUrl={p.imageUrl}
						stock={p.stock}
						label={p.categoryName}
						badge={i < 3 ? 'Baru' : null}
						rating={p.rating}
						reviewCount={p.reviewCount}
					/>
				</div>
			{/each}
		</div>
	{/if}
</section>

<!-- Sorotan + kategori -->
{#if featured || data.categories.length > 0}
	<section class="container-shop mt-10 grid gap-3 sm:mt-14 lg:grid-cols-[1.35fr_1fr]">
		{#if featured}
			<a
				use:reveal
				href="/produk/{featured.slug}"
				class="group flex flex-col border border-ink {data.categories.length
					? ''
					: 'lg:col-span-2'}"
			>
				<div
					class="product-media relative !aspect-[4/3] overflow-hidden bg-paper lg:!aspect-auto lg:min-h-[20rem] lg:flex-1 [&_img]:object-cover lg:[&_img]:absolute lg:[&_img]:inset-0 [&_video]:object-cover lg:[&_video]:absolute lg:[&_video]:inset-0"
				>
					{#if isVideo(featuredMedia) && !featuredVideoFailed && !reduceMotion}
						<!-- Video latar belakang produk sorotan (mendukung HLS .m3u8 / mp4) -->
						<video
							use:setupHls={featuredMedia}
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

		{#if data.categories.length > 0}
			<ul class="grid auto-rows-fr grid-cols-2 gap-3">
				{#each data.categories as cat, i (cat.id)}
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
									use:setupHls={bgImage}
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

<!-- Bundling -->
{#if data.bundles.length > 0}
	<section class="mt-10 bg-mist py-10 sm:mt-14 sm:py-14">
		<div class="container-shop">
			<div class="mb-6 flex items-end justify-between gap-4">
				<h2 class="section-title">Paket bundling</h2>
				<a
					href="/bundling"
					class="more link inline-flex items-center gap-1.5 text-sm font-semibold"
				>
					Semua paket <ArrowRight size={14} class="arrow" />
				</a>
			</div>

			{#if data.bundles.length <= 2}
				<!-- Sedikit paket: tampil sebagai kartu lebar supaya baris tidak kosong -->
				<div use:reveal class="grid gap-3 md:grid-cols-2">
					{#each data.bundles as b (b.id)}
						<a
							href="/bundling/{b.slug}"
							class="group grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] border border-ink bg-paper"
						>
							<div class="product-media !aspect-square sm:!aspect-[4/3] md:!aspect-square">
								{#if b.imageUrl}
									<img src={thumbOf(b.imageUrl)} alt={b.name} />
								{:else}
									<div class="flex h-full w-full items-center justify-center">
										<span class="display text-3xl text-ink/10">DOWNSHIT</span>
									</div>
								{/if}
							</div>
							<div class="flex flex-col justify-between gap-6 border-l border-ink p-4 sm:p-5">
								<p class="eyebrow">Paket {b.itemCount} produk</p>
								<div>
									<h3 class="display text-2xl sm:text-3xl">{b.name}</h3>
									<p class="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm">
										<span class="price {b.savings > 0 ? 'text-sale' : ''}"
											>{formatRupiah(b.price)}</span
										>
										{#if b.savings > 0}
											<span class="price-old text-xs">{formatRupiah(b.normalPrice)}</span>
										{/if}
									</p>
									{#if b.savings > 0}
										<p class="badge badge-sale mt-3">Hemat {formatRupiah(b.savings)}</p>
									{/if}
								</div>
							</div>
						</a>
					{/each}
				</div>
			{:else}
				<div
					use:reveal
					class="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4 [&_.product-media]:bg-paper"
				>
					{#each data.bundles as b (b.id)}
						<ProductCard
							href="/bundling/{b.slug}"
							name={b.name}
							price={b.price}
							oldPrice={b.savings > 0 ? b.normalPrice : null}
							imageUrl={b.imageUrl}
							stock={b.effectiveStock}
							label="Paket {b.itemCount} produk"
							badge={b.savings > 0 ? `Hemat ${formatRupiah(b.savings)}` : null}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</section>
{/if}

<!-- Galeri model -->
<section class="container-shop mt-10 sm:mt-14">
	<div class="grid grid-cols-6 gap-3 sm:gap-4 md:grid-cols-12">
		{#each album as photo, i (photo.src)}
			<button
				type="button"
				use:reveal={{ delay: (i % 3) * 90 }}
				class="group overflow-hidden bg-mist {photo.cls}"
				onclick={() => (lightbox = i)}
				aria-label="Buka foto {i + 1}: {photo.alt}"
			>
				<img
					src={photo.src}
					alt={photo.alt}
					loading="lazy"
					class="h-full w-full object-cover {photo.pos ??
						''} grayscale transition duration-700 group-hover:scale-105 group-hover:grayscale-0"
				/>
			</button>
		{/each}
	</div>
</section>

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
				href={waLink}
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

<!-- Lightbox -->
{#if lightbox !== null}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 p-4 text-paper sm:p-10"
		role="dialog"
		aria-modal="true"
		aria-label="Foto model"
		transition:fade={{ duration: 150 }}
	>
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			onclick={() => (lightbox = null)}
			aria-label="Tutup"
		></button>

		<img
			src={album[lightbox].src}
			alt={album[lightbox].alt}
			class="pointer-events-none relative max-h-full max-w-full object-contain"
		/>

		<button
			type="button"
			class="lb-btn top-3 right-3 sm:top-6 sm:right-6"
			onclick={() => (lightbox = null)}
			aria-label="Tutup"
		>
			<X size={20} />
		</button>
		<button
			type="button"
			class="lb-btn top-1/2 left-3 -translate-y-1/2 sm:left-6"
			onclick={() => (lightbox = ((lightbox ?? 0) - 1 + album.length) % album.length)}
			aria-label="Foto sebelumnya"
		>
			<ChevronLeft size={22} />
		</button>
		<button
			type="button"
			class="lb-btn top-1/2 right-3 -translate-y-1/2 sm:right-6"
			onclick={() => (lightbox = ((lightbox ?? 0) + 1) % album.length)}
			aria-label="Foto berikutnya"
		>
			<ChevronRight size={22} />
		</button>

		<p class="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-paper/70">
			{lightbox + 1} / {album.length}
		</p>
	</div>
{/if}

<!-- Pintasan WhatsApp mengambang untuk beranda pelanggan -->
<WhatsAppShortcut store={data.store} />

<style>
	/* Animasi Gerbong Kereta Hero */
	@keyframes heroTrainGlide {
		0% {
			transform: translate3d(0, 0, 0);
		}
		100% {
			transform: translate3d(-50%, 0, 0);
		}
	}

	.hero-train-track {
		animation-name: heroTrainGlide;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
		will-change: transform;
	}

	@media (prefers-reduced-motion: reduce) {
		.hero-train-track {
			animation: none;
		}
	}

	.track {
		scrollbar-width: none;
	}
	.track::-webkit-scrollbar {
		display: none;
	}

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

	.nav-btn,
	.lb-btn {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid rgba(255, 255, 255, 0.5);
		background: rgba(0, 0, 0, 0.25);
		color: white;
		transition:
			background-color 0.2s ease,
			color 0.2s ease;
	}
	.lb-btn {
		position: absolute;
	}
	.nav-btn:hover,
	.lb-btn:hover {
		background: white;
		color: black;
	}

	.shelf-btn {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid var(--color-ink);
		transition:
			background-color 0.2s ease,
			color 0.2s ease;
	}
	.shelf-btn:hover {
		background: var(--color-ink);
		color: var(--color-paper);
	}

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

	.more :global(.arrow) {
		transition: transform 0.2s ease;
	}
	.more:hover :global(.arrow) {
		transform: translateX(3px);
	}
</style>
