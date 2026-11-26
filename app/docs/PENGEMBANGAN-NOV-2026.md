# Catatan Pengembangan — November 2026

Ringkasan penambahan setelah versi awal (SRS-F-001…014), dikelompokkan menurut tujuan. Semua fitur punya tes
otomatis; fitur yang bergantung layanan luar **mati secara bawaan** dan aplikasi tetap berjalan penuh tanpanya.

## 1. Keandalan & operasional

| Perubahan                                                                           | Lokasi utama                                                     | Catatan                                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **CI** (cek tipe, lint, seluruh tes, pemeriksaan migrasi, E2E)                      | `.github/workflows/ci.yml`                                       | CI gagal bila `schema.ts` berubah tanpa file migrasi                                        |
| **Tes end-to-end** Playwright                                                       | `e2e/`                                                           | Build produksi + DB sementara + simulator pembayaran; paket npm sendiri                     |
| **Migrasi berversi** (menggantikan skrip `ALTER TABLE` manual)                      | `drizzle/`, `src/lib/server/db/migrator.ts`                      | DB lama disusul otomatis ke baseline (`legacy-catchup.ts`); dijalankan `deploy.sh` & Docker |
| **Pemantauan**: log JSON, Sentry/GlitchTip tanpa SDK, `/api/health`, heartbeat cron | `logger.ts`, `error-report.ts`, `api/health`, `api/client-error` | Rahasia otomatis disamarkan; dedupe 1×/menit & batas 30/menit                               |
| **Backup di luar server** (rclone) + verifikasi ukuran + retensi                    | `deploy/scripts/offsite.sh`, `backup.sh`                         | Heartbeat hanya bila backup & unggahan sukses                                               |
| **Rate limit dibagi antar-proses** (tabel `rate_hits`, atomik)                      | `rate-limit.ts`                                                  | Tahan restart                                                                               |

## 2. Pelanggan

| Fitur                                     | Ringkas                                                                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pilih item untuk checkout**             | Kotak centang per item di keranjang; item tak dicentang tetap tersimpan (`cart_items.is_selected`)                                                                                     |
| **Alamat terstruktur**                    | Provinsi → kota/kab → kecamatan → desa (data resmi, 83 ribu desa, lokal) + kode pos + alamat detail; alamat default di profil, pilihan "pakai alamat profil / alamat baru" di checkout |
| **Lupa password lewat email**             | Tautan sekali pakai 1 jam, hanya hash token disimpan, semua sesi lama dicabut, tidak membocorkan daftar akun                                                                           |
| **Notifikasi pesanan** (email + WhatsApp) | Dikirim **setelah commit** (`afterCommit`), kegagalan kirim tidak menggagalkan pesanan                                                                                                 |
| **Ongkir per tujuan & berat**             | Biteship; harga selalu dihitung ulang di server; cadangan ongkir flat                                                                                                                  |
| **Voucher**                               | Persen/nominal, minimal belanja, batas potongan, kuota total & per pelanggan, periode; kuota atomik & kembali saat pesanan batal                                                       |
| **Banner promo di beranda**               | Voucher yang ditandai admin; tidak tampil bila jatah pelanggan itu habis                                                                                                               |
| **Foto di ulasan**                        | Maks. 3 foto, di-encode ulang (EXIF dibuang), thumbnail, tampil publik                                                                                                                 |
| **"Kabari saya saat stok tersedia"**      | Dikirim job pemeliharaan (sekali per permintaan)                                                                                                                                       |

## 3. Admin

Halaman **Voucher & promo** (status efektif, ringkasan, filter, pratinjau potongan, salin kode, tampil di beranda),
berat produk (untuk ongkir), kode pos asal & kurir di Pengaturan, moderasi ulasan berfoto, laporan dengan kolom
diskon (pendapatan = subtotal − diskon).

## 4. Struktur kode

- Query katalog publik dan daftar admin dipindah dari controller ke `lib/server/catalog.ts` dan `admin-lists.ts`.
- Halaman besar dipecah: `pesanan/[kode]` (786→573 baris), `checkout` (545→368), `produk/[slug]` (542→460), dengan
  komponen `OrderItemsSection`, `OrderReviewsSection`, `ShipmentPanel`, `ShippingPicker`, `VoucherBox`,
  `ProductReviews` yang masing-masing punya tes komponen.
- Peta MVC: `docs/STRUKTUR-MVC.md`.

## 5. Data demo

`npm run db:seed-demo` — produk baru berfoto, bundling, pelanggan beralamat terstruktur, ±70 pesanan dengan seluruh
siklusnya (stok & mutasi disimulasikan kronologis), voucher berbagai status, ulasan berfoto, favorit, keranjang,
pengingat stok. Aditif, bercadangan, dan diperiksa asersi konsistensi (stok, mutasi, voucher, total).

## 6. Pelajaran penting

- **E2E menemukan bug yang lolos semua tes lain**: `pattern="[0-9]{5}"` pada kode pos di template Svelte — `{5}`
  dibaca sebagai ekspresi sehingga pola menjadi `[0-9]5` dan peramban menolak setiap kode pos. Sudah diperbaiki dan
  dikunci tes regresi. Tes yang tidak menjalankan peramban sungguhan tidak akan menangkap kelas bug ini.
- Penggantian teks otomatis yang diam-diam gagal (format berubah oleh Prettier) hampir meloloskan fitur yang tidak
  terpasang: semua perubahan struktural diverifikasi tes, bukan hanya "tidak ada galat".

## 7. Yang memerlukan akun/kunci Anda untuk aktif di produksi

| Fitur                 | Yang dibutuhkan                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Email                 | `MAIL_PROVIDER` + `MAIL_API_KEY` + `MAIL_FROM` (Resend/Brevo, domain pengirim terverifikasi) |
| WhatsApp otomatis     | `WA_PROVIDER=fonnte` + `WA_API_TOKEN`                                                        |
| Ongkir kurir          | `BITESHIP_API_KEY` + kode pos asal di Admin > Pengaturan                                     |
| Pelaporan galat       | `SENTRY_DSN`                                                                                 |
| Backup di luar server | remote rclone + `OFFSITE_RCLONE_REMOTE`                                                      |
| Alarm cron/backup     | `HEARTBEAT_URL`, `BACKUP_HEARTBEAT_URL` (healthchecks.io)                                    |
