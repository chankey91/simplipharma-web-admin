#!/bin/bash
# Fix dev.simplipharmaadmin.sanchet.in returning 404.
#
# Cause: Certbot added duplicate server blocks in /etc/nginx/sites-available/default
# that return 404, conflicting with sites-available/dev.simplipharmaadmin.sanchet.in
# which correctly proxies to port 8083.
#
# Run on the server (requires sudo):
#   chmod +x scripts/fix-nginx-admin-dev-domain.sh
#   ./scripts/fix-nginx-admin-dev-domain.sh

set -euo pipefail

DEFAULT_FILE="/etc/nginx/sites-available/default"
DEV_SITE="/etc/nginx/sites-available/dev.simplipharmaadmin.sanchet.in"
BACKUP="/etc/nginx/sites-available/default.bak-$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$DEFAULT_FILE" ]; then
  echo "ERROR: $DEFAULT_FILE not found"
  exit 1
fi

echo "Backing up $DEFAULT_FILE to $BACKUP"
sudo cp "$DEFAULT_FILE" "$BACKUP"

echo "Removing Certbot 404 stubs for dev.simplipharmaadmin.sanchet.in from default..."
sudo python3 - <<'PY'
from pathlib import Path
import re

path = Path("/etc/nginx/sites-available/default")
text = path.read_text()
pattern = re.compile(
    r"\nserver \{[^}]*server_name dev\.simplipharmaadmin\.sanchet\.in;[^}]*\}\n",
    re.DOTALL,
)
new_text, count = pattern.subn("\n", text)
if count == 0:
    raise SystemExit("No matching Certbot stub blocks found — check default manually")
path.write_text(new_text)
print(f"Removed {count} duplicate server block(s)")
PY

if [ ! -L "/etc/nginx/sites-enabled/dev.simplipharmaadmin.sanchet.in" ]; then
  echo "Enabling dev.simplipharmaadmin.sanchet.in site..."
  sudo ln -sf "$DEV_SITE" /etc/nginx/sites-enabled/dev.simplipharmaadmin.sanchet.in
fi

echo "Testing nginx config..."
sudo nginx -t

echo "Reloading nginx..."
sudo systemctl reload nginx

echo "Verifying..."
curl -sk -o /dev/null -w "HTTPS dev domain: %{http_code}\n" https://dev.simplipharmaadmin.sanchet.in/
curl -s -o /dev/null -w "Direct port 8083: %{http_code}\n" http://127.0.0.1:8083/health

echo "Done. Access: https://dev.simplipharmaadmin.sanchet.in or http://103.230.227.5:8083"
