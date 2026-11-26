<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SizeEditor from '#lib/components/SizeEditor.svelte';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let v = $derived((form?.values as Record<string, unknown>) ?? {});

	let filesList = $state<{ file: File; url: string }[]>([]);
	let activePreviewIndex = $state(0);
	let fileInput = $state<HTMLInputElement | null>(null);
	let busy = $state(false);
	let sizeCount = $state(0);

	// Isian ukuran sebelum submit gagal (dikirim ulang server agar baris tidak hilang)
	function parseRows(raw: unknown): { label: string; stock: number }[] {
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
			for (const item of filesList) {
				dt.items.add(item.file);
			}
			fileInput.files = dt.files;
		} catch {
			// fallback bila DataTransfer tidak didukung
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
		filesList = [...filesList, ...newItems];
		activePreviewIndex = filesList.length - newItems.length; // arahkan ke foto baru pertama
		syncInput();
	}

	function removeImage(index: number, e?: Event) {
		e?.stopPropagation();
		URL.revokeObjectURL(filesList[index].url);
		filesList = filesList.filter((_, i) => i !== index);
		if (activePreviewIndex >= filesList.length) {
			activePreviewIndex = Math.max(0, filesList.length - 1);
		}
		syncInput();
	}

	function setPrimary(index: number, e?: Event) {
		e?.stopPropagation();
		if (index === 0 || index >= filesList.length) return;
		const item = filesList[index];
		const remaining = filesList.filter((_, i) => i !== index);
		filesList = [item, ...remaining];
		activePreviewIndex = 0;
		syncInput();
	}
</script>

<svelte:head>
	<title>Tambah Produk Baru - Admin Downshit</title>
</svelte:head>

