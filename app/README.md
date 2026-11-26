# Downshit Store

Website e-commerce streetwear lokal (Subang) untuk skripsi. Tiga peran: **konsumen**, **admin**, **owner**.

## Fitur

**Pelanggan**

- Katalog produk & paket bundling (filter, urutan, stok per ukuran, rating, rekomendasi), favorit, dan pengingat
  "kabari saya saat stok tersedia kembali".
- Keranjang dengan **pilihan item yang di-checkout** (item tak dicentang tetap tersimpan).
- Checkout: **alamat terstruktur** (provinsi → kota/kab → kecamatan → desa dari data resmi + kode pos), alamat default
  di profil, **ongkir per tujuan & berat** (Biteship, cadangan ongkir flat), **voucher**, dan pembayaran transfer bank
  atau online (Midtrans / simulator).
- Pesanan: status bertahap, unggah bukti transfer, nomor resi + tautan pelacakan, ulasan produk **dengan foto**.
- Akun: daftar/login, **lupa password lewat email**, kelola sesi, notifikasi status pesanan (email + WhatsApp).
- **Banner promo** di beranda untuk voucher yang ditampilkan admin.

**Admin**: produk & kategori (ukuran, berat, galeri foto), bundling, pembelian/restock, stok, pesanan (verifikasi
pembayaran, resi, pembatalan), pelanggan, ulasan (moderasi), **voucher & promo**, pengaturan toko.

**Owner**: laporan penjualan (diskon voucher terhitung, ekspor CSV), aktivitas, ringkasan stok.

## Teknologi

| Lapisan    | Pilihan                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| Framework  | SvelteKit 3 + Svelte 5 (runes), `adapter-node`                                       |
| Bahasa     | TypeScript                                                                           |
| Database   | SQLite (`better-sqlite3`, mode WAL) lewat Drizzle ORM, **migrasi berversi**          |
| UI         | Tailwind CSS 4, ikon `@lucide/svelte`                                                |
| Auth       | Sesi cookie (token di-hash SHA-256), password Argon2, portal pelanggan/staf          |
| Gambar     | `sharp` → WebP + thumbnail, EXIF dibuang                                             |
| Validasi   | Zod                                                                                  |
| Integrasi  | Midtrans, Biteship, Resend/Brevo (email), Fonnte (WhatsApp), Sentry — semua opsional |
| Tes        | Vitest (unit, komponen happy-dom, integrasi DB sementara) + Playwright (E2E)         |
| CI/Operasi | GitHub Actions, Docker/systemd/PM2/Nginx, backup + rclone, `/api/health`             |

Dokumen perancangan (PRD, UML, wireframe, test case, traceability) ada di folder `../plan/`.

## Prasyarat

- Node.js 24 (lihat `engine-strict` di `.npmrc`)
- npm

## Menjalankan (pengembangan)

```sh
npm install
cp .env.example .env          # lalu sesuaikan nilainya
npm run db:migrate            # buat/perbarui tabel lewat migrasi berversi (folder drizzle/); aman diulang,
                              # database lama (sebelum migrasi berversi) disusul otomatis
npm run db:seed               # akun owner & admin awal + kategori, produk, dan bundling contoh
npm run dev                   # http://localhost:5173
```

Akun hasil seed memakai `SEED_OWNER_EMAIL`, `SEED_ADMIN_EMAIL`, dan `SEED_DEFAULT_PASSWORD` di `.env`; di produksi akun
itu wajib ganti password saat login pertama. Lupa password staf: `npm run db:reset-password`. Pelanggan memakai
**Lupa password** di halaman login (butuh `MAIL_PROVIDER`; tanpa itu halamannya mengarahkan ke WhatsApp admin).

### Data contoh (opsional, hanya untuk pengembangan/demo)

| Perintah                  | Isi                                                                 |
| ------------------------- | ------------------------------------------------------------------- |
| `npm run db:seed-produk`  | Produk contoh bernama artikel                                       |
| `npm run db:seed-ukuran`  | Ukuran S–XL / 28–34 untuk produk pakaian                            |
| `npm run db:seed-riwayat` | Riwayat 5 bulan: pelanggan, bundling, ±280 pesanan, restock, ulasan |
| `npm run db:seed-demo`    | **Data demo terbaru & lengkap** (lihat di bawah)                    |

