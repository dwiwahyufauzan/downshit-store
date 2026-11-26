<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';

	let { data, form } = $props();
	let loading = $state(false);
</script>

<svelte:head>
	<title>Password Baru – Downshit Store</title>
</svelte:head>

<div class="container-shop py-10 sm:py-16">
	<div class="mx-auto max-w-md">
		<PageHeader title="Buat password baru" />

		{#if !data.valid}
			<div class="mt-6">
				<Alert
					type="error"
					message="Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru di halaman Lupa password."
				/>
			</div>
			<a href="/lupa-password" class="btn btn-primary btn-block mt-4">Minta tautan baru</a>
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
				<div>
					<label for="password" class="label">Password baru</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						autocomplete="new-password"
						placeholder="Min. 8 karakter, huruf dan angka"
						aria-invalid={form?.errors?.password ? 'true' : undefined}
					/>
					{#if form?.errors?.password}<p class="field-error">{form.errors.password[0]}</p>{/if}
				</div>
				<div>
					<label for="confirmPassword" class="label">Ulangi password baru</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type="password"
						required
						autocomplete="new-password"
						aria-invalid={form?.errors?.confirmPassword ? 'true' : undefined}
					/>
					{#if form?.errors?.confirmPassword}
						<p class="field-error">{form.errors.confirmPassword[0]}</p>
					{/if}
				</div>
				<button type="submit" disabled={loading} class="btn btn-primary btn-block">
					{loading ? 'Menyimpan...' : 'Simpan password baru'}
				</button>
			</form>
		{/if}
	</div>
</div>
