#!/usr/bin/env bash
# probe-railway-keys.sh
#
# Safe wrapper omkring `railway variables --json`. Printer KUN key-navne,
# ALDRIG values. Bash version af probe-railway-keys.ps1.
#
# Brug:
#   bash scripts/probe-railway-keys.sh
#   bash scripts/probe-railway-keys.sh --service CyclingZone --filter SUPABASE
#   bash scripts/probe-railway-keys.sh --json
#
# Refs: #634 AC3.

set -eu

SERVICE="CyclingZone"
ENVIRONMENT="production"
FILTER=""
JSON_OUT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --service) SERVICE="$2"; shift 2 ;;
    --environment|--env) ENVIRONMENT="$2"; shift 2 ;;
    --filter) FILTER="$2"; shift 2 ;;
    --json) JSON_OUT=1; shift ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--service NAME] [--environment NAME] [--filter SUBSTR] [--json]

Printer key-navne fra Railway. ALDRIG values. Refs #634 AC3.
EOF
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

command -v railway >/dev/null 2>&1 || {
  echo "railway CLI not found. Install: https://docs.railway.app/develop/cli" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || {
  echo "jq not found. Install: https://stedolan.github.io/jq/" >&2
  exit 1
}

# Auth check
railway whoami >/dev/null 2>&1 || {
  echo "railway not authenticated. Run: railway login" >&2
  exit 1
}

# Project link check
railway status --json >/dev/null 2>&1 || {
  echo "railway project not linked. Run: railway link" >&2
  exit 1
}

# Fetch + extract keys ONLY. jq processes JSON in-memory; values are
# discarded before any data hits stdout/transcript.
# CRITICAL: pipe direkte til jq, ALDRIG echo/cat det rå output.
KEYS_JSON=$(railway variables --json --service "$SERVICE" --environment "$ENVIRONMENT" 2>/dev/null | jq -c 'keys' 2>/dev/null) || {
  echo "Failed to fetch/parse railway variables. Output suppressed for safety." >&2
  exit 1
}

if [ -z "$KEYS_JSON" ]; then
  echo "No variables returned (empty response)." >&2
  exit 1
fi

# Apply filter on keys-only JSON
if [ -n "$FILTER" ]; then
  KEYS_JSON=$(printf '%s' "$KEYS_JSON" | jq --arg f "$FILTER" '[.[] | select(test($f; "i"))]')
fi

# Output
if [ "$JSON_OUT" = "1" ]; then
  printf '%s\n' "$KEYS_JSON"
else
  COUNT=$(printf '%s' "$KEYS_JSON" | jq 'length')
  echo "Railway variables (service: $SERVICE, env: $ENVIRONMENT) — $COUNT keys"
  [ -n "$FILTER" ] && echo "  filter: '$FILTER'"
  printf '%s' "$KEYS_JSON" | jq -r '.[]' | sort | sed 's/^/  /'
fi

exit 0
