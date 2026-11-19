<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '$lib/components/Alert.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { tanggal } from '$lib/utils/format';

	let { data, form } = $props();
	let loadingProfile = $state(false);
	let loadingPassword = $state(false);

	// Akun wajib ganti password: dari ?wajib=1 (hooks) atau flag di profil
	// (query hilang setelah submit form, flag tetap ada sampai password diganti).
	let mustChange = $derived(
		page.url.searchParams.get('wajib') !== null || data.profile?.mustChangePassword === true
	);
</script>

<svelte:head>
	<title>Profil & Pengaturan Akun – Downshit Store</title>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<PageHeader title="Pengaturan akun" meta={data.profile.email} />

	{#if mustChange && !form?.passwordSuccess}
		<div class="mt-6">
			<Alert
				type="warning"
				message="Ganti password dulu. Demi keamanan, akunmu wajib memakai password baru sebelum bisa membuka fitur lain. Isi formulir Ubah Password di bawah."
			/>
		</div>
	{/if}

	<div class="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
		<!-- Ubah password (diutamakan di atas bila wajib) -->
		<section
			class="panel {mustChange && !form?.passwordSuccess ? 'order-first !border-ink' : ''}"
			id="ubah-password"
		>
			<h2 class="panel-title">Ubah password</h2>
			<p class="hint !mt-1">Gunakan kombinasi huruf dan angka.</p>

			{#if form?.passwordSuccess}
				<div class="mt-5"><Alert type="success" message="Password berhasil diubah!" /></div>
			{/if}
			{#if form?.passwordError}
				<div class="mt-5"><Alert type="error" message={form.passwordError} /></div>
			{/if}

			<form
				method="POST"
				action="?/updatePassword"
				class="mt-5 space-y-5"
				use:enhance={() => {
					loadingPassword = true;
					return async ({ update }) => {
						await update();
						loadingPassword = false;
					};
				}}
			>
				<div>
					<label for="currentPassword" class="label">Password saat ini</label>
					<input
						id="currentPassword"
						name="currentPassword"
						type="password"
						required
						autocomplete="current-password"
					/>
				</div>

				<div>
					<label for="newPassword" class="label">Password baru</label>
					<input
						id="newPassword"
						name="newPassword"
						type="password"
						required
						autocomplete="new-password"
						placeholder="Min. 8 karakter"
						aria-invalid={form?.passwordErrors?.newPassword ? 'true' : undefined}
						aria-describedby={form?.passwordErrors?.newPassword ? 'err-newPassword' : undefined}
					/>
					{#if form?.passwordErrors?.newPassword}
						<p id="err-newPassword" class="field-error">{form.passwordErrors.newPassword[0]}</p>
					{/if}
				</div>

				<div>
					<label for="confirmPassword" class="label">Ulangi password baru</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type="password"
						required
						autocomplete="new-password"
						aria-invalid={form?.passwordErrors?.confirmPassword ? 'true' : undefined}
						aria-describedby={form?.passwordErrors?.confirmPassword
							? 'err-confirmPassword'
							: undefined}
					/>
					{#if form?.passwordErrors?.confirmPassword}
						<p id="err-confirmPassword" class="field-error">
							{form.passwordErrors.confirmPassword[0]}
						</p>
					{/if}
				</div>

				<button type="submit" disabled={loadingPassword} class="btn btn-primary btn-block">
					{loadingPassword ? 'Memperbarui...' : 'Ubah password'}
				</button>
			</form>
		</section>

		<!-- Data profil -->
		<section class="panel">
			<h2 class="panel-title">Data profil</h2>
			<p class="hint !mt-1">Terdaftar sejak {tanggal(data.profile.createdAt)}</p>

			{#if form?.profileSuccess}
				<div class="mt-5"><Alert type="success" message="Profil berhasil diperbarui!" /></div>
			{/if}
			{#if form?.profileError}
				<div class="mt-5"><Alert type="error" message={form.profileError} /></div>
			{/if}

			<form
				method="POST"
				action="?/updateProfile"
				class="mt-5 space-y-5"
				use:enhance={() => {
					loadingProfile = true;
					return async ({ update }) => {
						await update();
						loadingProfile = false;
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
						value={data.profile.name}
						aria-invalid={form?.profileErrors?.name ? 'true' : undefined}
						aria-describedby={form?.profileErrors?.name ? 'err-name' : undefined}
					/>
					{#if form?.profileErrors?.name}
						<p id="err-name" class="field-error">{form.profileErrors.name[0]}</p>
					{/if}
				</div>

				<div>
					<label for="email" class="label">Alamat email</label>
					<input id="email" type="email" disabled value={data.profile.email} />
					<p class="hint">Email tidak dapat diubah.</p>
				</div>

				<div>
					<label for="phone" class="label">Nomor WhatsApp / HP</label>
					<input
						id="phone"
						name="phone"
						type="tel"
						autocomplete="tel"
						value={data.profile.phone ?? ''}
						placeholder="081234567890"
						aria-invalid={form?.profileErrors?.phone ? 'true' : undefined}
						aria-describedby={form?.profileErrors?.phone ? 'err-phone' : undefined}
					/>
					{#if form?.profileErrors?.phone}
						<p id="err-phone" class="field-error">{form.profileErrors.phone[0]}</p>
					{/if}
				</div>

				<div>
					<label for="address" class="label">Alamat pengiriman default</label>
					<textarea
						id="address"
						name="address"
						rows="3"
						placeholder="Nama jalan, nomor rumah, RT/RW, kelurahan, kecamatan, kota Subang"
						aria-invalid={form?.profileErrors?.address ? 'true' : undefined}
						aria-describedby={form?.profileErrors?.address ? 'err-address' : undefined}
						>{data.profile.address ?? ''}</textarea
					>
					{#if form?.profileErrors?.address}
						<p id="err-address" class="field-error">{form.profileErrors.address[0]}</p>
					{/if}
				</div>

				<button type="submit" disabled={loadingProfile} class="btn btn-primary btn-block">
					{loadingProfile ? 'Menyimpan...' : 'Simpan profil'}
				</button>
			</form>
		</section>
	</div>
</div>
