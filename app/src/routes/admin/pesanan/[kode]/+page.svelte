<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { COURIERS, PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABEL } from '#lib/constants';
	import { formatRupiah, formatDate } from '#lib/utils/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let o = $derived(data.order);
	let pay = $derived(data.latestPayment);
	let ship = $derived(data.shipment);

	let showRejectModal = $state(false);
	let showCancelModal = $state(false);
	let showEditResi = $state(false);

	let rejectReason = $state('');
	let cancelReason = $state('');
</script>

<svelte:head>
	<title>Proses Pesanan {o.code} - Admin Downshit</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<Breadcrumb
			home={{ label: 'Admin', href: '/admin' }}
			items={[{ label: 'Pesanan', href: '/admin/pesanan' }, { label: o.code }]}
		/>
		<PageHeader title={o.code} meta="Dibuat {formatDate(o.createdAt)}">
			{#snippet after()}<StatusBadge status={o.status} />{/snippet}
			{#snippet actions()}
				{#if data.waUrl}
					<a href={data.waUrl} target="_blank" rel="noreferrer" class="btn btn-tool">
						<MessageCircle size={12} /> WhatsApp pelanggan
					</a>
				{/if}
			{/snippet}
		</PageHeader>
	</div>

	{#if form?.success}
		<Alert type="success" message="Aksi berhasil diproses!" />
	{/if}

	{#if form?.message}
		<Alert type="error" message={form.message} />
	{/if}

	<!-- Ringkasan -->
	<dl class="grid grid-cols-2 border border-line lg:grid-cols-4">
		<div class="border-r border-b border-line p-4 lg:border-b-0">
			<dt class="eyebrow">Total Tagihan</dt>
			<dd class="price mt-1 text-lg">{formatRupiah(o.total)}</dd>
		</div>
		<div class="border-b border-line p-4 lg:border-r lg:border-b-0">
			<dt class="eyebrow">Pembayaran</dt>
			<dd class="mt-1.5">
				<span class="badge {PAYMENT_STATUS_BADGE[data.paymentStatus] ?? 'badge-muted'}">
					{PAYMENT_STATUS_LABEL[data.paymentStatus] ?? data.paymentStatus}
				</span>
			</dd>
		</div>
		<div class="border-r border-line p-4">
			<dt class="eyebrow">Penerima</dt>
			<dd class="mt-1 truncate text-sm font-semibold">{o.recipientName}</dd>
		</div>
		<div class="p-4">
			<dt class="eyebrow">Item</dt>
			<dd class="mt-1 text-sm font-semibold">{data.items.length} baris</dd>
		</div>
	</dl>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Kolom Kanan (tampil pertama di mobile): Aksi sesuai status -->
		<div class="space-y-6 lg:order-2">
			<!-- Verifikasi Pembayaran -->
			<div class="panel">
				<h2 class="panel-title">Verifikasi Pembayaran</h2>

				{#if pay?.proofUrl}
					<div class="mt-4">
						<p class="eyebrow">
							Bukti Transfer Terbaru &middot; Unggahan ke-{data.payments.length}
						</p>
						<a href={pay.proofUrl} target="_blank" class="mt-2 block border border-line bg-mist">
							<img src={pay.proofUrl} alt="Bukti Transfer" class="max-h-60 w-full object-contain" />
						</a>
						<div class="mt-2">
							<a href={pay.proofUrl} target="_blank" class="link text-xs font-semibold">
								Buka gambar penuh &#8599;
							</a>
						</div>
					</div>
				{:else}
					<div
						class="mt-4 border border-dashed border-line bg-mist/50 p-4 text-center text-xs text-smoke"
					>
						Konsumen belum mengunggah bukti transfer.
					</div>
				{/if}

				{#if o.status === 'menunggu_konfirmasi'}
					<div class="mt-4 flex flex-col gap-2">
						<form method="POST" action="?/konfirmasi">
							<button type="submit" class="btn btn-primary btn-block text-center whitespace-normal">
								&#10003; Konfirmasi Pembayaran
							</button>
						</form>

						<button
							type="button"
							onclick={() => (showRejectModal = true)}
							class="btn btn-danger-outline btn-block text-center whitespace-normal"
						>
							&#10005; Tolak Bukti Transfer
						</button>
					</div>
				{/if}

				<!-- Riwayat Seluruh Percobaan Pembayaran -->
				{#if data.payments.length > 0}
					<div class="divider mt-5 pt-4">
						<p class="eyebrow">Riwayat Verifikasi</p>
						<ul class="mt-3 space-y-2 text-xs">
							{#each data.payments as p (p.id)}
								<li class="border border-line bg-mist/50 p-2.5">
									<div class="flex items-center justify-between gap-2">
										<span class="badge {PAYMENT_STATUS_BADGE[p.status] ?? 'badge-muted'}">
											{PAYMENT_STATUS_LABEL[p.status] ?? p.status}
										</span>
										<span class="text-[10px] text-smoke">{formatDate(p.createdAt)}</span>
									</div>
									{#if p.note}
										<p class="mt-1 {p.status === 'ditolak' ? 'text-danger' : 'text-smoke'}">
											{p.status === 'ditolak' ? 'Alasan' : 'Catatan'}: {p.note}
										</p>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<!-- Proses Pengiriman -->
			{#if o.status === 'diproses'}
				<div class="panel border-ink">
					<h2 class="panel-title">Input Pengiriman / Resi</h2>
					<p class="mt-2 text-xs text-smoke">
						Pembayaran sudah diverifikasi. Masukkan kurir dan nomor resi untuk mengirimkan barang ke
						konsumen.
					</p>

					<form method="POST" action="?/kirim" class="mt-4 space-y-4">
						<div>
							<label for="courier" class="label">Ekspedisi / Kurir</label>
							<select id="courier" name="courier" required>
								{#each COURIERS as c (c)}
									<option value={c}>{c}</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="trackingNumber" class="label">Nomor Resi Pengiriman</label>
							<input
								id="trackingNumber"
								name="trackingNumber"
								type="text"
								placeholder="Contoh: JP1234567890"
								required
							/>
						</div>

						<div>
							<label for="ship-note" class="label">Catatan (opsional)</label>
							<input id="ship-note" name="note" type="text" maxlength="255" />
						</div>

						<button type="submit" class="btn btn-primary btn-block text-center whitespace-normal">
							Simpan Resi &amp; Tandai Dikirim
						</button>
					</form>
				</div>
			{/if}

			<!-- Informasi Resi yang Sedang Berjalan -->
			{#if o.status === 'dikirim' || o.status === 'selesai'}
				<div class="panel">
					<div class="flex items-center justify-between gap-3">
						<h2 class="panel-title">Informasi Resi</h2>
						{#if o.status === 'dikirim'}
							<button
								type="button"
								onclick={() => (showEditResi = !showEditResi)}
								class="btn btn-tool btn-ghost"
								aria-expanded={showEditResi}
							>
								{showEditResi ? 'Batal' : 'Koreksi Resi'}
							</button>
						{/if}
					</div>

					<dl class="mt-4 space-y-3 text-sm">
						<div>
							<dt class="eyebrow">Kurir</dt>
							<dd class="mt-0.5 font-semibold">{ship?.courier ?? '-'}</dd>
						</div>
						<div>
							<dt class="eyebrow">Nomor Resi</dt>
							<dd class="mt-0.5 font-mono font-bold break-all">{ship?.trackingNumber ?? '-'}</dd>
						</div>
						<div>
							<dt class="eyebrow">Waktu Kirim</dt>
							<dd class="mt-0.5">{ship?.shippedAt ? formatDate(ship.shippedAt) : '-'}</dd>
						</div>
					</dl>

					{#if showEditResi}
						<form method="POST" action="?/koreksiResi" class="divider mt-5 space-y-4 pt-4">
							<div>
								<label for="corr-courier" class="label">Kurir</label>
								<select id="corr-courier" name="courier" required>
									{#each COURIERS as c (c)}
										<option value={c} selected={ship?.courier === c}>{c}</option>
									{/each}
								</select>
							</div>
							<div>
								<label for="corr-tracking" class="label">Nomor Resi</label>
								<input
									id="corr-tracking"
									name="trackingNumber"
									type="text"
									value={ship?.trackingNumber ?? ''}
									required
								/>
							</div>
							<button type="submit" class="btn btn-primary btn-block text-center whitespace-normal"
								>Perbarui Resi</button
							>
						</form>
					{/if}
				</div>
			{/if}

			<!-- Opsi Batalkan Pesanan -->
			{#if data.bisaBatal}
				<div class="panel border-danger">
					<h2 class="panel-title text-danger">Batalkan Pesanan</h2>
					<p class="mt-2 text-xs text-smoke">
						Pembatalan oleh admin akan mengembalikan seluruh stok produk &amp; kuota bundling ke
						etalase toko.
					</p>

					{#if o.status === 'diproses'}
						<div
							class="mt-3 border-l-4 border-warn bg-warn-bg px-3 py-2 text-xs font-medium text-warn"
						>
							Peringatan: pesanan sudah dibayar. Refund dana wajib dilakukan secara manual kepada
							konsumen di luar sistem.
						</div>
					{/if}

					<button
						type="button"
						onclick={() => (showCancelModal = true)}
						class="btn btn-danger btn-block mt-4"
					>
						Batalkan Pesanan Ini
					</button>
				</div>
			{/if}
		</div>

		<!-- Kolom Kiri: Detail Item & Pelanggan -->
		<div class="space-y-6 lg:order-1 lg:col-span-2">
			<!-- Detail Item Pesanan -->
			<div class="panel">
				<h2 class="panel-title">Item Pesanan ({data.items.length})</h2>
				<div class="mt-4 divide-y divide-line">
					{#each data.items as item (item.id)}
						<div class="py-3 first:pt-0">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="text-sm font-bold">
										{item.itemName}
										{#if item.itemType === 'bundle'}
											<span class="badge badge-outline ml-1 align-middle">Paket Bundling</span>
										{/if}
									</div>
									<div class="mt-0.5 text-xs text-smoke">
										{item.quantity} x {formatRupiah(item.unitPrice)}
									</div>
									{#if item.itemType === 'product' && item.size}
										<div class="mt-1.5">
											<span class="badge badge-ink">Ukuran {item.size}</span>
										</div>
									{/if}
								</div>
								<div class="price text-sm whitespace-nowrap">{formatRupiah(item.subtotal)}</div>
							</div>

							{#if item.components && item.components.length > 0}
								<div class="mt-2 border border-line bg-mist/50 p-3">
									<p class="eyebrow">Isi paket yang dikemas</p>
									<ul class="mt-2 space-y-1.5 text-xs">
										{#each item.components as c (c.id)}
											<li class="flex flex-wrap items-center gap-2">
												<span class="text-smoke">&bull; {c.productName} ({c.quantity}x)</span>
												{#if c.size}<span class="badge badge-ink">Ukuran {c.size}</span>{/if}
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Rincian Biaya -->
				<div class="divider space-y-1.5 pt-4 text-sm">
					<div class="flex justify-between text-smoke">
						<span>Subtotal Produk</span>
						<span class="price text-ink">{formatRupiah(o.subtotal)}</span>
					</div>
					<div class="flex justify-between text-smoke">
						<span>Ongkos Kirim Flat</span>
						<span class="price text-ink">{formatRupiah(o.shippingCost)}</span>
					</div>
					<div class="flex justify-between border-t border-ink pt-3 font-bold">
						<span class="tracking-[0.12em] uppercase">Total Tagihan</span>
						<span class="price text-lg">{formatRupiah(o.total)}</span>
					</div>
				</div>
			</div>

			<!-- Info Pengiriman & Penerima -->
			<div class="panel">
				<h2 class="panel-title">Tujuan Pengiriman &amp; Penerima</h2>
				<dl class="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
					<div>
						<dt class="eyebrow">Nama Penerima</dt>
						<dd class="mt-0.5 font-semibold">{o.recipientName}</dd>
					</div>
					<div>
						<dt class="eyebrow">Nomor Telepon</dt>
						<dd class="mt-0.5 font-semibold">{o.recipientPhone}</dd>
					</div>
					<div class="sm:col-span-2">
						<dt class="eyebrow">Alamat Lengkap</dt>
						<dd class="mt-0.5">{o.shippingAddress}</dd>
					</div>
					{#if o.notes}
						<div
							class="border-l-4 border-info bg-info-bg px-3 py-2 text-xs text-info sm:col-span-2"
						>
							<span class="font-bold">Catatan Pembeli:</span>
							{o.notes}
						</div>
					{/if}
				</dl>
			</div>

			<!-- Log Aktivitas Pesanan -->
			<div class="panel">
				<h2 class="panel-title">Riwayat Aktivitas Pesanan</h2>
				<div class="mt-4 divide-y divide-line">
					{#each data.logs as l (l.id)}
						<div class="py-2.5 text-xs first:pt-0 last:pb-0">
							<div class="flex items-center justify-between gap-3 text-smoke">
								<span>{formatDate(l.createdAt)} &bull; {l.userName ?? 'Sistem'}</span>
								<span class="font-mono text-[10px] uppercase">{l.action}</span>
							</div>
							<p class="mt-0.5 font-medium">{l.description}</p>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Modal Tolak Bukti -->
{#if showRejectModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-paper/80 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="reject-title"
	>
		<div class="panel w-full max-w-md">
			<h3 id="reject-title" class="panel-title">Tolak Bukti Pembayaran</h3>
			<p class="mt-2 text-xs text-smoke">
				Masukkan alasan penolakan (bukti buram, nominal tidak sesuai, nama pengirim salah). Konsumen
				akan mendapatkan kesempatan upload ulang.
			</p>
			<form method="POST" action="?/tolak" class="mt-4 space-y-4">
				<div>
					<label for="reject-reason" class="label">Alasan</label>
					<textarea
						id="reject-reason"
						name="reason"
						rows="3"
						placeholder="Alasan penolakan (min. 5 karakter)..."
						bind:value={rejectReason}
						required></textarea>
				</div>
				<div class="flex justify-end gap-2">
					<button type="button" onclick={() => (showRejectModal = false)} class="btn btn-tool">
						Batal
					</button>
					<button
						type="submit"
						disabled={rejectReason.trim().length < 5}
						class="btn btn-tool btn-danger"
					>
						Kirim Penolakan
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Modal Batal Pesanan -->
{#if showCancelModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-paper/80 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="cancel-title"
	>
		<div class="panel w-full max-w-md">
			<h3 id="cancel-title" class="panel-title">Konfirmasi Pembatalan Pesanan</h3>
			<p class="mt-2 text-xs text-smoke">
				Tuliskan alasan pembatalan. Seluruh stok produk dan bundling akan langsung dikembalikan ke
				etalase.
			</p>
			<form method="POST" action="?/batal" class="mt-4 space-y-4">
				<div>
					<label for="cancel-reason" class="label">Alasan</label>
					<textarea
						id="cancel-reason"
						name="reason"
						rows="3"
						placeholder="Alasan pembatalan (min. 5 karakter, contoh: Barang cacat saat packing)..."
						bind:value={cancelReason}
						required></textarea>
				</div>
				<div class="flex justify-end gap-2">
					<button type="button" onclick={() => (showCancelModal = false)} class="btn btn-tool">
						Kembali
					</button>
					<button
						type="submit"
						disabled={cancelReason.trim().length < 5}
						class="btn btn-tool btn-danger"
					>
						Batalkan Pesanan
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
