#!/usr/bin/env bash
# Pulihkan database (dan opsional uploads) dari arsip backup.sh.
#   bash deploy/scripts/restore.sh <db-YYYYMMDD-HHMMSS.sqlite.gz> [uploads-YYYYMMDD-HHMMSS.tar.gz] [--yes]
#
# HENTIKAN aplikasi dulu (sudo systemctl stop downshit). Skrip menolak jalan tanpa --yes.
# Variabel: DOWNSHIT_BASE, ENV_FILE, DB_FILE, UPLOAD_DIR, BACKUP_DIR, SQLITE3
set -euo pipefail
umask 077
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

YES=0; ARGS=()
for a in "$@"; do [ "$a" = "--yes" ] && YES=1 || ARGS+=("$a"); done
DB_ARCHIVE="${ARGS[0]:-}"; UP_ARCHIVE="${ARGS[1]:-}"
[ -n "$DB_ARCHIVE" ] || die "pemakaian: restore.sh <db-*.sqlite.gz> [uploads-*.tar.gz] --yes"
[ -f "$DB_ARCHIVE" ] || die "arsip tidak ditemukan: $DB_ARCHIVE"
[ -z "$UP_ARCHIVE" ] || [ -f "$UP_ARCHIVE" ] || die "arsip uploads tidak ditemukan: $UP_ARCHIVE"

DB_FILE="${DB_FILE:-$(env_get DATABASE_URL)}"
DB_FILE="${DB_FILE:-$BASE/shared/data/downshit.db}"
UPLOAD_DIR="${UPLOAD_DIR:-$(env_get UPLOAD_DIR)}"
UPLOAD_DIR="${UPLOAD_DIR:-$BASE/shared/uploads}"
BACKUP_DIR="${BACKUP_DIR:-$BASE/shared/backups}"
SQLITE3="${SQLITE3:-sqlite3}"
need "$SQLITE3" sqlite3

[ "$YES" = 1 ] || die "ini MENIMPA $DB_FILE. Pastikan aplikasi sudah dihentikan, lalu ulangi dengan --yes"

mkdir -p "$BACKUP_DIR" "$(dirname "$DB_FILE")"
STAMP=$(date +%Y%m%d-%H%M%S)
NEW="$(dirname "$DB_FILE")/.restore-$STAMP.sqlite"
trap 'rm -f "$NEW" "$NEW-wal" "$NEW-shm"' EXIT

START=$(date +%s)
# 1) bongkar & validasi SEBELUM menyentuh database yang berjalan
gzip -t "$DB_ARCHIVE" || die "arsip rusak (gzip -t gagal)"
gunzip -c "$DB_ARCHIVE" > "$NEW"
[ "$("$SQLITE3" "$NEW" 'PRAGMA integrity_check;')" = "ok" ] || die "integrity_check arsip GAGAL; database tidak diubah"
[ "$("$SQLITE3" "$NEW" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('users','orders','products');")" = "3" ] \
  || die "arsip bukan database Downshit; database tidak diubah"

# 2) amankan kondisi sekarang (jaga-jaga)
if [ -f "$DB_FILE" ]; then
  SAFE="$BACKUP_DIR/pre-restore-$STAMP.sqlite"
  "$SQLITE3" "$DB_FILE" ".timeout 10000" ".backup '$SAFE'"
  chmod 600 "$SAFE"
  log "kondisi sebelum restore disimpan: $SAFE"
fi

# 3) tukar berkas. -wal/-shm lama WAJIB dihapus: bila tertinggal, SQLite menerapkannya ke database hasil restore.
mv -f "$NEW" "$DB_FILE"
rm -f "$DB_FILE-wal" "$DB_FILE-shm"
chmod 600 "$DB_FILE"

# 4) uploads (opsional)
if [ -n "$UP_ARCHIVE" ]; then
  tar -xzf "$UP_ARCHIVE" -C "$(dirname "$UPLOAD_DIR")"
  log "uploads dipulihkan ke $UPLOAD_DIR"
fi

# 5) verifikasi
"$SQLITE3" "$DB_FILE" 'PRAGMA foreign_key_check;' | head -5 | grep -q . && die "foreign_key_check menemukan data yatim" || true
for t in $CORE_TABLES; do printf '%-24s %s\n' "$t" "$("$SQLITE3" "$DB_FILE" "SELECT count(*) FROM $t;")"; done
log "RESTORE SELESAI dalam $(( $(date +%s) - START )) detik. Cek kepemilikan berkas (chown -R downshit:downshit), lalu: sudo systemctl start downshit"