<div>
	<Breadcrumb
		home={{ label: 'Admin', href: '/admin' }}
		items={[{ label: 'Produk', href: '/admin/produk' }, { label: 'Tambah produk' }]}
	/>
	<PageHeader title="Tambah produk baru" />

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
							placeholder="Contoh: Heavyweight Boxy T-Shirt 'Rebel' Black"
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
									<option value={cat.id} selected={String(v.categoryId) === String(cat.id)}>
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
								placeholder="150000"
								class="h-[46px] w-full"
								value={v.price ?? ''}
								required
							/>
							{#if form?.errors?.price}
								<p class="field-error">{form.errors.price[0]}</p>
							{/if}
						</div>

						<div>
							<label for="weightGrams" class="label">Berat satuan (gram)</label>
							<input
								id="weightGrams"
								name="weightGrams"
								type="number"
								min="1"
								max="50000"
								step="1"
								class="h-[46px] w-full"
								value={v.weightGrams ?? 300}
								required
							/>
							<p class="hint">Dipakai menghitung ongkir. Kaos ± 250, hoodie ± 600.</p>
							{#if form?.errors?.weightGrams}
								<p class="field-error">{form.errors.weightGrams[0]}</p>
							{/if}
						</div>

						<div>
							<label for="stock" class="label">Stok awal</label>
							<input
								id="stock"
								name="stock"
								type="number"
								min="0"
								placeholder="50"
								class="h-[46px] w-full"
								value={sizeCount > 0 ? '0' : (v.stock ?? '0')}
								disabled={sizeCount > 0}
								required={sizeCount === 0}
							/>
							<p class="hint">
								{sizeCount > 0
									? 'Dihitung dari stok tiap ukuran di bawah'
									: 'Stok awal saat pendaftaran item baru'}
							</p>
							{#if form?.errors?.stock}
								<p class="field-error">{form.errors.stock[0]}</p>
							{/if}
						</div>
					</div>

					<div>
						<label for="description" class="label">Deskripsi produk</label>
						<textarea
							id="description"
							name="description"
							rows="5"
							placeholder="Bahan 100% cotton combed 24s, sablon discharge, potongan boxy fit..."
							>{v.description ?? ''}</textarea
						>
						{#if form?.errors?.description}
							<p class="field-error">{form.errors.description[0]}</p>
						{/if}
					</div>
				</div>

				<div class="panel space-y-4">
					<h2 class="panel-title">Ukuran &amp; stok</h2>
					<SizeEditor bind:count={sizeCount} initialRows={parseRows(v.sizesNew)} />
					{#if form?.errors?.sizes}
						<p class="field-error">{form.errors.sizes[0]}</p>
					{/if}
				</div>
			</div>

			<div class="space-y-6">
				<div class="panel space-y-4">
					<div class="flex items-center justify-between">
						<h2 class="panel-title">Foto produk</h2>
						{#if filesList.length > 0}
							<span class="eyebrow text-smoke">{filesList.length} foto dipilih</span>
						{/if}
					</div>

					<div class="product-media relative mx-auto max-w-64 lg:max-w-none">
						{#if filesList.length > 0 && filesList[activePreviewIndex]}
							<img
								src={filesList[activePreviewIndex].url}
								alt="Pratinjau foto {activePreviewIndex + 1}"
								class="h-full w-full object-cover"
							/>
							<div class="absolute top-2 left-2 flex gap-1">
								{#if activePreviewIndex === 0}
									<span class="badge badge-ink flex items-center gap-1 shadow-sm">
										<Star size={10} class="fill-current" /> Foto Utama (Katalog)
									</span>
								{:else}
									<span class="badge bg-paper/90 text-ink shadow-sm">
										Foto #{activePreviewIndex + 1}
									</span>
								{/if}
							</div>
						{:else}
							<div class="flex h-full w-full flex-col items-center justify-center gap-2 text-smoke">
								<ImageIcon size={28} strokeWidth={1.5} />
								<span class="eyebrow">Belum ada foto</span>
							</div>
						{/if}
					</div>

					{#if filesList.length > 0}
						<!-- Thumbnail list -->
						<div class="space-y-2">
							<div class="text-[11px] font-semibold tracking-wider text-smoke uppercase">
								Daftar Galeri Foto:
							</div>
							<div class="grid grid-cols-4 gap-2">
								{#each filesList as item, idx (item.url)}
									<div
										class="group relative aspect-square cursor-pointer border-2 transition-all {activePreviewIndex ===
										idx
											? 'border-ink shadow'
											: 'border-line hover:border-smoke'}"
										onclick={() => (activePreviewIndex = idx)}
										onkeydown={(e) => e.key === 'Enter' && (activePreviewIndex = idx)}
										role="button"
										tabindex="0"
										title="Klik untuk melihat pratinjau"
									>
										<img
											src={item.url}
											alt="Thumbnail {idx + 1}"
											class="h-full w-full object-cover"
										/>
										{#if idx === 0}
											<div class="absolute top-1 left-1">
												<span class="badge badge-ink !px-1 !py-0.5 !text-[9px] leading-tight">
													Utama
												</span>
											</div>
										{/if}
										<div
											class="absolute inset-0 flex items-center justify-center gap-1 bg-ink/70 opacity-0 transition-opacity group-hover:opacity-100"
										>
											{#if idx !== 0}
												<button
													type="button"
													onclick={(e) => setPrimary(idx, e)}
													class="p-1 text-paper hover:text-warn"
													title="Jadikan Foto Utama"
												>
													<Star size={14} />
												</button>
											{/if}
											<button
												type="button"
												onclick={(e) => removeImage(idx, e)}
												class="p-1 text-paper hover:text-danger"
												title="Hapus foto ini"
											>
												<Trash2 size={14} />
											</button>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<div class="mt-4">
						<label for="image-picker" class="label">
							{filesList.length > 0 ? 'Tambah foto lain' : 'Pilih file foto produk'}
						</label>
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
							Bisa memilih lebih dari 1 foto. JPG, PNG, atau WEBP maks 2 MB per file. Foto pertama
							otomatis menjadi foto utama.
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
							checked={Boolean(v.isBundleable ?? true)}
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
							checked={Boolean(v.isActive ?? true)}
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
				{busy ? 'Menyimpan…' : 'Simpan produk'}
			</button>
		</div>
	</form>
</div>
