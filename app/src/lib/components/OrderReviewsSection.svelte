<script lang="ts">
	import StarInput from '#lib/components/StarInput.svelte';
	import Stars from '#lib/components/Stars.svelte';
	import { formatDate } from '#lib/utils/format';
	import type { PageData } from '../../routes/pesanan/[kode]/$types';

	/** Form & daftar ulasan per produk pada pesanan yang sudah selesai (foto opsional, maks. 3). */
	let { reviewables }: { reviewables: PageData['reviewables'] } = $props();
</script>

<!-- Ulasan: hanya setelah pesanan selesai -->
{#if reviewables.length > 0}
	<section id="ulasan" class="scroll-mt-24">
		<h2 class="panel-title mb-4">Beri ulasan</h2>
		<ul class="divide-y divide-line border-y border-line">
			{#each reviewables as rp (rp.productId)}
				<li class="py-5">
					<div class="flex items-start justify-between gap-4">
						<a
							href="/produk/{rp.slug}"
							class="text-sm font-bold tracking-[0.06em] uppercase hover:underline"
						>
							{rp.name}
						</a>
						{#if rp.review}<Stars value={rp.review.rating} size={14} />{/if}
					</div>

					{#if rp.review}
						<p class="mt-2 text-xs text-smoke">
							Ulasanmu &middot; {formatDate(rp.review.createdAt)}
						</p>
						{#if rp.review.comment}
							<p class="mt-1 text-sm leading-relaxed">{rp.review.comment}</p>
						{/if}
						{#if rp.review.photos.length > 0}
							<ul class="mt-3 flex flex-wrap gap-2">
								{#each rp.review.photos as ph, i (i)}
									<li>
										<a href={ph.url} target="_blank" rel="noopener noreferrer">
											<img
												src={ph.thumbUrl}
												alt="Foto ulasanmu"
												class="h-16 w-16 border border-line object-cover"
											/>
										</a>
									</li>
								{/each}
							</ul>
						{/if}
					{:else}
						<form
							method="POST"
							action="?/ulas"
							enctype="multipart/form-data"
							class="mt-4 space-y-4"
						>
							<input type="hidden" name="productId" value={rp.productId} />
							<StarInput name="rating" legend="Rating" />
							<div>
								<label for="comment-{rp.productId}" class="label">Ulasan (opsional)</label>
								<textarea
									id="comment-{rp.productId}"
									name="comment"
									rows="3"
									maxlength="500"
									placeholder="Ceritakan bahan, ukuran, atau kualitasnya…"></textarea>
							</div>
							<div>
								<label for="photos-{rp.productId}" class="label">Foto (opsional)</label>
								<input
									id="photos-{rp.productId}"
									name="photos"
									type="file"
									accept="image/jpeg,image/png,image/webp"
									multiple
									class="block w-full min-w-0 text-xs text-smoke file:mr-4 file:cursor-pointer file:border file:border-ink file:bg-paper file:px-4 file:py-2.5 file:text-xs file:font-semibold file:tracking-[0.12em] file:text-ink file:uppercase hover:file:bg-ink hover:file:text-paper"
								/>
								<p class="hint">Maksimal 3 foto (JPG, PNG, atau WEBP).</p>
							</div>
							<button type="submit" class="btn btn-primary btn-tool">Kirim ulasan</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
