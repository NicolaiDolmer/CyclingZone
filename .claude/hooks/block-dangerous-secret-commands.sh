#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash|PowerShell)
#
# Blokerer kendte command-patterns der dumper secret-values til stdout/stderr.
# Defense-in-depth: PrimÆR forsvarslinje før secret overhovedet printes.
# Sekundær er sanitize-secrets.sh (PostToolUse).
#
# Patterns katalogiseret i docs/SECRET_LEAK_VECTORS.md tabel A-D.
#
# Adfærd:
#   - Safe command  -> exit 0
#   - Dangerous     -> exit 2 med stderr (block), giv agent safe alternativ
#
# Refs: #634 AC2.

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

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

# For ALLE tool-calls: scan tool_input for secret-patterns. Catch'er meta-leaks
# hvor agent ekkoer et secret i fx spawn_task-prompt eller MCP-arg (opdaget
# 2026-05-25 da et spawn_task indeholdt Sentry DSN literal fra source-file).
#
# Vi scanner kun tool_input — tool_response håndteres af PostToolUse sanitizer.
# Bash/PowerShell command-specifikt block (cat .env, railway variables osv.)
# kommer længere nede.
command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || INPUT_SCAN_AVAILABLE=0
PY=$(command -v python3 || command -v python)

if [ -n "${PY:-}" ]; then
  export _BLOCK_SCAN_INPUT="$INPUT"
  LEAK_TYPES=$("$PY" <<'PYEOF' 2>/dev/null
import os, re, json, sys
text = os.environ.get("_BLOCK_SCAN_INPUT", "")
try:
    d = json.loads(text)
except Exception:
    sys.exit(0)

# Extract ALL string-values from tool_input recursively
def collect_strings(obj, out):
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            collect_strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_strings(v, out)

strings = []
collect_strings(d.get("tool_input", {}), strings)
joined = "\n".join(strings)

# Scan for HIGH-VALUE patterns kun (mindre risiko for false positive end full
# sanitize-secrets pattern-set). Skip her hvis pattern er publikt acceptabelt.
PATTERNS = [
    ("supabase-secret",      re.compile(r"sb_secret_[A-Za-z0-9_-]{30,}")),
    ("jwt-supabase-legacy",  re.compile(r"eyJh[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}")),
    ("sentry-dsn",           re.compile(r"https://[a-f0-9]{32}@[a-z0-9.\-]+\.ingest(?:\.[a-z]{2})?\.sentry\.io/[0-9]+")),
    ("discord-bot-token",    re.compile(r"\b[MN][A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,38}\b")),
    ("github-pat",           re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b")),
    ("aws-access-key",       re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("anthropic-key",        re.compile(r"\bsk-ant-[A-Za-z0-9_-]{90,}\b")),
    ("stripe-key",           re.compile(r"\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{24,}\b")),
]
found = []
for name, pat in PATTERNS:
    if pat.search(joined):
        found.append(name)
if found:
    print(",".join(sorted(set(found))))
PYEOF
  )
  unset _BLOCK_SCAN_INPUT

  if [ -n "$LEAK_TYPES" ]; then
    cat >&2 <<EOF
🔴 BLOCKED by block-dangerous-secret-commands.sh

Tool call input indeholder secret-pattern(s): $LEAK_TYPES

Hvad skete der: agent forsøgte at sende et tool-call med en literal secret i
input (fx spawn_task prompt, MCP-arg, agent-besked). Selv hvis Bash-output
sanitizer ville fange et sådan secret AFTER det printes, blokerer vi nu FØR
det forwardes til et andet system (spawned session, MCP-server, etc.).

Hvad gør du nu:
1. STOP. Genkald værdien fra hukommelsen — det skal IKKE være i prompts.
2. Reference værdien indirekte (fx "line 147 i setup-sentry-frontend.ps1
   indeholder den hardcoded DSN" — uden at quote det).
3. Hvis du SKAL inkludere et secret i et tool-input, så er flowet at
   brugeren tilføjer det manuelt i en separat besked til den spawned agent.

Refs: #634 (denne hook).
EOF
    exit 2
  fi
fi

# --- Lag A (#634 follow-up): block Read/Grep mod secret-fil-stier ----------
# Read/Grep tool_response indeholder filindhold; for secret-filer = leak til
# transcript. Input-scan ovenfor fanger det IKKE (tool_input er kun en sti),
# og PostToolUse-sanitizer dækkede det først efter Read/Grep blev tilføjet til
# matcheren. Denne block er proaktiv + indholds-uafhængig (fanger også custom
# secrets uden genkendeligt format). Vektoren bed 2026-05-29 (.mcp.json).
if [ -n "${PY:-}" ]; then
  export _PATHSCAN_INPUT="$INPUT"
  SECRET_PATH=$("$PY" <<'PYEOF' 2>/dev/null
import os, json, re, sys
text = os.environ.get("_PATHSCAN_INPUT", "")
try:
    d = json.loads(text)
except Exception:
    sys.exit(0)
tn = str(d.get("tool_name", "") or "")
if tn not in ("Read", "Grep"):
    sys.exit(0)
ti = d.get("tool_input", {}) or {}
paths = []
if tn == "Read":
    p = ti.get("file_path")
    if p:
        paths.append(str(p))
elif tn == "Grep":
    # Grep uden 'path' = cwd-bred soegning; kan ikke pinnes til een fil ->
    # overlades til PostToolUse-sanitizer (lag B). Kun eksplicit fil/sti her.
    p = ti.get("path")
    if p:
        paths.append(str(p))

whitelist = re.compile(r"\.(example|sample|template)$", re.IGNORECASE)

def is_secret_path(p):
    pl = p.replace("\\", "/")
    base = pl.rsplit("/", 1)[-1]
    if whitelist.search(base):
        return False
    if base == ".mcp.json":
        return True
    if re.match(r"^\.env(\..+)?$", base):
        return True
    if "/secrets/" in pl.lower():
        return True
    return False

hits = [p for p in paths if is_secret_path(p)]
if hits:
    print(hits[0])
PYEOF
  )
  unset _PATHSCAN_INPUT

  if [ -n "$SECRET_PATH" ]; then
    cat >&2 <<EOF
🔴 BLOCKED by block-dangerous-secret-commands.sh

Read/Grep mod secret-fil: $SECRET_PATH

Filen indeholder secrets i klartekst. Tool-output ville dumpe dem til
transcript (vektoren der bed 2026-05-29 paa .mcp.json). Selv gitignored filer
laekker denne vej.

Hvad goer du nu:
1. Behoever du kun KEY-NAVNE (ikke values)?
     grep -oE '^[A-Z_][A-Z0-9_]*' backend/.env     # via Bash — kun keys
2. Behoever du strukturen i .mcp.json? Laes docs/DISCORD_MCP_SETUP.md (har
   redacted eksempel) i stedet for selve filen.
3. Skal du se en value? Aaben filen i en editor UDENFOR Claude Code.

Catalog: docs/SECRET_LEAK_VECTORS.md tabel B.

Refs: #634.
EOF
    exit 2
  fi
fi

# Quick bail-out hvis ikke Bash/PowerShell tool-call for command-specifikke checks nedenfor
case "$INPUT" in
  *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*) ;;
  *'"tool_name":"PowerShell"'*|*'"tool_name": "PowerShell"'*) ;;
  *) exit 0 ;;