`db:seed-demo` menambah: 16 produk baru (ukuran, berat, galeri — memakai gambar yang sudah ada di toko), 2 bundling,
14 pelanggan, alamat terstruktur untuk semua pelanggan contoh, ±70 pesanan dengan seluruh siklusnya (stok & mutasi
disimulasikan kronologis), voucher berbagai status (beberapa tampil di banner beranda), ulasan berfoto, favorit,
keranjang, dan pengingat stok. Skrip ini **hanya menambah data**, membuat cadangan di `backups/` lebih dulu, memeriksa
konsistensi (stok, mutasi, voucher, total pesanan; gagal = tidak ada yang berubah), dan aman diulang (ditandai di
tabel `settings`).

## Perintah penting

| Perintah                  | Fungsi                                                   |
| ------------------------- | -------------------------------------------------------- |
| `npm run dev`             | Server pengembangan                                      |
| `npm run build`           | Build produksi ke `build/` (`BUILD_OUT` mengubah folder) |
| `npm start`               | Jalankan build (`node --env-file=.env build`)            |
| `npm run check`           | Type-check (`svelte-check`)                              |
| `npm run lint`            | Prettier + ESLint                                        |
| `npm run format`          | Rapikan format kode                                      |
| `npm test`                | Seluruh tes (unit + komponen + integrasi)                |
| `npm run test:unit`       | Logika murni (+ tes skrip deploy)                        |
| `npm run test:component`  | Komponen Svelte di DOM tiruan (happy-dom)                |
| `npm run test:int`        | Tes yang memakai DB                                      |
| `cd e2e && npm test`      | Tes end-to-end Playwright (lihat bagian E2E)             |
| `npm run db:generate`     | Buat migrasi baru setelah mengubah `schema.ts`           |
| `npm run db:migrate`      | Terapkan migrasi ke database (`DATABASE_URL`)            |
| `npm run db:studio`       | Drizzle Studio                                           |
| `npm run db:schema-sql`   | Ekspor skema SQL untuk lampiran (`docs/lampiran/`)       |
| `npm run ops:backup`      | Backup database + uploads (+ salinan di luar server)     |
| `npm run ops:maintenance` | Kedaluwarsa pesanan, auto-selesai, bersihkan sesi lama   |

Tes integrasi tidak pernah menyentuh `downshit.db`: `tests/global-setup.ts` membuat DB sementara
(`tests/.tmp-*`, otomatis dihapus setelah tes selesai).

## Variabel lingkungan

Lihat `.env.example` (pengembangan) dan `deploy/env.production.example` (produksi). Yang paling penting:

- `DATABASE_URL`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`
- `ORIGIN` — URL publik persis (menentukan cookie `Secure`, HSTS, dan CSRF)
- `CRON_SECRET` — minimal 32 karakter, melindungi `POST /internal/maintenance`
- `CATALOG_REQUIRES_LOGIN` — `true` agar katalog hanya untuk pengguna login

Integrasi opsional (semuanya mati bila kosong, aplikasi tetap berjalan penuh):

| Variabel                                       | Fungsi                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `MAIL_PROVIDER` / `MAIL_API_KEY` / `MAIL_FROM` | Email: lupa password pelanggan + notifikasi pesanan (`resend`, `brevo`, `log`) |
| `WA_PROVIDER` / `WA_API_TOKEN`                 | WhatsApp otomatis (`fonnte`, `log`)                                            |
| `BITESHIP_API_KEY`                             | Ongkir per tujuan & berat (kode pos asal di Admin > Pengaturan)                |
| `MIDTRANS_SERVER_KEY`, `PAYMENT_SIMULATOR`     | Pembayaran online / simulator (lihat `docs/pembayaran-online.md`)              |
| `SENTRY_DSN`, `LOG_LEVEL`, `LOG_FORMAT`        | Pelaporan galat (Sentry/GlitchTip) & log terstruktur                           |
| `OFFSITE_RCLONE_REMOTE`, `HEARTBEAT_URL`       | Backup di luar server & pemantauan cron (lihat Catatan operasional)            |

## Struktur

```
src/
  hooks.server.ts            gerbang login/role, header keamanan, penanganan error, ID permintaan
  hooks.client.ts            galat peramban → /api/client-error
  lib/server/                logika bisnis (orders, cart, stock, vouchers, shipping, notifications, reports, ...)
  lib/server/db/schema.ts    skema Drizzle (sumber kebenaran skema)
  lib/server/db/migrator.ts  runner migrasi berversi (deploy.sh, Docker, `db:migrate`, tes)
  lib/server/data/           data wilayah Indonesia (lisensi: WILAYAH.md)
  lib/schemas/               skema validasi Zod
  lib/components/            komponen UI bersama (+ tes komponen `*.svelte.test.ts`)
  lib/utils/                 fungsi murni (format, alamat, promo, ukuran, ...)
  routes/                    halaman konsumen, /admin, /owner, /api, /internal
