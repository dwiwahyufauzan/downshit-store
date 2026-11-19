<script lang="ts">
	import Star from '@lucide/svelte/icons/star';

	/** Pilihan rating 1–5 bintang (radio bergaya bintang, bisa dipakai dengan keyboard). */
	let {
		value = $bindable(0),
		name = 'rating',
		legend = 'Rating'
	}: { value?: number; name?: string; legend?: string } = $props();

	const LABEL = ['', 'Buruk', 'Kurang', 'Cukup', 'Bagus', 'Sangat bagus'];
	let hover = $state(0);
	const shown = $derived(hover || value);
</script>

<fieldset>
	<legend class="label">
		{legend}
		{#if shown}<span class="ml-1 font-normal tracking-normal text-smoke normal-case">
				&middot; {LABEL[shown]}
			</span>{/if}
	</legend>
	<div class="flex gap-1" onmouseleave={() => (hover = 0)} role="presentation">
		{#each [1, 2, 3, 4, 5] as n (n)}
			<label class="cursor-pointer p-0.5" onmouseenter={() => (hover = n)}>
				<input type="radio" {name} value={n} bind:group={value} class="peer sr-only" required />
				<Star
					size={26}
					strokeWidth={1.5}
					class="transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-ink {n <=
					shown
						? 'fill-ink text-ink'
						: 'text-line'}"
				/>
				<span class="sr-only">{n} bintang</span>
			</label>
		{/each}
	</div>
</fieldset>
