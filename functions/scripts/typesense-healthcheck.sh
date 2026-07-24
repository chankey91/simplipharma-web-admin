#!/usr/bin/env bash
# Cron-friendly Typesense health monitor + auto-restart.
# Install on the Typesense host (example every 2 minutes):
#   */2 * * * * /opt/simplipharma/scripts/typesense-healthcheck.sh >> /var/log/typesense-health.log 2>&1
#
# Env (optional):
#   TYPESENSE_HEALTH_URL  default http://127.0.0.1:8088/health  (prod maps 8088→8108)
#   TYPESENSE_CONTAINER   default typesense

set -euo pipefail

URL="${TYPESENSE_HEALTH_URL:-http://127.0.0.1:8088/health}"
CONTAINER="${TYPESENSE_CONTAINER:-typesense}"
TIMEOUT_SEC="${TYPESENSE_HEALTH_TIMEOUT:-5}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

if curl -fsS -m "$TIMEOUT_SEC" "$URL" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "$(ts) OK $URL"
  exit 0
fi

echo "$(ts) UNHEALTHY $URL — restarting container $CONTAINER"
if command -v docker >/dev/null 2>&1; then
  docker restart "$CONTAINER" || true
  sleep 8
  if curl -fsS -m "$TIMEOUT_SEC" "$URL" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    echo "$(ts) RECOVERED after restart"
    exit 0
  fi
  echo "$(ts) STILL DOWN after restart"
  exit 1
fi

echo "$(ts) docker not available; cannot restart"
exit 1
