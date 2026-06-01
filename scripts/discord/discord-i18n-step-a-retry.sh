#!/usr/bin/env bash
# Retry 3 channels where em-dash mangled JSON encoding.
set -uo pipefail

TOKEN="${DISCORD_TOKEN:-${DISCORD_BOT_TOKEN:-}}"
if [ -z "$TOKEN" ]; then echo "ERR: DISCORD_TOKEN not found in environment"; exit 1; fi
[ -z "$TOKEN" ] && exit 1

API="https://discord.com/api/v10"
H_AUTH="Authorization: Bot $TOKEN"
H_CT="Content-Type: application/json; charset=utf-8"
UA="User-Agent: CyclingZone-Setup (claude, 1.0)"

retry() {
  local cid=$1 file=$2 label=$3
  printf "  %-35s ... " "$label"
  code=$(curl -sS -o /tmp/discord_resp -w "%{http_code}" -X PATCH "$API/channels/$cid" \
    -H "$H_AUTH" -H "$H_CT" -H "$UA" --data-binary @"$file")
  if [ "$code" = "200" ]; then echo "OK"; else echo "FAIL($code): $(cat /tmp/discord_resp)"; fi
}

mkdir -p /tmp/discord-payloads

# Use plain hyphen instead of em-dash to dodge encoding issues; cleaner anyway.
cat > /tmp/discord-payloads/start-here.json <<'JSON'
{"name":"start-here","topic":"Welcome! Start here if you're new - check pinned for the guide."}
JSON

cat > /tmp/discord-payloads/general.json <<'JSON'
{"topic":"General chat about CyclingZone. Keep it on-topic - off-topic belongs in #cafe."}
JSON

cat > /tmp/discord-payloads/cafe.json <<'JSON'
{"name":"cafe","topic":"Off-topic cycling chat. Tour, classics, Vingegaard - all things cycling."}
JSON

echo "==> Retrying 3 channels"
retry 1504952589739884664 /tmp/discord-payloads/start-here.json "start-her → start-here"
retry 1504952590486474805 /tmp/discord-payloads/general.json     "general (topic)"
retry 1504952617523089538 /tmp/discord-payloads/cafe.json        "café → cafe"
