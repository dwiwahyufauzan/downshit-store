<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SizeEditor from '#lib/components/SizeEditor.svelte';
	import ImageIcon from '@lucide/svelte/icons/image';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let p = $derived(data.product);
	let v = $derived((form?.values as Record<string, unknown>) ?? p);

	let deletedImageIds = $state<number[]>([]);
	let customPrimaryUrl = $state<string | null>(null);
	const primaryImageUrl = $derived(
		customPrimaryUrl ?? p.imageUrl ?? data.images[0]?.imageUrl ?? null
	);
	let newFilesList = $state<{ file: File; url: string }[]>([]);
	let activePreview = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let busy = $state(false);

	const activeImages = $derived(data.images.filter((img) => !deletedImageIds.includes(img.id)));
	const displayedMain = $derived(
		activePreview ?? primaryImageUrl ?? activeImages[0]?.imageUrl ?? newFilesList[0]?.url ?? null
	);

	// Isian ukuran sebelum submit gagal (dikirim ulang server agar baris tidak hilang)
	function parseRows(raw: unknown): { label: string; stock: number }[] {
		try {
			const j = JSON.parse(String(raw ?? '[]'));
			return Array.isArray(j) ? j : [];
		} catch {
			return [];
		}
	}
	function parseRemove(raw: unknown): string[] {
		try {
			const j = JSON.parse(String(raw ?? '[]'));
			return Array.isArray(j) ? j : [];
		} catch {
			return [];
		}
	}

	function syncInput() {
		if (!fileInput) return;
		try {
			const dt = new DataTransfer();
			for (const item of newFilesList) {
				dt.items.add(item.file);
			}
			fileInput.files = dt.files;
		} catch {
			// DataTransfer tidak didukung browser ini: biarkan input file apa adanya
		}
	}

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		const newItems: { file: File; url: string }[] = [];
		for (let i = 0; i < input.files.length; i++) {
			const file = input.files[i];
			newItems.push({ file, url: URL.createObjectURL(file) });
		}
		newFilesList = [...newFilesList, ...newItems];
		if (!customPrimaryUrl && !p.imageUrl && newFilesList.length > 0) {
			customPrimaryUrl = newFilesList[0].url;
		}
		activePreview = newItems[0]?.url ?? null;
		syncInput();
	}

	function removeNewFile(index: number, e?: Event) {
		e?.stopPropagation();
		URL.revokeObjectURL(newFilesList[index].url);
		newFilesList = newFilesList.filter((_, i) => i !== index);
		if (activePreview === newFilesList[index]?.url) {
			activePreview = null;
		}
		syncInput();
	}

	function markDeleteExisting(id: number, url: string, e?: Event) {
		e?.stopPropagation();
		if (!deletedImageIds.includes(id)) {
			deletedImageIds = [...deletedImageIds, id];
		}
		if (primaryImageUrl === url) {
			const nextAvailable = data.images.find(
				(img) => !deletedImageIds.includes(img.id) && img.id !== id
			);
			customPrimaryUrl = nextAvailable ? nextAvailable.imageUrl : (newFilesList[0]?.url ?? null);
		}
		if (activePreview === url) {
			activePreview = null;
		}
	}

	function restoreExisting(id: number, e?: Event) {
		e?.stopPropagation();
		deletedImageIds = deletedImageIds.filter((x) => x !== id);
	}

	function setAsPrimary(url: string, e?: Event) {
		e?.stopPropagation();
		customPrimaryUrl = url;
		activePreview = url;
	}
</script>

<svelte:head>
	<title>Edit Produk: {p.name} - Admin Downshit</title>
</svelte:head>

