#!/usr/bin/env bash
# Memanggil POST /internal/maintenance (kedaluwarsa pesanan, auto-selesai, bersihkan sesi & login_attempts).
# Dijadwalkan oleh cron tiap 15 menit (lihat deploy/cron/downshit.cron).
# Variabel: ENV_FILE (default /srv/downshit/shared/.env), PORT, CRON_SECRET,
#   HEARTBEAT_URL (opsional; mis. https://hc-ping.com/<uuid> dari healthchecks.io: dipanggil HANYA bila
#   pemeliharaan sukses, sehingga layanan itu memberi alarm bila cron berhenti atau aplikasi mati)
#
# CATATAN SvelteKit 3: POST tanpa header Origin dan tanpa Content-Type JSON ditolak CSRF (403) SEBELUM
# endpoint dijalankan. Karena itu curl mengirim Content-Type: application/json + body {}.
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

CRON_SECRET="${CRON_SECRET:-$(env_get CRON_SECRET)}"
PORT="${PORT:-$(env_get PORT)}"; PORT="${PORT:-3000}"
[ -n "$CRON_SECRET" ] || die "CRON_SECRET kosong (cek $ENV_FILE)"

printf '[%s] ' "$(date '+%F %T')"
# Rahasia dikirim lewat konfigurasi stdin (bukan argumen) agar tidak terlihat oleh user lain via `ps`.
curl -fsS -m 30 -X POST --config - \
  -H "Content-Type: application/json" -d '{}' \
  "http://127.0.0.1:${PORT}/internal/maintenance" <<CURLCFG
header = "Authorization: Bearer ${CRON_SECRET}"
CURLCFG
echo

# set -e: sampai sini berarti pemeliharaan sukses (curl -f gagal pada HTTP >= 400, termasuk 500 job gagal)
HEARTBEAT_URL="${HEARTBEAT_URL:-$(env_get HEARTBEAT_URL)}"
if [ -n "$HEARTBEAT_URL" ]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$HEARTBEAT_URL" || log "peringatan: heartbeat gagal dikirim"
fi
