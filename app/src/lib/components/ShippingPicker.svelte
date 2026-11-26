<script lang="ts">
	import { formatRupiah } from '#lib/utils/format';

	type Opt = { id: string; label: string; price: number; etd: string | null };
	type Quote = { source: 'api' | 'flat'; options: Opt[] };

	/**
	 * Pilihan layanan kirim di checkout. Tarif kurir diambil dari /api/ongkir menurut kode pos tujuan
	 * (atau ongkir flat bila API kurir nonaktif / tidak melayani tujuan itu). Hasilnya dilaporkan ke halaman:
	 *  - `cost`: ongkir terpilih (rupiah)
	 *  - `blocker`: kenapa tombol "Buat pesanan" belum boleh ditekan ('none' = boleh)
	 * Harga di sini hanya tampilan; server menghitung ulang dari id layanan saat pesanan dibuat.
	 */
	let {
		shippingApi,
		flatCost,
		weightGrams,
		postal,
		initialOption = '',
		error,
		cost = $bindable(0),
		blocker = $bindable('none')
	}: {
		shippingApi: boolean;
		flatCost: number;
		weightGrams: number;
		/** kode pos tujuan yang berlaku saat ini */
		postal: string;
		initialOption?: string;
		error?: string;
		cost?: number;
		blocker?: 'none' | 'waiting' | 'pick' | 'failed';
	} = $props();

	// svelte-ignore state_referenced_locally
	let shippingOption = $state(initialOption);
	let quote = $state<Quote | null>(null);
	let quoting = $state(false);
	let quoteFailed = $state(false);

	$effect(() => {
		const code = postal;
		if (!shippingApi || !/^[0-9]{5}$/.test(code)) {
			quote = null;
			return;
		}
		quoting = true;
		quoteFailed = false;
		const ctrl = new AbortController();
		// jeda singkat: tidak menembak API tiap ketukan saat kode pos masih diketik
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/ongkir?postal=${code}`, { signal: ctrl.signal });
				if (!res.ok) throw new Error(String(res.status));
				const q = (await res.json()) as Quote;
				quote = q;
				if (!q.options.some((o) => o.id === shippingOption)) {
					shippingOption = q.source === 'api' ? '' : (q.options[0]?.id ?? '');
				}
				quoting = false;
			} catch (e) {
				if ((e as Error).name === 'AbortError') return;
				quote = null;
				quoteFailed = true;
				quoting = false;
			}
		}, 350);
		return () => {
			clearTimeout(timer);
			ctrl.abort();
		};
	});

	const chosen = $derived(quote?.options.find((o) => o.id === shippingOption));
	// tarif kurir wajib dipilih; ongkir flat (cadangan) otomatis
	const needsPick = $derived(shippingApi && quote?.source === 'api' && !chosen);
	const validPostal = $derived(/^[0-9]{5}$/.test(postal));
	// kode pos belum lengkap bukan "sedang menghitung": validasi form yang menahan pengiriman
	const waiting = $derived(
		shippingApi && validPostal && (quoting || quote === null) && !quoteFailed
	);

	$effect(() => {
		cost = !shippingApi ? flatCost : (chosen?.price ?? flatCost);
		blocker = !shippingApi
			? 'none'
			: quoteFailed
				? 'failed'
				: waiting
					? 'waiting'
					: needsPick
						? 'pick'
						: 'none';
	});
</script>

<section class="panel">
	<h2 class="panel-title">Layanan pengiriman</h2>

	{#if !shippingApi}
		<p class="mt-4 text-sm text-smoke">
			Ongkos kirim flat <strong class="text-ink">{formatRupiah(flatCost)}</strong> ke seluruh Indonesia.
		</p>
	{:else if !/^[0-9]{5}$/.test(postal)}
		<p class="mt-4 text-sm text-smoke">
			Isi kode pos tujuan pada alamat untuk melihat pilihan kurir dan ongkirnya.
		</p>
	{:else if quoting || (quote === null && !quoteFailed)}
		<p class="mt-4 text-sm text-smoke" role="status">Mengambil tarif kurir…</p>
	{:else if quoteFailed || !quote}
		<p class="mt-4 text-sm text-danger" role="alert">
			Tarif kurir gagal dimuat. Muat ulang halaman atau periksa kode pos.
		</p>
	{:else if quote.source === 'flat'}
		<p class="mt-4 text-sm text-smoke">
			Tarif kurir belum tersedia untuk tujuan ini, memakai ongkos kirim standar
			<strong class="text-ink">{formatRupiah(quote.options[0].price)}</strong>.
		</p>
		<input type="hidden" name="shippingOption" value={quote.options[0].id} />
	{:else}
		<p class="mt-2 text-xs text-smoke">
			Berat pesanan sekitar {(weightGrams / 1000).toLocaleString('id-ID', {
				maximumFractionDigits: 1
			})} kg.
		</p>
		<div class="mt-4 space-y-2" role="radiogroup" aria-label="Layanan pengiriman">
			{#each quote.options as o (o.id)}
				<label
					class="flex cursor-pointer items-center gap-3 border p-3 text-sm {shippingOption === o.id
						? 'border-ink'
						: 'border-line'}"
				>
					<input type="radio" name="shippingOption" value={o.id} bind:group={shippingOption} />
					<span class="min-w-0 flex-1">
						<span class="font-bold">{o.label}</span>
						{#if o.etd}<span class="block text-xs text-smoke">Estimasi {o.etd}</span>{/if}
					</span>
					<span class="price shrink-0">{formatRupiah(o.price)}</span>
				</label>
			{/each}
		</div>
		{#if error}<p class="field-error">{error}</p>{/if}
	{/if}
</section>
