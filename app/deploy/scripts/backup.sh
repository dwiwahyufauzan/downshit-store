#!/usr/bin/env bash
# Backup SQLite (konsisten walau aplikasi sedang menulis) + folder uploads. Retensi default 14 hari.
#   bash deploy/scripts/backup.sh
# Variabel (opsional): DOWNSHIT_BASE, ENV_FILE, DB_FILE, UPLOAD_DIR, BACKUP_DIR, KEEP_DAYS, SQLITE3,
#   OFFSITE_RCLONE_REMOTE (salin juga ke luar server via rclone, lihat offsite.sh),
#   BACKUP_HEARTBEAT_URL (ping healthchecks.io HANYA bila backup + offsite sukses)
#
# Mengapa bukan `cp downshit.db`? Mode WAL menyimpan data terbaru di berkas -wal; menyalin berkas utama saja
# bisa menghasilkan salinan rusak/usang. `sqlite3 .backup` memakai API backup SQLite (snapshot konsisten).
set -euo pipefail
umask 077
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

DB_FILE="${DB_FILE:-$(env_get DATABASE_URL)}"
DB_FILE="${DB_FILE:-$BASE/shared/data/downshit.db}"
UPLOAD_DIR="${UPLOAD_DIR:-$(env_get UPLOAD_DIR)}"
UPLOAD_DIR="${UPLOAD_DIR:-$BASE/shared/uploads}"
BACKUP_DIR="${BACKUP_DIR:-$BASE/shared/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
SQLITE3="${SQLITE3:-sqlite3}"

need "$SQLITE3" sqlite3
need gzip gzip
need tar tar
[ -f "$DB_FILE" ] || die "database tidak ditemukan: $DB_FILE"
mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y%m%d-%H%M%S)
DB_OUT="$BACKUP_DIR/db-$STAMP.sqlite.gz"
UP_OUT="$BACKUP_DIR/uploads-$STAMP.tar.gz"
TMP="$BACKUP_DIR/.db-$STAMP.sqlite.tmp"

cleanup() {
  rc=$?
  rm -f "$TMP" "$TMP-wal" "$TMP-shm"
  if [ $rc -ne 0 ]; then rm -f "$DB_OUT" "$UP_OUT"; echo "[$(date '+%F %T')] BACKUP GAGAL (kode $rc)" >&2; fi
  exit $rc
}
trap cleanup EXIT

# 1) database: snapshot konsisten via API backup (menunggu kunci tulis maks. 10 dtk)
"$SQLITE3" "$DB_FILE" ".timeout 10000" ".backup '$TMP'"
[ "$("$SQLITE3" "$TMP" 'PRAGMA integrity_check;')" = "ok" ] || die "integrity_check salinan GAGAL"
[ "$("$SQLITE3" "$TMP" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='orders';")" = "1" ] || die "salinan tidak berisi tabel orders"
gzip -9 < "$TMP" > "$DB_OUT"
gzip -t "$DB_OUT"
[ "$(fsize "$DB_OUT")" -gt 512 ] || die "arsip database terlalu kecil"

# 2) gambar produk & bukti bayar
if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$UP_OUT" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  tar -tzf "$UP_OUT" > /dev/null
  chmod 600 "$UP_OUT"
else
  log "peringatan: folder uploads tidak ada ($UPLOAD_DIR); arsip uploads dilewati"
  UP_OUT=""
fi
chmod 600 "$DB_OUT"

# 3) retensi
find "$BACKUP_DIR" -type f \( -name 'db-*.sqlite.gz' -o -name 'uploads-*.tar.gz' -o -name 'pre-restore-*.sqlite' \) -mtime +"$KEEP_DAYS" -delete

trap - EXIT
rm -f "$TMP" "$TMP-wal" "$TMP-shm"

# 4) salinan di luar server (disk server rusak/hilang = semua backup lokal ikut hilang)
OFFSITE="${OFFSITE_RCLONE_REMOTE:-$(env_get OFFSITE_RCLONE_REMOTE)}"
if [ -n "$OFFSITE" ]; then
  # gagal di sini = skrip keluar non-nol (cron mencatat & heartbeat TIDAK terkirim); backup lokal tetap tersimpan
  bash "$(dirname "$0")/offsite.sh" "$DB_OUT" ${UP_OUT:+"$UP_OUT"}
else
  log "peringatan: OFFSITE_RCLONE_REMOTE kosong; backup HANYA ada di server ini"
fi

BEAT="${BACKUP_HEARTBEAT_URL:-$(env_get BACKUP_HEARTBEAT_URL)}"
if [ -n "$BEAT" ]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$BEAT" || log "peringatan: heartbeat backup gagal dikirim"
fi

echo "[$(date '+%F %T')] OK  $(basename "$DB_OUT") ($(du -h "$DB_OUT" | cut -f1))  ${UP_OUT:+$(basename "$UP_OUT") ($(du -h "$UP_OUT" | cut -f1))}"
