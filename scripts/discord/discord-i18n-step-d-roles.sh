#!/usr/bin/env bash
# Step D: Create language roles "Speaks English" + "Speaks Danish".
# Outputs role IDs (capture for step C).
set -uo pipefail

TOKEN="${DISCORD_TOKEN:-${DISCORD_BOT_TOKEN:-}}"
if [ -z "$TOKEN" ]; then echo "ERR: DISCORD_TOKEN not found in environment"; exit 1; fi

GUILD=1504615050831466669
API="https://discord.com/api/v10"
H_AUTH="Authorization: Bot $TOKEN"
H_CT="Content-Type: application/json"
UA="User-Agent: CyclingZone-Setup (claude, 1.0)"

create_role() {
  local name=$1
  printf "  create role %-20s ... " "$name"
  resp=$(curl -sS -X POST "$API/guilds/$GUILD/roles" \
    -H "$H_AUTH" -H "$H_CT" -H "$UA" \
    -d "{\"name\":\"$name\",\"mentionable\":false,\"hoist\":false,\"permissions\":\"0\"}")
  id=$(echo "$resp" | grep -oP '"id":\s*"\K[^"]+' | head -1)
  if [ -n "$id" ]; then echo "OK  id=$id"; else echo "FAIL: $resp"; fi
}

echo "==> Creating language roles"
create_role "Speaks English"
create_role "Speaks Danish"

echo ""
echo "==> Listing all roles (verify)"
curl -sS "$API/guilds/$GUILD/roles" -H "$H_AUTH" -H "$UA" | \
  python3 -c "import json,sys;[print(f\"  {r['id']}  {r['name']}\") for r in json.load(sys.stdin)]" 2>/dev/null || \
  curl -sS "$API/guilds/$GUILD/roles" -H "$H_AUTH" -H "$UA"
