# Shared by install.sh and install-local.sh: asks for settings and writes .env.

[ -f .env ] && . ./.env

ask_settings() {
  echo
  echo "The installer will now ask for a few settings. Nothing appears on screen while you paste or type. That is normal."
  echo "If a value is already set, just press Enter to keep it."
  echo

  while :; do
    printf "Paste your Gemini key and press Enter: "
    read -rs value; echo
    value="${value:-${GEMINI_API_KEY:-}}"
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-goog-api-key: $value" \
      https://generativelanguage.googleapis.com/v1beta/models)
    if [ "$code" = 200 ]; then GEMINI_API_KEY="$value"; echo "The Gemini key works."; break; fi
    echo "Google did not accept this key. Copy it again and paste it here."
  done

  echo
  printf "Paste your Apify token (only needed for Instagram). No token? Just press Enter: "
  read -rs value; echo
  APIFY_API_TOKEN="${value:-${APIFY_API_TOKEN:-}}"

  echo
  while :; do
    printf "Choose a password for your notes, at least 8 characters: "
    read -rs value; echo
    value="${value:-${APP_PASSWORD:-}}"
    case "$value" in *\'*) echo "Please don't use the ' character."; continue ;; esac
    if [ "${#value}" -ge 8 ]; then APP_PASSWORD="$value"; break; fi
    echo "That password is too short."
  done

  SECRET_KEY="${SECRET_KEY:-$(openssl rand -hex 32)}"
  MCP_TOKEN="${MCP_TOKEN:-$(openssl rand -hex 32)}"
}

write_env() {
  ( umask 077; cat > .env <<ENV
APP_PASSWORD='$APP_PASSWORD'
SECRET_KEY='$SECRET_KEY'
MCP_TOKEN='$MCP_TOKEN'
GEMINI_API_KEY='$GEMINI_API_KEY'
APIFY_API_TOKEN='$APIFY_API_TOKEN'
SITE_ADDRESS='${SITE_ADDRESS:-}'
PUBLIC_URL='${PUBLIC_URL:-}'
ENV
  )
}
