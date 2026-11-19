# Downshit Store

Website e-commerce streetwear lokal (Subang) untuk skripsi: katalog produk & bundling, keranjang,
checkout dengan transfer bank, verifikasi pembayaran, pengiriman + resi, ulasan, laporan penjualan,
dan manajemen stok. Tiga peran: **konsumen**, **admin**, **owner**.

## Teknologi

| Lapisan   | Pilihan                                                         |
| --------- | --------------------------------------------------------------- |
| Framework | SvelteKit 3 + Svelte 5 (runes), `adapter-node`                  |
| Bahasa    | TypeScript                                                      |
| Database  | SQLite (`better-sqlite3`, mode WAL) lewat Drizzle ORM           |
| UI        | Tailwind CSS 4, ikon `@lucide/svelte`                           |
| Auth      | Sesi cookie (token di-hash SHA-256), password Argon2            |
| Gambar    | `sharp` → WebP + thumbnail, EXIF dibuang                        |
| Validasi  | Zod                                                             |
| Tes       | Vitest (unit + integrasi dengan DB SQLite sementara per berkas) |

Dokumen perancangan (PRD, UML, wireframe, test case, traceability) ada di folder `../plan/`.

## Prasyarat

- Node.js 24 (lihat `engine-strict` di `.npmrc`)
- npm

## Menjalankan (pengembangan)

```sh
npm install
cp .env.example .env          # lalu sesuaikan nilainya
npm run db:push               # buat tabel di SQLite (downshit.db)
npm run db:seed               # akun owner & admin awal
npm run dev                   # http://localhost:5173
```

Opsional untuk data contoh: `npm run db:seed-produk`, `db:seed-ukuran`, `db:seed-riwayat`.
Akun hasil seed memakai `SEED_OWNER_EMAIL`, `SEED_ADMIN_EMAIL`, dan `SEED_DEFAULT_PASSWORD` di `.env`;
di produksi akun itu wajib ganti password saat login pertama. Lupa password staf: `npm run db:reset-password`.

## Perintah penting

| Perintah                  | Fungsi                                                 |
| ------------------------- | ------------------------------------------------------ |
| `npm run check`           | Type-check (`svelte-check`)                            |
| `npm run lint`            | Prettier + ESLint                                      |
| `npm run format`          | Rapikan format kode                                    |
| `npm test`                | Seluruh tes (unit + integrasi)                         |
| `npm run test:unit`       | Hanya logika murni                                     |
| `npm run test:int`        | Hanya tes yang memakai DB                              |
| `npm run build`           | Build produksi ke `build/`                             |
| `npm start`               | Jalankan build (`node --env-file=.env build`)          |
| `npm run db:studio`       | Drizzle Studio                                         |
| `npm run ops:backup`      | Backup database + uploads                              |
| `npm run ops:maintenance` | Kedaluwarsa pesanan, auto-selesai, bersihkan sesi lama |

Tes integrasi tidak pernah menyentuh `downshit.db`: `tests/global-setup.ts` membuat DB sementara
(`tests/.tmp-*`, otomatis dihapus setelah tes selesai).

## Variabel lingkungan

Lihat `.env.example` (pengembangan) dan `deploy/env.production.example` (produksi). Yang paling penting:

- `DATABASE_URL`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`
- `ORIGIN` — URL publik persis (menentukan cookie `Secure`, HSTS, dan CSRF)
- `CRON_SECRET` — minimal 32 karakter, melindungi `POST /internal/maintenance`
- `CATALOG_REQUIRES_LOGIN` — `true` agar katalog hanya untuk pengguna login

## Struktur

```
src/
  hooks.server.ts          gerbang login/role, header keamanan, penanganan error
  lib/server/              logika bisnis (orders, stock, purchase, reports, auth, upload, ...)
  lib/server/db/schema.ts  skema Drizzle (sumber kebenaran skema)
  lib/schemas/             skema validasi Zod
  lib/components/          komponen UI bersama
  routes/                  halaman konsumen, /admin, /owner, /internal
scripts/                   seed, reset password, migrasi
deploy/                    Nginx, systemd, PM2, Docker, skrip backup/deploy
tests/                     setup tes + generator data sintetis
docs/lampiran/             ekspor skema SQL untuk lampiran skripsi (`npm run db:schema-sql`)
```

## Catatan operasional

- **Satu instance Node.** Rate limit registrasi/upload disimpan di memori proses (hilang saat restart,
  tidak dibagi antar-proses). Login memakai tabel `login_attempts` sehingga tahan restart.
  SQLite cocok untuk satu server; untuk beberapa instance perlu database server.
- **Di belakang proxy** (Nginx/Cloudflare) set `ADDRESS_HEADER` dan `XFF_DEPTH` agar IP klien benar.
- **Upload > 512 KB** butuh `BODY_SIZE_LIMIT=3M` di produksi (bawaan adapter-node 512 KB).
- Panduan deploy lengkap: `../plan/12-deployment.md` dan `deploy/`.
