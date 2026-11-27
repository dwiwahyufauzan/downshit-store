<script lang="ts">
	import Stars from '#lib/components/Stars.svelte';
	import type { PageData } from '../../routes/produk/[slug]/$types';

	/** Ringkasan rating (rata-rata + sebaran) dan daftar ulasan pembeli, termasuk foto ulasan. */
	let {
		summary,
		reviews,
		showAll
	}: {
		summary: PageData['reviewSummary'];
		reviews: PageData['reviews'];
		showAll: boolean;
	} = $props();
</script>

<section id="ulasan" class="mt-16 scroll-mt-24">
	<div class="mb-6 flex items-end justify-between gap-4">
		<h2 class="section-title">Ulasan pembeli</h2>
		{#if summary.count > 0}
			<p class="meta">{summary.count} ulasan</p>
		{/if}
	</div>

	{#if summary.count === 0}
		<div class="border border-dashed border-line bg-mist/50 px-6 py-12 text-center">
			<p class="text-sm font-bold tracking-[0.14em] uppercase">Belum ada ulasan</p>
			<p class="mx-auto mt-2 max-w-sm text-sm text-smoke">
				Ulasan ditulis pembeli setelah pesanan selesai.
			</p>
		</div>
	{:else}
		<div class="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14">
			<div>
				<p class="display text-6xl tabular-nums">{summary.avg?.toFixed(1)}</p>
				{#if summary.avg !== null}
					<div class="mt-2"><Stars value={summary.avg} size={18} /></div>
				{/if}
				<p class="mt-2 text-xs text-smoke">dari {summary.count} ulasan</p>

				<ul class="mt-5 space-y-1.5" aria-label="Sebaran rating">
					{#each [5, 4, 3, 2, 1] as star (star)}
						{@const n = summary.dist[star - 1]}
						<li class="flex items-center gap-3 text-xs">
							<span class="w-6 tabular-nums">{star}&#9733;</span>
							<span class="h-1.5 flex-1 bg-line">
								<span class="block h-full bg-ink" style="width: {(n / summary.count) * 100}%"
								></span>
							</span>
							<span class="w-7 text-right text-smoke tabular-nums">{n}</span>
						</li>
					{/each}
				</ul>
			</div>

			<div>
				<ul class="divide-y divide-line border-y border-line">
					{#each reviews as r (r.id)}
						<li class="py-5">
							<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
								<div class="flex items-center gap-3">
									<Stars value={r.rating} size={14} />
									<span class="text-sm font-bold">{r.name}</span>
								</div>
								<time class="text-xs text-smoke" datetime={r.createdAt}>
									{new Intl.DateTimeFormat('id-ID', {
										dateStyle: 'medium',
										timeZone: 'Asia/Jakarta'
									}).format(new Date(r.createdAt))}
								</time>
							</div>
							{#if r.comment}
								<p class="mt-2 text-sm leading-relaxed text-smoke">{r.comment}</p>
							{/if}
							{#if r.photos.length > 0}
								<ul class="mt-3 flex flex-wrap gap-2">
									{#each r.photos as ph, i (i)}
										<li>
											<a href={ph.url} target="_blank" rel="noopener noreferrer">
												<img
													src={ph.thumbUrl}
													alt="Foto dari {r.name}"
													loading="lazy"
													class="h-20 w-20 border border-line object-cover"
												/>
											</a>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
				{#if !showAll && summary.count > reviews.length}
					<a href="?ulasan=semua#ulasan" class="btn btn-sm mt-6">
						Lihat semua {summary.count} ulasan
					</a>
				{/if}
			</div>
		</div>
	{/if}
</section>
