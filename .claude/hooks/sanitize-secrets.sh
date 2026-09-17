#!/usr/bin/env bash
# PostToolUse hook (matcher: Bash|PowerShell|mcp__.*|Read|Write|Edit|Grep)
#
# Scanner tool-output for kendte secret-patterns og redact'er værdier FØR
# Claude ser dem. Defense-in-depth sammen med
# `block-dangerous-secret-commands.sh` (PreToolUse) + repo-side gitleaks
# (AC5). Detaljer: docs/SECRET_LEAK_VECTORS.md.
#
# Adfærd:
#   - INGEN match  -> exit 0 (silent passthrough)
#   - MATCH funnet -> exit 2 med stderr = redacted-summary +
#                     append-line til .claude/secret-leak-incidents.log
#                     Exit 2 = blocking error: Claude ser stderr som tool
#                     feedback i stedet for tool_response (= secrets aldrig
#                     når context).
#   - RUNTIME-FEJL -> exit 2 (fail-closed) med `cause:`-linje der siger HVAD
#                     der gik galt (#5326). Vagten gætter aldrig "safe".
#
# Selve regelsættet bor i scripts/hooks/lib/scan-secrets.py og får payloaden på
# STDIN. Indtil 17/9 gik den gennem env-var'en `_SECRET_SCAN_INPUT`; den har en
# platform-afhængig størrelses-/encoding-grænse, og når den rammes fejler
# Python før scanningen — hvilket gav den årsagsløse 'output scan failed' i
# #5326. stdin har ingen sådan grænse.
#
# Refs: #634 AC2 (forebyg gentagelse af #296 + #620), #5326 (årsag + stort payload).

set -u

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_LIB="$(cd "$HOOK_DIR/../../scripts/hooks/lib" && pwd)/resolve-python.sh"
if ! source "$HOOK_LIB"; then
  echo 'SECRET GUARD BLOCKED: Python runtime helper unavailable.' >&2
  exit 2
fi
PY=$(resolve_hook_python) || { secret_runtime_failure 'no working Python >=3.8 (Windows Store aliases rejected)'; exit 2; }

SCANNER="$(dirname "$HOOK_LIB")/scan-secrets.py"
if [ ! -f "$SCANNER" ]; then
  secret_runtime_failure 'scanner script missing' "expected at $SCANNER"
  exit 2
fi

# --- #684 TRACE (cross-PC hook-firing investigation) ---
{
  mkdir -p "$HOME/.claude" 2>/dev/null
  printf '%s hook=%s pid=%s host=%s cwd=%s\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
    "$(basename "$0")" \
    "$$" \
    "${COMPUTERNAME:-${HOSTNAME:-unknown}}" \
    "$(pwd 2>/dev/null)" \
    >> "$HOME/.claude/hook-trace.log" 2>/dev/null
} 2>/dev/null || true
# --- /#684 TRACE ---

# Læs stdin (PostToolUse JSON payload). Hvis ingen stdin -> exit 0 (fail open).
INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

# Performance: korte outputs er ofte safe (status-coder, OK-messages). Skip
# scan for outputs <100 chars for at undgå overhead på hver tool-call.
INPUT_LEN=${#INPUT}
if [ "$INPUT_LEN" -lt 100 ]; then
  exit 0
fi

# Performance: meget store payloads (>2MB) er sjældne men kan slow hooks.
# Truncate til 2MB. Hvis secret er forbi 2MB er det edge-case; primær
# forsvarslinje er PreToolUse-block. Et afskåret multibyte-tegn i snittet er
# ufarligt: scanneren decoder med errors="replace".
MAX_BYTES=2097152
if [ "$INPUT_LEN" -gt "$MAX_BYTES" ]; then
  INPUT=$(printf '%s' "$INPUT" | head -c "$MAX_BYTES")
fi

# Kør scanneren. Payload på stdin (ingen env-var-grænse, #5326), stderr fanges
# så en runtime-fejl kan diagnosticeres i stedet for bare at hedde "failed".
# PYTHONUTF8/PYTHONIOENCODING sættes eksplicit: på en dansk Windows er den
# implicitte konsol-codepage ikke UTF-8, og æøå i payloaden må ikke kunne
# vælte scanneren. Vi bruger ikke Python til at scanne dens egen stderr —
# helperen i resolve-python.sh er ren bash, netop fordi Python kan være den
# der fejlede.
SCAN_ERR="$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/cz-secret-scan-$$.err")"
SCAN_RESULT=$(printf '%s' "$INPUT" \
  | PYTHONUTF8=1 PYTHONIOENCODING=utf-8 "$PY" "$SCANNER" 2>"$SCAN_ERR")
SCAN_EXIT=$?
SCAN_DETAIL="$(secret_sanitize_detail "$SCAN_ERR")"
rm -f "$SCAN_ERR" 2>/dev/null || true

if [ "$SCAN_EXIT" -ne 0 ]; then
  secret_runtime_failure 'output scan failed' \
    "scanner exit=$SCAN_EXIT, input_chars=$INPUT_LEN, py=$PY | stderr: $SCAN_DETAIL"
  exit 2
fi

# Parse Python result
if [ -z "$SCAN_RESULT" ]; then
  secret_runtime_failure 'output scanner returned no result' \
    "scanner exit=0 men tom stdout, input_chars=$INPUT_LEN | stderr: $SCAN_DETAIL"
  exit 2
fi

REPO_ROOT=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd || pwd)
TS=$(date '+%Y-%m-%dT%H:%M:%S%z')

