<script lang="ts">
	import { SIZE_PRESETS, compareSizes, isValidSize, normalizeSize } from '$lib/utils/sizes';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';

	type Existing = { label: string; stock: number };
	type Row = { label: string; stock: number | null };

	/**
	 * Editor ukuran produk (form tambah & ubah). Mengirim dua field tersembunyi:
	 * - `sizesNew`    JSON [{label, stock}] — ukuran baru + stok awalnya
	 * - `sizesRemove` JSON [label]          — ukuran lama yang dihapus (hanya bila stoknya 0)
	 * Stok ukuran yang sudah ada TIDAK diubah di sini (lewat menu Stok / Pembelian).
	 */
	let {
		existing = [],
		initialRows = [],
		initialRemove = [],
		lowStock = 5,
		unsizedStock = 0,
		count = $bindable(0)
	}: {
		existing?: Existing[];
		initialRows?: { label: string; stock: number }[];
		initialRemove?: string[];
		lowStock?: number;
		/** Stok produk yang sekarang tanpa ukuran (mode ubah) — dipindahkan ke ukuran baru bila ditambah */
		unsizedStock?: number;
		/** Jumlah ukuran efektif (ukuran lama yang tidak dihapus + ukuran baru) */
		count?: number;
	} = $props();

	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(initialRows.map((r) => ({ ...r })));
	// svelte-ignore state_referenced_locally
	let removed = $state<string[]>([...initialRemove]);
	let custom = $state('');
	let error = $state('');

	const labels = $derived(new Set([...existing.map((e) => e.label), ...rows.map((r) => r.label)]));
	const sortedExisting = $derived([...existing].sort((a, b) => compareSizes(a.label, b.label)));

	$effect(() => {
		count = existing.filter((e) => !removed.includes(e.label)).length + rows.length;
	});

	const newTotal = $derived(rows.reduce((s, r) => s + clean(r.stock), 0));
	const keptTotal = $derived(
		existing.filter((e) => !removed.includes(e.label)).reduce((s, e) => s + e.stock, 0)
	);

	function clean(n: number | null) {
		return Math.max(0, Math.floor(Number(n) || 0));
	}

	function add(raw: string) {
		const label = normalizeSize(raw);
		if (!isValidSize(label)) {
			error = 'Ukuran tidak valid (maks. 12 karakter: huruf, angka, spasi, titik, garis).';
			return false;
		}
		if (removed.includes(label)) {
			removed = removed.filter((l) => l !== label); // menambah ukuran yang tadi dihapus = batal hapus
			error = '';
			return true;
		}
		if (labels.has(label)) {
			error = `Ukuran ${label} sudah ada.`;
			return false;
		}
		if (labels.size >= 20) {
			error = 'Maksimal 20 ukuran per produk.';
			return false;
		}
		rows.push({ label, stock: 0 });
		error = '';
		return true;
	}

	function addPreset(list: readonly string[]) {
		for (const l of list) if (!labels.has(l)) add(l);
		error = '';
	}

	function addCustom(e: Event) {
		e.preventDefault();
		if (add(custom)) custom = '';
	}

	function toggleRemove(label: string) {
		removed = removed.includes(label) ? removed.filter((l) => l !== label) : [...removed, label];
	}

	const payload = $derived(
		JSON.stringify(rows.map((r) => ({ label: r.label, stock: clean(r.stock) })))
	);
</script>

<input type="hidden" name="sizesNew" value={payload} />
<input type="hidden" name="sizesRemove" value={JSON.stringify(removed)} />

<div class="space-y-4">
	{#if existing.length > 0}
		<ul class="divide-y divide-line border border-line">
			{#each sortedExisting as s (s.label)}
				{@const gone = removed.includes(s.label)}
				<li class="flex items-center gap-3 px-3 py-2.5 {gone ? 'opacity-50' : ''}">
					<span class="tag !text-xs !font-bold {gone ? 'line-through' : ''}">{s.label}</span>
					<span
						class="flex-1 text-xs tabular-nums {s.stock === 0
							? 'text-danger'
							: s.stock <= lowStock
								? 'text-warn'
								: 'text-smoke'}"
					>
						Stok {s.stock}
					</span>
					{#if gone}
						<button type="button" class="chip h-8" onclick={() => toggleRemove(s.label)}>
							Batal hapus
						</button>
					{:else}
						<button
							type="button"
							class="chip h-8 disabled:cursor-not-allowed disabled:opacity-40"
							disabled={s.stock > 0}
							title={s.stock > 0
								? 'Kosongkan stok ukuran ini di menu Stok sebelum menghapus'
								: 'Hapus ukuran'}
							onclick={() => toggleRemove(s.label)}
						>
							Hapus
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if rows.length > 0}
		<div>
			<p class="label">Ukuran baru &amp; stok awal</p>
			<ul class="divide-y divide-line border border-line">
				{#each rows as r, i (r.label)}
					<li class="flex items-center gap-3 px-3 py-2">
						<span class="tag !text-xs !font-bold">{r.label}</span>
						<label class="flex flex-1 items-center gap-2 text-xs text-smoke">
							<span class="sr-only">Stok awal ukuran {r.label}</span>
							<input
								type="number"
								min="0"
								max="100000"
								step="1"
								bind:value={r.stock}
								aria-label="Stok awal ukuran {r.label}"
								class="field-sm !w-24 tabular-nums"
							/>
							pcs
						</label>
						<button
							type="button"
							class="chip h-8"
							aria-label="Buang ukuran {r.label}"
							onclick={() => rows.splice(i, 1)}
						>
							<X size={12} />
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="space-y-2">
		<p class="label">Tambah ukuran</p>
		<div class="flex flex-wrap items-center gap-1.5">
			{#each Object.entries(SIZE_PRESETS) as [name, list] (name)}
				<button type="button" class="chip" onclick={() => addPreset(list)}>
					<Plus size={11} class="mr-1" />
					{name}: {list.join(' ')}
				</button>
			{/each}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<input
				type="text"
				bind:value={custom}
				maxlength="12"
				placeholder="Ukuran sendiri, mis. 38"
				aria-label="Ukuran sendiri"
				class="field-sm !w-48"
				onkeydown={(e) => {
					if (e.key === 'Enter') addCustom(e);
				}}
			/>
			<button type="button" class="btn btn-tool" onclick={addCustom}>Tambah</button>
		</div>
		{#if error}<p class="field-error" role="alert">{error}</p>{/if}
	</div>

	{#if count > 0}
		<p class="hint">
			Stok total produk = jumlah stok semua ukuran
			<strong class="text-ink tabular-nums">({keptTotal + newTotal} pcs)</strong>. Stok ukuran yang
			sudah ada diubah lewat menu Stok atau Pembelian.
			{#if unsizedStock > 0 && existing.length === 0}
				Produk ini kini punya stok <strong class="text-ink">{unsizedStock}</strong> tanpa ukuran; stok
				itu akan dipindahkan, jadi isi stok tiap ukuran baru di atas.
			{/if}
		</p>
	{:else}
		<p class="hint">Kosongkan bila produk tidak punya pilihan ukuran (mis. topi atau tas).</p>
	{/if}
</div>
