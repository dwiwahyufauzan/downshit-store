<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';

	let {
		customerName,
		tempPassword,
		customerPhone = null
	}: { customerName: string; tempPassword: string; customerPhone?: string | null } = $props();

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

	// 08xxx / +62xxx / 62xxx → 62xxx untuk tautan wa.me
	const waNumber = $derived.by(() => {
		const d = (customerPhone ?? '').replace(/\D/g, '');
		if (!d) return '';
		return d.startsWith('0') ? `62${d.slice(1)}` : d;
	});
	const waText = $derived(
		`Halo ${customerName}, password sementara akun Downshit Anda: ${tempPassword}\nSilakan masuk lalu segera ganti password Anda.`
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
		{#if waNumber}
			<a
				class="btn"
				href="https://wa.me/{waNumber}?text={encodeURIComponent(waText)}"
				target="_blank"
				rel="noopener noreferrer"
			>
				Kirim via WhatsApp
			</a>
		{/if}
	</div>
	<p class="mt-4 text-xs text-smoke">
		Sampaikan password sementara ini kepada pelanggan via WhatsApp/kontak. Pelanggan wajib
		menggantinya saat login berikutnya; semua sesi lamanya sudah berakhir.
		<strong class="text-ink">Hanya tampil sekali ini demi keamanan.</strong>
	</p>
</div>
