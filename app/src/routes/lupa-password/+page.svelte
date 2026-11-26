<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { waLink } from '#lib/utils/whatsapp';
	import { forgotPasswordMessage } from '#lib/utils/wa-messages';

	let { data, form } = $props();
	let loading = $state(false);

	const waUrl = $derived(
		waLink(data.store?.whatsapp, forgotPasswordMessage(data.store?.name ?? 'Downshit Store'))
	);
</script>

<svelte:head>
	<title>Lupa Password – Downshit Store</title>
</svelte:head>

<div class="container-shop py-10 sm:py-16">
	<div class="mx-auto max-w-md">
		<PageHeader title="Lupa password" />

		{#if !data.mailEnabled}
			<div class="panel mt-6">
				<p class="text-sm">
					Pengaturan ulang lewat email belum diaktifkan di toko ini.
					{#if waUrl}
						<a href={waUrl} target="_blank" rel="noopener noreferrer" class="link text-ink">
							Hubungi admin via WhatsApp
						</a>
						untuk mengatur ulang password.
					{:else}
						Hubungi admin toko untuk mengatur ulang password.
					{/if}
				</p>
				<a href="/login" class="btn btn-ghost btn-sm btn-block mt-4">Kembali ke login</a>
			</div>
		{:else if form?.sent}
			<div class="mt-6">
				<Alert
					type="success"
					message="Jika email {form.email} terdaftar, tautan untuk mengatur ulang password sudah dikirim. Periksa kotak masuk (dan folder spam). Tautan berlaku 1 jam."
				/>
			</div>
			<a href="/login" class="btn btn-ghost btn-sm btn-block mt-4">Kembali ke login</a>
		{:else}
			{#if form?.error}
				<div class="mt-6"><Alert type="error" message={form.error} /></div>
			{/if}
			<form
				method="POST"
				class="panel mt-6 space-y-5"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						await update();
						loading = false;
					};
				}}
			>
				<p class="text-sm text-smoke">
					Masukkan email akunmu. Kami kirim tautan untuk membuat password baru.
				</p>
				<div>
					<label for="email" class="label">Email</label>
					<input
						id="email"
						name="email"
						type="email"
						required
						autocomplete="email"
						value={form?.email ?? ''}
					/>
				</div>
				<button type="submit" disabled={loading} class="btn btn-primary btn-block">
					{loading ? 'Mengirim...' : 'Kirim tautan reset'}
				</button>
				<a href="/login" class="btn btn-ghost btn-sm btn-block">Kembali ke login</a>
			</form>
		{/if}
	</div>
</div>
