#!/usr/bin/env bash
# Step C: Create Dansk category (gated) + 3 channels.
# Permission bits: VIEW_CHANNEL=1024, SEND_MESSAGES=2048
set -uo pipefail

TOKEN="${DISCORD_TOKEN:-${DISCORD_BOT_TOKEN:-}}"
if [ -z "$TOKEN" ]; then echo "ERR: DISCORD_TOKEN not found in environment"; exit 1; fi
[ -z "$TOKEN" ] && exit 1

GUILD=1504615050831466669
EVERYONE=$GUILD
SPEAKS_DANISH=1505477431853842472
API="https://discord.com/api/v10"
H_AUTH="Authorization: Bot $TOKEN"
H_CT="Content-Type: application/json; charset=utf-8"
UA="User-Agent: CyclingZone-Setup (claude, 1.0)"

mkdir -p /tmp/discord-payloads

# 1. Category with overwrites
cat > /tmp/discord-payloads/cat-dansk.json <<JSON
{
  "name": "🇩🇰 Dansk",
  "type": 4,
  "permission_overwrites": [
    {"id":"$EVERYONE","type":0,"deny":"1024","allow":"0"},
    {"id":"$SPEAKS_DANISH","type":0,"allow":"1024","deny":"0"}
  ]
}
JSON

printf "==> Create category 🇩🇰 Dansk ... "
resp=$(curl -sS -X POST "$API/guilds/$GUILD/channels" \
  -H "$H_AUTH" -H "$H_CT" -H "$UA" --data-binary @/tmp/discord-payloads/cat-dansk.json)
CAT_DANSK=$(echo "$resp" | grep -oP '"id":\s*"\K[^"]+' | head -1)
if [ -n "$CAT_DANSK" ]; then echo "OK  id=$CAT_DANSK"; else echo "FAIL: $resp"; exit 1; fi

create_channel() {
  local name=$1 topic=$2 readonly=$3 outvar=$4
  local payload="/tmp/discord-payloads/ch-$name.json"
  if [ "$readonly" = "true" ]; then
    cat > "$payload" <<JSON
{"name":"$name","type":0,"parent_id":"$CAT_DANSK","topic":"$topic","permission_overwrites":[{"id":"$EVERYONE","type":0,"deny":"3072","allow":"0"},{"id":"$SPEAKS_DANISH","type":0,"allow":"1024","deny":"0"}]}
JSON
  else
    cat > "$payload" <<JSON
{"name":"$name","type":0,"parent_id":"$CAT_DANSK","topic":"$topic"}
JSON
  fi
  printf "  create #%-18s ... " "$name"
  resp=$(curl -sS -X POST "$API/guilds/$GUILD/channels" \
    -H "$H_AUTH" -H "$H_CT" -H "$UA" --data-binary @"$payload")
  cid=$(echo "$resp" | grep -oP '"id":\s*"\K[^"]+' | head -1)
  if [ -n "$cid" ]; then echo "OK  id=$cid"; eval "$outvar=$cid"; else echo "FAIL: $resp"; fi
}

echo ""
echo "==> Create 3 channels in 🇩🇰 Dansk"
create_channel "dansk-regler"   "Community-regler på dansk. Læs før du poster. Read-only." true  CH_REGLER
create_channel "dansk-snak"     "Generel snak på dansk. On-topic + off-topic begge OK her."        false CH_SNAK
create_channel "dansk-strategi" "Dansk taktik + transfer-snak. Del råd, spørg om feedback."        false CH_STRAT

echo ""
echo "==> Summary"
echo "  CAT_DANSK=$CAT_DANSK"
echo "  CH_REGLER=$CH_REGLER"
echo "  CH_SNAK=$CH_SNAK"
echo "  CH_STRAT=$CH_STRAT"
