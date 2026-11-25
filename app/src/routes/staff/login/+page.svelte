<script lang="ts">
	import { enhance } from '$app/forms';
	import { dev } from '$app/env';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';

	let { form } = $props();
	let loading = $state(false);

	const demoAccounts = [
		{ label: 'Owner', email: 'owner@downshit.local' },
		{ label: 'Admin', email: 'admin@downshit.local' }
	];

	function fillDemo(email: string) {
		const emailInput = document.getElementById('email') as HTMLInputElement;
		const passInput = document.getElementById('password') as HTMLInputElement;
		if (emailInput && passInput) {
			emailInput.value = email;
			passInput.value = 'Ganti-Password-123!';
		}
	}
</script>

<svelte:head>
	<title>Portal Staf – Downshit Store</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="staff-login relative flex min-h-screen items-center justify-center px-6 py-12">
	<div class="relative z-10 w-full max-w-md">
		<a href="/" class="eyebrow inline-flex items-center gap-2 hover:!text-ink">
			<ArrowLeft size={14} /> Ke halaman toko
		</a>

		<div class="mt-6 border border-line bg-paper p-8 sm:p-10">
			<div class="flex items-center gap-2 text-smoke">
				<ShieldCheck size={16} />
				<p class="eyebrow">Area terbatas</p>
			</div>
			<h1 class="display mt-4 text-[clamp(2.75rem,10vw,4rem)] text-ink">
				Portal<br />staf.
			</h1>
			<p class="mt-4 text-sm leading-relaxed text-smoke">
				Khusus admin dan owner Downshit. Pelanggan silakan masuk lewat
				<a href="/login" class="link text-ink">halaman masuk pelanggan</a>.
			</p>

			{#if form?.message}
				<div
					class="mt-6 border-l-4 border-danger bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
					role="alert"
				>
					{form.message}
				</div>
			{/if}

			<form
				method="POST"
				class="mt-8 space-y-5"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						await update();
						loading = false;
					};
				}}
			>
				<div>
					<label for="email" class="label">Email staf</label>
					<input
						id="email"
						name="email"
						type="email"
						required
						autocomplete="username"
						value={form?.email ?? ''}
						placeholder="staf@downshit.id"
						aria-invalid={form?.errors?.email ? 'true' : undefined}
						aria-describedby={form?.errors?.email ? 'err-email' : undefined}
					/>
					{#if form?.errors?.email}
						<p id="err-email" class="field-error">{form.errors.email[0]}</p>
					{/if}
				</div>

				<div>
					<label for="password" class="label">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						autocomplete="current-password"
						placeholder="••••••••"
						aria-invalid={form?.errors?.password ? 'true' : undefined}
						aria-describedby={form?.errors?.password ? 'err-password' : undefined}
					/>
					{#if form?.errors?.password}
						<p id="err-password" class="field-error">{form.errors.password[0]}</p>
					{/if}
					<p class="hint">
						Lupa password? Hubungi owner atau pengelola sistem untuk mengatur ulang.
					</p>
				</div>

				<button type="submit" disabled={loading} class="btn btn-primary btn-lg btn-block">
					{loading ? 'Memverifikasi...' : 'Masuk ke portal'}
				</button>

				<!-- Akun uji coba: hanya mode pengembangan, JANGAN tampil di produksi -->
				{#if dev}
					<div class="border border-dashed border-line bg-mist/50 p-4">
						<p class="eyebrow">Akun uji coba</p>
						<p class="hint !mt-1">Password: Ganti-Password-123!</p>
						<div class="mt-3 grid grid-cols-2 gap-2">
							{#each demoAccounts as acc (acc.email)}
								<button type="button" class="btn btn-sm" onclick={() => fillDemo(acc.email)}>
									{acc.label}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</form>
		</div>

		<p class="eyebrow mt-6 text-center">Downshit &middot; Back office</p>
	</div>
</div>

<style>
	/* Kisi tipis ala gambar teknik: pembeda visual dari halaman pelanggan */
	.staff-login {
		background-image:
			linear-gradient(to right, rgb(255 255 255 / 0.035) 1px, transparent 1px),
			linear-gradient(to bottom, rgb(255 255 255 / 0.035) 1px, transparent 1px);
		background-size: 48px 48px;
	}
</style>
