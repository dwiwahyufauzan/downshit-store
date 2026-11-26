# Peta Struktur Folder & MVC

Dokumen ini membantu membaca kode Downshit Store lewat sudut pandang **MVC** (Model – View – Controller).

## 1. Gambaran besar

Proyek ini memakai **SvelteKit**, framework _full-stack_: kode server dan tampilan hidup di satu proyek.
Karena itu tidak ada folder `backend/` dan `frontend/` terpisah. Pemisahan MVC dilakukan **lewat nama berkas**,
bukan lewat folder induk.

| Peran MVC      | Di proyek ini                                                       | Dikenali dari                                      |
| -------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| **View**       | Halaman & komponen Svelte (HTML + tampilan)                         | `+page.svelte`, `+layout.svelte`, `components/`    |
| **Controller** | Penerima request: baca input, validasi, panggil Model, siapkan data | `+page.server.ts`, `+server.ts`, `hooks.server.ts` |
| **Model**      | Struktur tabel + aturan bisnis + akses database                     | `lib/server/db/schema.ts`, `lib/server/*.ts`       |

Tambahan di luar tiga peran itu:

| Lapisan               | Fungsi                                                             | Lokasi                                |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| **Router**            | URL ditentukan oleh struktur folder (bukan file rute terpisah)     | `src/routes/…`                        |
| **Validasi (Zod)**    | Memeriksa isian form sebelum masuk ke Model                        | `src/lib/schemas/`                    |
| **Pembantu murni**    | Fungsi kecil tanpa database (format rupiah, ukuran, pesan WA, dll) | `src/lib/utils/`, `constants.ts`      |
| **Perilaku UI klien** | Aksi Svelte & state sisi browser (toast, animasi, anti klik ganda) | `src/lib/actions/`, `src/lib/stores/` |

> Aturan keras SvelteKit: apa pun di `src/lib/server/` **tidak bisa** diimpor oleh kode browser.
> Jadi garis antara "backend" dan "frontend" dijaga oleh framework, bukan oleh nama folder induk.

## 2. Peta folder

```
app/
├─ src/
│  ├─ hooks.server.ts      CONTROLLER global: dijalankan di SETIAP request (cek sesi, login wajib, role)
│  ├─ hooks.client.ts      penanganan galat di browser
│  ├─ app.html, error.html kerangka HTML dasar
│  ├─ env.ts               pembacaan & validasi variabel .env
│  │
│  ├─ routes/              ★ VIEW + CONTROLLER (satu folder = satu URL)
│  │  ├─ +layout.svelte    View kerangka semua halaman (Navbar, Footer, Toast)
│  │  ├─ +layout.server.ts Controller kerangka (jumlah keranjang, data toko)
│  │  ├─ layout.css        gaya global (Tailwind + kelas .btn, .panel, .chip, …)
│  │  ├─ produk/ bundling/ keranjang/ checkout/ pesanan/ favorit/ profil/   halaman pelanggan
│  │  ├─ login/ register/ logout/ staff/                                    masuk & keluar
│  │  ├─ admin/…           halaman Admin (produk, pesanan, stok, pembelian, ulasan, …)
│  │  ├─ owner/…           halaman Owner (laporan, aktivitas, stok)
│  │  └─ api/ internal/ uploads/ robots.txt/ sitemap.xml/                   endpoint tanpa tampilan
│  │
│  └─ lib/                 kode bersama (diimpor lewat alias `#lib/…`)
│     ├─ server/           ★ MODEL: aturan bisnis + database (khusus server)
│     │  ├─ db/            schema.ts (struktur tabel), index.ts (koneksi + transaksi)
│     │  ├─ data/          data statis wilayah Indonesia
│     │  └─ *.ts           satu berkas per domain (cart.ts, orders.ts, stock.ts, …)
│     ├─ schemas/          validasi Zod untuk form
│     ├─ components/       ★ VIEW: potongan tampilan yang dipakai ulang
│     ├─ actions/ stores/  perilaku UI di browser
│     ├─ utils/            fungsi murni (tanpa DB)
│     └─ constants.ts      konstanta & label bersama
│
├─ drizzle/                migrasi database berversi (hasil `npm run db:generate`)
├─ scripts/                seed (+ seed-demo), migrasi (`migrate.ts`), reset password, pembuat data wilayah
├─ e2e/                    tes end-to-end Playwright (paket npm sendiri)
├─ tests/                  setup & data sintetis untuk tes
├─ docs/                   dokumen ini, skema SQL, panduan pembayaran online
├─ static/ uploads/        aset statis & unggahan gambar
└─ deploy/                 konfigurasi nginx, systemd, skrip deploy
```

## 3. Cara satu halaman bekerja

Setiap folder di `src/routes/` biasanya berisi sepasang berkas:

```
routes/keranjang/
├─ +page.server.ts   CONTROLLER   load() menyiapkan data · actions = menangani form POST
└─ +page.svelte      VIEW         menampilkan data dari load() dan mengirim form
```

Alurnya:

```
Browser
  │  GET /keranjang
  ▼
