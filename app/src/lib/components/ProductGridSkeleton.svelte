<script lang="ts">
	let { count = 8 }: { count?: number } = $props();
</script>

<!-- Kerangka daftar produk: dipakai saat hasil pencarian/filter/halaman berikutnya masih dimuat -->
<div role="status" aria-busy="true" aria-live="polite">
	<span class="sr-only">Memuat produk…</span>
	<div class="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
		{#each Array.from({ length: count }, (_, i) => i) as i (i)}
			<div class="motion-safe:animate-pulse">
				<div class="aspect-square bg-mist"></div>
				<div class="mt-3 space-y-2">
					<div class="h-2 w-1/3 bg-mist"></div>
					<div class="h-3 w-4/5 bg-mist"></div>
					<div class="h-3 w-1/3 bg-mist"></div>
				</div>
			</div>
		{/each}
	</div>
</div>
