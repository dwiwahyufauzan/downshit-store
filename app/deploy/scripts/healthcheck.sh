#!/usr/bin/env bash
# Tunggu hingga aplikasi menjawab 200 di /api/health (DB terbaca; maks. TRIES detik). Kode keluar 0 = sehat.
#   bash deploy/scripts/healthcheck.sh [port]
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"
PORT="${1:-${PORT:-$(env_get PORT)}}"; PORT="${PORT:-3000}"
TRIES="${TRIES:-20}"
curl -fsS -o /dev/null --retry "$TRIES" --retry-connrefused --retry-delay 1 "http://127.0.0.1:${PORT}/api/health" \
  && log "sehat: http://127.0.0.1:${PORT}/api/health" \
  || { log "TIDAK SEHAT: http://127.0.0.1:${PORT}/api/health"; exit 1; }
