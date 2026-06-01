#!/usr/bin/env bash
# Fix category names + 2 topics where emoji got mangled to "??".
set -uo pipefail

TOKEN="${DISCORD_TOKEN:-${DISCORD_BOT_TOKEN:-}}"
if [ -z "$TOKEN" ]; then echo "ERR: DISCORD_TOKEN not found in environment"; exit 1; fi
[ -z "$TOKEN" ] && exit 1

API="https://discord.com/api/v10"
H_AUTH="Authorization: Bot $TOKEN"
H_CT="Content-Type: application/json; charset=utf-8"
UA="User-Agent: CyclingZone-Setup (claude, 1.0)"

patch_file() {
  local cid=$1 file=$2 label=$3
  printf "  %-30s ... " "$label"
  code=$(curl -sS -o /tmp/discord_resp -w "%{http_code}" -X PATCH "$API/channels/$cid" \
    -H "$H_AUTH" -H "$H_CT" -H "$UA" --data-binary @"$file")
  if [ "$code" = "200" ]; then echo "OK"; else echo "FAIL($code): $(cat /tmp/discord_resp)"; fi
}

mkdir -p /tmp/discord-payloads

cat > /tmp/discord-payloads/cat-welcome.json <<'JSON'
{"name":"📢 Welcome"}
JSON

cat > /tmp/discord-payloads/cat-game.json <<'JSON'
{"name":"🚴 The Game"}
JSON

cat > /tmp/discord-payloads/cat-season.json <<'JSON'
{"name":"🏆 Season & events"}
JSON

cat > /tmp/discord-payloads/topic-feedback.json <<'JSON'
{"topic":"⚠️ CONVERT TO FORUM via UI: Edit Channel → Channel Type → Forum. Tags: idea, under-consideration, accepted, declined."}
JSON

cat > /tmp/discord-payloads/topic-bugs.json <<'JSON'
{"topic":"⚠️ CONVERT TO FORUM via UI: Edit Channel → Channel Type → Forum. Tags: open, verified, fixed, cannot-reproduce."}
JSON

echo "==> Fixing category names + 2 topics"
patch_file 1504952498199466084 /tmp/discord-payloads/cat-welcome.json  "cat: 📢 Welcome"
patch_file 1504952499369676981 /tmp/discord-payloads/cat-game.json     "cat: 🚴 The Game"
patch_file 1504952500468449410 /tmp/discord-payloads/cat-season.json   "cat: 🏆 Season & events"
patch_file 1504952594551013577 /tmp/discord-payloads/topic-feedback.json "feedback-and-ideas topic"
patch_file 1504952595901583532 /tmp/discord-payloads/topic-bugs.json     "bugs topic"
