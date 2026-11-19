<script lang="ts">
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import CheckCircle from '@lucide/svelte/icons/circle-check';
	import AlertCircle from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import X from '@lucide/svelte/icons/x';
	import { dismiss, pause, resume, toasts, type ToastKind } from '#lib/stores/toast.svelte';

	const styles: Record<ToastKind, string> = {
		success: 'border-ok bg-ok-bg text-ok',
		error: 'border-danger bg-danger-bg text-danger',
		info: 'border-info bg-info-bg text-info'
	};
	const icons = { success: CheckCircle, error: AlertCircle, info: Info };

	// Pengguna dengan reduce-motion: muncul/hilang tanpa gerak
	const reduced = $derived(
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
	);
	const dur = $derived(reduced ? 0 : 180);
</script>

<!-- Wilayah live: pembaca layar membacakan toast baru tanpa memindahkan fokus -->
<div
	class="pointer-events-none fixed inset-x-4 top-20 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end print:hidden"
	aria-live="polite"
	aria-atomic="false"
>
	{#each toasts as t (t.id)}
		{@const Icon = icons[t.kind]}
		<div
			class="pointer-events-auto flex w-full max-w-sm items-start gap-3 border-l-4 px-4 py-3 text-sm font-medium shadow-lg {styles[
				t.kind
			]}"
			role={t.kind === 'error' ? 'alert' : 'status'}
			onmouseenter={() => pause(t.id)}
			onmouseleave={() => resume(t.id)}
			onfocusin={() => pause(t.id)}
			onfocusout={() => resume(t.id)}
			in:fly={{ y: -12, duration: dur }}
			out:fly={{ x: 24, duration: dur }}
			animate:flip={{ duration: dur }}
		>
			<Icon size={18} class="mt-px shrink-0" aria-hidden="true" />
			<div class="min-w-0 flex-1">
				<p class="break-words">{t.message}</p>
				{#if t.action}
					<a
						href={t.action.href}
						class="link mt-1 inline-block text-xs font-semibold tracking-[0.14em] uppercase"
						onclick={() => dismiss(t.id)}
					>
						{t.action.label}
					</a>
				{/if}
			</div>
			<button
				type="button"
				class="-m-1 shrink-0 p-1 opacity-70 hover:opacity-100 focus-visible:opacity-100"
				aria-label="Tutup notifikasi"
				onclick={() => dismiss(t.id)}
			>
				<X size={16} aria-hidden="true" />
			</button>
		</div>
	{/each}
</div>
