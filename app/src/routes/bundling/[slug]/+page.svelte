<script lang="ts">
	import { thumbOf } from '#lib/utils/image';
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import SizePicker from '#lib/components/SizePicker.svelte';
	import { formatRupiah } from '#lib/utils/format';
	import { effectiveBundleStock } from '#lib/utils/bundle';
	import { encodeSelection } from '#lib/utils/sizes';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let b = $derived(data.bundle);
	let qty = $state(1);
	// Pilihan ukuran per komponen ber-ukuran: productId → label
	let picks = $state<Record<number, string>>({});

	const sizedComps = $derived(data.components.filter((c) => c.sizes.length > 0));
	const allPicked = $derived(sizedComps.every((c) => picks[c.productId]));
	const encoded = $derived(
		encodeSelection(
			Object.fromEntries(sizedComps.map((c) => [c.productId, picks[c.productId] ?? '']))
		)
	);

	// Stok efektif: komponen ber-ukuran memakai stok ukuran terpilih (sebelum dipilih, memakai total produk)
	const available = $derived(
		effectiveBundleStock(
			b.stock,
			data.components.map((c) => {
				const picked = c.sizes.find((s) => s.label === picks[c.productId]);
				return {
					stock: !c.productActive
						? 0
						: c.sizes.length > 0 && picked
							? picked.stock
							: c.productStock,
					qty: c.quantity
				};
			})
		)
	);
	const maxQty = $derived(Math.min(allPicked ? available : data.effectiveStock, 99));

	// Ganti ukuran → jumlah paket tidak boleh melebihi stok yang tersedia
	$effect(() => {
		if (qty > maxQty) qty = Math.max(1, maxQty);
	});
	const savingsPct = $derived(
		data.savings > 0 && data.normalPrice > 0
			? Math.round((data.savings / data.normalPrice) * 100)
			: 0
	);

	function decrement() {
		if (qty > 1) qty -= 1;
	}

	function increment() {
		if (qty < maxQty) qty += 1;
	}
</script>

