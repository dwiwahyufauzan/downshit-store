# Data wilayah (wilayah.json)

Daftar provinsi, kota/kabupaten, kecamatan, dan desa/kelurahan untuk dropdown alamat bertingkat.

- Sumber: paket npm [`idn-area-data`](https://www.npmjs.com/package/idn-area-data) 4.0.1, berdasarkan data
  Kementerian Dalam Negeri / BPS ([fityannugroho/idn-area-data](https://github.com/fityannugroho/idn-area-data)).
- Lisensi data: Open Database License (ODbL) 1.0 — atribusi wajib; salinan bentuk lain dari basis data ini
  harus dibagikan dengan lisensi yang sama. Penggunaan hasilnya di aplikasi (produced work) cukup dengan atribusi ini.
- Dibuat ulang dengan `scripts/build-wilayah.ts` (petunjuk di bagian atas skrip), lalu di-commit.
- Format: `{ p: [[kode, nama]], r: { kodeProvinsi: [...] }, d: { kodeKota: [...] }, v: { kodeKecamatan: [...] } }`.
