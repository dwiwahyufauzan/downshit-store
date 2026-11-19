<script lang="ts">
	import Alert from '$lib/components/Alert.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let editingId = $state<number | null>(null);
	let editName = $state('');
	let editDescription = $state('');

	// Update gagal validasi → tetap di mode ubah dengan isian terakhir
	$effect(() => {
		if (form?.action === 'update' && form.id && form.errors) {
			editingId = form.id;
			editName = String(form.values?.name ?? '');
			editDescription = String(form.values?.description ?? '');
		}
	});

	function startEdit(cat: { id: number; name: string; description: string | null }) {
		editingId = cat.id;
		editName = cat.name;
		editDescription = cat.description ?? '';
	}

	function cancelEdit() {
		editingId = null;
		editName = '';
		editDescription = '';
	}
</script>

<svelte:head>
	<title>Kelola Kategori - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Kelola kategori" meta="{data.categories.length} kategori" />

	{#if form?.success}
		<div class="mt-6">
			<Alert type="success" message={form.message ?? 'Kategori berhasil disimpan.'} />
		</div>
	{:else if form?.message}
		<div class="mt-6"><Alert type="error" message={form.message} /></div>
	{/if}

	<div class="mt-6 space-y-6">
		<!-- Form tambah kategori -->
		<div class="panel">
			<h2 class="panel-title mb-4">Tambah kategori baru</h2>
			<form
				method="POST"
				action="?/create"
				class="grid gap-4 md:grid-cols-[1fr_1.5fr_auto] md:items-start"
			>
				<div>
					<label for="name" class="label">Nama kategori</label>
					<input
						id="name"
						name="name"
						type="text"
						placeholder="Contoh: Outerwear"
						maxlength="100"
						value={form?.action === 'create' ? String(form?.values?.name ?? '') : ''}
						required
					/>
					{#if form?.action === 'create' && form?.errors?.name}
						<p class="field-error">{form.errors.name[0]}</p>
					{/if}
				</div>

				<div>
					<label for="description" class="label">Deskripsi (opsional)</label>
					<textarea
						id="description"
						name="description"
						rows="1"
						maxlength="500"
						placeholder="Keterangan singkat kategori..."
						>{form?.action === 'create' ? String(form?.values?.description ?? '') : ''}</textarea
					>
					{#if form?.action === 'create' && form?.errors?.description}
						<p class="field-error">{form.errors.description[0]}</p>
					{/if}
				</div>

				<button type="submit" class="btn btn-primary md:mt-[1.4rem]">
					<Plus size={16} /> Tambah kategori
				</button>
			</form>
		</div>

		<!-- Daftar kategori -->
		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>Kategori</th>
						<th>Slug</th>
						<th class="text-center">Jumlah produk</th>
						<th class="text-right">Aksi</th>
					</tr>
				</thead>
				<tbody>
					{#if data.categories.length === 0}
						<tr>
							<td colspan="4" class="!py-10 text-center text-sm text-smoke">
								Belum ada kategori. Silakan tambahkan melalui form di atas.
							</td>
						</tr>
					{:else}
						{#each data.categories as cat (cat.id)}
							<tr>
								<td class="min-w-48">
									{#if editingId === cat.id}
										<form method="POST" action="?/update" class="space-y-2">
											<input type="hidden" name="id" value={cat.id} />
											<input
												type="text"
												name="name"
												bind:value={editName}
												aria-label="Nama kategori"
												class="!py-2"
												maxlength="100"
												required
											/>
											{#if form?.action === 'update' && form.id === cat.id && form.errors?.name}
												<p class="field-error">{form.errors.name[0]}</p>
											{/if}
											<input
												type="text"
												name="description"
												bind:value={editDescription}
												placeholder="Deskripsi..."
												aria-label="Deskripsi kategori"
												maxlength="500"
												class="!py-2"
											/>
											{#if form?.action === 'update' && form.id === cat.id && form.errors?.description}
												<p class="field-error">{form.errors.description[0]}</p>
											{/if}
											<div class="flex gap-2">
												<button type="submit" class="btn btn-tool btn-primary">Simpan</button>
												<button type="button" onclick={cancelEdit} class="btn btn-tool"
													>Batal</button
												>
											</div>
										</form>
									{:else}
										<div class="font-bold">{cat.name}</div>
										{#if cat.description}
											<div class="text-xs text-smoke">{cat.description}</div>
										{/if}
									{/if}
								</td>
								<td class="font-mono text-xs text-smoke">{cat.slug}</td>
								<td class="text-center">
									<span class="display text-xl">{cat.productCount}</span>
								</td>
								<td>
									{#if editingId !== cat.id}
										<div class="flex justify-end gap-2">
											<button type="button" onclick={() => startEdit(cat)} class="btn btn-tool">
												Ubah
											</button>
											<form
												method="POST"
												action="?/delete"
												onsubmit={(e) => {
													if (!confirm(`Hapus kategori "${cat.name}"?`)) e.preventDefault();
												}}
											>
												<input type="hidden" name="id" value={cat.id} />
												<button type="submit" class="btn btn-tool btn-danger-outline">Hapus</button>
											</form>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>
