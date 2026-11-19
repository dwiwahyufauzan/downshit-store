<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { page } from '$app/state';

	const wa = $derived(
		((page.data as { store?: { whatsapp?: string } }).store?.whatsapp ?? '').replace(/\D/g, '')
	);

	const sections = [
		{
			title: 'Data yang dikumpulkan',
			body: 'Nama, alamat email, nomor telepon/WhatsApp, alamat pengiriman, riwayat pesanan, dan bukti transfer yang kamu unggah. Kami tidak menyimpan data kartu atau rekening milikmu; pembayaran hanya berupa bukti transfer manual.'
		},
		{
			title: 'Tujuan penggunaan',
			body: 'Memproses pesanan, mengirim barang, mengonfirmasi pembayaran, dan menyusun laporan penjualan toko. Data tidak dipakai untuk iklan dan tidak dijual kepada pihak lain.'
		},
		{
			title: 'Pihak yang dapat mengakses',
			body: 'Admin dan owner Downshit Store. Owner melihat data agregat (laporan), sedangkan nomor telepon dan alamat hanya terlihat oleh admin dan pemilik data. Kurir hanya menerima nama, telepon, dan alamat saat pengiriman.'
		},
		{
			title: 'Penyimpanan dan keamanan',
			body: 'Password disimpan sebagai hash (Argon2id), sesi login memakai cookie aman, akses dibatasi berdasarkan peran, dan bukti transfer hanya bisa dibuka oleh pemilik pesanan, admin, dan owner. Gambar yang diunggah diproses ulang sehingga metadata (termasuk lokasi GPS) dibuang.'
		},
		{
			title: 'Lama penyimpanan',
			body: 'Data pesanan disimpan selama diperlukan untuk pembukuan toko. Akun dapat dinonaktifkan atas permintaanmu; catatan transaksi tetap dipertahankan sesuai kebutuhan pembukuan.'
		},
		{
			title: 'Hak kamu',
			body: 'Kamu dapat memperbarui nama, telepon, dan alamat kapan saja lewat halaman Profil, serta meminta koreksi atau penonaktifan akun lewat WhatsApp toko.'
		}
	];
</script>

<svelte:head>
	<title>Kebijakan Privasi – Downshit Store</title>
</svelte:head>

<div class="container-shop py-6 sm:py-8">
	<PageHeader title="Kebijakan privasi" />

	<div class="max-w-3xl">
		<p class="mt-6 text-sm leading-relaxed text-smoke">
			Downshit Store menyimpan data seperlunya untuk melayani pesananmu, sejalan dengan prinsip
			pelindungan data pribadi (UU No. 27 Tahun 2022).
		</p>

		<div class="mt-6 divide-y divide-line border-y border-line">
			{#each sections as s, i (s.title)}
				<section class="grid gap-2 py-6 sm:grid-cols-[14rem_1fr] sm:gap-8">
					<h2 class="text-xs font-bold tracking-[0.14em] uppercase">{i + 1}. {s.title}</h2>
					<p class="text-sm leading-relaxed text-smoke">{s.body}</p>
				</section>
			{/each}
		</div>

		<p class="mt-8 text-sm text-smoke">
			Pertanyaan atau permintaan koreksi data:
			{#if wa}
				<a
					href="https://wa.me/{wa}"
					rel="noopener"
					target="_blank"
					class="link font-semibold text-ink"
				>
					hubungi WhatsApp toko
				</a>.
			{:else}
				hubungi admin toko.
			{/if}
		</p>
	</div>
</div>
