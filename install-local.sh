#!/usr/bin/env bash
# Runs the notes on this computer (macOS or Linux). Safe to run again.
set -euo pipefail
cd "$(dirname "$0")"
PORT=3210
. ./scripts_common.sh

if ! command -v node >/dev/null; then
  echo "This needs Node.js. Install it from https://nodejs.org and run this command again."
  exit 1
fi
if ! command -v uv >/dev/null; then
  echo "Installing uv, a helper that runs the app."
  curl -fsSL https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

ask_settings
write_env

echo; echo "Building the app. This takes a couple of minutes."
uv venv --quiet --allow-existing --python 3.12 backend/.venv
uv pip install --quiet --python backend/.venv/bin/python -r backend/requirements.txt
( cd frontend && npm ci --silent --no-audit --no-fund && npm run build --silent )

run=("$PWD/backend/.venv/bin/uvicorn" main:app --app-dir "$PWD/backend" --host 127.0.0.1 --port "$PORT")

if [ "$(uname)" = Darwin ] && [ -z "${SKIP_AUTOSTART:-}" ]; then
  plist="$HOME/Library/LaunchAgents/com.second-brain-notes.plist"
  args=""; for a in "${run[@]}"; do args="$args<string>$a</string>"; done
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>com.second-brain-notes</string>
<key>ProgramArguments</key><array>$args</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
PLIST
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
  for _ in $(seq 1 30); do curl -fsS -o /dev/null "http://localhost:$PORT/api/health" && break; sleep 1; done
  cat <<DONE

All done. Your notes: http://localhost:$PORT
The app now starts by itself when you turn on your computer.

To connect your notes to Claude Code, run:

claude mcp add --scope user --transport http second-brain http://localhost:$PORT/mcp/ --header "Authorization: Bearer $MCP_TOKEN"
DONE
else
  echo; echo "Starting. Your notes: http://localhost:$PORT. Press Ctrl+C to stop."
  exec "${run[@]}"
fi
