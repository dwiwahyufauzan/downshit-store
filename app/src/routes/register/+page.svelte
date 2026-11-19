<script lang="ts">
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	/* ------------------------------------------------------------------
	 * AUTH_BG_IMAGE: URL gambar latar belakang untuk bagian kiri registrasi.
	 * Anda dapat mengganti tautan link gambar ini sesuai keinginan Anda.
	 * ------------------------------------------------------------------ */
	const AUTH_BG_IMAGE = 'https://i.pinimg.com/1200x/3e/74/75/3e7475870effd8fbbe6efd49e9029428.jpg';

	let { form } = $props();
	let loading = $state(false);
	let message = $derived((form as { message?: string } | null | undefined)?.message);
</script>

<svelte:head>
	<title>Daftar Akun Baru – Downshit Store</title>
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
					Buat akun untuk checkout, memantau status pesanan, dan melihat nomor resi pengiriman.
				</p>
			</div>

			<p class="eyebrow hidden !text-paper/60 lg:block">Official store &middot; Subang</p>
		</div>
	</div>

	<!-- Form -->
	<div class="flex items-center justify-center px-6 py-12 sm:px-10 lg:p-14">
		<div class="w-full max-w-md">
			<p class="eyebrow">Akun baru</p>
			<h2 class="section-title mt-2">Daftar</h2>
			<p class="mt-3 text-sm text-smoke">
				Sudah punya akun?
				<a href="/login" class="link font-semibold text-ink">Masuk di sini</a>
			</p>

			{#if message}
				<div
					class="mt-6 border-l-4 border-danger bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
					role="alert"
				>
					{message}
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
					<label for="name" class="label">Nama lengkap</label>
					<input
						id="name"
						name="name"
						type="text"
						required
						autocomplete="name"
						value={form?.values?.name ?? ''}
						placeholder="Contoh: Adrias Raihan"
						aria-invalid={form?.errors?.name ? 'true' : undefined}
						aria-describedby={form?.errors?.name ? 'err-name' : undefined}
					/>
					{#if form?.errors?.name}
						<p id="err-name" class="field-error">{form.errors.name[0]}</p>
					{/if}
				</div>

				<div>
					<label for="email" class="label">Alamat email</label>
					<input
						id="email"
						name="email"
						type="email"
						required
						autocomplete="email"
						value={form?.values?.email ?? ''}
						placeholder="nama@email.com"
						aria-invalid={form?.errors?.email ? 'true' : undefined}
						aria-describedby={form?.errors?.email ? 'err-email' : undefined}
					/>
					{#if form?.errors?.email}
						<p id="err-email" class="field-error">{form.errors.email[0]}</p>
					{/if}
				</div>

				<div>
					<label for="phone" class="label">Nomor WhatsApp / HP</label>
					<input
						id="phone"
						name="phone"
						type="tel"
						autocomplete="tel"
						value={form?.values?.phone ?? ''}
						placeholder="081234567890"
						aria-invalid={form?.errors?.phone ? 'true' : undefined}
						aria-describedby={form?.errors?.phone ? 'err-phone' : undefined}
					/>
					{#if form?.errors?.phone}
						<p id="err-phone" class="field-error">{form.errors.phone[0]}</p>
					{/if}
				</div>

				<div>
					<label for="password" class="label">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						autocomplete="new-password"
						placeholder="Minimal 8 karakter huruf & angka"
						aria-invalid={form?.errors?.password ? 'true' : undefined}
						aria-describedby={form?.errors?.password ? 'err-password' : undefined}
					/>
					{#if form?.errors?.password}
						<p id="err-password" class="field-error">{form.errors.password[0]}</p>
					{/if}
				</div>

				<div>
					<label for="confirmPassword" class="label">Ulangi password</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type="password"
						required
						autocomplete="new-password"
						placeholder="Ulangi password di atas"
						aria-invalid={form?.errors?.confirmPassword ? 'true' : undefined}
						aria-describedby={form?.errors?.confirmPassword ? 'err-confirmPassword' : undefined}
					/>
					{#if form?.errors?.confirmPassword}
						<p id="err-confirmPassword" class="field-error">{form.errors.confirmPassword[0]}</p>
					{/if}
				</div>

				<button type="submit" disabled={loading} class="btn btn-primary btn-lg btn-block">
					{loading ? 'Mendaftarkan akun...' : 'Daftar akun baru'}
				</button>
			</form>
		</div>
	</div>
</div>
