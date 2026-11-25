<script lang="ts">
	type Slide = { src: string; alt: string; title: string; href: string; cta: string; tag?: string };

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
		},
		{
			src: 'https://i.pinimg.com/1200x/46/3a/e6/463ae67e403f7047702f5acd84ea6a88.jpg',
			alt: 'Downshit Graphic Series - Streetwear Raw Culture',
			tag: 'Graphic Series',
			title: 'Kaos grafis',
			href: '/produk?kategori=kaos',
			cta: 'Lihat koleksi'
		},
		{
			src: 'https://i.pinimg.com/1200x/2a/94/a6/2a94a6fe903d096df267bef684e0f4bd.jpg',
			alt: 'Downshit Monokrom Edition - Heavy Cotton Apparel',
			tag: 'Monokrom Edition',
			title: 'Koleksi monokrom',
			href: '/produk',
			cta: 'Jelajahi'
		},
		{
			src: 'https://i.pinimg.com/1200x/3e/74/75/3e7475870effd8fbbe6efd49e9029428.jpg',
			alt: 'Downshit Winter & Heavyweight Street Style',
			tag: 'Heavy Fleece',
			title: 'Jaket & hoodie',
			href: '/produk?kategori=hoodie',
			cta: 'Lihat produk'
		}
	];

	/* ---------- Hero Train (Gerbong Kereta) ---------- */
	/** Kecepatan putaran kereta hero (dalam detik). 63 detik untuk 9 gerbong = sangat halus, tenang, & konsisten */
	const TRAIN_SPEED_SECONDS = 63;
</script>

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
</style>
