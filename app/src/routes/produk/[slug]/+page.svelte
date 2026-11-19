<script lang="ts">
	import { enhance } from '$app/forms';
	import { enhanceInPlace } from '#lib/actions/form-enhance';
	import { thumbOf } from '#lib/utils/image';
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import SizePicker from '#lib/components/SizePicker.svelte';
	import ProductShelf from '#lib/components/ProductShelf.svelte';
	import Stars from '#lib/components/Stars.svelte';
	import { formatRupiah } from '#lib/utils/format';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let p = $derived(data.product);
	let qty = $state(1);
	let size = $state('');
	let adding = $state(false);

	// Galeri gambar produk
	let activeImageIndex = $state(0);
	const gallery = $derived(data.gallery ?? []);
	const activeImage = $derived(gallery[activeImageIndex]?.imageUrl ?? p.imageUrl ?? null);

	function prevImage() {
		if (gallery.length <= 1) return;
		activeImageIndex = (activeImageIndex - 1 + gallery.length) % gallery.length;
	}

	function nextImage() {
		if (gallery.length <= 1) return;
		activeImageIndex = (activeImageIndex + 1) % gallery.length;
	}

	// Produk ber-ukuran: stok & batas jumlah mengikuti ukuran yang dipilih
	const hasSizes = $derived(data.sizes.length > 0);
	const selected = $derived(data.sizes.find((s) => s.label === size));
	const available = $derived(hasSizes ? (selected?.stock ?? 0) : p.stock);
	const maxQty = $derived(Math.min(available, 99));

	// Ganti ukuran → jumlah tidak boleh melebihi stok ukuran baru
	$effect(() => {
		if (qty > maxQty) qty = Math.max(1, maxQty);
	});

	function decrement() {
		if (qty > 1) qty -= 1;
	}

	function increment() {
		if (qty < maxQty) qty += 1;
	}
</script>