# Forward-guard: log a stats line whenever image-mode triggered OR a leak
# fired. Quiet on the (vast majority) of plain text tool-calls. The stats
# log lets us measure FP-rate after the image-mode fix and tighten patterns
# if image-mode still misses cases.
STATS_FILE="$REPO_ROOT/.claude/secret-leak-stats.log"
STATS_LINE=$(printf '%s' "$SCAN_RESULT" | "$PY" -c '
import sys, json
d = json.load(sys.stdin)
if not (d.get("image_mode") or d.get("leak_detected") or d.get("path_like_skipped") or d.get("iso_timestamp_skipped") or d.get("bot_metadata_skipped") or d.get("var_assign_skipped")):
    sys.exit(0)
fields = [
    "image_mode={}".format(d.get("image_mode", False)),
    "reason={}".format(d.get("image_mode_reason", "") or "-"),
    "skipped_he={}".format(d.get("high_entropy_skipped", 0)),
    "skipped_path={}".format(d.get("path_like_skipped", 0)),
    "skipped_iso={}".format(d.get("iso_timestamp_skipped", 0)),
    "skipped_var={}".format(d.get("var_assign_skipped", 0)),
    "skipped_bot={}".format(d.get("bot_metadata_skipped", 0)),
    "leak={}".format(d.get("leak_detected", False)),
    "count={}".format(d.get("count", 0)),
    "chars={}".format(d.get("input_chars", 0)),
    "tool={}".format(d.get("tool_name", "") or "-"),
]
print(" ".join(fields))
' 2>/dev/null || true)
if [ -n "$STATS_LINE" ]; then
  mkdir -p "$(dirname "$STATS_FILE")" 2>/dev/null || true
  echo "$TS $STATS_LINE" >> "$STATS_FILE" 2>/dev/null || true
fi

VERDICT_ERR="$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/cz-secret-verdict-$$.err")"
LEAK=$(printf '%s' "$SCAN_RESULT" | "$PY" -c 'import sys,json; d=json.load(sys.stdin); assert isinstance(d.get("leak_detected"), bool); print("yes" if d["leak_detected"] else "no")' 2>"$VERDICT_ERR")
VERDICT_EXIT=$?
VERDICT_DETAIL="$(secret_sanitize_detail "$VERDICT_ERR")"
rm -f "$VERDICT_ERR" 2>/dev/null || true
if [ "$VERDICT_EXIT" -ne 0 ]; then
  secret_runtime_failure 'scan verdict parsing failed' \
    "verdict exit=$VERDICT_EXIT | stderr: $VERDICT_DETAIL"
  exit 2
fi

if [ "$LEAK" != "yes" ]; then
  exit 0
fi

# Leak detected. Log incident + alert via stderr + exit 2 (block).
LOG_FILE="$REPO_ROOT/.claude/secret-leak-incidents.log"

# Extract types and counts via Python (avoid f-string backslash escapes — Python forbidder).
SUMMARY=$(printf '%s' "$SCAN_RESULT" | "$PY" -c '
import sys, json
d = json.load(sys.stdin)
types = d.get("types", [])
count = d.get("count", 0)
findings = d.get("findings", [])
types_str = ",".join(types)
print("count={} types={}".format(count, types_str))
for f in findings[:5]:
    print("  - {}: {}".format(f.get("type", "?"), f.get("preview", "?")))
' 2>/dev/null || echo "parse-error")

# Append to incident log (best-effort, don't fail if disk issues)
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
{
  echo "---"
  echo "timestamp: $TS"
  echo "$SUMMARY"
  echo "raw: $SCAN_RESULT"
} >> "$LOG_FILE" 2>/dev/null || true

# Emit blocking-error message to stderr (Claude ser dette i stedet for tool_response)
cat >&2 <<EOF
🔴 SECRET LEAK DETECTED — tool output blocked by sanitize-secrets.sh

Found secret-patterns in tool output. Output suppressed to prevent leak.

$SUMMARY

What this means:
- A tool just printed something matching known secret-patterns (JWT, Sentry
  DSN, Supabase key, Discord token, AWS key, etc.).
- The full tool_response has been REPLACED with this message — agent does
  not see the leaked values.
- Incident logged to .claude/secret-leak-incidents.log

What to do (agent):
1. STOP. Do not retry the same command.
2. Tell the user IMMEDIATELY what you ran and what type leaked.
3. Suggest the safe alternative from docs/SECRET_LEAK_VECTORS.md, e.g.:
     - railway variables  ->  pwsh -File scripts/probe-railway-keys.ps1
     - vercel env ls      ->  pwsh -File scripts/probe-vercel-keys.ps1
     - cat .env           ->  grep -oE '^[A-Z_]+=' backend/.env  (kun keys)
4. If you genuinely need the value (rotation, debugging): ask the user to
   read it from the dashboard directly and paste only what's needed.

Known false positives — you did NOT leak anything (#3024):
- types=high-entropy ONLY, while reading a .jsonl agent transcript from
  .claude/projects/: the long base64 strings in each thinking block's
  "signature" field are integrity signatures over the model's own
  reasoning. They are not credentials, grant no access and never rotate.
  Do not report a leak. Re-read the transcript with a narrower slice
  (jq/python that prints only the fields you need) instead of raw file
  content.
- types=high-entropy ONLY, on a localhost:5173/5174 URL: see table H in
  docs/SECRET_LEAK_VECTORS.md — a real key match would show as
  jwt-supabase-legacy or supabase-publishable, not high-entropy.
Any named type (jwt*, sb_secret_, ghp_, AKIA, sentry-dsn, ...) is a REAL
match and the rules above still apply.

Refs: #634 (denne hook), #296 + #620 (tidligere leaks), #3024 (FP-noter).
EOF

exit 2
