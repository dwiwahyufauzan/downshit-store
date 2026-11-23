<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import { formatDate, formatRupiah } from '#lib/utils/format';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let tx = $derived(data.tx);
	let copied = $state(false);

	const QR_CHANNELS = ['other_qris', 'gopay', 'shopeepay', 'dana', 'ovo'];
	let showQr = $derived(!!tx.channel && QR_CHANNELS.includes(tx.channel));
	let isVa = $derived(!!tx.channel && (tx.channel.endsWith('_va') || tx.channel === 'echannel'));
	let isStore = $derived(tx.channel === 'indomaret' || tx.channel === 'alfamart');

	/** QR tiruan: pola acak yang stabil per transaksi (bukan QR sungguhan, tidak bisa dipindai). */
	function fakeQr(seed: string, n = 25): boolean[][] {
		let h = 2166136261;
		for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
		const next = () => (
			(h = Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9),
			(h >>> 0) / 2 ** 32
		);
		const g = Array.from({ length: n }, () => Array.from({ length: n }, () => next() > 0.52));
		const finder = (r0: number, c0: number) => {
			for (let r = -1; r <= 7; r++)
				for (let c = -1; c <= 7; c++) {
					const rr = r0 + r;
					const cc = c0 + c;
					if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
					const edge = r === 0 || r === 6 || c === 0 || c === 6;
					const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
					g[rr][cc] = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (edge || core);
				}
		};
		finder(0, 0);
		finder(0, n - 7);
		finder(n - 7, 0);
		return g;
	}
	const qr = $derived(showQr ? fakeQr(tx.token) : []);

	function copy(text: string) {
		navigator.clipboard?.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const RESULT: Record<string, string> = {
		settlement: 'Pembayaran berhasil.',
		deny: 'Pembayaran gagal.',
		expire: 'Waktu pembayaran habis.',
		cancel: 'Transaksi dibatalkan (pesanan dibatalkan atau metode diganti).'
	};
</script>

<svelte:head>
	<title>Simulasi Pembayaran - Store Downshit</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="container-shop max-w-xl py-8">
	<div class="border-l-4 border-warn bg-warn-bg px-4 py-3 text-xs font-semibold text-warn">
		MODE SIMULASI: halaman ini meniru payment gateway (mirip Midtrans Snap). Tidak ada uang
		sungguhan yang berpindah.
	</div>

	<section class="panel mt-4">
		<p class="eyebrow">Pesanan {data.order.code}</p>
		<p class="price mt-1 text-3xl">{formatRupiah(tx.amount)}</p>
		<p class="hint">ID transaksi: {tx.gatewayOrderId}</p>
		{#if tx.status === 'pending'}
			<p class="mt-2 text-xs text-smoke">Bayar sebelum {formatDate(tx.expiresAt)}</p>
		{/if}
	</section>

	{#if form?.message}
		<div class="mt-4">
			<Alert type={form.success ? 'success' : 'error'} message={form.message} />
		</div>
	{/if}

	{#if tx.status === 'pending' && !tx.channel}
		<!-- 1) Pilih cara bayar -->
		<section class="panel mt-4">
			<h2 class="panel-title">Pilih cara bayar</h2>
			<form method="POST" action="?/pilih" class="mt-4 grid gap-px border border-line bg-line">
				{#each data.channels as c (c.key)}
					<button
						type="submit"
						name="channel"
						value={c.key}
						class="bg-paper px-4 py-3 text-left text-sm font-semibold hover:bg-mist"
					>
						{c.label}
					</button>
				{/each}
			</form>
		</section>
	{:else if tx.status === 'pending'}
		<!-- 2) Instruksi bayar -->
		<section class="panel mt-4">
			<h2 class="panel-title">{tx.channelLabel}</h2>

			{#if showQr}
				<p class="mt-3 text-sm text-smoke">
					Scan QR di bawah dengan aplikasi {tx.channelLabel === 'QRIS'
						? 'bank / e-wallet'
						: tx.channelLabel}.
				</p>
				<svg
					viewBox="-2 -2 29 29"
					class="mx-auto mt-4 w-56 border border-line bg-white"
					role="img"
					aria-label="QR simulasi"
					shape-rendering="crispEdges"
				>
					{#each qr as row, r (r)}
						{#each row as on, c (c)}
							{#if on}<rect x={c} y={r} width="1" height="1" fill="#000" />{/if}
						{/each}
					{/each}
				</svg>
				<p class="hint text-center">QR contoh, tidak bisa dipindai.</p>
			{:else if isVa || isStore}
				<p class="mt-3 text-sm text-smoke">
					{isStore
						? `Tunjukkan kode ini ke kasir ${tx.channelLabel}.`
						: 'Bayar ke nomor berikut lewat ATM, mobile banking, atau internet banking.'}
				</p>
				<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
					<span class="display text-2xl tracking-[0.04em] tabular-nums">
						{tx.channel === 'echannel' ? `70012 / ${tx.paymentCode}` : tx.paymentCode}
					</span>
					<button type="button" class="btn btn-sm" onclick={() => copy(tx.paymentCode ?? '')}>
						{#if copied}<Check size={14} /> Tersalin{:else}<Copy size={14} /> Salin{/if}
					</button>
				</div>
			{/if}
		</section>

		<!-- 3) Aksi simulator -->
		<section class="panel mt-4 border-dashed">
			<h2 class="panel-title">Simulator</h2>
			<p class="mt-2 text-sm text-smoke">
				Di Midtrans asli, langkah ini dilakukan pelanggan di aplikasi bank/e-wallet. Di sini pilih
				hasilnya:
			</p>
			<form method="POST" action="?/hasil" class="mt-4 flex flex-wrap gap-2">
				<button type="submit" name="outcome" value="settlement" class="btn btn-primary">
					Simulasikan pembayaran BERHASIL
				</button>
				<button type="submit" name="outcome" value="deny" class="btn btn-danger-outline">
					Gagal
				</button>
				<button type="submit" name="outcome" value="expire" class="btn">Kedaluwarsa</button>
			</form>
		</section>
	{:else}
		<section class="panel mt-4" role="status">
			<h2 class="panel-title">{RESULT[tx.status] ?? tx.status}</h2>
			{#if tx.status === 'deny' || tx.status === 'expire'}
				<p class="mt-2 text-sm text-smoke">
					Pesanan tetap menunggu pembayaran. Pilih metode pembayaran lagi di halaman pesanan.
				</p>
			{/if}
		</section>
	{/if}

	<div class="mt-6 text-center">
		<a href={data.returnUrl} class="btn btn-sm">Kembali ke toko</a>
	</div>
</div>
