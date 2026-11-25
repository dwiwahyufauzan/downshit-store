<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { effectiveBundleStock } from '#lib/utils/bundle';
	import { formatRupiah } from '#lib/utils/format';
	import { thumbOf } from '#lib/utils/image';

	type Product = { id: number; name: string; price: number; stock: number; available?: boolean };
	type Item = { productId: number; quantity: number };
	type Errors = Record<string, string[] | undefined>;

	let {
		mode,
		products,
		initial,
		form
	}: {
		mode: 'create' | 'edit';
		products: Product[];
		initial: {
			name: string;
			description: string;
			price: number | string;
			stock?: number; // kuota saat ini (edit) atau kuota awal (tambah)
			isActive: boolean;
			imageUrl?: string | null;
			items: Item[];
		};
		form?: { message?: string; errors?: Errors; values?: Record<string, unknown> } | null;
	} = $props();

	// Setelah gagal validasi, pulihkan isian terakhir (bukan nilai awal). Sengaja dibaca sekali saat komponen dibuat.
	const init = untrack(() => initial);
	const restored = untrack(() => {
		const v = form?.values;
		if (!v) return null;
		let parsed: Item[] = [];
		try {
			const it = v.items;
			if (Array.isArray(it)) parsed = it as Item[];
		} catch {
			parsed = [];
		}
		return {
			name: String(v.name ?? ''),
			description: String(v.description ?? ''),
			price: String(v.price ?? ''),
			stock: String(v.stock ?? ''),
			isActive: Boolean(v.isActive),
			items: parsed
		};
	});

	const startItems = (): Item[] => {
		const src = restored?.items?.length ? restored.items : init.items;
		if (src.length >= 2)
			return src.map((i) => ({
				productId: Number(i.productId),
				quantity: Number(i.quantity) || 1
			}));
		const sel = products.filter((p) => p.available !== false);
		return [
			{ productId: sel[0]?.id ?? 0, quantity: 1 },
			{ productId: sel[1]?.id ?? 0, quantity: 1 }
		];
	};

	let items = $state<Item[]>(startItems());
	let bundlePrice = $state<string>(restored?.price ?? String(init.price ?? ''));
	let quota = $state<string>(restored?.stock ?? String(init.stock ?? 20));
	let preview = $state<string | null>(null);
	let busy = $state(false);

	const productOf = (id: number) => products.find((p) => p.id === Number(id));

	function addItem() {
		const nextUnused = products.find(
			(p) => p.available !== false && !items.some((i) => Number(i.productId) === p.id)
		);
		items.push({ productId: nextUnused?.id ?? products[0]?.id ?? 0, quantity: 1 });
	}

	function removeItem(idx: number) {
		if (items.length > 2) items.splice(idx, 1);
	}

	const normalPrice = $derived(
		items.reduce(
			(sum, it) => sum + (productOf(it.productId)?.price ?? 0) * (Number(it.quantity) || 0),
			0
		)
	);
	// bind:value pada <input type="number"> mengubah state menjadi number/null → selalu dinormalkan ke string dulu
	const priceNum = $derived(String(bundlePrice ?? '').trim() === '' ? null : Number(bundlePrice));
	const savings = $derived(priceNum === null ? null : normalPrice - priceNum);

	// Stok efektif = min(kuota, min(floor(stok komponen / qty)))  (BR-06, TC-005-11)
	const maxFromComponents = $derived(
		effectiveBundleStock(
			Number.MAX_SAFE_INTEGER,
			items.map((it) => ({
				stock: productOf(it.productId)?.stock ?? 0,
				qty: Number(it.quantity) || 1
			}))
		)
	);
	const quotaNum = $derived(Number(quota) || 0);

	const duplicate = $derived(new Set(items.map((i) => Number(i.productId))).size !== items.length);

	function onPick(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (preview) URL.revokeObjectURL(preview);
		preview = file ? URL.createObjectURL(file) : null;
	}
</script>

