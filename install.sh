#!/usr/bin/env bash
# Installs or updates the notes on an Ubuntu server. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")"
. ./scripts_common.sh

ask_settings

ip=$(curl -4 -fsS https://api.ipify.org)
SITE_ADDRESS="${SITE_ADDRESS:-${ip//./-}.sslip.io}"
PUBLIC_URL="https://$SITE_ADDRESS"
write_env

if ! command -v docker >/dev/null; then
  echo; echo "Installing Docker. This takes a couple of minutes."
  curl -fsSL https://get.docker.com | sh
fi

echo; echo "Building and starting the app. This takes 3 to 10 minutes."
docker compose up -d --build

echo; echo "Waiting for the site to get a secure connection."
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$PUBLIC_URL/api/health"; then ready=1; break; fi
  sleep 5
done

echo
if [ "${ready:-}" != 1 ]; then
  echo "The app is running, but $PUBLIC_URL isn't answering yet."
  echo "Show Claude this line and the output of: docker compose logs --tail 50"
  exit 1
fi
cat <<DONE
====================================================
All done. Your notes: $PUBLIC_URL
Sign in with the password you just chose.

To connect your notes to Claude, open your notes, then the menu in the top right,
and choose Connect to Claude.
====================================================
DONE
