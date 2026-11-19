<script lang="ts">
	import Star from '@lucide/svelte/icons/star';

	/** Deretan 5 bintang; `value` dibulatkan ke bintang penuh terdekat. */
	let { value, size = 14 }: { value: number; size?: number } = $props();

	const full = $derived(Math.max(0, Math.min(5, Math.round(value))));
</script>

<span class="inline-flex items-center gap-0.5" role="img" aria-label="Rating {value} dari 5">
	{#each [1, 2, 3, 4, 5] as n (n)}
		<Star {size} strokeWidth={1.5} class={n <= full ? 'fill-ink text-ink' : 'text-line'} />
	{/each}
</span>
