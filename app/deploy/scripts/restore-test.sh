#!/usr/bin/env bash
# Uji restore (WAJIB sekali sebelum go-live, lalu tiap bulan): pulihkan backup TERBARU ke lokasi sementara
# dan bandingkan dengan database sumber. TIDAK menyentuh database produksi.
#   bash deploy/scripts/restore-test.sh [db-*.sqlite.gz]
# Hasil: tabel perbandingan jumlah baris, integrity_check, foreign_key_check, sampel UTF-8, waktu restore (RTO).
# Keluar dengan kode != 0 bila ada ketidakcocokan. Bila aplikasi sedang aktif dan ada transaksi baru sejak
# backup, jumlah baris boleh berbeda: jalankan dengan ALLOW_DIFF=1 dan catat selisihnya.
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

DB_FILE="${DB_FILE:-$(env_get DATABASE_URL)}"
DB_FILE="${DB_FILE:-$BASE/shared/data/downshit.db}"
BACKUP_DIR="${BACKUP_DIR:-$BASE/shared/backups}"
SQLITE3="${SQLITE3:-sqlite3}"
need "$SQLITE3" sqlite3

LATEST="${1:-$(ls -1t "$BACKUP_DIR"/db-*.sqlite.gz 2>/dev/null | head -1 || true)}"
[ -n "$LATEST" ] && [ -f "$LATEST" ] || die "tidak ada arsip db-*.sqlite.gz di $BACKUP_DIR"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

log "arsip uji: $LATEST"
T0=$(date +%s)
gzip -t "$LATEST"
gunzip -c "$LATEST" > "$WORK/restore.sqlite"
SECS=$(( $(date +%s) - T0 ))

FAIL=0
IC=$("$SQLITE3" "$WORK/restore.sqlite" 'PRAGMA integrity_check;')
echo "integrity_check      : $IC"; [ "$IC" = "ok" ] || FAIL=1
FK=$("$SQLITE3" "$WORK/restore.sqlite" 'PRAGMA foreign_key_check;' | wc -l | tr -d ' ')
echo "foreign_key_check    : $FK baris yatim"; [ "$FK" = "0" ] || FAIL=1
echo "jumlah tabel         : $("$SQLITE3" "$WORK/restore.sqlite" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"

printf '\n%-24s %12s %12s  %s\n' tabel sumber restore hasil
for t in $CORE_TABLES; do
  a=$("$SQLITE3" "$DB_FILE" "SELECT count(*) FROM $t;" 2>/dev/null || echo "?")
  b=$("$SQLITE3" "$WORK/restore.sqlite" "SELECT count(*) FROM $t;")
  if [ "$a" = "$b" ]; then r=OK; else r=BEDA; [ "${ALLOW_DIFF:-0}" = 1 ] || FAIL=1; fi
  printf '%-24s %12s %12s  %s\n' "$t" "$a" "$b" "$r"
done

echo; echo "sampel produk (periksa UTF-8):"; "$SQLITE3" "$WORK/restore.sqlite" "SELECT name FROM products LIMIT 3;"
UP=$(ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | head -1 || true)
if [ -n "$UP" ]; then tar -tzf "$UP" > /dev/null && echo "arsip uploads terbuka   : $(basename "$UP") ($(tar -tzf "$UP" | wc -l | tr -d ' ') entri)"; fi
echo; echo "waktu restore (RTO)  : ${SECS} detik   (target PRD < 2 jam)"
[ $FAIL = 0 ] && { log "UJI RESTORE LULUS"; } || { log "UJI RESTORE GAGAL"; exit 1; }