<svelte:head>
	<title>{p.name} - Store Downshit Subang</title>
	<meta
		name="description"
		content={p.description?.slice(0, 160) ||
			`Beli ${p.name} harga ${formatRupiah(p.price)} di Store Downshit.`}
	/>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<Breadcrumb
		items={[
			{ label: 'Produk', href: '/produk' },
			...(p.categoryName
				? [{ label: p.categoryName, href: `/produk?kategori=${p.categorySlug}` }]
				: []),
			{ label: p.name }
		]}
	/>

	{#if form?.message && !form.success}
		<div class="mb-6">
			<Alert type="error" message={form.message} />
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
		<!-- Gallery Media -->
		<div class="space-y-3">
			<div class="product-media group relative !aspect-square overflow-hidden">
				{#if activeImage}
					<img
						src={activeImage}
						alt="{p.name} - Foto {activeImageIndex + 1}"
						class="h-full w-full object-contain transition-opacity duration-200"
					/>
				{:else}
					<div class="flex h-full w-full items-center justify-center">
						<span class="display text-[clamp(2rem,8vw,4rem)] text-ink/10">DOWNSHIT</span>
					</div>
				{/if}

				{#if p.stock <= 0}
					<div class="absolute inset-0 flex items-end bg-paper/55 p-3">
						<span class="badge badge-ink">Habis</span>
					</div>
				{/if}

				<!-- Tombol navigasi jika foto lebih dari 1 -->
				{#if gallery.length > 1}
					<button
						type="button"
						onclick={prevImage}
						aria-label="Foto sebelumnya"
						class="absolute top-1/2 left-3 flex h-9 w-9 -translate-y-1/2 items-center justify-center border border-line bg-paper/90 text-ink opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-ink hover:text-paper focus:opacity-100"
					>
						<ChevronLeft size={20} />
					</button>
					<button
						type="button"
						onclick={nextImage}
						aria-label="Foto berikutnya"
						class="absolute top-1/2 right-3 flex h-9 w-9 -translate-y-1/2 items-center justify-center border border-line bg-paper/90 text-ink opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-ink hover:text-paper focus:opacity-100"
					>
						<ChevronRight size={20} />
					</button>

					<!-- Indikator urutan foto -->
					<div class="absolute right-3 bottom-3">
						<span class="badge border border-line/60 bg-paper/90 text-ink tabular-nums shadow-sm">
							{activeImageIndex + 1} / {gallery.length}
						</span>
					</div>
				{/if}
			</div>

			<!-- Thumbnail strip galeri foto -->
			{#if gallery.length > 1}
				<div class="flex scrollbar-none gap-2 overflow-x-auto pb-1">
					{#each gallery as item, idx (item.id)}
						<button
							type="button"
							onclick={() => (activeImageIndex = idx)}
							class="relative h-18 w-18 shrink-0 overflow-hidden border-2 transition-all sm:h-20 sm:w-20 {activeImageIndex ===
							idx
								? 'scale-[1.02] border-ink opacity-100 shadow-sm'
								: 'border-line opacity-60 hover:border-smoke hover:opacity-100'}"
							aria-label="Pilih foto {idx + 1}"
						>
							<img
								src={item.imageUrl}
								alt="Thumbnail {idx + 1}"
								class="h-full w-full object-cover"
							/>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Info -->
		<div class="lg:sticky lg:top-24 lg:self-start">
			{#if p.categoryName}
				<a href="/produk?kategori={p.categorySlug}" class="eyebrow hover:text-ink hover:underline">
					{p.categoryName}
				</a>
			{/if}
			<h1 class="display mt-2 text-[clamp(1.75rem,4.5vw,3rem)]">{p.name}</h1>

			{#if data.reviewSummary.count > 0 || data.sold > 0}
				<p class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-smoke">
					{#if data.reviewSummary.avg !== null}
						<a href="#ulasan" class="inline-flex items-center gap-1.5 hover:text-ink">
							<Stars value={data.reviewSummary.avg} size={13} />
							<span class="font-semibold text-ink tabular-nums"
								>{data.reviewSummary.avg.toFixed(1)}</span
							>
							<span class="underline underline-offset-2">{data.reviewSummary.count} ulasan</span>
						</a>
					{/if}
					{#if data.sold > 0}<span class="tabular-nums">{data.sold} terjual</span>{/if}
				</p>
			{/if}

			<div class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
				<p class="price text-2xl">{formatRupiah(p.price)}</p>
				{#if p.stock <= 0}
					<span class="badge badge-danger">Stok habis</span>
				{:else if p.stock <= data.lowStock}
					<span class="badge badge-warn">Tersisa {p.stock}</span>
				{:else}
					<span class="text-xs text-smoke">Stok {p.stock} pcs</span>
				{/if}
			</div>

			<div class="divider mt-6 pt-6">
				<!-- Aksi beli -->
				{#if p.stock <= 0}
					<div class="border border-dashed border-line bg-mist/50 p-5 text-center">
						<p class="text-sm font-bold tracking-[0.14em] uppercase">Stok sedang habis</p>
						<p class="mt-1 text-xs text-smoke">Pantau terus toko kami atau pilih produk lainnya.</p>
						<a href="/produk" class="btn btn-sm mt-4">Lihat produk lain</a>
					</div>
					{#if data.isKonsumen}
						<button type="button" disabled class="btn btn-lg btn-block mt-3">
							<ShoppingBag size={16} /> Stok habis
						</button>
					{/if}
				{:else if !data.user}
					<div class="space-y-3">
						<p class="text-sm text-smoke">Masuk ke akunmu untuk mulai berbelanja.</p>
						<a href="/login?next=/produk/{p.slug}" class="btn btn-primary btn-lg btn-block">
							Masuk untuk membeli
						</a>
					</div>
				{:else if data.isKonsumen}
					<form
						method="POST"
						action="?/tambah"
						class="space-y-5"
						use:enhance={enhanceInPlace((b) => (adding = b))}
					>
						<input type="hidden" name="productId" value={p.id} />

						{#if hasSizes}
							<SizePicker sizes={data.sizes} bind:value={size} lowStock={data.lowStock} />
						{/if}

						<div>
							<label for="qty-input" class="label">Jumlah</label>
							<div class="flex items-center gap-3">
								<div class="inline-flex items-stretch border border-line">
									<button
										type="button"
										onclick={decrement}
										disabled={qty <= 1}
										class="flex h-11 w-11 items-center justify-center hover:bg-mist disabled:cursor-not-allowed disabled:opacity-30"
										aria-label="Kurangi jumlah"
									>
										<Minus size={16} />
									</button>
									<input
										id="qty-input"
										type="number"
										name="qty"
										bind:value={qty}
										min="1"
										max={maxQty}
										class="!h-11 !w-14 [appearance:textfield] !border-0 !px-0 text-center font-semibold focus:!shadow-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
									/>
									<button
										type="button"
										onclick={increment}
										disabled={qty >= maxQty || (hasSizes && !size)}
										class="flex h-11 w-11 items-center justify-center hover:bg-mist disabled:cursor-not-allowed disabled:opacity-30"
										aria-label="Tambah jumlah"
									>
										<Plus size={16} />
									</button>
								</div>
								<span class="text-xs text-smoke">
									{hasSizes && !size ? 'Pilih ukuran dulu' : `Maksimal ${maxQty} item`}
								</span>
							</div>
						</div>

						<button
							type="submit"
							class="btn btn-primary btn-lg btn-block"
							disabled={adding || (hasSizes && !size)}
						>
							<ShoppingBag size={16} />
							{adding
								? 'Menambahkan…'
								: hasSizes && !size
									? 'Pilih ukuran dulu'
									: 'Tambah ke keranjang'}
						</button>
					</form>
				{:else}
					<div class="border-l-4 border-warn bg-warn-bg px-4 py-3 text-sm text-warn" role="status">
						Kamu login sebagai <strong>{data.user.role}</strong>. Keranjang dan pembelian hanya
						aktif untuk akun Konsumen.
					</div>
				{/if}
			</div>

			<!-- Deskripsi -->
			<div class="divider mt-8 pt-6">
				<h2 class="panel-title">Deskripsi</h2>
				{#if p.description}
					<p class="mt-3 text-sm leading-relaxed whitespace-pre-line text-smoke">
						{p.description}
					</p>
				{:else}
					<p class="mt-3 text-sm text-smoke italic">Belum ada deskripsi untuk produk ini.</p>
				{/if}
			</div>
		</div>
	</div>

	<!-- Paket bundling terkait -->
	{#if data.relatedBundles.length > 0}
		<section class="mt-16">
			<div class="mb-6 flex items-end justify-between gap-4">
				<h2 class="section-title">Ada di paket bundling</h2>
				<a href="/bundling" class="link inline-flex items-center gap-1.5 text-sm font-semibold">
					Semua paket <ArrowRight size={14} />
				</a>
			</div>

			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.relatedBundles as b (b.id)}
					<a
						href="/bundling/{b.slug}"
						class="group flex items-center gap-4 border border-line bg-paper p-4 hover:border-ink"
					>
						<div class="h-20 w-16 shrink-0 overflow-hidden bg-mist">
							{#if b.imageUrl}
								<img src={thumbOf(b.imageUrl)} alt={b.name} class="h-full w-full object-cover" />
							{:else}
								<div class="flex h-full w-full items-center justify-center">
									<span class="eyebrow">Paket</span>
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="eyebrow">Paket bundling</p>
							<h3
								class="mt-1 truncate text-[13px] font-semibold tracking-wide uppercase group-hover:underline"
							>
								{b.name}
							</h3>
							<p class="price mt-1 text-sm">{formatRupiah(b.price)}</p>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Ulasan pembeli -->
	<section id="ulasan" class="mt-16 scroll-mt-24">
		<div class="mb-6 flex items-end justify-between gap-4">
			<h2 class="section-title">Ulasan pembeli</h2>
			{#if data.reviewSummary.count > 0}
				<p class="meta">{data.reviewSummary.count} ulasan</p>
			{/if}
		</div>

		{#if data.reviewSummary.count === 0}
			<div class="border border-dashed border-line bg-mist/50 px-6 py-12 text-center">
				<p class="text-sm font-bold tracking-[0.14em] uppercase">Belum ada ulasan</p>
				<p class="mx-auto mt-2 max-w-sm text-sm text-smoke">
					Ulasan ditulis pembeli setelah pesanan selesai.
				</p>
			</div>
		{:else}
			<div class="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14">
				<div>
					<p class="display text-6xl tabular-nums">{data.reviewSummary.avg?.toFixed(1)}</p>
					{#if data.reviewSummary.avg !== null}
						<div class="mt-2"><Stars value={data.reviewSummary.avg} size={18} /></div>
					{/if}
					<p class="mt-2 text-xs text-smoke">dari {data.reviewSummary.count} ulasan</p>

					<ul class="mt-5 space-y-1.5" aria-label="Sebaran rating">
						{#each [5, 4, 3, 2, 1] as star (star)}
							{@const n = data.reviewSummary.dist[star - 1]}
							<li class="flex items-center gap-3 text-xs">
								<span class="w-6 tabular-nums">{star}&#9733;</span>
								<span class="h-1.5 flex-1 bg-line">
									<span
										class="block h-full bg-ink"
										style="width: {(n / data.reviewSummary.count) * 100}%"
									></span>
								</span>
								<span class="w-7 text-right text-smoke tabular-nums">{n}</span>
							</li>
						{/each}
					</ul>
				</div>

				<div>
					<ul class="divide-y divide-line border-y border-line">
						{#each data.reviews as r (r.id)}
							<li class="py-5">
								<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
									<div class="flex items-center gap-3">
										<Stars value={r.rating} size={14} />
										<span class="text-sm font-bold">{r.name}</span>
									</div>
									<time class="text-xs text-smoke" datetime={r.createdAt}>
										{new Intl.DateTimeFormat('id-ID', {
											dateStyle: 'medium',
											timeZone: 'Asia/Jakarta'
										}).format(new Date(r.createdAt))}
									</time>
								</div>
								{#if r.comment}
									<p class="mt-2 text-sm leading-relaxed text-smoke">{r.comment}</p>
								{/if}
							</li>
						{/each}
					</ul>
					{#if !data.showAllReviews && data.reviewSummary.count > data.reviews.length}
						<a href="?ulasan=semua#ulasan" class="btn btn-sm mt-6">
							Lihat semua {data.reviewSummary.count} ulasan
						</a>
					{/if}
				</div>
			</div>
		{/if}
	</section>

	<!-- Rekomendasi -->
	<div class="mt-16 space-y-14">
		<ProductShelf
			title="Produk serupa"
			items={data.similar}
			href="/produk?kategori={p.categorySlug ?? ''}"
		/>
		<ProductShelf title="Terlaris" items={data.bestSellers} href="/produk?urut=terlaris" showSold />
		<ProductShelf title="Rating tertinggi" items={data.topRated} href="/produk?urut=rating" />
	</div>
</div>
