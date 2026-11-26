<script lang="ts">
	import { onMount } from 'svelte';

	type Values = {
		province?: string;
		city?: string;
		district?: string;
		village?: string;
		addressDetail?: string;
		postalCode?: string;
	};
	type Errors = Partial<Record<keyof Values, string[]>>;
	type Opt = [code: string, name: string];

	let {
		values = {},
		errors = {},
		required = true,
		onpostal
	}: {
		values?: Values;
		errors?: Errors;
		required?: boolean;
		/** Dipanggil setiap kode pos berubah (checkout memakainya untuk memuat ongkir) */
		onpostal?: (postal: string) => void;
	} = $props();

	// Tingkat berurutan: memilih satu tingkat memuat daftar tingkat berikutnya menurut kode pilihannya.
	const LEVELS = [
		{ key: 'province', api: 'provinsi', label: 'Provinsi', auto: 'address-level1' },
		{ key: 'city', api: 'kota', label: 'Kota / Kabupaten', auto: 'address-level2' },
		{ key: 'district', api: 'kecamatan', label: 'Kecamatan', auto: 'address-level3' },
		{ key: 'village', api: 'desa', label: 'Desa / Kelurahan', auto: 'address-level4' }
	] as const;
	type Key = (typeof LEVELS)[number]['key'];

	// nilai awal saja (halaman dimuat ulang bila data berubah)
	/* svelte-ignore state_referenced_locally */
	let sel = $state<Record<Key, string>>({
		province: values.province ?? '',
		city: values.city ?? '',
		district: values.district ?? '',
		village: values.village ?? ''
	});
	let lists = $state<Record<Key, Opt[]>>({ province: [], city: [], district: [], village: [] });
	let loading = $state(true);
	// data wilayah gagal dimuat → kolom berubah jadi isian teks biasa agar pelanggan tetap bisa checkout
	let failed = $state(false);

	const codeOf = (key: Key) => lists[key].find((o) => o[1] === sel[key])?.[0];

	async function fetchLevel(i: number): Promise<Opt[]> {
		const parent = i === 0 ? '' : codeOf(LEVELS[i - 1].key);
		if (i > 0 && !parent) return [];
		const url = `/api/wilayah?level=${LEVELS[i].api}${parent ? `&parent=${parent}` : ''}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`wilayah ${res.status}`);
		return res.json();
	}

	onMount(async () => {
		try {
			// pulihkan pilihan tersimpan tingkat demi tingkat; yang tidak cocok dengan data (alamat lama) dikosongkan
			for (let i = 0; i < LEVELS.length; i++) {
				const { key } = LEVELS[i];
				lists[key] = await fetchLevel(i);
				if (sel[key] && !codeOf(key)) {
					for (const l of LEVELS.slice(i)) sel[l.key] = '';
				}
				if (!sel[key]) break;
			}
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	});

	async function choose(i: number, name: string) {
		// nilai dibaca dari elemen: urutan handler `bind:value` dan `onchange` tidak dijamin
		sel[LEVELS[i].key] = name;
		// tingkat di bawahnya dikosongkan, lalu daftar tingkat berikutnya dimuat sesuai pilihan
		for (const l of LEVELS.slice(i + 1)) {
			sel[l.key] = '';
			lists[l.key] = [];
		}
		const next = LEVELS[i + 1];
		if (!next || !sel[LEVELS[i].key]) return;
		try {
			lists[next.key] = await fetchLevel(i + 1);
		} catch {
			failed = true;
		}
	}
</script>

<div class="space-y-5">
	<div class="grid gap-5 sm:grid-cols-2">
		{#each LEVELS as l, i (l.key)}
			{@const err = errors[l.key]}
			<div>
				<label for={l.key} class="label">{l.label}</label>
				{#if failed}
					<input
						type="text"
						id={l.key}
						name={l.key}
						bind:value={sel[l.key]}
						{required}
						autocomplete={l.auto}
						aria-invalid={err ? 'true' : undefined}
						aria-describedby={err ? `err-${l.key}` : undefined}
					/>
				{:else}
					<select
						id={l.key}
						name={l.key}
						bind:value={sel[l.key]}
						onchange={(e) => choose(i, e.currentTarget.value)}
						{required}
						disabled={loading || (i > 0 && !sel[LEVELS[i - 1].key])}
						autocomplete={l.auto}
						aria-invalid={err ? 'true' : undefined}
						aria-describedby={err ? `err-${l.key}` : undefined}
					>
						<option value="">
							{loading && i === 0 ? 'Memuat…' : `Pilih ${l.label.toLowerCase()}`}
						</option>
						{#each lists[l.key] as [code, name] (code)}
							<option value={name}>{name}</option>
						{/each}
					</select>
				{/if}
				{#if err}<p id="err-{l.key}" class="field-error">{err[0]}</p>{/if}
			</div>
		{/each}
	</div>

	<div class="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
		<div>
			<label for="postalCode" class="label">Kode pos</label>
			<input
				type="text"
				id="postalCode"
				name="postalCode"
				value={values.postalCode ?? ''}
				oninput={(e) => onpostal?.(e.currentTarget.value)}
				inputmode="numeric"
				maxlength="5"
				pattern={'[0-9]{5}'}
				placeholder="41211"
				{required}
				autocomplete="postal-code"
				aria-invalid={errors.postalCode ? 'true' : undefined}
				aria-describedby={errors.postalCode ? 'err-postalCode' : undefined}
			/>
			{#if errors.postalCode}
				<p id="err-postalCode" class="field-error">{errors.postalCode[0]}</p>
			{/if}
		</div>
	</div>

	<div>
		<label for="addressDetail" class="label">Alamat detail</label>
		<textarea
			id="addressDetail"
			name="addressDetail"
			rows="3"
			placeholder="Nama jalan, nomor rumah, RT/RW, patokan, kode pos"
			{required}
			autocomplete="street-address"
			aria-invalid={errors.addressDetail ? 'true' : undefined}
			aria-describedby={errors.addressDetail ? 'err-addressDetail' : undefined}
			>{values.addressDetail ?? ''}</textarea
		>
		{#if errors.addressDetail}
			<p id="err-addressDetail" class="field-error">{errors.addressDetail[0]}</p>
		{/if}
	</div>
</div>
