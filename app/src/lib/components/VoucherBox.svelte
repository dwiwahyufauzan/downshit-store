<script lang="ts">
	import { onMount } from 'svelte';
	import { formatRupiah } from '#lib/utils/format';

	/**
	 * Kotak kode voucher di checkout. "Pakai" meminta pratinjau potongan ke /api/voucher (hanya tampilan:
	 * kuota baru diambil server saat pesanan dibuat). Hasilnya dilaporkan lewat `applied`, dan kodenya
	 * dikirim bersama form lewat input tersembunyi `voucherCode`.
	 */
	let {
		initialCode = '',
		error,
		applied = $bindable(null)
	}: {
		initialCode?: string;
		/** galat dari server (mis. voucher ditolak saat pesanan dibuat) */
		error?: string;
		applied?: { code: string; discount: number } | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	let voucherInput = $state(initialCode);
	let voucherMsg = $state('');
	let applying = $state(false);

	async function applyVoucher() {
		const code = voucherInput.trim();
		if (!code) return;
		applying = true;
		voucherMsg = '';
		try {
			const res = await fetch(`/api/voucher?code=${encodeURIComponent(code)}`);
			if (!res.ok) throw new Error(String(res.status));
			const r = (await res.json()) as {
				ok: boolean;
				code?: string;
				discount?: number;
				message?: string;
			};
			if (r.ok && r.code && r.discount) {
				applied = { code: r.code, discount: r.discount };
				voucherInput = r.code;
			} else {
				applied = null;
				voucherMsg = r.message ?? 'Voucher tidak valid.';
			}
		} catch {
			applied = null;
			voucherMsg = 'Gagal memeriksa voucher. Coba lagi.';
		}
		applying = false;
	}
	function removeVoucher() {
		applied = null;
		voucherInput = '';
		voucherMsg = '';
	}
	// setelah formulir dikembalikan karena galat, voucher yang tadi dipakai dicek ulang
	onMount(() => {
		if (voucherInput) void applyVoucher();
	});
</script>

<div class="mt-5">
	<label for="voucher-input" class="label">Kode voucher</label>
	{#if applied}
		<div
			class="flex items-center justify-between gap-3 border border-ink bg-mist/50 px-3 py-2 text-sm"
		>
			<span>
				<strong class="font-mono">{applied.code}</strong>
				<span class="text-smoke"> · hemat {formatRupiah(applied.discount)}</span>
			</span>
			<button type="button" class="text-xs underline" onclick={removeVoucher}>Lepas</button>
		</div>
		<input type="hidden" name="voucherCode" value={applied.code} />
	{:else}
		<div class="flex gap-2">
			<input
				id="voucher-input"
				type="text"
				bind:value={voucherInput}
				placeholder="Punya kode?"
				maxlength="30"
				autocomplete="off"
				class="min-w-0 flex-1 uppercase"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void applyVoucher();
					}
				}}
			/>
			<button
				type="button"
				class="btn btn-sm"
				disabled={applying || !voucherInput.trim()}
				onclick={applyVoucher}
			>
				{applying ? '…' : 'Pakai'}
			</button>
		</div>
	{/if}
	{#if voucherMsg}<p class="field-error" role="alert">{voucherMsg}</p>{/if}
	{#if error}<p class="field-error">{error}</p>{/if}
</div>
