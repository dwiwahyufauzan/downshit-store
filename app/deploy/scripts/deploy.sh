#!/usr/bin/env bash
# Rilis aplikasi tanpa downtime lama: build di folder rilis baru -> backup -> migrasi -> ganti symlink -> restart
# -> health check (gagal = rollback otomatis). Dijalankan sebagai user `downshit`.
#
#   REPO=git@github.com:USERNAME/downshit-store.git bash deploy.sh      # dari Git (source ada di folder app/)
#   SRC_DIR=/path/ke/app bash deploy.sh                                  # dari folder lokal (rsync)
#   SKIP_PRUNE=1 REPO=... bash deploy.sh                                 # rilis pertama: pertahankan devDependencies
#
# Struktur: $BASE/releases/<stempel>/  (satu build)   $BASE/current -> rilis aktif
#           $BASE/shared/{.env, data/downshit.db, uploads/, backups/}  (tidak ikut berganti)
#
# Variabel (opsional): DOWNSHIT_BASE (/srv/downshit), BRANCH (main), KEEP_RELEASES (5), NPM_INSTALL_CMD ("npm ci"),
#   BUILD_CMD ("npm run build"), RESTART_CMD ("sudo systemctl restart downshit"), PORT (dari .env)
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

REPO="${REPO:-}"; SRC_DIR="${SRC_DIR:-}"; BRANCH="${BRANCH:-main}"
SKIP_PRUNE="${SKIP_PRUNE:-0}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
NPM_INSTALL_CMD="${NPM_INSTALL_CMD:-npm ci}"
BUILD_CMD="${BUILD_CMD:-npm run build}"
RESTART_CMD="${RESTART_CMD:-sudo systemctl restart downshit}"
[ -n "$REPO" ] || [ -n "$SRC_DIR" ] || die "isi REPO=<url git> atau SRC_DIR=<folder app/>"
[ -f "$ENV_FILE" ] || die "$ENV_FILE tidak ada (salin dari deploy/env.production.example, chmod 600)"

TS=$(date +%Y%m%d-%H%M%S)
REL="$BASE/releases/$TS"
mkdir -p "$BASE/releases" "$BASE/shared/data" "$BASE/shared/uploads" "$BASE/shared/backups"
trap 'rc=$?; [ $rc -ne 0 ] && log "rilis $TS gagal (kode $rc); folder $REL dibiarkan untuk diagnosa"; exit $rc' EXIT

# 1) ambil source
if [ -n "$SRC_DIR" ]; then
  need rsync rsync
  mkdir -p "$REL"
  rsync -a --exclude node_modules --exclude .env --exclude build --exclude .svelte-kit \
        --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' --exclude 'tests/.tmp*' "$SRC_DIR"/ "$REL"/
else
  need git git
  git clone --depth 1 -b "$BRANCH" "$REPO" "$REL.src"
  mv "$REL.src/app" "$REL" && rm -rf "$REL.src"
fi
cd "$REL"

# 2) .env bersama + dependensi + build
ln -s "$ENV_FILE" .env                    # dibaca scripts/*.ts (dotenv) & node --env-file
log "install dependensi: $NPM_INSTALL_CMD"; eval "$NPM_INSTALL_CMD"
log "build: $BUILD_CMD";                    eval "$BUILD_CMD"

# 3) database: instal pertama (skema dari schema.ts) ATAU backup + migrasi idempoten
DB_FILE="$(env_get DATABASE_URL)"; DB_FILE="${DB_FILE:-$BASE/shared/data/downshit.db}"
case "$DB_FILE" in /*) ;; *) die "DATABASE_URL harus path absolut di produksi (sekarang: $DB_FILE)";; esac
need sqlite3 sqlite3
# CATATAN: `npm run build` membuka DATABASE_URL (modul db dimuat saat analisis build) sehingga berkas .db KOSONG
# (0 tabel) sudah bisa ada sebelum langkah ini. Karena itu "sudah terpasang" = ada tabel users, bukan sekadar berkas ada.
if [ -f "$DB_FILE" ] && [ "$(sqlite3 "$DB_FILE" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='users';")" = "1" ]; then
  log "backup sebelum migrasi"
  DOWNSHIT_BASE="$BASE" ENV_FILE="$ENV_FILE" bash "$REL/deploy/scripts/backup.sh"
  log "migrasi (db:migrate-sync, idempoten)"
  npm run db:migrate-sync
else
  log "database belum ada -> membuat skema baru di $DB_FILE"
  npx drizzle-kit export --sql | sqlite3 "$DB_FILE"
  sqlite3 "$DB_FILE" 'PRAGMA journal_mode=WAL;' > /dev/null
  chmod 600 "$DB_FILE"
  log "LANGKAH BERIKUTNYA (sekali): seed akun owner/admin - lihat docs/deployment.md bagian Seed produksi"
fi

# 4) buang devDependencies (modul native tetap). tsx tetap ada (dependencies); drizzle-kit hilang.
[ "$SKIP_PRUNE" = "1" ] || npm prune --omit=dev

# 5) aktifkan rilis
PREV=""; [ -L "$BASE/current" ] && PREV=$(readlink -f "$BASE/current")
ln -sfn "$REL" "$BASE/current"
log "restart: $RESTART_CMD"; eval "$RESTART_CMD"

# 6) health check; gagal -> rollback ke rilis sebelumnya
if ! DOWNSHIT_BASE="$BASE" ENV_FILE="$ENV_FILE" bash "$REL/deploy/scripts/healthcheck.sh"; then
  log "GAGAL -> rollback"
  if [ -n "$PREV" ]; then ln -sfn "$PREV" "$BASE/current"; eval "$RESTART_CMD" || true; log "kembali ke $PREV"; fi
  exit 1
fi

# 7) simpan N rilis terakhir
ls -1dt "$BASE"/releases/*/ | tail -n +$((KEEP_RELEASES + 1)) | while read -r d; do rm -rf "$d"; done
trap - EXIT
log "Rilis $TS aktif"
