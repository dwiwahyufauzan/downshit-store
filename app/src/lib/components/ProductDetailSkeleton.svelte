<!-- Kerangka halaman detail produk/bundling selama data dimuat -->
<div class="container-shop py-6 sm:py-8" role="status" aria-busy="true" aria-live="polite">
	<span class="sr-only">Memuat halaman…</span>
	<div class="motion-safe:animate-pulse" aria-hidden="true">
		<div class="mb-6 h-3 w-64 max-w-full bg-mist"></div>
		<div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
			<div class="aspect-square bg-mist"></div>
			<div class="space-y-5">
				<div class="h-3 w-24 bg-mist"></div>
				<div class="h-9 w-4/5 bg-mist"></div>
				<div class="h-7 w-40 bg-mist"></div>
				<div class="divider space-y-3 pt-6">
					<div class="h-3 w-20 bg-mist"></div>
					<div class="flex gap-2">
						{#each [0, 1, 2, 3] as i (i)}
							<div class="h-11 w-12 bg-mist"></div>
						{/each}
					</div>
				</div>
				<div class="h-14 w-full bg-mist"></div>
				<div class="space-y-2 pt-4">
					<div class="h-3 w-full bg-mist"></div>
					<div class="h-3 w-11/12 bg-mist"></div>
					<div class="h-3 w-2/3 bg-mist"></div>
				</div>
			</div>
		</div>
	</div>
</div>
