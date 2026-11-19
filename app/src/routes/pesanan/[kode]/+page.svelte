<script lang="ts">
	import Alert from '$lib/components/Alert.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import StarInput from '$lib/components/StarInput.svelte';
	import Stars from '$lib/components/Stars.svelte';
	import { PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABEL } from '$lib/constants';
	import { formatDate, formatRupiah } from '$lib/utils/format';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Ban from '@lucide/svelte/icons/ban';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Upload from '@lucide/svelte/icons/upload';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let o = $derived(data.order);
	let copied = $state('');

	function copyToClipboard(text: string, key: string) {
		if (navigator.clipboard) {
			navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => {
				if (copied === key) copied = '';
			}, 2000);
		}
	}

	const steps = [
		{ key: 'menunggu_pembayaran', label: 'Dibuat' },
		{ key: 'menunggu_konfirmasi', label: 'Dibayar' },
		{ key: 'diproses', label: 'Diproses' },
		{ key: 'dikirim', label: 'Dikirim' },
		{ key: 'selesai', label: 'Selesai' }
	];

	let currentStep = $derived(steps.findIndex((s) => s.key === o.status));
	let isCancelled = $derived(o.status === 'dibatalkan');
	let isOverdue = $derived(
		o.status === 'menunggu_pembayaran' && !!o.expiresAt && new Date(o.expiresAt) < new Date()
	);
</script>

