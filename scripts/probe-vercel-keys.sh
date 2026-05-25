#!/usr/bin/env bash
# probe-vercel-keys.sh
#
# Safe wrapper omkring `vercel env ls`. Printer KUN key-navne, ALDRIG values.
# Bash version af probe-vercel-keys.ps1. Refs: #634 AC3.
#
# Brug:
#   bash scripts/probe-vercel-keys.sh
#   bash scripts/probe-vercel-keys.sh --environment production --filter SUPABASE
#   bash scripts/probe-vercel-keys.sh --json

set -eu

ENVIRONMENT="production"
FILTER=""
JSON_OUT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --environment|--env) ENVIRONMENT="$2"; shift 2 ;;
    --filter) FILTER="$2"; shift 2 ;;
    --json) JSON_OUT=1; shift ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--environment production|preview|development] [--filter SUBSTR] [--json]

Printer key-navne fra Vercel. ALDRIG values. Refs #634 AC3.
EOF
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

command -v vercel >/dev/null 2>&1 || {
  echo "vercel CLI not found. Install: npm i -g vercel" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || {
  echo "jq not found." >&2
  exit 1
}

# Auth check
vercel whoami >/dev/null 2>&1 || {
  echo "vercel not authenticated. Run: vercel login" >&2
  exit 1
}

# Project link check
if [ ! -f ".vercel/project.json" ]; then
  echo "Vercel project not linked. Run: vercel link" >&2
  exit 1
fi

# Fetch + extract keys ONLY. jq projects .key + .type, discards .value
# in-memory. Raw JSON ALDRIG hits stdout/transcript.
KEYS_JSON=$(vercel env ls "$ENVIRONMENT" --format json 2>/dev/null | jq -c '
  (if has("envs") then .envs else . end)
  | [.[] | {key: .key, type: .type}]
' 2>/dev/null) || {
  echo "Failed to fetch/parse vercel env ls. Output suppressed for safety." >&2
  exit 1
}

if [ -z "$KEYS_JSON" ] || [ "$KEYS_JSON" = "null" ]; then
  echo "No env vars returned (empty response or auth issue)." >&2
  exit 1
fi

# Filter
if [ -n "$FILTER" ]; then
  KEYS_JSON=$(printf '%s' "$KEYS_JSON" | jq --arg f "$FILTER" '[.[] | select(.key | test($f; "i"))]')
fi

# Output
if [ "$JSON_OUT" = "1" ]; then
  printf '%s\n' "$KEYS_JSON"
else
  COUNT=$(printf '%s' "$KEYS_JSON" | jq 'length')
  echo "Vercel env vars (env: $ENVIRONMENT) — $COUNT keys"
  [ -n "$FILTER" ] && echo "  filter: '$FILTER'"
  printf '%s' "$KEYS_JSON" | jq -r '.[] | "  \(.key) (\(.type))"' | sort
fi

exit 0
