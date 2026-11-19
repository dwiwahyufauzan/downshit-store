# Fungsi bersama untuk skrip deploy/*.sh  (di-source, bukan dijalankan langsung)

BASE="${DOWNSHIT_BASE:-/srv/downshit}"
ENV_FILE="${ENV_FILE:-$BASE/shared/.env}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { printf '[%s] GALAT: %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

# Baca KEY dari berkas .env tanpa meng-source-nya (tidak mengeksekusi isi berkas)
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" || true
}

# ukuran berkas (byte), portabel Linux/macOS
fsize() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || die "perintah '$1' tidak ditemukan (apt install $2)"; }

# Hitung baris tabel inti (dipakai backup/restore/uji restore)
CORE_TABLES="users products bundles bundle_items orders order_items order_item_components payments shipments stock_movements activity_logs settings"