<svelte:head>
	<title>{b.name} (Paket Bundling Hemat) - Store Downshit Subang</title>
	<meta
		name="description"
		content={b.description ||
			`Paket bundling ${b.name} hanya ${formatRupiah(b.price)} di Store Downshit.`}
	/>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<Breadcrumb items={[{ label: 'Bundling', href: '/bundling' }, { label: b.name }]} />

	{#if form?.success}
		<div class="mb-6">
			<Alert
				type="success"
				message={form.message ?? 'Paket bundling berhasil ditambahkan ke keranjang belanja!'}
			/>
			<p class="mt-2 text-xs">
				<a href="/keranjang" class="link font-semibold tracking-[0.14em] uppercase">
					Lihat keranjang
				</a>
			</p>
		</div>
	{:else if form?.message}
		<div class="mb-6">
			<Alert type="error" message={form.message} />
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
		<!-- Media -->
		<div class="product-media">
			{#if b.imageUrl}
				<img src={b.imageUrl} alt={b.name} />
			{:else}
				<div class="flex h-full w-full items-center justify-center">
					<span class="display text-[clamp(2rem,8vw,4rem)] text-ink/10">DOWNSHIT</span>
				</div>
			{/if}
			{#if savingsPct > 0 && data.effectiveStock > 0}
				<span class="badge badge-sale absolute top-3 left-3"
					>Hemat {formatRupiah(data.savings)}</span
				>
			{/if}
			{#if data.effectiveStock <= 0}
				<div class="absolute inset-0 flex items-end bg-paper/55 p-3">
					<span class="badge badge-ink">Habis</span>
				</div>
			{/if}
		</div>

		<!-- Info -->
		<div class="lg:sticky lg:top-24 lg:self-start">
			<p class="eyebrow">Paket bundling &middot; {data.components.length} macam produk</p>
			<h1 class="display mt-2 text-[clamp(1.75rem,4.5vw,3rem)]">{b.name}</h1>

			<!-- Harga -->
			<div class="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<p class="price text-2xl {data.savings > 0 ? 'text-sale' : ''}">{formatRupiah(b.price)}</p>
				{#if data.normalPrice > b.price}
					<p class="price-old text-sm">{formatRupiah(data.normalPrice)}</p>
				{/if}
			</div>
			{#if data.savings > 0}
				<p class="mt-2 text-xs font-semibold tracking-[0.1em] text-sale uppercase">
					Hemat {formatRupiah(data.savings)}{savingsPct > 0 ? ` (${savingsPct}%)` : ''}
				</p>
			{/if}

			<div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
				{#if data.effectiveStock <= 0}
					<span class="badge badge-danger">Stok habis</span>
				{:else if data.effectiveStock <= data.lowStock}
					<span class="badge badge-warn">Tersisa {data.effectiveStock} paket</span>
				{:else}
					<span class="text-xs text-smoke">Stok {data.effectiveStock} paket</span>
				{/if}
			</div>
			<p class="hint">Stok paket dibatasi ketersediaan stok setiap produk di dalamnya.</p>

			<div class="divider mt-6 pt-6">
				<!-- Aksi beli -->
				{#if data.effectiveStock <= 0}
					<div class="border border-dashed border-line bg-mist/50 p-5 text-center">
						<p class="text-sm font-bold tracking-[0.14em] uppercase">Paket sedang habis</p>
						<p class="mt-1 text-xs text-smoke">
							Satu atau beberapa produk di dalam paket ini sedang kehabisan stok.
						</p>
						<a href="/bundling" class="btn btn-sm mt-4">Lihat paket lain</a>
					</div>
					{#if data.isKonsumen}
						<button type="button" disabled class="btn btn-lg btn-block mt-3">
							<ShoppingBag size={16} /> Stok habis
						</button>
					{/if}
				{:else if !data.user}
					<div class="space-y-3">
						<p class="text-sm text-smoke">Masuk ke akunmu untuk membeli paket bundling ini.</p>
						<a href="/login?next=/bundling/{b.slug}" class="btn btn-primary btn-lg btn-block">
							Masuk untuk membeli
						</a>
					</div>
				{:else if data.isKonsumen}
					<form method="POST" action="?/tambah" class="space-y-5">
						<input type="hidden" name="bundleId" value={b.id} />
						<input type="hidden" name="sizes" value={encoded} />

						{#each sizedComps as c (c.productId)}
							<SizePicker
								sizes={c.sizes}
								bind:value={picks[c.productId]}
								name="size-{c.productId}"
								label="Ukuran {c.productName}"
								lowStock={data.lowStock}
							/>
						{/each}

						<div>
							<label for="qty-bundle-input" class="label">Jumlah paket</label>
							<div class="flex items-center gap-3">
								<div class="inline-flex items-stretch border border-line">
									<button
										type="button"
										onclick={decrement}
										disabled={qty <= 1}
										class="flex h-11 w-11 items-center justify-center hover:bg-mist disabled:cursor-not-allowed disabled:opacity-30"
										aria-label="Kurangi paket"
									>
										<Minus size={16} />
									</button>
									<input
										id="qty-bundle-input"
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
										disabled={qty >= maxQty || !allPicked}
										class="flex h-11 w-11 items-center justify-center hover:bg-mist disabled:cursor-not-allowed disabled:opacity-30"
										aria-label="Tambah paket"
									>
										<Plus size={16} />
									</button>
								</div>
								<span class="text-xs text-smoke">
									{allPicked ? `Maksimal ${maxQty} paket` : 'Pilih ukuran dulu'}
								</span>
							</div>
						</div>

						<button type="submit" class="btn btn-primary btn-lg btn-block" disabled={!allPicked}>
							<ShoppingBag size={16} />
							{allPicked ? 'Beli paket bundling' : 'Pilih ukuran dulu'}
						</button>
					</form>
				{:else}
					<div class="border-l-4 border-warn bg-warn-bg px-4 py-3 text-sm text-warn" role="status">
						Kamu login sebagai <strong>{data.user.role}</strong>. Pembelian hanya dapat dilakukan
						oleh akun Konsumen.
					</div>
				{/if}
			</div>

			<!-- Isi paket -->
			<div class="divider mt-8 pt-6">
				<h2 class="panel-title">Isi paket</h2>
				<ul class="mt-4 divide-y divide-line border-y border-line">
					{#each data.components as comp (comp.id)}
						<li>
							<a href="/produk/{comp.productSlug}" class="group flex items-center gap-4 py-3">
								<div class="h-20 w-16 shrink-0 overflow-hidden bg-mist">
									{#if comp.productImage}
										<img
											src={thumbOf(comp.productImage)}
											alt={comp.productName}
											class="h-full w-full object-cover"
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center">
											<span class="eyebrow">DS</span>
										</div>
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<p
										class="truncate text-[13px] font-semibold tracking-wide uppercase group-hover:underline"
									>
										{comp.productName}
									</p>
									<p class="mt-1 text-xs text-smoke">
										{comp.quantity} pcs &times; {formatRupiah(comp.productPrice)}
									</p>
								</div>
								<p class="price shrink-0 text-sm">
									{formatRupiah(comp.productPrice * comp.quantity)}
								</p>
							</a>
						</li>
					{/each}
				</ul>
				<div class="mt-3 flex items-baseline justify-between text-xs text-smoke">
					<span>Total harga normal</span>
					<span class="price-old">{formatRupiah(data.normalPrice)}</span>
				</div>
			</div>

			<!-- Catatan -->
			{#if b.description}
				<div class="divider mt-8 pt-6">
					<h2 class="panel-title">Catatan paket</h2>
					<p class="mt-3 text-sm leading-relaxed whitespace-pre-line text-smoke">
						{b.description}
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
