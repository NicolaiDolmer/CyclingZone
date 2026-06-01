#!/usr/bin/env bash
# Step A: Rename DA channels + categories to EN. Translate topics.
set -uo pipefail

TOKEN="${DISCORD_TOKEN:-${DISCORD_BOT_TOKEN:-}}"
[ -z "$TOKEN" ] && { echo "ERR: DISCORD_TOKEN not found in environment"; exit 1; }

API="https://discord.com/api/v10"
H_AUTH="Authorization: Bot $TOKEN"
H_CT="Content-Type: application/json"
UA="User-Agent: CyclingZone-Setup (claude, 1.0)"

patch_channel() {
  local cid=$1 payload=$2 label=$3
  printf "  %-35s ... " "$label"
  code=$(curl -sS -o /tmp/discord_resp -w "%{http_code}" -X PATCH "$API/channels/$cid" \
    -H "$H_AUTH" -H "$H_CT" -H "$UA" -d "$payload")
  if [ "$code" = "200" ]; then echo "OK"; else echo "FAIL($code): $(cat /tmp/discord_resp)"; fi
}

echo "==> Renaming categories"
patch_channel 1504952498199466084 '{"name":"📢 Welcome"}'           "cat: Velkommen → Welcome"
patch_channel 1504952499369676981 '{"name":"🚴 The Game"}'          "cat: Spillet → The Game"
patch_channel 1504952500468449410 '{"name":"🏆 Season & events"}'   "cat: Sæson → Season"

echo ""
echo "==> Renaming channels + updating topics"
patch_channel 1504952585990180986 '{"name":"rules","topic":"Community rules. Read before posting. Read-only."}' \
  "regler → rules"
patch_channel 1504952587311382680 '{"name":"announcements","topic":"Official announcements from staff. Follow for updates."}' \
  "annonceringer → announcements"
patch_channel 1504952588578193480 '{"topic":"Auto-posted patch notes from GitHub. Every ship lands here."}' \
  "patch-notes (topic)"
patch_channel 1504952589739884664 '{"name":"start-here","topic":"Welcome! Start here if you'\''re new — check pinned for the guide."}' \
  "start-her → start-here"
patch_channel 1504952590486474805 '{"topic":"General chat about CyclingZone. Keep it on-topic — off-topic belongs in #cafe."}' \
  "general (topic)"
patch_channel 1504952591941898280 '{"name":"strategy-and-tips","topic":"Tactics, transfer guides, economy. Share your insight + ask others'\''."}' \
  "strategi-og-tips → strategy-and-tips"
patch_channel 1504952593309499462 '{"name":"team-showcase","topic":"Show off your team + season results. Screenshots welcome. 30s slow-mode."}' \
  "hold-showcase → team-showcase"
patch_channel 1504952594551013577 '{"name":"feedback-and-ideas","topic":"⚠️ CONVERT TO FORUM via UI: Edit Channel → Channel Type → Forum. Tags: idea, under-consideration, accepted, declined."}' \
  "feedback-og-ideer → feedback-and-ideas"
patch_channel 1504952595901583532 '{"topic":"⚠️ CONVERT TO FORUM via UI: Edit Channel → Channel Type → Forum. Tags: open, verified, fixed, cannot-reproduce."}' \
  "bugs (topic)"
patch_channel 1504952601928536115 '{"name":"season-results","topic":"Weekly season recaps + Top-50 leaderboard. Auto-posted Sunday evenings."}' \
  "sæson-resultater → season-results"
patch_channel 1504952608186437762 '{"name":"leagues","topic":"Community leagues + private leagues. Find opponents + arrange duels."}' \
  "liga-snak → leagues"
patch_channel 1504952617523089538 '{"name":"cafe","topic":"Off-topic cycling chat. Tour, classics, Vingegaard — all things cycling."}' \
  "café → cafe"
patch_channel 1504952622853918851 '{"topic":"Memes only. Keep #general joke-free."}' \
  "memes (topic)"
patch_channel 1504952629732835379 '{"topic":"Private staff coordination."}' \
  "staff-chat (topic)"
patch_channel 1504952635655065651 '{"topic":"Dyno + Carl-bot mod-log."}' \
  "moderation-log (topic)"
patch_channel 1504952639400706291 '{"topic":"Bot command spam and tests."}' \
  "bot-commands (topic)"

echo ""
echo "==> Done."