<div>
	<Breadcrumb
		home={{ label: 'Admin', href: '/admin' }}
		items={[{ label: 'Produk', href: '/admin/produk' }, { label: p.name }]}
	/>
	<PageHeader title="Ubah produk" meta={p.name} />

	{#if form?.message}
		<div class="mt-6"><Alert type="error" message={form.message} /></div>
	{/if}

	{#if form?.errors}
		<div class="mt-6">
			<Alert
				type="error"
				message="Terdapat kesalahan pada input. Silakan periksa formulir di bawah."
			/>
		</div>
	{/if}

	<form
		method="POST"
		enctype="multipart/form-data"
		class="mt-6 space-y-6"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<!-- Info stok read-only (BR-19) -->
		<div
			class="flex flex-col gap-4 border border-line bg-mist p-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				<div class="eyebrow">Stok fisik saat ini</div>
				<div class="display mt-1 text-4xl">
					{p.stock} <span class="eyebrow">unit</span>
				</div>
				{#if data.sizes.length > 0}
					<div class="mt-2 flex flex-wrap gap-1">
						{#each data.sizes as sz (sz.label)}
							<span
								class="tag tabular-nums {sz.stock === 0
									? '!text-danger'
									: sz.stock <= data.lowStock
										? '!text-warn'
										: ''}"
							>
								{sz.label}
								{sz.stock}
							</span>
						{/each}
					</div>
				{/if}
			</div>
			<div class="sm:max-w-sm sm:text-right">
				<p class="text-xs text-smoke">
					Sesuai aturan bisnis BR-19, stok diubah via menu Stok (opname) atau Pembelian (restock).
				</p>
				<a href="/admin/stok" class="link mt-1 inline-block text-xs font-bold">
					Sesuaikan stok di menu Stok &rarr;
				</a>
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-[1fr_20rem]">
			<div class="space-y-6 self-start">
				<div class="panel space-y-6">
					<h2 class="panel-title">Informasi produk</h2>

					<div>
						<label for="name" class="label">Nama produk</label>
						<input
							id="name"
							name="name"
							type="text"
							class="h-[46px] w-full"
							value={v.name ?? ''}
							required
						/>
						{#if form?.errors?.name}
							<p class="field-error">{form.errors.name[0]}</p>
						{/if}
					</div>

					<div class="grid gap-6 sm:grid-cols-2">
						<div>
							<label for="categoryId" class="label">Kategori</label>
							<select id="categoryId" name="categoryId" class="h-[46px] w-full" required>
								<option value="">Pilih kategori...</option>
								{#each data.categories as cat (cat.id)}
									<option value={cat.id} selected={Number(v.categoryId) === cat.id}>
										{cat.name}
									</option>
								{/each}
							</select>
							{#if form?.errors?.categoryId}
								<p class="field-error">{form.errors.categoryId[0]}</p>
							{/if}
						</div>

						<div>
							<label for="price" class="label">Harga satuan (Rp)</label>
							<input
								id="price"
								name="price"
								type="number"
								min="1000"
								step="1"
								class="h-[46px] w-full"
								value={v.price ?? ''}
								required
							/>
							{#if form?.errors?.price}
								<p class="field-error">{form.errors.price[0]}</p>
							{/if}
						</div>
					</div>

					<div>
						<label for="description" class="label">Deskripsi produk</label>
						<textarea id="description" name="description" rows="5">{v.description ?? ''}</textarea>
						{#if form?.errors?.description}
							<p class="field-error">{form.errors.description[0]}</p>
						{/if}
					</div>
				</div>

				<div class="panel space-y-4">
					<h2 class="panel-title">Ukuran &amp; stok</h2>
					<SizeEditor
						existing={data.sizes}
						initialRows={parseRows(
							form?.values && 'sizesNew' in form.values ? form.values.sizesNew : ''
						)}
						initialRemove={parseRemove(
							form?.values && 'sizesRemove' in form.values ? form.values.sizesRemove : ''
						)}
						lowStock={data.lowStock}
						unsizedStock={p.stock}
					/>
					{#if form?.errors?.sizes}
						<p class="field-error">{form.errors.sizes[0]}</p>
					{/if}
				</div>
			</div>

			<div class="space-y-6">
				<!-- Hidden input untuk tracking foto yang dihapus & foto utama -->
				{#each deletedImageIds as delId (delId)}
					<input type="hidden" name="deleteImageIds" value={delId} />
				{/each}
				<input type="hidden" name="primaryImageUrl" value={primaryImageUrl ?? ''} />

				<div class="panel space-y-4">
					<div class="flex items-center justify-between">
						<h2 class="panel-title">Galeri foto produk</h2>
						<span class="eyebrow text-smoke">
							{activeImages.length + newFilesList.length} foto
						</span>
					</div>

					<div class="product-media relative mx-auto max-w-64 lg:max-w-none">
						{#if displayedMain}
							<img
								src={displayedMain}
								alt="Pratinjau foto produk"
								class="h-full w-full object-cover"
							/>
							<div class="absolute top-2 left-2 flex gap-1">
								{#if displayedMain === primaryImageUrl}
									<span class="badge badge-ink flex items-center gap-1 shadow-sm">
										<Star size={10} class="fill-current" /> Foto Utama (Katalog)
									</span>
								{:else}
									<span class="badge bg-paper/90 text-ink shadow-sm"> Pratinjau Foto </span>
								{/if}
							</div>
						{:else}
							<div class="flex h-full w-full flex-col items-center justify-center gap-2 text-smoke">
								<ImageIcon size={28} strokeWidth={1.5} />
								<span class="eyebrow">Belum ada foto</span>
							</div>
						{/if}
					</div>

					<!-- Foto yang sudah tersimpan di database -->
					{#if data.images.length > 0}
						<div class="space-y-2">
							<div class="text-[11px] font-semibold tracking-wider text-smoke uppercase">
								Foto Tersimpan:
							</div>
							<div class="grid grid-cols-4 gap-2">
								{#each data.images as img (img.id)}
									{@const isDeleted = deletedImageIds.includes(img.id)}
									{@const isPrimary = img.imageUrl === primaryImageUrl && !isDeleted}
									<div
										class="group relative aspect-square overflow-hidden border-2 transition-all {isDeleted
											? 'border-danger/60 opacity-40'
											: displayedMain === img.imageUrl
												? 'border-ink shadow'
												: 'border-line hover:border-smoke'}"
										onclick={() => {
											if (!isDeleted) activePreview = img.imageUrl;
										}}
										onkeydown={(e) => {
											if (!isDeleted && e.key === 'Enter') activePreview = img.imageUrl;
										}}
										role="button"
										tabindex="0"
										title={isDeleted ? 'Ditandai untuk dihapus' : 'Klik untuk melihat pratinjau'}
									>
										<img src={img.imageUrl} alt="Foto produk" class="h-full w-full object-cover" />
										{#if isPrimary}
											<div class="absolute top-1 left-1">
												<span class="badge badge-ink !px-1 !py-0.5 !text-[9px] leading-tight">
													Utama
												</span>
											</div>
										{/if}

										{#if isDeleted}
											<div
												class="absolute inset-0 flex flex-col items-center justify-center bg-danger/80 p-1 text-center"
											>
												<span class="text-[9px] font-bold tracking-wider text-paper uppercase">
													Dihapus
												</span>
												<button
													type="button"
													onclick={(e) => restoreExisting(img.id, e)}
													class="mt-1 flex items-center gap-0.5 rounded bg-paper px-1 py-0.5 text-[9px] font-semibold text-ink hover:bg-mist"
													title="Batalkan hapus"
												>
													<RotateCcw size={10} /> Batal
												</button>
											</div>
										{:else}
											<div
												class="absolute inset-0 flex items-center justify-center gap-1 bg-ink/70 opacity-0 transition-opacity group-hover:opacity-100"
											>
												{#if !isPrimary}
													<button
														type="button"
														onclick={(e) => setAsPrimary(img.imageUrl, e)}
														class="p-1 text-paper hover:text-warn"
														title="Jadikan Foto Utama"
													>
														<Star size={14} />
													</button>
												{/if}
												<button
													type="button"
													onclick={(e) => markDeleteExisting(img.id, img.imageUrl, e)}
													class="p-1 text-paper hover:text-danger"
													title="Hapus foto ini"
												>
													<Trash2 size={14} />
												</button>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Foto baru yang akan diunggah -->
					{#if newFilesList.length > 0}
						<div class="space-y-2 border-t border-line/60 pt-3">
							<div class="text-[11px] font-semibold tracking-wider text-smoke uppercase">
								Foto Baru Ditambahkan:
							</div>
							<div class="grid grid-cols-4 gap-2">
								{#each newFilesList as item, idx (item.url)}
									{@const isPrimary = item.url === primaryImageUrl}
									<div
										class="group relative aspect-square overflow-hidden border-2 transition-all {displayedMain ===
										item.url
											? 'border-ink shadow'
											: 'border-line hover:border-smoke'}"
										onclick={() => (activePreview = item.url)}
										onkeydown={(e) => e.key === 'Enter' && (activePreview = item.url)}
										role="button"
										tabindex="0"
										title="Klik untuk melihat pratinjau"
									>
										<img
											src={item.url}
											alt="Foto baru {idx + 1}"
											class="h-full w-full object-cover"
										/>
										{#if isPrimary}
											<div class="absolute top-1 left-1">
												<span class="badge badge-ink !px-1 !py-0.5 !text-[9px] leading-tight">
													Utama
												</span>
											</div>
										{/if}
										<div
											class="absolute inset-0 flex items-center justify-center gap-1 bg-ink/70 opacity-0 transition-opacity group-hover:opacity-100"
										>
											{#if !isPrimary}
												<button
													type="button"
													onclick={(e) => setAsPrimary(item.url, e)}
													class="p-1 text-paper hover:text-warn"
													title="Jadikan Foto Utama"
												>
													<Star size={14} />
												</button>
											{/if}
											<button
												type="button"
												onclick={(e) => removeNewFile(idx, e)}
												class="p-1 text-paper hover:text-danger"
												title="Hapus foto baru ini"
											>
												<Trash2 size={14} />
											</button>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<div class="mt-4 border-t border-line/60 pt-3">
						<label for="image-picker" class="label">Tambah foto baru ke galeri</label>
						<input
							id="image-picker"
							bind:this={fileInput}
							name="images"
							type="file"
							multiple
							accept="image/jpeg,image/png,image/webp"
							onchange={onPick}
							class="block w-full text-xs text-smoke file:mr-3 file:border file:border-ink file:bg-paper file:px-3 file:py-2 file:text-[11px] file:font-semibold file:tracking-[0.14em] file:text-ink file:uppercase hover:file:bg-ink hover:file:text-paper"
						/>
						<p class="hint">
							Bisa memilih lebih dari 1 file sekaligus. JPG, PNG, atau WEBP maks 2 MB per file.
						</p>
						{#if form?.errors?.image}
							<p class="field-error">{form.errors.image[0]}</p>
						{/if}
					</div>
				</div>

				<div class="panel space-y-4">
					<h2 class="panel-title">Pengaturan</h2>
					<label class="flex items-start gap-3">
						<input
							type="checkbox"
							name="isBundleable"
							checked={Boolean(v.isBundleable ?? false)}
							class="mt-0.5 shrink-0 accent-ink"
						/>
						<span>
							<span class="block text-sm font-semibold">Izinkan masuk paket bundling</span>
							<span class="hint !mt-0.5 block">
								Produk dapat dipilih sebagai komponen paket bundling hemat.
							</span>
						</span>
					</label>

					<label class="flex items-start gap-3">
						<input
							type="checkbox"
							name="isActive"
							checked={Boolean(v.isActive ?? false)}
							class="mt-0.5 shrink-0 accent-ink"
						/>
						<span>
							<span class="block text-sm font-semibold">Tampilkan di katalog (aktif)</span>
							<span class="hint !mt-0.5 block">
								Jika tidak dicentang, produk disembunyikan dari etalase konsumen.
							</span>
						</span>
					</label>
				</div>
			</div>
		</div>

		<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<a href="/admin/produk" class="btn">Batal</a>
			<button type="submit" class="btn btn-primary" disabled={busy}>
				{busy ? 'Menyimpan…' : 'Simpan perubahan'}
			</button>
		</div>
	</form>
</div>