hooks.server.ts ........... cek cookie sesi → siapa pengguna? wajib login? role cukup?
  ▼
+layout.server.ts ......... data umum (jumlah keranjang, info toko)
  ▼
+page.server.ts → load() .. ambil data lewat Model (lib/server/cart.ts)
  ▼
+page.svelte .............. View dirender dengan data tadi → HTML ke browser

Browser
  │  POST /keranjang?/pilih   (klik kotak centang)
  ▼
hooks.server.ts → +page.server.ts → actions.pilih
  │   1. cek role           (guards.ts)
  │   2. validasi input     (Zod)
  │   3. panggil Model      (cart.ts → setCartItemSelected)
  ▼
halaman dimuat ulang dengan data terbaru
```

Penamaan penting di SvelteKit:

| Berkas               | Arti                                                          |
| -------------------- | ------------------------------------------------------------- |
| `+page.svelte`       | Tampilan satu URL                                             |
| `+page.server.ts`    | `load` (ambil data) dan `actions` (terima form) untuk URL itu |
| `+layout.svelte/.ts` | Kerangka yang membungkus semua halaman di bawahnya            |
| `+server.ts`         | Endpoint murni (JSON/file), tanpa tampilan                    |
| `[slug]`, `[kode]`   | Bagian URL dinamis, mis. `/produk/kaos-hitam`                 |

## 4. Contoh alur lengkap: dari keranjang sampai pesanan dibuat

| Langkah                       | Berkas                                                       | Peran             |
| ----------------------------- | ------------------------------------------------------------ | ----------------- |
| Pelanggan melihat keranjang   | `routes/keranjang/+page.svelte`                              | View              |
| Data keranjang disiapkan      | `routes/keranjang/+page.server.ts` (`load`)                  | Controller        |
| Ambil baris + hitung stok     | `lib/server/cart.ts` (`getCartDetails`)                      | Model             |
| Centang / ubah jumlah / hapus | `+page.server.ts` (`actions`) → `cart.ts`                    | Controller→Model  |
| Klik "Lanjut ke checkout"     | `routes/checkout/+page.svelte`                               | View              |
| Isian alamat divalidasi       | `lib/schemas/checkout.ts`, `schemas/address.ts`              | Validasi          |
| Alamat default dibaca         | `routes/checkout/+page.server.ts`, `utils/address.ts`        | Controller        |
| Pesanan dibuat atomik         | `lib/server/orders.ts` (`createOrderFromCart`)               | Model             |
| Stok dikurangi + dicatat      | `lib/server/stock.ts`                                        | Model             |
| Data tersimpan                | `lib/server/db/schema.ts` (tabel `orders`, `order_items`, …) | Model             |
| Bayar online (opsional)       | `lib/server/gateway-payments.ts` → `midtrans.ts`             | Model             |
| Lanjut ke halaman pesanan     | `routes/pesanan/[kode]/…`                                    | View + Controller |

## 5. Peta fitur → berkas

| Fitur                     | View & Controller (`src/routes/…`)                   | Model / aturan bisnis (`src/lib/server/…`)                                                      |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Katalog produk            | `produk/`, `produk/[slug]/`                          | `catalog.ts` (daftar & detail), `recommendations.ts`, `sizes.ts`                                |
| Paket bundling            | `bundling/`, `admin/bundling/`                       | `bundle-validate.ts`, `stock.ts`                                                                |
| Keranjang                 | `keranjang/`                                         | `cart.ts`                                                                                       |
| Checkout & pesanan        | `checkout/`, `pesanan/`                              | `orders.ts`, `order-flow.ts`, `order-status.ts`, `order-items.ts`                               |
| Pembayaran online         | `simulasi-bayar/`, `api/midtrans/notification/`      | `gateway-payments.ts`, `midtrans.ts`, `payment-simulator.ts`                                    |
| Favorit                   | `favorit/`                                           | `wishlist.ts`                                                                                   |
| Ulasan                    | `admin/ulasan/` (+ form di `pesanan/`)               | `reviews.ts`                                                                                    |
| Profil & alamat default   | `profil/`, `admin/profil/`, `owner/profil/`          | `auth.ts`, `login.ts`, `lib/utils/address.ts`                                                   |
| Dropdown wilayah          | `api/wilayah/`                                       | `wilayah.ts`, `data/wilayah.json`                                                               |
| Login / sesi / role       | `login/`, `staff/login/`, `register/`, `logout/`     | `auth.ts`, `login.ts`, `guards.ts`, `rate-limit.ts`                                             |
| Produk & kategori (Admin) | `admin/produk/`, `admin/kategori/`                   | `admin-lists.ts` (daftar), `product-sizes.ts`, `product-usage.ts`, `image-refs.ts`, `upload.ts` |
| Stok & pembelian          | `admin/stok/`, `admin/pembelian/`, `owner/stok/`     | `stock.ts`, `stock-overview.ts`, `purchase.ts`                                                  |
| Pelanggan (Admin)         | `admin/pelanggan/`                                   | `customer-admin.ts`                                                                             |
| Pengaturan toko           | `admin/pengaturan/`                                  | `settings.ts`                                                                                   |
| Laporan & aktivitas       | `owner/laporan/`, `owner/aktivitas/`                 | `reports.ts`, `activity.ts`                                                                     |
| Pesan WhatsApp            | (dipakai di halaman pesanan)                         | `wa-order.ts`, `lib/utils/wa-messages.ts`, `whatsapp.ts`                                        |
| Ongkir otomatis           | `checkout/`, `api/ongkir/`, `admin/pengaturan/`      | `shipping.ts` (Biteship, cadangan flat), `cart.ts` (berat)                                      |
| Voucher & banner promo    | `admin/voucher/`, `api/voucher/`, `+page` beranda    | `vouchers.ts`, `lib/utils/promo.ts`, `components/home/PromoBanner`                              |
| Email & WhatsApp otomatis | (dipicu setelah transaksi commit)                    | `notifications.ts`, `mail.ts`, `wa-gateway.ts`, `db/index.ts` (`afterCommit`)                   |
| Lupa password pelanggan   | `lupa-password/`, `reset-password/[token]/`          | `password-reset.ts`, `mail.ts`                                                                  |
| Stok kembali tersedia     | tombol di `produk/[slug]/`                           | `stock-alerts.ts` (dikirim job pemeliharaan)                                                    |
| Foto ulasan               | `pesanan/[kode]/`, `produk/[slug]/`, `admin/ulasan/` | `reviews.ts`, `upload.ts` (folder `reviews`)                                                    |
| Pemantauan                | `api/health/`, `api/client-error/`, `hooks.*.ts`     | `logger.ts`, `error-report.ts`, `rate-limit.ts`                                                 |

## 6. Model (database & aturan bisnis)

**Struktur tabel** ada di satu berkas: `src/lib/server/db/schema.ts` (Drizzle ORM), dikelompokkan:
pengguna & sesi → katalog (kategori, produk, ukuran, bundling) → keranjang → favorit →
pesanan, item & pembayaran → pengiriman → ulasan → pembelian/stok → pengaturan & log aktivitas.
Salinan SQL-nya untuk lampiran skripsi: `docs/lampiran/schema.sqlite.sql`.

**Akses & aturan bisnis** ada di `src/lib/server/*.ts`. Satu berkas biasanya mewakili satu domain
(`cart.ts` = keranjang, `orders.ts` = membuat/membatalkan pesanan, `stock.ts` = mutasi stok).
Operasi yang harus berhasil bersama dibungkus `transact()` (`db/index.ts`) agar atomik: semua tersimpan atau tidak sama sekali.

Berkas pembantu (bukan domain): `codes.ts` (kode pesanan), `slug.ts`, `sql.ts` (pencarian aman),
`time.ts` (zona WIB), `redirect.ts` (validasi `?next=`), `order-error.ts` (galat bisnis pesanan).

## 7. Catatan jujur tentang batas MVC di proyek ini

MVC di sini **tidak murni**, dan itu wajar untuk SvelteKit:

- **Sebagian controller masih langsung bicara ke database.** Sekitar 37 dari 60 berkas `+page.server.ts` / `+server.ts`
  mengimpor `#lib/server/db` dan menulis query sendiri. Yang paling sering berubah sudah dipindah ke Model:
  katalog publik (`lib/server/catalog.ts`) dan daftar admin produk/pesanan (`lib/server/admin-lists.ts`), sehingga
  controllernya tinggal membaca parameter URL, memanggil fungsi Model, lalu memutuskan respons (404/redirect).
  Alur yang rumit (keranjang, checkout, pembatalan, stok, voucher, notifikasi) memang sejak awal ada di `lib/server/`.
  Halaman admin lain (kategori, stok, pelanggan, ulasan) masih berisi query di controller; pola pemindahannya sama.
- **Gabungan View + Controller per folder.** Di MVC klasik controller berdiri sendiri;
  di SvelteKit controller dan view-nya berdampingan di folder yang sama, itu memang desain framework.
- **Validasi** (`lib/schemas/`) bukan bagian MVC klasik, tetapi di sini ia lapisan tersendiri di antara Controller dan Model.

Praktis: kalau ingin tahu **"aturan bisnisnya apa"**, buka `lib/server/<domain>.ts`.
Kalau ingin tahu **"kenapa halaman ini menampilkan itu"**, buka `+page.server.ts` di folder URL-nya.
Kalau ingin mengubah **tampilan**, buka `+page.svelte` atau komponen di `lib/components/`.

## 8. Tips menemukan berkas

| Pertanyaan                               | Mulai dari                                            |
| ---------------------------------------- | ----------------------------------------------------- |
| "Halaman `/xyz` kodenya di mana?"        | `src/routes/xyz/+page.svelte` dan `+page.server.ts`   |
| "Tombol/kartu ini komponen apa?"         | cari nama di `src/lib/components/`                    |
| "Tabel/kolom ini didefinisikan di mana?" | `src/lib/server/db/schema.ts`                         |
| "Siapa boleh membuka halaman ini?"       | `src/hooks.server.ts` (area login/role) + `guards.ts` |
| "Pesan error validasi form dari mana?"   | `src/lib/schemas/<nama>.ts`                           |
| "Bagaimana kode ini diuji?"              | berkas `*.test.ts` / `*.int.test.ts` di sebelahnya    |

## 9. Tes

- `*.test.ts` — tes unit (logika murni), `npm run test:unit`.
- `*.int.test.ts` — tes integrasi dengan database SQLite sementara, `npm run test:int`.
  Setiap berkas memakai salinan DB sendiri; `downshit.db` yang asli tidak tersentuh.
