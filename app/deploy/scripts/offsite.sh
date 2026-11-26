#!/usr/bin/env bash
# Salin arsip backup ke penyimpanan DI LUAR server memakai rclone (S3, Backblaze B2, Google Drive, SFTP, ...),
# lalu pastikan berkasnya benar-benar ada di sana dengan ukuran yang sama. Dipanggil otomatis oleh backup.sh
# bila OFFSITE_RCLONE_REMOTE terisi; bisa juga dijalankan sendiri:
#   bash deploy/scripts/offsite.sh <db-*.sqlite.gz> [uploads-*.tar.gz]
#
# Variabel (di .env server atau lingkungan):
#   OFFSITE_RCLONE_REMOTE   tujuan rclone, mis. "b2:nama-bucket/downshit" (wajib)
#   OFFSITE_KEEP_DAYS       retensi di tujuan, hari (default 60; 0 = jangan hapus)
#   RCLONE                  jalur perintah rclone (default: rclone)
# Penyimpanan dingin yang ringkas & terenkripsi: buat remote bertipe "crypt" di rclone di atas bucket Anda,
# lalu isi OFFSITE_RCLONE_REMOTE dengan remote crypt itu (data & nama berkas terenkripsi sebelum keluar server).
set -euo pipefail
umask 077
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

REMOTE="${OFFSITE_RCLONE_REMOTE:-$(env_get OFFSITE_RCLONE_REMOTE)}"
KEEP="${OFFSITE_KEEP_DAYS:-$(env_get OFFSITE_KEEP_DAYS)}"; KEEP="${KEEP:-60}"
RCLONE="${RCLONE:-rclone}"
[ -n "$REMOTE" ] || die "OFFSITE_RCLONE_REMOTE kosong"
[ "$#" -ge 1 ] || die "pemakaian: offsite.sh <arsip> [arsip ...]"
need "$RCLONE" rclone

for f in "$@"; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || die "arsip tidak ditemukan: $f"
  name="$(basename "$f")"
  want="$(fsize "$f")"

  "$RCLONE" copyto "$f" "${REMOTE%/}/$name" || die "gagal mengunggah $name ke $REMOTE"

  # verifikasi: berkas ada di tujuan dan ukurannya sama (rclone lsf --format ps → "path;size")
  got="$("$RCLONE" lsf --format ps "${REMOTE%/}/$name" 2>/dev/null | head -1 | cut -d';' -f2 || true)"
  [ "$got" = "$want" ] || die "verifikasi GAGAL untuk $name (lokal $want byte, di tujuan '${got:-tidak ada}')"
  log "offsite OK  $name ($want byte) -> $REMOTE"
done

# retensi di tujuan (hanya berkas arsip kita; cadangan lain di bucket yang sama tidak disentuh)
if [ "$KEEP" -gt 0 ] 2>/dev/null; then
  "$RCLONE" delete "$REMOTE" --min-age "${KEEP}d" --include 'db-*.sqlite.gz' --include 'uploads-*.tar.gz' \
    || log "peringatan: pembersihan retensi offsite gagal (arsip baru tetap aman)"
fi
