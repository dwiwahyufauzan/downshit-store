<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { tanggal } from '#lib/utils/format';

	// Bentuk data/form mengikuti load & actions di routes/profil/+page.server.ts
	type Props = {
		data: {
			profile: {
				name: string;
				email: string;
				phone: string | null;
				role: string;
				mustChangePassword: boolean;
				createdAt: string;
			};
		};
		form?: {
			profileSuccess?: boolean;
			profileError?: string;
			profileErrors?: { name?: string[]; phone?: string[] };
			passwordSuccess?: boolean;
			passwordError?: string;
			passwordErrors?: { newPassword?: string[]; confirmPassword?: string[] };
		} | null;
	};
	let { data, form }: Props = $props();

	let loadingProfile = $state(false);
	let loadingPassword = $state(false);

	// Akun wajib ganti password: dari ?wajib=1 (hooks) atau flag di profil
	let mustChange = $derived(
		page.url.searchParams.get('wajib') !== null || data.profile.mustChangePassword === true
	);
	const roleLabel = $derived(data.profile.role === 'owner' ? 'Owner' : 'Admin');
</script>

<div>
	<PageHeader title="Profil akun" meta="Terdaftar sejak {tanggal(data.profile.createdAt)}">
		{#snippet after()}
			<span class="badge border-line text-smoke">{roleLabel}</span>
		{/snippet}
	</PageHeader>

	{#if mustChange && !form?.passwordSuccess}
		<div class="mt-6">
			<Alert
				type="warning"
				message="Ganti password dulu. Demi keamanan, akun staf wajib memakai password baru sebelum bisa membuka menu lain. Isi formulir Ubah password di bawah."
			/>
		</div>
	{/if}

	<div class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
		<!-- Data akun -->
		<section class="panel space-y-4">
			<h2 class="panel-title border-b border-line pb-3">Data akun</h2>

			{#if form?.profileSuccess}
				<Alert type="success" message="Profil berhasil diperbarui!" />
			{/if}
			{#if form?.profileError}
				<Alert type="error" message={form.profileError} />
			{/if}

			<form
				method="POST"
				action="?/updateProfile"
				class="space-y-4"
				use:enhance={() => {
					loadingProfile = true;
					return async ({ update }) => {
						await update({ reset: false });
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

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="email" class="label">Alamat email</label>
						<input id="email" type="email" disabled value={data.profile.email} />
						<p class="hint">Email tidak dapat diubah.</p>
					</div>
					<div>
						<label for="role" class="label">Peran</label>
						<input id="role" type="text" disabled value={roleLabel} />
					</div>
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

				<button type="submit" disabled={loadingProfile} class="btn btn-primary">
					{loadingProfile ? 'Menyimpan...' : 'Simpan profil'}
				</button>
			</form>
		</section>

		<!-- Ubah password (diutamakan di atas bila wajib) -->
		<section
			class="panel space-y-4 {mustChange && !form?.passwordSuccess
				? 'order-first !border-ink'
				: ''}"
			id="ubah-password"
		>
			<h2 class="panel-title border-b border-line pb-3">Ubah password</h2>

			{#if form?.passwordSuccess}
				<Alert type="success" message="Password berhasil diubah!" />
			{/if}
			{#if form?.passwordError}
				<Alert type="error" message={form.passwordError} />
			{/if}

			<form
				method="POST"
				action="?/updatePassword"
				class="space-y-4"
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

				<button type="submit" disabled={loadingPassword} class="btn btn-primary">
					{loadingPassword ? 'Memperbarui...' : 'Ubah password'}
				</button>
			</form>
		</section>
	</div>
</div>