drizzle/                     migrasi berversi (hasil `db:generate`; WAJIB di-commit bersama perubahan schema.ts)
scripts/                     seed (termasuk seed-demo), reset password, migrasi, pembuat data wilayah
deploy/                      Nginx, systemd, PM2, Docker, skrip backup/offsite/deploy (+ tesnya)
e2e/                         tes end-to-end Playwright (paket npm sendiri)
tests/                       setup tes + generator data sintetis
docs/                        peta MVC, catatan pengembangan, pembayaran online, lampiran skema SQL
```

## Dokumentasi

| Berkas                          | Isi                                                                 |
| ------------------------------- | ------------------------------------------------------------------- |
| `docs/STRUKTUR-MVC.md`          | Peta folder dalam kerangka Model–View–Controller + alur satu fitur  |
| `docs/PENGEMBANGAN-NOV-2026.md` | Ringkasan pengembangan terbaru, pelajaran, dan kebutuhan akun/kunci |
| `docs/pembayaran-online.md`     | Midtrans & simulator pembayaran                                     |
| `docs/lampiran/`                | Skema SQL untuk lampiran skripsi                                    |
| `../plan/`                      | PRD, perancangan, test case, deployment (`12-deployment.md`)        |

## Catatan operasional

- **Rate limit** disimpan di tabel `rate_hits` (jendela geser, atomik) sehingga tahan restart dan dibagi antar
  proses yang memakai database yang sama; login memakai tabel `login_attempts`. SQLite tetap cocok untuk SATU
  server (beberapa instance di mesin berbeda perlu database server).
- **Migrasi database**: ubah `schema.ts` → `npm run db:generate` → commit folder `drizzle/`. `deploy.sh` dan image
  Docker menjalankan `db:migrate` otomatis (setelah backup). CI gagal bila skema berubah tanpa migrasi.
- **Pemantauan**: `GET /api/health` (200 ok/degraded, 503 down; `degraded` = cron pemeliharaan macet > 2 jam) untuk
  UptimeRobot/Better Stack; `HEARTBEAT_URL`/`BACKUP_HEARTBEAT_URL` (healthchecks.io) memberi alarm bila cron berhenti;
  galat server & peramban masuk ke Sentry bila `SENTRY_DSN` diisi; log JSON di produksi (`LOG_FORMAT=json`).
- **Backup di luar server**: isi `OFFSITE_RCLONE_REMOTE` (remote rclone, sebaiknya `crypt`); `backup.sh` mengunggah,
  memverifikasi ukuran berkas di tujuan, dan menerapkan retensi. Tanpa ini backup hanya ada di disk server.
- **Notifikasi**: email/WhatsApp dikirim SETELAH transaksi database commit (tidak pernah untuk transaksi yang
  di-rollback) dan kegagalan kirim tidak menggagalkan pesanan.
- **Di belakang proxy** (Nginx/Cloudflare) set `ADDRESS_HEADER` dan `XFF_DEPTH` agar IP klien benar.
- **Upload > 512 KB** butuh `BODY_SIZE_LIMIT=3M` di produksi (bawaan adapter-node 512 KB).
- Panduan deploy lengkap: `../plan/12-deployment.md` dan `deploy/`.

## Tes end-to-end (Playwright)

Folder `e2e/` berisi paket npm sendiri (agar `node_modules` aplikasi tidak tersentuh). Tes membangun aplikasi
produksi, membuat database SQLite sementara (`.e2e/`), menjalankan server dengan simulator pembayaran, lalu menguji
alur sungguhan di peramban: daftar → keranjang (centang sebagian) → alamat bertingkat → voucher → bayar → admin kirim
→ selesai → ulasan berfoto; transfer bank (bukti ditolak lalu dikonfirmasi); lupa password lewat email; banner promo.

```sh
cd e2e
npm install
npm run install:browser      # sekali: unduh Chromium (atau pakai Chrome terpasang: PW_CHANNEL=chrome npm test)
npm test                     # E2E_SKIP_BUILD=1 npm test  → pakai ulang build sebelumnya saat iterasi
```

CI (`.github/workflows/ci.yml`) menjalankan cek tipe, lint, seluruh tes, pemeriksaan migrasi, dan E2E pada tiap push/PR.
