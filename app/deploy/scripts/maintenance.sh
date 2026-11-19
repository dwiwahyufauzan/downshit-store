#!/usr/bin/env bash
# Memanggil POST /internal/maintenance (kedaluwarsa pesanan, auto-selesai, bersihkan sesi & login_attempts).
# Dijadwalkan oleh cron tiap 15 menit (lihat deploy/cron/downshit.cron).
# Variabel: ENV_FILE (default /srv/downshit/shared/.env), PORT, CRON_SECRET
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
curl -fsS -m 30 -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" -d '{}' \
  "http://127.0.0.1:${PORT}/internal/maintenance"
echo
