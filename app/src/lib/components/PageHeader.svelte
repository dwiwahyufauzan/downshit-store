<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		meta,
		after,
		actions
	}: {
		title: string;
		/** Keterangan kecil di kanan (mis. "30 produk tersedia") */
		meta?: string;
		/** Konten di samping judul (mis. badge status) */
		after?: Snippet;
		/** Tombol/aksi di kanan, setelah `meta` */
		actions?: Snippet;
	} = $props();
</script>

<div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h1 class="display text-2xl tracking-tight text-ink sm:text-3xl">{title}</h1>
		{@render after?.()}
	</div>
	{#if meta || actions}
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-2">
			{#if meta}<p class="meta">{meta}</p>{/if}
			{@render actions?.()}
		</div>
	{/if}
</div>
