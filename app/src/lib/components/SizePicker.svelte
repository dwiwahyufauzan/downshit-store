<script lang="ts">
	/** Pilihan ukuran (radio bergaya tombol). Ukuran yang stoknya habis tidak bisa dipilih. */
	let {
		sizes,
		value = $bindable(),
		name = 'size',
		label = 'Ukuran',
		lowStock = 5
	}: {
		sizes: { label: string; stock: number }[];
		value?: string | undefined;
		name?: string;
		label?: string;
		lowStock?: number;
	} = $props();

	// `value` boleh undefined (belum dipilih) supaya bisa di-bind ke entri objek yang belum ada
	const selected = $derived(sizes.find((s) => s.label === value));
</script>

<fieldset>
	<legend class="label">
		{label}
		{#if selected}
			<span class="ml-1 font-normal tracking-normal text-smoke normal-case">
				&middot; {selected.stock <= lowStock
					? `tersisa ${selected.stock}`
					: `stok ${selected.stock}`}
			</span>
		{/if}
	</legend>

	<div class="flex flex-wrap gap-2">
		{#each sizes as s (s.label)}
			{@const out = s.stock <= 0}
			<label class="relative {out ? 'cursor-not-allowed' : 'cursor-pointer'}">
				<input
					type="radio"
					{name}
					value={s.label}
					bind:group={value}
					disabled={out}
					class="peer sr-only"
				/>
				<span
					class="flex h-11 min-w-12 items-center justify-center border border-line px-3.5 text-sm font-semibold transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink {out
						? 'text-smoke/60 line-through opacity-60'
						: 'hover:border-ink'}"
				>
					{s.label}
				</span>
				{#if out}<span class="sr-only">(habis)</span>{/if}
			</label>
		{/each}
	</div>
</fieldset>
