<script lang="ts">
	import { enhance } from '$app/forms';
	import { dev } from '$app/env';
	import { waLink } from '#lib/utils/whatsapp';
	import { forgotPasswordMessage } from '#lib/utils/wa-messages';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	/* ------------------------------------------------------------------
	 * AUTH_BG_IMAGE: URL gambar latar belakang untuk bagian kiri login.
	 * Anda dapat mengganti tautan link gambar ini sesuai keinginan Anda.
	 * ------------------------------------------------------------------ */
	const AUTH_BG_IMAGE = 'https://i.pinimg.com/1200x/2a/94/a6/2a94a6fe903d096df267bef684e0f4bd.jpg';

	let { form, data } = $props();
	let loading = $state(false);

	// Lupa password: tanpa email, konsumen meminta admin mengatur ulang lewat WhatsApp (plan/04)
	// email yang sudah diketik ikut dicantumkan agar admin tahu akun mana yang direset
	let typedEmail = $state('');
	const forgotUrl = $derived(
		waLink(
			data.store?.whatsapp,
			forgotPasswordMessage(data.store?.name ?? 'Downshit Store', typedEmail || form?.email)
		)
	);

	// Akun staf (owner/admin) masuk lewat portal terpisah: /staff/login
	const demoAccounts = [{ label: 'Konsumen', email: 'konsumen@downshit.local' }];

	function fillDemo(email: string) {
		const emailInput = document.getElementById('email') as HTMLInputElement;
		const passInput = document.getElementById('password') as HTMLInputElement;
		if (emailInput && passInput) {
			emailInput.value = email;
			typedEmail = email;
			passInput.value = 'Ganti-Password-123!';
		}
	}
</script>

<svelte:head>
	<title>Masuk Akun – Downshit Store</title>
</svelte:head>

<div class="grid min-h-screen lg:grid-cols-2">
	<!-- Blok merek dengan latar belakang gambar -->
	<div
		class="relative flex flex-col justify-between overflow-hidden bg-ink px-6 py-8 text-paper sm:px-10 lg:sticky lg:top-0 lg:h-screen lg:p-14"
	>
		<!-- Foto background dari link -->
		<img
			src={AUTH_BG_IMAGE}
			alt="Downshit Streetwear"
			class="absolute inset-0 h-full w-full object-cover object-center"
			loading="eager"
		/>
		<!-- Dark overlay gradient agar teks tetap tajam dan terbaca dengan jelas -->
		<div class="absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/75 to-ink/65"></div>

		<!-- Konten di atas background -->
		<div class="relative z-10 flex h-full flex-col justify-between">
			<a href="/" class="eyebrow inline-flex items-center gap-2 !text-paper/80 hover:!text-paper">
				<ArrowLeft size={14} /> Kembali ke toko
			</a>

			<div class="py-10 lg:py-0">
				<h1
					class="display text-[clamp(3rem,11vw,5.5rem)] text-paper drop-shadow-sm lg:text-[clamp(4rem,8vw,8rem)]"
				>
					Down<br />shit.
				</h1>
				<p class="mt-5 max-w-sm text-sm leading-relaxed text-paper/80 drop-shadow-sm">
					Streetwear lokal berbahan tebal dari Subang. Masuk untuk memantau pesanan dan belanja
					lebih cepat.
				</p>
			</div>

			<p class="eyebrow hidden !text-paper/60 lg:block">Official store &middot; Subang</p>
		</div>
	</div>

	<!-- Form -->
	<div class="flex items-center justify-center px-6 py-12 sm:px-10 lg:p-14">
		<div class="w-full max-w-md">
			<p class="eyebrow">Akun</p>
			<h2 class="section-title mt-2">Masuk</h2>
			<p class="mt-3 text-sm text-smoke">
				Belum punya akun?
				<a href="/register" class="link font-semibold text-ink">Daftar sebagai konsumen</a>
			</p>

			{#if form?.message}
				<div
					class="mt-6 border-l-4 border-danger bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
					role="alert"
				>
					{form.message}
					{#if 'wrongPortal' in form && form.wrongPortal}
						<a href="/staff/login" class="link ml-1 font-semibold">Buka portal staf</a>
					{/if}
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
					<label for="email" class="label">Alamat email</label>
					<input
						id="email"
						name="email"
						type="email"
						required
						autocomplete="email"
						value={form?.email ?? ''}
						oninput={(e) => (typedEmail = e.currentTarget.value)}
						placeholder="nama@email.com"
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
						Lupa password?
						{#if forgotUrl}
							<a href={forgotUrl} target="_blank" rel="noopener noreferrer" class="link text-ink">
								Hubungi admin via WhatsApp
							</a>
							untuk mengatur ulang.
						{:else}
							Hubungi admin toko untuk mengatur ulang.
						{/if}
					</p>
				</div>

				<button type="submit" disabled={loading} class="btn btn-primary btn-lg btn-block">
					{loading ? 'Memverifikasi...' : 'Masuk sekarang'}
				</button>

				<!-- Akun uji coba: hanya mode pengembangan, JANGAN tampil di produksi -->
				{#if dev}
					<div class="border border-dashed border-line bg-mist/50 p-4">
						<p class="eyebrow">Akun uji coba</p>
						<p class="hint !mt-1">Password: Ganti-Password-123!</p>
						<div class="mt-3 grid grid-cols-1 gap-2">
							{#each demoAccounts as acc (acc.email)}
								<button type="button" class="btn btn-sm" onclick={() => fillDemo(acc.email)}>
									{acc.label}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</form>

			<p class="mt-8 border-t border-line pt-5 text-xs text-smoke">
				Admin atau owner toko?
				<a href="/staff/login" class="link text-ink">Masuk lewat portal staf</a>
			</p>
		</div>
	</div>
</div>