esac

# Extract command field via python json-parse (sed-greedy bug ramte ved korte
# commands som "env" — fanger ikke trailing JSON). Python handles escapes
# korrekt. Fail-open hvis python mangler.
command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || exit 0
PY=$(command -v python3 || command -v python)

CMD=$(printf '%s' "$INPUT" | "$PY" -c 'import sys, json
try:
  d = json.load(sys.stdin)
  print(d.get("tool_input", {}).get("command", ""))
except Exception:
  pass' 2>/dev/null | head -c 8000)

if [ -z "$CMD" ]; then
  exit 0
fi

# Lowercase for case-insensitive match
CMDLO=$(printf '%s' "$CMD" | tr '[:upper:]' '[:lower:]')

block() {
  local pattern_name="$1"
  local safe_alt="$2"
  cat >&2 <<EOF
🔴 BLOCKED by block-dangerous-secret-commands.sh

Command matches known leak-pattern: $pattern_name

Det blokerede command ville sandsynligvis printe secret-values til transcript.
Tidligere incidents: #296 (setup.py JWT in commit), #620 (railway variables --json).

Safe alternative:
$safe_alt

Catalog: docs/SECRET_LEAK_VECTORS.md (alle kendte vektorer + wrappers).
Override: hvis du SKAL køre raw command (fx for rotation), kør det fra en
terminal UDENFOR Claude Code så transcript ikke fanger output.

Refs: #634.
EOF
  exit 2
}

# --- Railway env-dumps ---
# `railway variables` (med eller uden --json) printer alle values.
# Tillader: `railway variables --json | jq 'keys'` (extracts only keys).
# Tillader: probe-railway-keys.* wrapper.
if printf '%s' "$CMDLO" | grep -Eq '(^|[^a-z])railway[[:space:]]+variables'; then
  # Check om der er en safe-extract pattern i samme command
  if printf '%s' "$CMDLO" | grep -Eq "jq[[:space:]]+'keys'" || \
     printf '%s' "$CMDLO" | grep -Eq 'jq[[:space:]]+"keys"' || \
     printf '%s' "$CMDLO" | grep -Eq 'probe-railway-keys'; then
    : # Safe
  else
    block "railway variables (uden jq 'keys' filter)" \
      "  pwsh -File scripts/probe-railway-keys.ps1   # Windows
  bash scripts/probe-railway-keys.sh           # Linux/Mac
  # Eller manual: railway variables --json | jq 'keys'"
  fi
fi

# --- Vercel env-dumps ---
# `vercel env ls --format json` printer values. `vercel env pull` skriver
# values til disk. `vercel env decrypt` printer values direkte.
if printf '%s' "$CMDLO" | grep -Eq 'vercel[[:space:]]+env[[:space:]]+ls.*--format[[:space:]]+json'; then
  if printf '%s' "$CMDLO" | grep -Eq "jq[[:space:]]+'\\[" || \
     printf '%s' "$CMDLO" | grep -Eq 'probe-vercel-keys'; then
    : # Safe
  else
    block "vercel env ls --format json (uden jq filter)" \
      "  pwsh -File scripts/probe-vercel-keys.ps1
  bash scripts/probe-vercel-keys.sh
  # Eller manual: vercel env ls production --format json | jq '[.[] | .key]'"
  fi
fi

if printf '%s' "$CMDLO" | grep -Eq 'vercel[[:space:]]+env[[:space:]]+pull'; then
  block "vercel env pull (skriver values til disk)" \
    "  # IKKE behov i agent-flow. Hvis du SKAL pull values lokalt for debug:
  #   kør fra terminal UDENFOR Claude Code, og slet filen bagefter."
fi

if printf '%s' "$CMDLO" | grep -Eq 'vercel[[:space:]]+env[[:space:]]+decrypt'; then
  block "vercel env decrypt (printer values)" \
    "  Brug probe-vercel-keys.ps1 til at se key-navne."
fi

# --- Infisical secrets-list med values ---
if printf '%s' "$CMDLO" | grep -Eq 'infisical[[:space:]]+secrets[[:space:]]+list.*--format[[:space:]]+json'; then
  block "infisical secrets list --format json (printer values)" \
    "  infisical secrets list --raw=false   # kun key-navne"
fi

# --- Cat / Get-Content på .env-filer ---
if printf '%s' "$CMDLO" | grep -Eq '(^|[[:space:]])cat[[:space:]]+([^|;&]+/)?\.env'; then
  block "cat .env (direkte secret-file læsning)" \
    "  # Kun key-navne:
  grep -oE '^[A-Z_][A-Z0-9_]+' backend/.env
  # Eller åben fil i editor manuelt (uden agent)."
fi

if printf '%s' "$CMDLO" | grep -Eq 'get-content[[:space:]]+([^|;&]+/)?\.env' || \
   printf '%s' "$CMDLO" | grep -Eq '(^|[[:space:]])gc[[:space:]]+([^|;&]+/)?\.env'; then
  block "Get-Content .env" \
    "  Select-String -Path backend/.env -Pattern '^[A-Z_]+=' | ForEach-Object { (\$_ -split '=')[0] }"
fi

# --- env / printenv unfiltered ---
# `env` alene eller `printenv` alene printer alle env vars incl. secrets.
# `env | grep` er ofte ok hvis grep filter er på key-name. `env | awk '{print $1}'`
# er safe. Vi blokker kun helt-unfiltered.
if printf '%s' "$CMDLO" | grep -Eq '(^|[[:space:]];|\|\||&&)(env|printenv)([[:space:]]*$|[[:space:]]*[;|&])'; then
  block "env / printenv (unfiltered — dumper alle env-vars)" \
    "  env | awk -F= '{print \$1}' | sort   # kun key-navne
  # Eller: env | grep -E '^(SUPABASE|RAILWAY)_'   # filter på prefix"
fi

# --- PowerShell env-listing unfiltered ---
if printf '%s' "$CMDLO" | grep -Eq 'get-childitem[[:space:]]+env:[[:space:]]*$' || \
   printf '%s' "$CMDLO" | grep -Eq '(^|[[:space:]])(gci|ls|dir)[[:space:]]+env:[[:space:]]*$'; then
  block "Get-ChildItem env: (printer alle env-vars incl. values)" \
    "  Get-ChildItem env: | Select-Object -ExpandProperty Name | Sort-Object"
fi

# --- Git show/log/diff på .env-filer ---
if printf '%s' "$CMDLO" | grep -Eq 'git[[:space:]]+show[[:space:]]+[^|]*\.env'; then
  block "git show <ref>:.env (læser historisk secret hvis nogensinde committed)" \
    "  Hvis .env i historie: brug \`git log --diff-filter=D --name-only -- .env\` (kun stier)
  Hvis du skal vurdere om secret er compromised: tjek GitHub secret-scanning."
fi

if printf '%s' "$CMDLO" | grep -Eq 'git[[:space:]]+log[[:space:]]+-p[[:space:]]+[^|]*\.env'; then
  block "git log -p .env (printer historiske values)" \
    "  git log --oneline -- backend/.env   # kun commit-summaries"
fi

# --- Vercel inspect (kan inkludere build-time env i nogen formater) ---
# Specifikt: `vercel inspect <deployment-url>` uden filter kan dumpe env.
# Detalje-output har vi set inkludere build-config-objekter med embedded keys.
if printf '%s' "$CMDLO" | grep -Eq 'vercel[[:space:]]+inspect[[:space:]]+'; then
  # Allow inspect kun hvis output filtres (>/dev/null, jq, eller specific subcommand)
  if printf '%s' "$CMDLO" | grep -Eq 'jq' || \
     printf '%s' "$CMDLO" | grep -Eq '> ?/dev/null'; then
    : # Filtered
  else
    block "vercel inspect (kan inkludere build-time env)" \
      "  vercel inspect <url> 2>&1 | jq '{name, status, url, createdAt}'   # kun metadata"
  fi
fi

# --- Dotenv debug-print ---
if printf '%s' "$CMDLO" | grep -Eq 'console\.log\([^)]*process\.env[^)]*\)'; then
  block "console.log(process.env) (printer alle env-vars med values)" \
    "  console.log(Object.keys(process.env).sort())   # kun key-navne"
fi

# Hvis vi når hertil — ingen pattern matched. Tillad command.
exit 0
