<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { page } from '$app/state';
	import { waLink } from '#lib/utils/whatsapp';
	import { tempPasswordMessage } from '#lib/utils/wa-messages';

	let {
		customerName,
		customerEmail = '',
		tempPassword,
		customerPhone = null
	}: {
		customerName: string;
		customerEmail?: string;
		tempPassword: string;
		customerPhone?: string | null;
	} = $props();

	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(tempPassword);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}

	// pesan memuat email akun, password sementara, dan tautan masuk (lihat utils/wa-messages)
	const waUrl = $derived(
		waLink(
			customerPhone,
			tempPasswordMessage({
				name: customerName,
				email: customerEmail,
				password: tempPassword,
				storeName: page.data.store?.name ?? 'Downshit Store',
				loginUrl: `${page.data.origin ?? page.url.origin}/login`
			})
		)
	);
</script>

<div class="border-2 border-ink bg-mist p-5" role="status">
	<p class="eyebrow text-ink">Password sementara dibuat</p>
	<h2 class="mt-1 text-base font-bold">Untuk: {customerName}</h2>
	<div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
		<output
			class="block flex-1 border border-ink bg-paper px-4 py-4 text-center font-mono text-xl font-black tracking-widest break-all select-all sm:text-2xl"
		>
			{tempPassword}
		</output>
		<button type="button" class="btn btn-primary" onclick={copy}>
			{#if copied}
				<Check size={16} /> Tersalin
			{:else}
				<Copy size={16} /> Salin
			{/if}
		</button>
		{#if waUrl}
			<a class="btn" href={waUrl} target="_blank" rel="noopener noreferrer"> Kirim via WhatsApp </a>
		{:else}
			<span class="self-center text-xs text-smoke">Nomor WhatsApp pelanggan belum valid</span>
		{/if}
	</div>
	<p class="mt-4 text-xs text-smoke">
		Sampaikan password sementara ini kepada pelanggan via WhatsApp/kontak. Pelanggan wajib
		menggantinya saat login berikutnya; semua sesi lamanya sudah berakhir.
		<strong class="text-ink">Hanya tampil sekali ini demi keamanan.</strong>
	</p>
</div>
