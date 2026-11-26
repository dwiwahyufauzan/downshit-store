<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatRupiah } from '#lib/utils/format';
	import Plus from '@lucide/svelte/icons/plus';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type V = PageProps['data']['vouchers'][number];
	let editing = $state<V | null>(null);
	/** Jenis potongan yang dipilih di form (null = ikut nilai awal) — menentukan field "batas potongan". */
	let typeSel = $state<string | null>(null);
	let formEl = $state<HTMLElement | null>(null);

	// tanggal tersimpan sebagai ISO UTC; form memakai tanggal kalender WIB
	const ymd = (iso: string | null) =>
		iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(iso)) : '';
	const dmy = (iso: string | null) =>
		iso
			? new Intl.DateTimeFormat('id-ID', {
					timeZone: 'Asia/Jakarta',
					day: 'numeric',
					month: 'short',
					year: 'numeric'
				}).format(new Date(iso))
			: '';

	const v = $derived((form?.values ?? {}) as Record<string, string | boolean | null>);
	const err = (k: string) =>
		(form?.errors as Record<string, string[] | undefined> | undefined)?.[k]?.[0];

	// nilai awal form: voucher yang sedang diubah, atau isian terakhir bila validasi gagal
	const init = $derived({
		code: editing?.code ?? v.code ?? '',
		description: editing?.description ?? v.description ?? '',
		type: editing?.type ?? v.type ?? 'percent',
		value: editing?.value ?? v.value ?? '',
		minSubtotal: editing?.minSubtotal ?? v.minSubtotal ?? 0,
		maxDiscount: editing?.maxDiscount ?? v.maxDiscount ?? '',
		startsOn: editing ? ymd(editing.startsAt) : (v.startsOn ?? ''),
		endsOn: editing ? ymd(editing.endsAt) : (v.endsOn ?? ''),
		usageLimit: editing?.usageLimit ?? v.usageLimit ?? '',
		perUserLimit: editing?.perUserLimit ?? v.perUserLimit ?? 1,
		isActive: editing ? editing.isActive : form?.errors ? Boolean(v.isActive) : true
	});
	const isPercent = $derived((typeSel ?? String(init.type)) === 'percent');

	function startEdit(x: V) {
		editing = x;
		typeSel = null;
		formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	function cancelEdit() {
		editing = null;
		typeSel = null;
	}

	/* ---------- status & ringkasan ---------- */
	type Status = 'aktif' | 'terjadwal' | 'berakhir' | 'habis' | 'nonaktif';
	const STATUS: Record<Status, { text: string; cls: string }> = {
		aktif: { text: 'Aktif', cls: 'badge-ok' },
		terjadwal: { text: 'Terjadwal', cls: 'badge-info' },
		berakhir: { text: 'Berakhir', cls: 'badge-muted' },
		habis: { text: 'Kuota habis', cls: 'badge-warn' },
		nonaktif: { text: 'Nonaktif', cls: 'badge-muted' }
	};
	const statusOf = (x: V): Status => {
		const now = Date.now();
		if (!x.isActive) return 'nonaktif';
		if (x.endsAt && new Date(x.endsAt).getTime() < now) return 'berakhir';
		if (x.startsAt && new Date(x.startsAt).getTime() > now) return 'terjadwal';
		if (x.usageLimit && x.usedCount >= x.usageLimit) return 'habis';
		return 'aktif';
	};

	const rows = $derived(data.vouchers.map((x) => ({ x, status: statusOf(x) })));
	const count = (s: Status) => rows.filter((r) => r.status === s).length;
	const totalUsed = $derived(data.vouchers.reduce((n, x) => n + x.usedCount, 0));

	const FILTERS: { key: 'semua' | Status; text: string }[] = [
		{ key: 'semua', text: 'Semua' },
		{ key: 'aktif', text: 'Aktif' },
		{ key: 'terjadwal', text: 'Terjadwal' },
		{ key: 'habis', text: 'Kuota habis' },
		{ key: 'berakhir', text: 'Berakhir' },
		{ key: 'nonaktif', text: 'Nonaktif' }
	];
	let filter = $state<'semua' | Status>('semua');
	let q = $state('');
	const shown = $derived(
		rows.filter(
			(r) =>
				(filter === 'semua' || r.status === filter) &&
				(!q.trim() || r.x.code.toLowerCase().includes(q.trim().toLowerCase()))
		)
	);

	const discount = (x: V) => (x.type === 'percent' ? `${x.value}%` : formatRupiah(x.value));
	const discountNote = (x: V) =>
		x.type === 'percent' && x.maxDiscount ? `maks. ${formatRupiah(x.maxDiscount)}` : '';
	const period = (x: V) =>
		x.startsAt || x.endsAt
			? `${dmy(x.startsAt) || '…'} – ${dmy(x.endsAt) || '…'}`
			: 'Tanpa batas waktu';
	const usagePct = (x: V) =>
		x.usageLimit ? Math.min(100, Math.round((x.usedCount / x.usageLimit) * 100)) : 0;

	const stats = $derived([
		{ label: 'Total voucher', value: data.vouchers.length, note: 'terdaftar' },
		{ label: 'Sedang aktif', value: count('aktif'), note: 'bisa dipakai pelanggan' },
		{ label: 'Terjadwal', value: count('terjadwal'), note: 'belum mulai' },
		{ label: 'Total pemakaian', value: totalUsed, note: 'kali ditebus' }
	]);
</script>

<svelte:head>
	<title>Kelola Voucher - Admin Downshit</title>
</svelte:head>

<div>
	<PageHeader title="Voucher & promo" meta="{data.vouchers.length} voucher" />

	{#if form?.message}
		<div class="mt-6">
			<Alert type={form.success ? 'success' : 'error'} message={form.message} />
		</div>
	{/if}

	<!-- Ringkasan -->
	<div class="mt-6 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
		{#each stats as s (s.label)}
			<div class="bg-paper px-4 py-4 sm:px-5">
				<p class="text-[11px] font-semibold tracking-[0.14em] text-smoke uppercase">{s.label}</p>
				<p class="display mt-1 text-3xl tabular-nums">{s.value}</p>
				<p class="text-xs text-smoke">{s.note}</p>
			</div>
		{/each}
	</div>

	<div class="mt-6 space-y-6">
		<!-- Form -->
		<section class="panel scroll-mt-24" bind:this={formEl}>
			<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
				<h2 class="panel-title">
					{editing ? `Ubah voucher ${editing.code}` : 'Buat voucher baru'}
				</h2>
				{#if editing}
					<span class="badge badge-ink">Mode ubah</span>
				{/if}
			</div>

			{#key editing?.id ?? 'baru'}
				<form method="POST" action="?/simpan" class="space-y-6">
					{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

					<!-- 1. Identitas -->
					<fieldset class="grid gap-4 md:grid-cols-3">
						<legend class="mb-3 text-xs font-bold tracking-[0.14em] text-ink uppercase">
							1 · Identitas
						</legend>
						<div>
							<label for="code" class="label">Kode voucher</label>
							<input
								id="code"
								name="code"
								value={init.code}
								maxlength="20"
								placeholder="HEMAT10"
								class="font-mono uppercase"
								autocomplete="off"
								required
							/>
							{#if err('code')}<p class="field-error">{err('code')}</p>{:else}
								<p class="mt-1 text-xs text-smoke">3–20 karakter: huruf, angka, - atau _</p>
							{/if}
						</div>
						<div class="md:col-span-2">
							<label for="description" class="label">Keterangan (opsional)</label>
							<input
								id="description"
								name="description"
								value={init.description}
								maxlength="200"
								placeholder="Contoh: Diskon spesial akhir pekan"
							/>
							<p class="mt-1 text-xs text-smoke">Ditampilkan ke pelanggan saat voucher dipakai.</p>
						</div>
					</fieldset>

					<!-- 2. Potongan -->
					<fieldset class="grid gap-4 border-t border-line pt-6 md:grid-cols-3">
						<legend class="mb-3 text-xs font-bold tracking-[0.14em] text-ink uppercase">
							2 · Potongan &amp; syarat
						</legend>
						<div>
							<label for="type" class="label">Jenis potongan</label>
							<select
								id="type"
								name="type"
								value={init.type}
								onchange={(e) => (typeSel = e.currentTarget.value)}
							>
								<option value="percent">Persen (%)</option>
								<option value="fixed">Nominal (Rp)</option>
							</select>
						</div>
						<div>
							<label for="value" class="label">
								Nilai potongan {isPercent ? '(%)' : '(Rp)'}
							</label>
							<input
								id="value"
								name="value"
								type="number"
								min="1"
								max={isPercent ? 100 : undefined}
								value={init.value}
								placeholder={isPercent ? '10' : '25000'}
								required
							/>
							{#if err('value')}<p class="field-error">{err('value')}</p>{/if}
						</div>
						<div>
							<label for="maxDiscount" class="label">Batas potongan (Rp)</label>
							<input
								id="maxDiscount"
								name="maxDiscount"
								type="number"
								min="1"
								value={init.maxDiscount}
								placeholder={isPercent ? 'Tanpa batas' : 'Hanya untuk persen'}
								disabled={!isPercent}
							/>
							{#if err('maxDiscount')}<p class="field-error">{err('maxDiscount')}</p>{:else}
								<p class="mt-1 text-xs text-smoke">Plafon potongan untuk voucher persen.</p>
							{/if}
						</div>
						<div>
							<label for="minSubtotal" class="label">Minimal belanja (Rp)</label>
							<input
								id="minSubtotal"
								name="minSubtotal"
								type="number"
								min="0"
								value={init.minSubtotal}
								required
							/>
							{#if err('minSubtotal')}<p class="field-error">{err('minSubtotal')}</p>{:else}
								<p class="mt-1 text-xs text-smoke">Isi 0 bila tanpa minimal.</p>
							{/if}
						</div>
					</fieldset>

					<!-- 3. Periode & kuota -->
					<fieldset class="grid gap-4 border-t border-line pt-6 md:grid-cols-4">
						<legend class="mb-3 text-xs font-bold tracking-[0.14em] text-ink uppercase">
							3 · Periode &amp; kuota
						</legend>
						<div>
							<label for="startsOn" class="label">Mulai (opsional)</label>
							<input id="startsOn" name="startsOn" type="date" value={init.startsOn} />
							{#if err('startsOn')}<p class="field-error">{err('startsOn')}</p>{/if}
						</div>
						<div>
							<label for="endsOn" class="label">Berakhir (opsional)</label>
							<input id="endsOn" name="endsOn" type="date" value={init.endsOn} />
							{#if err('endsOn')}<p class="field-error">{err('endsOn')}</p>{/if}
						</div>
						<div>
							<label for="usageLimit" class="label">Kuota total</label>
							<input
								id="usageLimit"
								name="usageLimit"
								type="number"
								min="1"
								value={init.usageLimit}
								placeholder="Tanpa batas"
							/>
							{#if err('usageLimit')}<p class="field-error">{err('usageLimit')}</p>{/if}
						</div>
						<div>
							<label for="perUserLimit" class="label">Batas per pelanggan</label>
							<input
								id="perUserLimit"
								name="perUserLimit"
								type="number"
								min="1"
								value={init.perUserLimit}
								required
							/>
							{#if err('perUserLimit')}<p class="field-error">{err('perUserLimit')}</p>{/if}
						</div>
						<p class="text-xs text-smoke md:col-span-4">
							Tanggal mengikuti zona waktu WIB. Kosongkan tanggal atau kuota bila voucher tidak
							dibatasi.
						</p>
					</fieldset>

					<div class="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
						<label class="flex cursor-pointer items-center gap-2 text-sm">
							<input type="checkbox" name="isActive" checked={Boolean(init.isActive)} />
							Voucher aktif (bisa dipakai pelanggan)
						</label>
						<div class="flex gap-3">
							{#if editing}
								<button type="button" class="btn" onclick={cancelEdit}>Batal</button>
							{/if}
							<button type="submit" class="btn btn-primary">
								{#if !editing}<Plus size={16} />{/if}
								{editing ? 'Simpan perubahan' : 'Buat voucher'}
							</button>
						</div>
					</div>
				</form>
			{/key}
		</section>

		<!-- Daftar -->
		<section class="space-y-3">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-wrap gap-2" role="group" aria-label="Filter status voucher">
					{#each FILTERS as f (f.key)}
						{@const n = f.key === 'semua' ? rows.length : count(f.key)}
						<button
							type="button"
							class="btn btn-tool {filter === f.key ? 'btn-primary' : ''}"
							aria-pressed={filter === f.key}
							onclick={() => (filter = f.key)}
						>
							{f.text}
							<span class="tabular-nums opacity-70">{n}</span>
						</button>
					{/each}
				</div>
				<input
					type="search"
					bind:value={q}
					placeholder="Cari kode…"
					aria-label="Cari kode voucher"
					class="!w-full sm:!w-56"
				/>
			</div>

			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Voucher</th>
							<th>Potongan</th>
							<th>Min. belanja</th>
							<th>Periode (WIB)</th>
							<th>Pemakaian</th>
							<th>Status</th>
							<th class="text-right">Aksi</th>
						</tr>
					</thead>
					<tbody>
						{#if data.vouchers.length === 0}
							<tr>
								<td colspan="7" class="!py-10 text-center text-sm text-smoke">
									Belum ada voucher. Buat voucher pertama lewat formulir di atas.
								</td>
							</tr>
						{:else if shown.length === 0}
							<tr>
								<td colspan="7" class="!py-10 text-center text-sm text-smoke">
									Tidak ada voucher yang cocok dengan filter.
								</td>
							</tr>
						{:else}
							{#each shown as { x, status } (x.id)}
								<tr class={editing?.id === x.id ? 'bg-mist' : ''}>
									<td class="min-w-40">
										<span class="font-mono font-bold tracking-wide">{x.code}</span>
										{#if x.description}
											<span
												class="block max-w-56 truncate text-xs text-smoke"
												title={x.description}
											>
												{x.description}
											</span>
										{/if}
									</td>
									<td class="whitespace-nowrap">
										<span class="display text-lg">{discount(x)}</span>
										{#if discountNote(x)}
											<span class="block text-xs text-smoke">{discountNote(x)}</span>
										{/if}
									</td>
									<td class="whitespace-nowrap">
										{x.minSubtotal ? formatRupiah(x.minSubtotal) : '—'}
									</td>
									<td class="text-xs whitespace-nowrap">{period(x)}</td>
									<td class="min-w-36">
										<span class="tabular-nums">
											{x.usedCount}{x.usageLimit ? ` / ${x.usageLimit}` : ''}
										</span>
										{#if x.usageLimit}
											<div
												class="mt-1 h-1 w-full bg-line"
												role="progressbar"
												aria-label="Pemakaian kuota"
												aria-valuenow={usagePct(x)}
												aria-valuemin="0"
												aria-valuemax="100"
											>
												<div class="h-full bg-ink" style="width: {usagePct(x)}%"></div>
											</div>
										{/if}
										<span class="block text-xs text-smoke">maks. {x.perUserLimit}/pelanggan</span>
									</td>
									<td>
										<span class="badge {STATUS[status].cls}">{STATUS[status].text}</span>
									</td>
									<td>
										<div class="flex flex-wrap justify-end gap-2">
											<button type="button" class="btn btn-tool" onclick={() => startEdit(x)}>
												Ubah
											</button>
											<form method="POST" action="?/toggle">
												<input type="hidden" name="id" value={x.id} />
												<input type="hidden" name="active" value={x.isActive ? '0' : '1'} />
												<button type="submit" class="btn btn-tool">
													{x.isActive ? 'Nonaktifkan' : 'Aktifkan'}
												</button>
											</form>
											{#if x.usedCount === 0}
												<form
													method="POST"
													action="?/hapus"
													onsubmit={(e) => {
														if (!confirm(`Hapus voucher ${x.code}?`)) e.preventDefault();
													}}
												>
													<input type="hidden" name="id" value={x.id} />
													<button type="submit" class="btn btn-tool btn-danger-outline"
														>Hapus</button
													>
												</form>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</section>
	</div>
</div>
