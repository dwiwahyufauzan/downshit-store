<script lang="ts">
	import { fade } from 'svelte/transition';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import X from '@lucide/svelte/icons/x';
	import { reveal } from '#lib/actions/reveal';

	type Shot = { src: string; alt: string; cls: string; pos?: string };

	/* ------------------------------------------------------------------
	 * MODEL_PHOTOS : galeri model. Foto sementara dari Unsplash, ganti dengan
	 * foto model Downshit. `cls` mengatur lebar kolom, rasio, dan geser vertikal
	 * (mobile: grid 6 kolom, md ke atas: 12 kolom) agar susunannya tidak seragam.
	 * ------------------------------------------------------------------ */
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

<svelte:window onkeydown={onKey} />

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

<style>
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
		position: absolute;
	}
	.lb-btn:hover {
		background: white;
		color: black;
	}
</style>
