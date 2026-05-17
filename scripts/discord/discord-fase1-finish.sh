#!/usr/bin/env bash
# One-shot: complete Discord Fase 1 server setup via REST API.
# Reads bot token from OneDrive mcp.json (samme på alle PCs via OneDrive-context sync).
set -uo pipefail

TOKEN=$(grep -oP '"DISCORD_TOKEN":\s*"\K[^"]+' "$HOME/OneDrive/CyclingZone-context/secrets/mcp.json")
if [ -z "$TOKEN" ]; then echo "ERR: DISCORD_TOKEN not found"; exit 1; fi

GUILD=1504615050831466669
API="https://discord.com/api/v10"
H_AUTH="Authorization: Bot $TOKEN"
H_CT="Content-Type: application/json"
UA="User-Agent: CyclingZone-Setup (claude, 1.0)"

# Categories
CAT_VELKOMMEN=1504952498199466084
CAT_SPILLET=1504952499369676981
CAT_SAESON=1504952500468449410
CAT_OFFTOPIC=1504952501773012993
CAT_STAFF=1504952504876531852

move() {
  local cid=$1 parent=$2 name=$3
  printf "  move %-22s → %s ... " "$name" "$parent"
  code=$(curl -sS -o /tmp/discord_resp -w "%{http_code}" -X PATCH "$API/channels/$cid" \
    -H "$H_AUTH" -H "$H_CT" -H "$UA" \
    -d "{\"parent_id\":\"$parent\"}")
  if [ "$code" = "200" ]; then echo "OK"; else echo "FAIL($code): $(cat /tmp/discord_resp)"; fi
}

deny_view() {
  local cid=$1 name=$2
  printf "  deny @everyone view on %-18s ... " "$name"
  # 1024 = VIEW_CHANNEL; overwrite type 0 = role
  code=$(curl -sS -o /tmp/discord_resp -w "%{http_code}" -X PUT "$API/channels/$cid/permissions/$GUILD" \
    -H "$H_AUTH" -H "$H_CT" -H "$UA" \
    -d '{"type":0,"deny":"1024","allow":"0"}')
  if [ "$code" = "204" ] || [ "$code" = "200" ]; then echo "OK"; else echo "FAIL($code): $(cat /tmp/discord_resp)"; fi
}

echo "==> Step 1: Move 18 channels into categories"
move 1504952585990180986 $CAT_VELKOMMEN "regler"
move 1504952587311382680 $CAT_VELKOMMEN "annonceringer"
move 1504952588578193480 $CAT_VELKOMMEN "patch-notes"
move 1504952589739884664 $CAT_VELKOMMEN "start-her"
move 1504952590486474805 $CAT_SPILLET   "general"
move 1504952591941898280 $CAT_SPILLET   "strategi-og-tips"
move 1504952593309499462 $CAT_SPILLET   "hold-showcase"
move 1504952594551013577 $CAT_SPILLET   "feedback-og-ideer"
move 1504952595901583532 $CAT_SPILLET   "bugs"
move 1504952601928536115 $CAT_SAESON    "sæson-resultater"
move 1504952608186437762 $CAT_SAESON    "liga-snak"
move 1504952617523089538 $CAT_OFFTOPIC  "café"
move 1504952622853918851 $CAT_OFFTOPIC  "memes"
move 1504952629732835379 $CAT_STAFF     "staff-chat"
move 1504952635655065651 $CAT_STAFF     "moderation-log"
move 1504952639400706291 $CAT_STAFF     "bot-commands"

echo ""
echo "==> Step 2: Redirect Community channels (rules→#regler, updates→#annonceringer)"
code=$(curl -sS -o /tmp/discord_resp -w "%{http_code}" -X PATCH "$API/guilds/$GUILD" \
  -H "$H_AUTH" -H "$H_CT" -H "$UA" \
  -d '{"rules_channel_id":"1504952585990180986","public_updates_channel_id":"1504952587311382680"}')
if [ "$code" = "200" ]; then echo "  Community redirect OK"; else echo "  FAIL($code): $(cat /tmp/discord_resp)"; fi

echo ""
echo "==> Step 3: Delete stub channels (#rules, #moderator-only)"
for cid in 1504616200557166773 1504616201060618300; do
  printf "  delete %s ... " "$cid"
  code=$(curl -sS -o /tmp/discord_resp -w "%{http_code}" -X DELETE "$API/channels/$cid" \
    -H "$H_AUTH" -H "$UA")
  if [ "$code" = "200" ]; then echo "OK"; else echo "FAIL($code): $(cat /tmp/discord_resp)"; fi
done

echo ""
echo "==> Step 4: Set @everyone View=Deny on 3 staff channels"
deny_view 1504952629732835379 "staff-chat"
deny_view 1504952635655065651 "moderation-log"
deny_view 1504952639400706291 "bot-commands"

echo ""
echo "==> Done."
