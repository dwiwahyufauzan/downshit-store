# Pembayaran online (Midtrans)

Pelanggan memilih metode saat checkout: **Transfer bank (manual)**, **E-wallet** (GoPay, OVO, DANA, ShopeePay),
**QRIS**, **Virtual Account** (BCA, BNI, BRI, Permata, CIMB, Mandiri) atau **Minimarket** (Indomaret, Alfamart).
Metode online diproses Midtrans Snap dan **terkonfirmasi otomatis**: pesanan langsung berstatus `diproses`.

## Coba tanpa akun Midtrans (mode simulasi)

Belum punya akun? Aktifkan payment gateway tiruan yang meniru alur Midtrans Snap:

1. Di `.env`: `PAYMENT_SIMULATOR="true"` (biarkan `MIDTRANS_SERVER_KEY` kosong), lalu `npm run db:migrate-sync`
   dan restart aplikasi.
2. Admin → **Pengaturan → Metode Pembayaran** → centang E-wallet / QRIS / Virtual Account / Minimarket.
3. Sebagai pelanggan, checkout dengan salah satu metode online. Kamu diarahkan ke halaman
   `/simulasi-bayar/<token>`: pilih saluran (GoPay, QRIS, VA BCA, Indomaret, dst.), lihat nomor VA / kode bayar /
   QR contoh, lalu tekan **Simulasikan pembayaran BERHASIL**, **Gagal**, atau **Kedaluwarsa**.
4. Hasilnya diproses lewat kode yang sama dengan notifikasi Midtrans asli (pesanan langsung `diproses`,
   atau pembayaran ditolak dan pelanggan bisa mencoba lagi). Tidak ada jaringan atau uang yang terlibat.

Batasan: simulator hanya aktif bila `PAYMENT_SIMULATOR="true"`, `MIDTRANS_SERVER_KEY` kosong, dan
`MIDTRANS_IS_PRODUCTION` bukan `"true"`. Halaman simulasi hanya bisa dibuka pelanggan pemilik pesanan.
Pasang Server Key Midtrans untuk pembayaran sungguhan.

## Pasang Midtrans asli

1. Daftar di <https://dashboard.sandbox.midtrans.com> (uji coba) atau <https://dashboard.midtrans.com> (produksi).
2. **Settings → Access Keys** → salin **Server Key**.
3. Isi `.env`:
   ```
   MIDTRANS_SERVER_KEY="SB-Mid-server-xxxx"   # produksi: Mid-server-xxxx
   MIDTRANS_IS_PRODUCTION="false"             # "true" hanya dengan key produksi
   ORIGIN="https://domain-anda.com"           # dipakai untuk URL kembali dari halaman bayar
   ```
4. Jalankan `npm run db:migrate-sync` (menambah kolom pembayaran online ke database lama), lalu restart aplikasi.
5. Di dashboard Midtrans → **Settings → Configuration → Payment Notification URL** isi:
   `https://domain-anda.com/api/midtrans/notification` (harus URL publik; saat uji lokal pakai tunnel).
6. Di **Settings → Snap Preferences / Payment** pastikan saluran yang diinginkan sudah aktif
   (sebagian saluran, mis. OVO/DANA/QRIS, perlu diaktifkan dulu di akun produksi).
7. Admin: **Pengaturan → Metode Pembayaran** → centang metode yang ditawarkan. Metode online baru tampil
   di checkout bila `MIDTRANS_SERVER_KEY` terisi.

## Cara kerja

- Checkout dengan metode online → pesanan dibuat → pelanggan dialihkan ke halaman bayar Midtrans.
- Midtrans mengirim notifikasi ke `/api/midtrans/notification`. Tanda tangan SHA512 diverifikasi, lalu status
  **diambil ulang dari Status API** dan nominalnya dicocokkan dengan tagihan sebelum diterapkan.
- Cadangan bila notifikasi tidak sampai: status dicek saat pelanggan membuka halaman pesanan
  (tombol "Periksa status pembayaran"), oleh admin (tombol di detail pesanan), dan oleh job pemeliharaan.
- Batas waktu transaksi di Midtrans = batas bayar pesanan. Pesanan yang kedaluwarsa/dibatalkan ikut
  membatalkan transaksi di Midtrans. Ganti metode atau unggah bukti transfer juga membatalkan percobaan online lama.
- Dana masuk setelah pesanan dibatalkan, atau bayar ganda → baris pembayaran bertanda `dikembalikan`,
  tercatat di log aktivitas (`payment.refund_needed`). **Refund dilakukan manual lewat dashboard Midtrans.**

## Uji di Sandbox

Gunakan simulator pembayaran Midtrans: <https://simulator.sandbox.midtrans.com>
(GoPay/QRIS/VA/minimarket). Setelah "bayar" di simulator, pesanan harus berubah menjadi `diproses`.