<div class="space-y-6">
	{#if form?.message}
		<Alert type="error" message={form.message} />
	{/if}

	{#if form?.errors}
		<Alert
			type="error"
			message="Terdapat kesalahan pada input. Silakan periksa formulir di bawah."
		/>
	{/if}

	<form
		method="POST"
		enctype="multipart/form-data"
		class="space-y-6"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<input type="hidden" name="items" value={JSON.stringify(items)} />

		{#if mode === 'edit'}
			<!-- Info kuota read-only (BR-19) -->
			<div
				class="flex flex-col gap-4 border border-line bg-mist p-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<div>
					<div class="eyebrow">Kuota alokasi stok paket saat ini</div>
					<div class="display mt-1 text-4xl">
						{initial.stock ?? 0} <span class="eyebrow">paket</span>
					</div>
				</div>
				<div class="sm:max-w-sm sm:text-right">
					<p class="text-xs text-smoke">
						Dapat dibentuk dari stok komponen saat ini: <strong>{maxFromComponents} paket</strong>.
						Kuota diubah lewat menu Stok (BR-19).
					</p>
					<a href="/admin/stok" class="link mt-1 inline-block text-xs font-bold">
						Sesuaikan kuota di menu Stok &rarr;
					</a>
				</div>
			</div>
		{/if}

		<div class="grid gap-6 lg:grid-cols-[1fr_20rem]">
			<div class="panel space-y-6 self-start">
				<h2 class="panel-title">Informasi paket</h2>

				<div>
					<label for="name" class="label">Nama paket bundling</label>
					<input
						id="name"
						name="name"
						type="text"
						maxlength="150"
						placeholder="Contoh: Streetwear Starter Pack (T-Shirt + Cap)"
						value={restored?.name ?? initial.name}
						required
					/>
					{#if form?.errors?.name}
						<p class="field-error">{form.errors.name[0]}</p>
					{/if}
				</div>

				<div>
					<label for="description" class="label">Deskripsi paket</label>
					<textarea
						id="description"
						name="description"
						rows="5"
						maxlength="2000"
						placeholder="Paket hemat kombinasi streetwear pilihan terbaik..."
						>{restored?.description ?? initial.description}</textarea
					>
					{#if form?.errors?.description}
						<p class="field-error">{form.errors.description[0]}</p>
					{/if}
				</div>
			</div>

			<div class="panel self-start">
				<h2 class="panel-title">Foto paket</h2>
				<div class="product-media mx-auto mt-4 max-w-64 lg:max-w-none">
					{#if preview}
						<img src={preview} alt="Pratinjau foto paket" />
					{:else if initial.imageUrl}
						<img src={thumbOf(initial.imageUrl)} alt="Foto paket saat ini" />
					{:else}
						<div class="flex h-full w-full flex-col items-center justify-center gap-2 text-smoke">
							<ImageIcon size={28} strokeWidth={1.5} />
							<span class="eyebrow">Belum ada foto</span>
						</div>
					{/if}
				</div>

				<div class="mt-4">
					<label for="image" class="label">
						{mode === 'edit' ? 'Ganti foto paket (opsional)' : 'Foto paket bundling'}
					</label>
					<input
						id="image"
						name="image"
						type="file"
						accept="image/jpeg,image/png,image/webp"
						onchange={onPick}
						class="block w-full text-xs text-smoke file:mr-3 file:border file:border-ink file:bg-paper file:px-3 file:py-2 file:text-[11px] file:font-semibold file:tracking-[0.14em] file:text-ink file:uppercase hover:file:bg-ink hover:file:text-paper"
					/>
					<p class="hint">
						JPG, PNG, atau WEBP maks 2 MB{mode === 'edit'
							? '. Kosongkan bila tidak ingin mengubah foto.'
							: ''}
					</p>
					{#if mode === 'edit' && initial.imageUrl && !preview}
						<label class="mt-3 flex items-center gap-2 text-xs font-medium">
							<input type="checkbox" name="removeImage" class="accent-ink" />
							Hapus foto saat ini (tanpa foto)
						</label>
					{/if}
					{#if form?.errors?.image}
						<p class="field-error">{form.errors.image[0]}</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Pemilih komponen produk dinamis -->
		<section class="panel space-y-4">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p class="eyebrow">Langkah 1</p>
					<h2 class="panel-title mt-1">Komponen produk (minimal 2 produk berbeda)</h2>
					<p class="hint">Hanya produk berstatus Bundleable dan Aktif yang dapat dipilih.</p>
				</div>
				<button type="button" onclick={addItem} class="btn btn-tool btn-primary shrink-0">
					<Plus size={14} /> Tambah produk
				</button>
			</div>

			{#if products.filter((p) => p.available !== false).length < 2}
				<Alert
					type="warning"
					message="Belum ada cukup produk yang boleh dibundling. Centang &quot;Izinkan masuk paket bundling&quot; dan aktifkan minimal 2 produk di menu Produk."
				/>
			{/if}

			<div class="space-y-3">
				{#each items as it, idx (idx)}
					<div
						class="grid gap-3 border border-line bg-mist p-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end"
					>
						<div>
							<label for="prod-{idx}" class="label">Produk #{idx + 1}</label>
							<select id="prod-{idx}" bind:value={it.productId}>
								{#each products as prod (prod.id)}
									<option value={prod.id}>
										{prod.name} (Harga: {formatRupiah(prod.price)} | Stok: {prod.stock}){prod.available ===
										false
											? ' - TIDAK TERSEDIA'
											: ''}
									</option>
								{/each}
							</select>
							{#if productOf(it.productId)?.available === false}
								<p class="field-error">
									Produk ini nonaktif/tidak boleh dibundling lagi. Ganti atau hapus dari paket.
								</p>
							{/if}
						</div>

						<div>
							<label for="qty-{idx}" class="label">Jumlah</label>
							<input
								id="qty-{idx}"
								type="number"
								min="1"
								max="20"
								bind:value={it.quantity}
								class="text-center"
							/>
						</div>

						<button
							type="button"
							onclick={() => removeItem(idx)}
							disabled={items.length <= 2}
							class="btn btn-danger-outline"
							aria-label="Hapus produk #{idx + 1}"
						>
							<Trash2 size={14} /> Hapus
						</button>
					</div>
				{/each}
			</div>

			{#if duplicate}
				<p class="field-error" role="alert">
					Satu produk tidak boleh dipilih dua kali dalam satu paket.
				</p>
			{/if}
			{#if form?.errors?.items}
				<p class="field-error">{form.errors.items[0]}</p>
			{/if}
		</section>

		<!-- Kalkulator hemat & harga paket -->
		<section class="panel space-y-5">
			<div>
				<p class="eyebrow">Langkah 2</p>
				<h2 class="panel-title mt-1">Kalkulator harga &amp; simulasi hemat</h2>
			</div>

			<div class="grid gap-px border border-line bg-line sm:grid-cols-3">
				<div class="bg-paper p-4">
					<span class="eyebrow block">Total harga normal satuan</span>
					<span class="display mt-2 block text-2xl">{formatRupiah(normalPrice)}</span>
				</div>

				<div class="bg-paper p-4">
					<label for="price" class="label">Harga paket bundling (Rp)</label>
					<input
						id="price"
						name="price"
						type="number"
						min="1000"
						step="1"
						bind:value={bundlePrice}
						placeholder="Contoh: 250000"
						required
						class="font-bold"
					/>
					{#if form?.errors?.price}
						<p class="field-error">{form.errors.price[0]}</p>
					{/if}
				</div>

				<div class="bg-paper p-4">
					<span class="eyebrow block">Nilai penghematan konsumen</span>
					{#if savings === null}
						<span class="mt-2 block text-sm text-smoke">Isi harga paket untuk melihat hemat.</span>
					{:else if savings > 0}
						<span class="display mt-2 block text-2xl text-ok">Hemat {formatRupiah(savings)}</span>
					{:else if savings === 0}
						<span class="display mt-2 block text-2xl text-warn">Sama dengan harga normal</span>
					{:else}
						<span class="display mt-2 block text-2xl text-danger">
							Lebih mahal {formatRupiah(Math.abs(savings))}
						</span>
					{/if}
				</div>
			</div>

			{#if savings !== null && savings <= 0}
				<Alert
					type={savings < 0 ? 'error' : 'warning'}
					message={savings < 0
						? 'Peringatan: harga paket LEBIH MAHAL dari total harga normal, paket ini tidak hemat bagi konsumen. Tetap boleh disimpan.'
						: 'Harga paket sama dengan harga normal, belum ada penghematan bagi konsumen.'}
				/>
			{/if}

			<div class="grid gap-6 sm:grid-cols-2">
				{#if mode === 'create'}
					<div>
						<label for="stock" class="label">Kuota penjualan paket (stok bundling)</label>
						<input
							id="stock"
							name="stock"
							type="number"
							min="0"
							max="100000"
							bind:value={quota}
							required
						/>
						<p class="hint">
							Dapat dibentuk dari stok komponen saat ini: <strong>{maxFromComponents} paket</strong
							>. Konsumen hanya bisa membeli sebanyak stok efektif = min(kuota, stok komponen).
						</p>
						{#if form?.errors?.stock}
							<p class="field-error">{form.errors.stock[0]}</p>
						{/if}
						{#if quotaNum > maxFromComponents}
							<p class="field-error" role="status">
								Kuota melebihi stok komponen; yang efektif dijual hanya {maxFromComponents} paket.
							</p>
						{/if}
					</div>
				{:else if (initial.stock ?? 0) > maxFromComponents}
					<div>
						<Alert
							type="warning"
							message="Stok paket ({initial.stock}) melebihi stok komponen; yang efektif dijual = {maxFromComponents} paket."
						/>
					</div>
				{/if}

				<div class="flex items-center">
					<label class="flex items-start gap-3">
						<input
							type="checkbox"
							name="isActive"
							checked={restored ? restored.isActive : initial.isActive}
							class="mt-0.5 shrink-0 accent-ink"
						/>
						<span>
							<span class="block text-sm font-semibold">Aktifkan di katalog bundling</span>
							<span class="hint !mt-0.5 block">Konsumen langsung dapat memesan paket ini.</span>
						</span>
					</label>
				</div>
			</div>
		</section>

		<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<a href="/admin/bundling" class="btn">Batal</a>
			<button type="submit" class="btn btn-primary" disabled={busy}>
				{busy ? 'Menyimpan…' : mode === 'edit' ? 'Simpan perubahan' : 'Simpan paket bundling'}
			</button>
		</div>
	</form>
</div>
