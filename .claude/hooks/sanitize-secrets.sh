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
#
# Refs: #634 AC2 (forebyg gentagelse af #296 + #620).

set -u

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
# forsvarslinje er PreToolUse-block.
MAX_BYTES=2097152
if [ "$INPUT_LEN" -gt "$MAX_BYTES" ]; then
  INPUT=$(printf '%s' "$INPUT" | head -c "$MAX_BYTES")
fi

# Patterns. Tuned for kendte vektorer fra docs/SECRET_LEAK_VECTORS.md.
# Hver pattern er en `<type>|<regex>` linje. Type bruges i redact-label.
#
# Bemærk: Vi bruger Python (ikke grep -E) til scanning fordi:
#   - Python regex er konsistent på tværs af Git Bash + macOS + Linux
#   - grep -E har subtle forskelle (fx \b, \d) på BSD vs GNU
#   - Performance-mæssigt er én Python-proces hurtigere end mange grep
#
# Fail-open: hvis Python ikke findes (sjældent på dev-maskiner) -> exit 0.
command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || exit 0
PY=$(command -v python3 || command -v python)

# Python script som heredoc. Læser INPUT fra env-var for at undgå quoting-helvede.
export _SECRET_SCAN_INPUT="$INPUT"

SCAN_RESULT=$("$PY" <<'PYEOF' 2>/dev/null || true
import os, re, json, sys

text = os.environ.get("_SECRET_SCAN_INPUT", "")
if not text:
    sys.exit(0)

# Best-effort JSON parse of the PostToolUse payload to extract tool_name.
# Falls back to text-only scanning if stdin isn't valid JSON (e.g. legacy
# hook callers or tests that pipe raw text).
tool_name = ""
try:
    payload = json.loads(text)
    if isinstance(payload, dict):
        tool_name = str(payload.get("tool_name", "") or "")
except Exception:
    pass

# --- Image-mode detection ------------------------------------------------
# Why: high-entropy fallback regex matches any 40+-char base64-like string
# with mixed case + digits. JPEG/PNG bytes encoded as base64 trip it for
# HUNDREDS of fragments per screenshot (count=241 on 2026-05-25, count=587
# on 2026-05-26 — both Chrome MCP browser_batch with screenshot action).
# Suppressing the entire tool_response breaks downstream verify flows.
#
# Fix: detect image-output context and skip the high-entropy fallback.
# Named patterns (sb_secret_, eyJ, ghp_, AKIA, ...) still run because they
# have distinct prefixes that random image bytes won't accidentally match.
#
# Two detection paths (either is enough):
#   1. tool_name matches a known image-producing MCP tool.
#   2. The payload contains an image magic-byte marker (JPEG SOI / PNG
#      signature / data URI / MCP image content type).
IMAGE_TOOL_RE = re.compile(
    r"^mcp__Claude_in_Chrome__(?:browser_batch|computer|gif_creator|upload_image|read_page)$"
    r"|^mcp__Claude_Preview__preview_screenshot$"
    r"|screenshot",
    re.IGNORECASE,
)
is_image_tool = bool(IMAGE_TOOL_RE.search(tool_name)) if tool_name else False

# Magic-byte / MIME / data-URI markers. Highly distinctive — vanishingly
# unlikely to appear in real secret-bearing output.
IMAGE_MARKERS = (
    "data:image/",
    '"type":"image"',
    "'type': 'image'",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "/9j/4AA",            # base64-encoded JPEG SOI + JFIF header
    "iVBORw0KG",          # base64-encoded PNG signature
    "R0lGODlh",           # base64-encoded GIF87a/89a header
    "UklGR",              # base64-encoded WebP RIFF header
    "Successfully captured screenshot",  # Chrome MCP success line
)
has_image_marker = any(marker in text for marker in IMAGE_MARKERS)

image_mode = is_image_tool or has_image_marker

# Pattern definitions. Order matters: mere-specifikke FØRST så vi får
# præcise typer (sb_secret_ scannes før generic-high-entropy).
PATTERNS = [
    # Supabase secret keys (post-2026-04 format) — ALDRIG må leake
    ("supabase-secret",     re.compile(r"sb_secret_[A-Za-z0-9_-]{30,}")),
    # Supabase publishable keys — public per Supabase model, men issue #634
    # spec'er at vi redact'er begge. Mindre kritisk men konsistent.
    ("supabase-publishable", re.compile(r"sb_publishable_[A-Za-z0-9_-]{30,}")),
    # Supabase legacy JWT (eyJh = JWT header "alg":"HS256"). Roden af #296.
    # JWT-format: header.payload.signature, alle base64url.
    ("jwt-supabase-legacy", re.compile(r"eyJh[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}")),
    # Generic JWT (alle 3-segment base64url). Bredere fang.
    ("jwt",                 re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    # Sentry DSN — eksponeret i #620
    ("sentry-dsn",          re.compile(r"https://[a-f0-9]{32}@[a-z0-9.\-]+\.ingest(?:\.[a-z]{2})?\.sentry\.io/[0-9]+")),
    # Discord bot token — eksponeret i #620. Format: <userId-base64>.<6-7char>.<27-38char>
    ("discord-bot-token",   re.compile(r"\b[MN][A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,38}\b")),
    # GitHub PAT (ghp_, gho_, ghu_, ghs_, ghr_)
    ("github-pat",          re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b")),
    # AWS access keys
    ("aws-access-key",      re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    # Slack tokens
    ("slack-token",         re.compile(r"\bxox[abprs]-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24,}\b")),
    # OpenAI/Anthropic-style API keys
    ("openai-key",          re.compile(r"\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b")),
    ("anthropic-key",       re.compile(r"\bsk-ant-[A-Za-z0-9_-]{90,}\b")),
    # Stripe keys
    ("stripe-key",          re.compile(r"\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{24,}\b")),
]

# High-entropy fallback: URL-safe base64-like ≥40 chars med blandet case + digits.
# CRITICAL: char-class udelukker `/` fordi URLs (fx GitHub-issue-links) ellers
# matcher (false positive opdaget 2026-05-25 da NOW.md med #-issue-links blev
# scanned). Modern API tokens bruger oftest URL-safe base64 uden `/`; legacy
# tokens med `/` slipper igennem high-entropy men fanges af named patterns
# (JWT, Sentry DSN, Supabase keys) OR af gitleaks ved commit.
HIGH_ENTROPY = re.compile(r"\b(?=(?:[A-Za-z0-9_+=-]*[A-Z]){2,})(?=(?:[A-Za-z0-9_+=-]*[a-z]){2,})(?=(?:[A-Za-z0-9_+=-]*[0-9]){2,})[A-Za-z0-9_+=-]{40,}\b")

# Allow-list: kendte ikke-secret base64-like strings vi IKKE vil flagge.
# Tilføj her hvis du opdager en konkret false-positive klage.
ALLOW = [
    # Git SHAs (40 hex)
    re.compile(r"^[a-f0-9]{40}$"),
    # GitHub node IDs (decoded MDQ6, LA_, etc.)
    re.compile(r"^(?:LA_|MDQ6|MDc6|IC_|I_|PR_)[A-Za-z0-9_=]+$"),
    # Vite asset hashes (8 chars suffix)
    re.compile(r"-[A-Za-z0-9]{8}\.(?:js|css|woff2?|map)$"),
    # Fixture markers (sync med .gitleaks.toml allowlist)
    re.compile(r"(?:FIXTURE_DO_NOT_USE|TEST_SECRET_NOT_REAL)"),
    # Google Drive/Sheets fileId (44-char moderne format, starter med "1",
    # kun [A-Za-z0-9_-]). IDENTIFIKATORER, ikke secrets — adgang styres af
    # deling, ikke hemmeligholdelse. memory/reference_uci_sheet*.md refererer
    # UCI-sheet fileId'er; uden denne allow tripper de high-entropy hver gang
    # filens indhold passerer et tool-output og blokerer Read af WARM-index.
    # Named secret-patterns (sb_secret_/eyJ/ghp_/AKIA/...) koeres FOER denne
    # fallback, saa aegte prefix-baerende secrets fanges stadig. (#743, 2026-05-29)
    re.compile(r"^1[A-Za-z0-9_-]{43}$"),
    # Windows-path slugs: Windows-stier med \ og : erstattet af -, fx
    # "C--Dev-CyclingZone--claude--worktrees--mystifying-ride-bad850".
    # Fil-system-stier er ikke secrets. Trigger: worktree-navne der dukker op i
    # tool-output JSON (cwd-felt, Read-path, etc.). (#719, 2026-05-29)
    re.compile(r"^[A-Z]--[A-Za-z]"),
]

findings = []
redacted = text

for type_name, pattern in PATTERNS:
    for m in pattern.finditer(text):
        value = m.group(0)
        findings.append({"type": type_name, "preview": value[:8] + "..." + value[-4:] if len(value) > 16 else value[:4] + "..."})
        redacted = redacted.replace(value, f"[REDACTED:{type_name}]")

# High-entropy scan AFTER named patterns (så vi ikke double-flag).
# Skipped entirely in image-mode to avoid the JPEG/PNG base64 false-positive
# storm. We still count would-be matches for the forward-guard stats log.
high_entropy_skipped = 0
if image_mode:
    high_entropy_skipped = sum(1 for _ in HIGH_ENTROPY.finditer(redacted))
else:
    for m in HIGH_ENTROPY.finditer(redacted):  # Scan redacted (named patterns already replaced)
        value = m.group(0)
        # Skip allow-listed
        if any(a.match(value) for a in ALLOW):
            continue
        # Skip hvis allerede del af en REDACTED-marker
        if "[REDACTED:" in value:
            continue
        findings.append({"type": "high-entropy", "preview": value[:8] + "..." + value[-4:]})
        redacted = redacted.replace(value, "[REDACTED:high-entropy]")

result = {
    "leak_detected": bool(findings),
    "count": len(findings),
    "types": sorted(set(f["type"] for f in findings)),
    "findings": findings[:10],  # Cap til 10 for at undgå log-bloat
    "image_mode": image_mode,
    "image_mode_reason": "tool_name" if is_image_tool else ("marker" if has_image_marker else ""),
    "high_entropy_skipped": high_entropy_skipped,
    "tool_name": tool_name,
}
print(json.dumps(result))
PYEOF
)

unset _SECRET_SCAN_INPUT

# Parse Python result
if [ -z "$SCAN_RESULT" ]; then
  exit 0
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
if not (d.get("image_mode") or d.get("leak_detected")):
    sys.exit(0)
fields = [
    "image_mode={}".format(d.get("image_mode", False)),
    "reason={}".format(d.get("image_mode_reason", "") or "-"),
    "skipped_he={}".format(d.get("high_entropy_skipped", 0)),
    "leak={}".format(d.get("leak_detected", False)),
    "count={}".format(d.get("count", 0)),
    "tool={}".format(d.get("tool_name", "") or "-"),
]
print(" ".join(fields))
' 2>/dev/null || true)
if [ -n "$STATS_LINE" ]; then
  mkdir -p "$(dirname "$STATS_FILE")" 2>/dev/null || true
  echo "$TS $STATS_LINE" >> "$STATS_FILE" 2>/dev/null || true
fi

LEAK=$(printf '%s' "$SCAN_RESULT" | "$PY" -c 'import sys,json; d=json.load(sys.stdin); print("yes" if d.get("leak_detected") else "no")' 2>/dev/null || echo "no")

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

Refs: #634 (denne hook), #296 + #620 (tidligere leaks).
EOF

exit 2