<svelte:head>
	<title>Pesanan {o.code} - Store Downshit</title>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<Breadcrumb items={[{ label: 'Pesanan', href: '/pesanan' }, { label: o.code }]} />

	<PageHeader title={o.code} meta="Dibuat {formatDate(o.createdAt)}">
		{#snippet after()}<StatusBadge status={o.status} />{/snippet}
	</PageHeader>

	<!-- Toolbar aksi (hanya muncul bila ada aksi yang tersedia) -->
	{#if data.canConfirmReceived || data.canCancel}
		<div class="flex flex-wrap items-center justify-end gap-3 border-b border-line py-3">
			{#if data.canCancel}
				<form method="POST" action="?/batal" class="flex flex-wrap items-center gap-2">
					<input
						type="text"
						name="reason"
						maxlength="200"
						placeholder="Alasan batal (opsional)"
						aria-label="Alasan batal (opsional)"
						class="field-sm w-full placeholder:text-smoke sm:w-56"
					/>
					<button
						type="submit"
						onclick={(e) => {
							if (
								!confirm(
									'Apakah Anda yakin ingin membatalkan pesanan ini? Stok akan dikembalikan ke toko.'
								)
							) {
								e.preventDefault();
							}
						}}
						class="btn btn-tool btn-danger-outline"
					>
						<Ban size={12} /> Batalkan pesanan
					</button>
				</form>
			{/if}

			{#if data.canConfirmReceived}
				<form method="POST" action="?/diterima">
					<button
						type="submit"
						onclick={(e) => {
							if (!confirm('Apakah paket telah Anda terima dengan baik dan sesuai?')) {
								e.preventDefault();
							}
						}}
						class="btn btn-tool btn-primary"
					>
						<Check size={12} /> Pesanan sudah diterima
					</button>
				</form>
			{/if}
		</div>
	{/if}

	{#if form?.success || form?.message}
		<div class="mt-6">
			{#if form?.success}
				<Alert type="success" message={form.message ?? 'Aksi berhasil diproses.'} />
			{:else if form?.message}
				<Alert type="error" message={form.message} />
			{/if}
		</div>
	{:else if data.justCreated}
		<div class="mt-6">
			<Alert
				type="success"
				message="Pesanan berhasil dibuat. Transfer sesuai total di bawah, lalu unggah bukti pembayarannya sebelum batas waktu."
			/>
		</div>
	{/if}

	<!-- Alur status -->
	{#if isCancelled}
		<section class="mt-6 border border-danger bg-danger-bg p-5 sm:p-6" role="status">
			<p class="text-xs font-bold tracking-[0.16em] text-danger uppercase">Pesanan dibatalkan</p>
			<p class="mt-2 text-sm text-ink">
				Pesanan ini sudah tidak aktif dan seluruh stok dikembalikan ke toko.
				{#if o.cancelReason}
					Alasan: {o.cancelReason}.
				{/if}
			</p>
			{#if o.cancelledAt}
				<p class="mt-1 text-xs text-smoke">Dibatalkan {formatDate(o.cancelledAt)}</p>
			{/if}
			<a href="/produk" class="btn btn-sm btn-primary mt-4">Belanja lagi</a>
		</section>
	{:else}
		<ol class="mt-6 grid gap-px border border-ink bg-ink sm:grid-cols-5" aria-label="Alur status">
			{#each steps as s, i (s.key)}
				{@const state = i < currentStep ? 'done' : i === currentStep ? 'active' : 'todo'}
				<li
					class="flex items-center gap-3 px-4 py-3 sm:flex-col sm:items-start sm:gap-2 sm:py-4 {state ===
					'active'
						? 'bg-ink text-paper'
						: state === 'done'
							? 'bg-paper text-ink'
							: 'bg-mist text-smoke'}"
					aria-current={state === 'active' ? 'step' : undefined}
				>
					<span
						class="flex h-6 w-6 shrink-0 items-center justify-center border text-[11px] font-bold {state ===
						'active'
							? 'border-paper'
							: state === 'done'
								? 'border-ink bg-ink text-paper'
								: 'border-smoke/40'}"
					>
						{#if state === 'done'}
							<Check size={12} />
							<span class="sr-only">Selesai</span>
						{:else}
							{i + 1}
						{/if}
					</span>
					<span
						class="text-xs tracking-[0.14em] uppercase {state === 'active'
							? 'font-extrabold'
							: state === 'done'
								? 'font-semibold'
								: 'font-medium'}"
					>
						{s.label}
					</span>
				</li>
			{/each}
		</ol>
	{/if}

	<div
		class="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_26rem]"
	>
		<!-- Kolom utama -->
		<div class="space-y-8">
			{#if o.status === 'menunggu_pembayaran'}
				<section class="border border-ink p-5 sm:p-6">
					<p class="eyebrow">Langkah berikutnya</p>
					<h2 class="section-title mt-2 !text-xl sm:!text-2xl">Transfer pembayaran</h2>
					<p class="mt-3 text-sm text-smoke">
						Transfer tepat <strong class="text-ink">{formatRupiah(o.total)}</strong> lalu unggah bukti
						transfernya di bawah.
					</p>

					{#if o.expiresAt}
						<p
							class="mt-4 inline-flex items-center gap-2 border px-3 py-2 text-xs font-bold tracking-[0.1em] uppercase {isOverdue
								? 'border-danger bg-danger-bg text-danger'
								: 'border-warn bg-warn-bg text-warn'}"
						>
							{isOverdue ? 'Batas bayar terlewat' : 'Bayar sebelum'}
							{formatDate(o.expiresAt)}
						</p>
						{#if isOverdue}
							<p class="mt-2 text-xs text-smoke">
								Pesanan akan dibatalkan otomatis dan stok dikembalikan bila belum dibayar.
							</p>
						{/if}
					{/if}

					{#if data.payment?.status === 'ditolak'}
						<div class="mt-5">
							<Alert
								type="error"
								message="Bukti transfer ditolak: {data.payment.note ||
									'bukti tidak jelas atau nominal tidak cocok'}. Silakan unggah ulang bukti yang valid."
							/>
						</div>
					{/if}

					<dl class="mt-6 grid gap-px border border-line bg-line sm:grid-cols-2">
						<div class="bg-paper p-4 sm:col-span-2">
							<dt class="eyebrow">Rekening tujuan</dt>
							<dd class="mt-1 text-sm font-bold uppercase">
								{data.settings.bankName ?? 'BCA'} &middot; a.n.
								{data.settings.bankHolder ?? 'DOWNSHIT STORE'}
							</dd>
							<dd class="mt-2 flex flex-wrap items-center justify-between gap-3">
								<span class="display text-2xl tracking-[0.04em] tabular-nums">
									{data.settings.bankNumber ?? '-'}
								</span>
								<button
									type="button"
									onclick={() => copyToClipboard(data.settings.bankNumber ?? '', 'rek')}
									class="btn btn-sm"
								>
									{#if copied === 'rek'}
										<Check size={14} /> Tersalin
									{:else}
										<Copy size={14} /> Salin
									{/if}
								</button>
							</dd>
						</div>
						<div class="bg-paper p-4 sm:col-span-2">
							<dt class="eyebrow">Total yang harus ditransfer</dt>
							<dd class="price mt-1 text-2xl">{formatRupiah(o.total)}</dd>
							<dd class="hint">Sesuai nominal, sudah termasuk ongkos kirim.</dd>
						</div>
					</dl>

					<form
						method="POST"
						action="?/bayar"
						enctype="multipart/form-data"
						class="mt-6 border border-dashed border-ink bg-mist/50 p-5"
					>
						<label for="proofImage" class="label">Unggah bukti transfer</label>
						<p class="hint !mt-0 mb-3">
							Format JPG, PNG, atau WEBP. Maksimal {data.maxUploadMb} MB.
						</p>
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
							<input
								type="file"
								id="proofImage"
								name="proofImage"
								accept="image/jpeg,image/png,image/webp"
								required
								class="block w-full min-w-0 text-xs text-smoke file:mr-4 file:cursor-pointer file:border-0 file:bg-ink file:px-4 file:py-2.5 file:text-xs file:font-semibold file:tracking-[0.12em] file:text-paper file:uppercase"
							/>
							<button type="submit" class="btn btn-primary shrink-0">
								<Upload size={14} /> Kirim bukti
							</button>
						</div>
					</form>
				</section>
			{:else if o.status === 'menunggu_konfirmasi'}
				<section class="border border-ink p-5 sm:p-6">
					<p class="eyebrow">Sedang berjalan</p>
					<h2 class="section-title mt-2 !text-xl sm:!text-2xl">Bukti sedang diverifikasi</h2>
					<p class="mt-3 text-sm text-smoke">
						Admin sedang mencocokkan mutasi transfermu. Pesanan segera diproses setelah
						diverifikasi.
					</p>
					{#if data.payment?.proofUrl}
						<a
							href={data.payment.proofUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="btn btn-sm mt-4"
						>
							Lihat bukti transfer <ExternalLink size={14} />
						</a>
					{/if}
				</section>
			{:else if o.status === 'diproses'}
				<section class="border border-ink p-5 sm:p-6">
					<p class="eyebrow">Sedang berjalan</p>
					<h2 class="section-title mt-2 !text-xl sm:!text-2xl">Pesanan dikemas</h2>
					<p class="mt-3 text-sm text-smoke">
						Pembayaran sudah dikonfirmasi. Tim kami sedang memeriksa dan mengemas pesananmu.
					</p>
				</section>
			{:else if o.status === 'dikirim'}
				<section class="border border-ink p-5 sm:p-6">
					<p class="eyebrow">Sedang berjalan</p>
					<h2 class="section-title mt-2 !text-xl sm:!text-2xl">Paket dalam pengiriman</h2>
					<p class="mt-3 text-sm text-smoke">
						Pesananmu sudah diserahkan ke kurir. Setelah paket sampai, konfirmasi lewat tombol
						"Pesanan sudah diterima".
					</p>
				</section>
			{:else if o.status === 'selesai'}
				<section class="border border-ok bg-ok-bg p-5 sm:p-6" role="status">
					<p class="text-xs font-bold tracking-[0.16em] text-ok uppercase">Pesanan selesai</p>
					<p class="mt-2 text-sm text-ink">
						Paket sudah diterima. Terima kasih sudah belanja di Downshit.
					</p>
				</section>
			{/if}

			<!-- Item pesanan -->
			<section>
				<h2 class="panel-title mb-4">Item pesanan</h2>
				<ul class="divide-y divide-line border-y border-line">
					{#each data.items as item (item.id)}
						<li class="py-5">
							<div class="flex items-start justify-between gap-4">
								<div class="min-w-0">
									<p class="eyebrow">{item.itemType === 'product' ? 'Produk' : 'Paket bundling'}</p>
									<h3 class="mt-1 text-sm font-bold tracking-[0.06em] uppercase">
										{item.itemName}
									</h3>
									<p class="mt-1 text-xs text-smoke">
										{item.quantity} &times; {formatRupiah(item.unitPrice)}
									</p>
									{#if item.size && item.itemType === 'product'}
										<p class="mt-1 text-xs font-semibold tracking-[0.08em] uppercase">
											Ukuran {item.size}
										</p>
									{/if}
								</div>
								<p class="price shrink-0 text-sm">{formatRupiah(item.subtotal)}</p>
							</div>

							{#if item.components && item.components.length > 0}
								<div class="mt-3 border-l-2 border-ink bg-mist px-4 py-3">
									<p class="eyebrow">Isi paket</p>
									<ul class="mt-2 space-y-1">
										{#each item.components as comp (comp.id)}
											<li class="flex items-center justify-between gap-4 text-xs text-smoke">
												<span>
													{comp.productName}
													{#if comp.size}<strong class="text-ink">({comp.size})</strong>{/if}
													&times; {comp.quantity}
												</span>
												<span class="tabular-nums">
													{formatRupiah(comp.productPrice * comp.quantity)}
												</span>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<dl class="mt-5 ml-auto max-w-sm space-y-3 text-sm">
					<div class="flex items-center justify-between gap-4">
						<dt class="text-smoke">Subtotal item</dt>
						<dd class="price">{formatRupiah(o.subtotal)}</dd>
					</div>
					<div class="flex items-center justify-between gap-4">
						<dt class="text-smoke">Ongkos kirim</dt>
						<dd class="price">{formatRupiah(o.shippingCost)}</dd>
					</div>
					<div class="divider flex items-baseline justify-between gap-4 pt-3">
						<dt class="text-xs font-bold tracking-[0.14em] uppercase">Total pembayaran</dt>
						<dd class="price text-xl">{formatRupiah(o.total)}</dd>
					</div>
				</dl>
			</section>

			<!-- Ulasan: hanya setelah pesanan selesai -->
			{#if data.reviewables.length > 0}
				<section id="ulasan" class="scroll-mt-24">
					<h2 class="panel-title mb-4">Beri ulasan</h2>
					<ul class="divide-y divide-line border-y border-line">
						{#each data.reviewables as rp (rp.productId)}
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
								{:else}
									<form method="POST" action="?/ulas" class="mt-4 space-y-4">
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
										<button type="submit" class="btn btn-primary btn-tool">Kirim ulasan</button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>

		<!-- Kolom samping -->
		<aside class="space-y-6">
			<section class="panel">
				<h2 class="panel-title">Tujuan pengiriman</h2>
				<dl class="mt-5 space-y-4 text-sm">
					<div>
						<dt class="eyebrow">Penerima</dt>
						<dd class="mt-1 font-semibold">{o.recipientName}</dd>
					</div>
					<div>
						<dt class="eyebrow">WhatsApp / HP</dt>
						<dd class="mt-1">{o.recipientPhone}</dd>
					</div>
					<div>
						<dt class="eyebrow">Alamat</dt>
						<dd class="mt-1 whitespace-pre-line text-smoke">{o.shippingAddress}</dd>
					</div>
					{#if o.notes}
						<div class="divider pt-4">
							<dt class="eyebrow">Catatan</dt>
							<dd class="mt-1 text-smoke italic">"{o.notes}"</dd>
						</div>
					{/if}
				</dl>
			</section>

			{#if data.shipment && data.shipment.status !== 'belum_dikirim' && data.shipment.trackingNumber}
				<section class="panel">
					<h2 class="panel-title">Pengiriman</h2>
					<dl class="mt-5 space-y-4 text-sm">
						<div>
							<dt class="eyebrow">Ekspedisi</dt>
							<dd class="mt-1 font-semibold uppercase">{data.shipment.courier ?? '-'}</dd>
						</div>
						<div>
							<dt class="eyebrow">Nomor resi</dt>
							<dd class="mt-1 flex flex-wrap items-center justify-between gap-3">
								<span class="text-base font-bold tracking-[0.04em] tabular-nums">
									{data.shipment.trackingNumber ?? '-'}
								</span>
								{#if data.shipment.trackingNumber}
									<button
										type="button"
										onclick={() => copyToClipboard(data.shipment?.trackingNumber ?? '', 'resi')}
										class="btn btn-sm"
									>
										{#if copied === 'resi'}
											<Check size={14} /> Tersalin
										{:else}
											<Copy size={14} /> Salin resi
										{/if}
									</button>
								{/if}
							</dd>
						</div>
						{#if data.shipment.shippedAt}
							<div>
								<dt class="eyebrow">Dikirim</dt>
								<dd class="mt-1 text-smoke">{formatDate(data.shipment.shippedAt)}</dd>
							</div>
						{/if}
						{#if data.shipment.deliveredAt}
							<div>
								<dt class="eyebrow">Diterima</dt>
								<dd class="mt-1 text-smoke">{formatDate(data.shipment.deliveredAt)}</dd>
							</div>
						{/if}
					</dl>
				</section>
			{:else}
				<section class="panel">
					<h2 class="panel-title">Pengiriman</h2>
					<p class="mt-4 text-sm text-smoke">Informasi pengiriman belum tersedia.</p>
				</section>
			{/if}

			<section class="panel">
				<h2 class="panel-title">Pembayaran</h2>
				<dl class="mt-5 space-y-4 text-sm">
					<div class="flex items-center justify-between gap-4">
						<dt class="eyebrow">Status</dt>
						<dd>
							<span class="badge {PAYMENT_STATUS_BADGE[data.paymentStatus] ?? 'badge-muted'}">
								{PAYMENT_STATUS_LABEL[data.paymentStatus] ?? data.paymentStatus}
							</span>
						</dd>
					</div>
					<div class="flex items-center justify-between gap-4">
						<dt class="eyebrow">Total tagihan</dt>
						<dd class="price">{formatRupiah(o.total)}</dd>
					</div>
				</dl>

				{#if data.paymentHistory.length > 0}
					<div class="divider mt-5 pt-4">
						<p class="eyebrow">Riwayat unggahan bukti</p>
						<ul class="mt-3 space-y-2 text-xs">
							{#each data.paymentHistory as p (p.id)}
								<li class="border border-line bg-mist/50 p-2.5">
									<div class="flex items-center justify-between gap-2">
										<span class="badge {PAYMENT_STATUS_BADGE[p.status] ?? 'badge-muted'}">
											{PAYMENT_STATUS_LABEL[p.status] ?? p.status}
										</span>
										<span class="text-[10px] text-smoke">{formatDate(p.createdAt)}</span>
									</div>
									{#if p.note}
										<p class="mt-1.5 text-smoke">
											{p.status === 'ditolak' ? 'Alasan' : 'Catatan'}: {p.note}
										</p>
									{/if}
									{#if p.confirmedAt}
										<p class="mt-1 text-smoke">Diproses admin {formatDate(p.confirmedAt)}</p>
									{/if}
									{#if p.proofUrl}
										<a
											href={p.proofUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="link mt-1.5 inline-flex items-center gap-1 font-semibold"
										>
											Lihat bukti <ExternalLink size={12} />
										</a>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</section>

			<a href={data.waUrl} target="_blank" rel="noopener noreferrer" class="btn btn-block">
				<MessageCircle size={14} /> Hubungi toko via WhatsApp
			</a>
		</aside>
	</div>
</div>
