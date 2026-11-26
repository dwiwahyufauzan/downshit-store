<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import OrderItemsSection from '#lib/components/OrderItemsSection.svelte';
	import OrderReviewsSection from '#lib/components/OrderReviewsSection.svelte';
	import ShipmentPanel from '#lib/components/ShipmentPanel.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import PaymentMethodPicker from '#lib/components/PaymentMethodPicker.svelte';
	import {
		GATEWAY_TYPE_LABEL,
		PAYMENT_STATUS_BADGE,
		PAYMENT_STATUS_LABEL,
		paymentMethodLabel,
		type PaymentMethod
	} from '#lib/constants';
	import { invalidateAll } from '$app/navigation';
	import { formatDate, formatRupiah } from '#lib/utils/format';
	import { cancelReasonText } from '#lib/utils/wa-messages';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Ban from '@lucide/svelte/icons/ban';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Upload from '@lucide/svelte/icons/upload';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let o = $derived(data.order);
	let copied = $state('');
	let checking = $state(false);
	// metode terpilih: lanjutkan percobaan bayar online yang masih terbuka, jika ada (nilai awal saja)
	// svelte-ignore state_referenced_locally
	let method = $state<PaymentMethod>(
		(data.gatewayPayment?.method as PaymentMethod | undefined) ??
			data.paymentOptions[0]?.method ??
			'transfer_bank'
	);
	const online = $derived(method !== 'transfer_bank');
	const gp = $derived(data.gatewayPayment);
	const gpChannel = $derived(
		gp?.gatewayType ? (GATEWAY_TYPE_LABEL[gp.gatewayType] ?? gp.gatewayType) : null
	);

	async function recheck() {
		checking = true;
		await invalidateAll();
		checking = false;
	}
	const cancelReason = $derived(cancelReasonText(o.cancelReason));

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

	{#if form?.message && !form.success}
		<div class="mt-6">
			<Alert type="error" message={form.message} />
		</div>
	{:else if data.justCreated}
		<div class="mt-6">
			<Alert
				type="success"
				message="Pesanan berhasil dibuat. Selesaikan pembayaran di bawah sebelum batas waktu."
			/>
		</div>
	{/if}

	{#if data.payReturn === 'gagal' && o.status === 'menunggu_pembayaran'}
		<div class="mt-6">
			<Alert
				type="warning"
				message="Pesanan sudah dibuat, tetapi halaman pembayaran online gagal dibuka. Pilih metode pembayaran di bawah dan coba lagi."
			/>
		</div>
	{:else if data.payReturn === 'kembali' && o.status === 'menunggu_pembayaran'}
		<div class="mt-6">
			<Alert
				type="info"
				message="Pembayaranmu belum kami terima. Bila sudah membayar, tunggu sebentar lalu tekan Periksa status pembayaran."
			/>
		</div>
	{:else if data.payReturn === 'kembali' && o.status === 'diproses'}
		<div class="mt-6">
			<Alert type="success" message="Pembayaran berhasil diterima. Pesananmu sedang diproses." />
		</div>
	{/if}

	<!-- Alur status -->
	{#if isCancelled}
		<section class="mt-6 border border-danger bg-danger-bg p-5 sm:p-6" role="status">
			<p class="text-xs font-bold tracking-[0.16em] text-danger uppercase">Pesanan dibatalkan</p>
			<p class="mt-2 text-sm text-ink">
				{#if data.cancelledBy === 'sistem'}
					Pesanan ini dibatalkan otomatis karena melewati batas waktu pembayaran.
				{:else if data.cancelledBy === 'konsumen'}
					Anda membatalkan pesanan ini.
				{:else}
					Pesanan ini dibatalkan oleh toko.
				{/if}
				{#if cancelReason && data.cancelledBy !== 'sistem'}
					Alasan: {cancelReason}.
				{/if}
			</p>
			<p class="mt-2 text-sm text-ink">
				{#if data.refund === 'dikembalikan'}
					Pembayaran {formatRupiah(o.total)} yang sudah kami terima akan dikembalikan. Hubungi toko via
					WhatsApp untuk menyampaikan nama bank, nomor rekening, dan nama pemilik rekening tujuan.
				{:else if data.refund === 'bukti_belum_diverifikasi'}
					Bukti transfer Anda belum sempat diverifikasi. Bila Anda sudah mentransfer, hubungi toko
					via WhatsApp beserta bukti transfer agar dana dapat dikembalikan.
				{:else}
					Tidak ada pembayaran yang perlu dikembalikan.
				{/if}
			</p>
			{#if o.cancelledAt}
				<p class="mt-1 text-xs text-smoke">Dibatalkan {formatDate(o.cancelledAt)}</p>
			{/if}
			<div class="mt-4 flex flex-wrap gap-2">
				<a href="/produk" class="btn btn-sm btn-primary">Belanja lagi</a>
				{#if data.refund !== 'tidak_ada' && data.waUrl}
					<a href={data.waUrl} target="_blank" rel="noopener noreferrer" class="btn btn-sm">
						<MessageCircle size={14} /> Hubungi toko soal dana
					</a>
				{/if}
			</div>
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
					<h2 class="section-title mt-2 !text-xl sm:!text-2xl">Pembayaran</h2>
					<p class="mt-3 text-sm text-smoke">
						Total yang harus dibayar <strong class="text-ink">{formatRupiah(o.total)}</strong>
						(sudah termasuk ongkos kirim).
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
							{#if data.payment.gatewayOrderId}
								<Alert
									type="error"
									message="Pembayaran online sebelumnya tidak berhasil{data.payment.note
										? ` (${data.payment.note})`
										: ''}. Silakan pilih metode pembayaran dan coba lagi."
								/>
							{:else}
								<Alert
									type="error"
									message="Bukti transfer ditolak: {data.payment.note ||
										'bukti tidak jelas atau nominal tidak cocok'}. Silakan unggah ulang bukti yang valid."
								/>
							{/if}
						</div>
					{/if}

					<!-- Pembayaran online yang sedang menunggu -->
					{#if gp}
						<div class="mt-6 border border-warn bg-warn-bg/40 p-4 text-sm">
							<p class="eyebrow">Menunggu pembayaran online</p>
							<p class="mt-1 font-bold uppercase">
								{paymentMethodLabel(gp.method)}{gpChannel ? ` · ${gpChannel}` : ''}
							</p>
							{#if gp.paymentCode}
								<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
									<span class="display text-2xl tracking-[0.04em] tabular-nums"
										>{gp.paymentCode}</span
									>
									<button
										type="button"
										onclick={() => copyToClipboard(gp.paymentCode ?? '', 'kode')}
										class="btn btn-sm"
									>
										{#if copied === 'kode'}
											<Check size={14} /> Tersalin
										{:else}
											<Copy size={14} /> Salin kode
										{/if}
									</button>
								</div>
							{/if}
							<div class="mt-4 flex flex-wrap gap-2">
								{#if gp.redirectUrl}
									<a href={gp.redirectUrl} class="btn btn-sm btn-primary">
										Lanjutkan pembayaran <ExternalLink size={14} />
									</a>
								{/if}
								<button type="button" class="btn btn-sm" onclick={recheck} disabled={checking}>
									<RefreshCw size={14} class={checking ? 'animate-spin' : ''} />
									Periksa status pembayaran
								</button>
							</div>
							<p class="hint">
								Setelah kamu membayar, pesanan otomatis diproses. Ingin ganti metode? Pilih metode
								lain di bawah, pembayaran ini akan dibatalkan.
							</p>
						</div>
					{/if}

					<div class="mt-6">
						<PaymentMethodPicker options={data.paymentOptions} bind:value={method} />
					</div>

					{#if online}
						<form method="POST" action="?/bayarOnline" class="mt-5">
							<input type="hidden" name="paymentMethod" value={method} />
							<button
								type="submit"
								class="btn btn-primary btn-block sm:w-auto"
								disabled={isOverdue}
							>
								{gp?.method === method ? 'Buka halaman pembayaran' : 'Bayar sekarang'}
								&middot; {formatRupiah(o.total)}
							</button>
							<p class="hint">
								Kamu akan diarahkan ke halaman pembayaran {data.simulator
									? 'simulasi (tanpa uang sungguhan)'
									: 'Midtrans yang aman'}. Tidak perlu unggah bukti.
							</p>
						</form>
					{:else}
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
							{#if gp}
								<p class="hint">
									Mengunggah bukti transfer akan membatalkan pembayaran online yang sedang menunggu.
								</p>
							{/if}
						</form>
					{/if}
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

			<OrderItemsSection order={o} items={data.items} />

			<OrderReviewsSection reviewables={data.reviewables} />
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

			<ShipmentPanel shipment={data.shipment} />

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
						<p class="eyebrow">Riwayat pembayaran</p>
						<ul class="mt-3 space-y-2 text-xs">
							{#each data.paymentHistory as p (p.id)}
								<li class="border border-line bg-mist/50 p-2.5">
									<div class="flex items-center justify-between gap-2">
										<span class="badge {PAYMENT_STATUS_BADGE[p.status] ?? 'badge-muted'}">
											{PAYMENT_STATUS_LABEL[p.status] ?? p.status}
										</span>
										<span class="text-[10px] text-smoke">{formatDate(p.createdAt)}</span>
									</div>
									<p class="mt-1.5 font-semibold">
										{paymentMethodLabel(p.method)}{p.gatewayType
											? ` · ${GATEWAY_TYPE_LABEL[p.gatewayType] ?? p.gatewayType}`
											: ''}
									</p>
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

			{#if data.waUrl}
				<a href={data.waUrl} target="_blank" rel="noopener noreferrer" class="btn btn-block">
					<MessageCircle size={14} /> Hubungi toko via WhatsApp
				</a>
			{/if}
		</aside>
	</div>
</div>
