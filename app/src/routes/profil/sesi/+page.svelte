<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import Breadcrumb from '#lib/components/Breadcrumb.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate } from '#lib/utils/format';
	import Monitor from '@lucide/svelte/icons/monitor';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const others = $derived(data.sessions.filter((s) => !s.current).length);
</script>

<svelte:head>
	<title>Sesi Login – Downshit Store</title>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<Breadcrumb items={[{ label: 'Pengaturan akun', href: '/profil' }, { label: 'Sesi login' }]} />

	<PageHeader title="Sesi login" meta="{data.sessions.length} sesi aktif">
		{#snippet actions()}
			{#if others > 0}
				<form method="POST" action="?/akhiriLain">
					<button
						type="submit"
						class="chip"
						onclick={(e) => {
							if (!confirm(`Akhiri ${others} sesi lain? Perangkat tersebut harus masuk ulang.`)) {
								e.preventDefault();
							}
						}}
					>
						Akhiri semua sesi lain
					</button>
				</form>
			{/if}
		{/snippet}
	</PageHeader>

	{#if form?.message && !form.success}
		<div class="mt-6">
			<Alert type="error" message={form.message} />
		</div>
	{/if}

	<ul class="mt-6 divide-y divide-line border-b border-line">
		{#each data.sessions as s (s.id)}
			<li class="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
				<Monitor size={20} class="shrink-0 text-smoke" strokeWidth={1.5} />

				<div class="min-w-0 flex-1">
					<p
						class="flex flex-wrap items-center gap-2 text-sm font-bold tracking-[0.06em] uppercase"
					>
						{s.current ? 'Perangkat ini' : 'Sesi lain'}
						{#if s.current}<span class="badge badge-ink">Aktif sekarang</span>{/if}
					</p>
					<p class="mt-1 text-xs text-smoke">
						Masuk {formatDate(s.createdAt)} &middot; berakhir {formatDate(s.expiresAt)}
					</p>
				</div>

				{#if !s.current}
					<form method="POST" action="?/akhiri">
						<input type="hidden" name="id" value={s.id} />
						<button type="submit" class="chip">Akhiri</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>

	<p class="hint mt-4">Perangkat tidak dicatat; tiap sesi dikenali dari waktu masuknya.</p>
</div>
