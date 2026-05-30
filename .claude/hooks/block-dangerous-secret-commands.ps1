# PreToolUse hook (PowerShell version)
#
# Blokerer kendte command-patterns der dumper secret-values til stdout/stderr.
# Functional parity med block-dangerous-secret-commands.sh.
#
# Refs: #634 AC2.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$inputText = [Console]::In.ReadToEnd()
if ([string]::IsNullOrEmpty($inputText)) {
  exit 0
}

# Quick bail-out: kun Bash/PowerShell tool-calls
if (-not ($inputText -match '"tool_name"\s*:\s*"(Bash|PowerShell)"')) {
  exit 0
}

# Extract command field via regex (tolerant af escape-sekvenser)
$cmdMatch = [regex]::Match($inputText, '"command"\s*:\s*"((?:[^"\\]|\\.)*)"')
if (-not $cmdMatch.Success) {
  exit 0
}

$cmd = $cmdMatch.Groups[1].Value
$cmdLo = $cmd.ToLower()

function Block-Command {
  param([string]$PatternName, [string]$SafeAlt)
  $msg = @"
🔴 BLOCKED by block-dangerous-secret-commands.ps1

Command matches known leak-pattern: $PatternName

Det blokerede command ville sandsynligvis printe secret-values til transcript.
Tidligere incidents: #296 (setup.py JWT in commit), #620 (railway variables --json).

Safe alternative:
$SafeAlt

Catalog: docs/SECRET_LEAK_VECTORS.md (alle kendte vektorer + wrappers).
Override: hvis du SKAL køre raw command (fx for rotation), kør det fra en
terminal UDENFOR Claude Code så transcript ikke fanger output.

Refs: #634.
"@
  [Console]::Error.WriteLine($msg)
  exit 2
}

# --- Railway env-dumps ---
if ($cmdLo -match '(^|\s)railway\s+variables') {
  if (-not ($cmdLo -match "jq\s+'keys'" -or $cmdLo -match 'jq\s+"keys"' -or $cmdLo -match 'probe-railway-keys')) {
    Block-Command "railway variables (uden jq 'keys' filter)" @"
  pwsh -File scripts/probe-railway-keys.ps1
  bash scripts/probe-railway-keys.sh
"@
  }
}

# --- Vercel env-dumps ---
if ($cmdLo -match 'vercel\s+env\s+ls.*--format\s+json') {
  if (-not ($cmdLo -match "jq\s+'\[" -or $cmdLo -match 'probe-vercel-keys')) {
    Block-Command "vercel env ls --format json (uden jq filter)" @"
  pwsh -File scripts/probe-vercel-keys.ps1
  bash scripts/probe-vercel-keys.sh
"@
  }
}

if ($cmdLo -match 'vercel\s+env\s+pull') {
  Block-Command "vercel env pull (skriver values til disk)" @"
  # IKKE behov i agent-flow. Hvis du SKAL pull values lokalt for debug:
  #   kør fra terminal UDENFOR Claude Code, og slet filen bagefter.
"@
}

if ($cmdLo -match 'vercel\s+env\s+decrypt') {
  Block-Command "vercel env decrypt (printer values)" "  Brug probe-vercel-keys.ps1 til at se key-navne."
}

# --- Infisical secrets-dump (ALLE former printer values) ---
# Blokeres kategorisk: `infisical secrets` (+ `--plain`, `get`), `infisical
# export`. Kun `infisical run -- <cmd>` (runtime-injection) er safe og rammes
# ikke. Hullet der lækkede SERVICE_KEY 2026-05-30 var den gamle snævre
# `list --format json`-form der ikke fangede `--plain`.
if ($cmdLo -match '(^|[^a-z])infisical\s+(secrets|export)(\s|$)') {
  Block-Command "infisical secrets/export (printer secret-values til transcript)" @"
  # Tjek om en key er sat (uden at printe value):
  infisical run --env=dev -- node backend/scripts/verify-infisical-injection.js
  # ALDRIG 'infisical secrets'/'--plain'/'export' i agent-session.
"@
}

# --- Cat / Get-Content / gc på .env-filer ---
if ($cmdLo -match '(^|\s)cat\s+([^|;&]+/)?\.env' -or
    $cmdLo -match 'get-content\s+([^|;&]+/)?\.env' -or
    $cmdLo -match '(^|\s)gc\s+([^|;&]+/)?\.env') {
  Block-Command "Læsning af .env-fil (cat/Get-Content/gc)" @"
  # Kun key-navne:
  Select-String -Path backend/.env -Pattern '^[A-Z_]+=' | ForEach-Object { (`$_ -split '=')[0] }
  # Bash: grep -oE '^[A-Z_][A-Z0-9_]+' backend/.env
"@
}

# --- env / printenv / Get-ChildItem env: unfiltered ---
if ($cmdLo -match '(^|\s|;|\|\||&&)(env|printenv)(\s*$|\s*[;|&])') {
  Block-Command "env / printenv (unfiltered — dumper alle env-vars med values)" @"
  env | awk -F= '{print `$1}' | sort
"@
}

if ($cmdLo -match 'get-childitem\s+env:\s*$' -or $cmdLo -match '(^|\s)(gci|ls|dir)\s+env:\s*$') {
  Block-Command "Get-ChildItem env: (printer alle env-vars med values)" @"
  Get-ChildItem env: | Select-Object -ExpandProperty Name | Sort-Object
"@
}

# --- Git show/log/diff på .env-filer ---
if ($cmdLo -match 'git\s+show\s+[^|]*\.env') {
  Block-Command "git show <ref>:.env (læser historisk secret hvis nogensinde committed)" @"
  git log --diff-filter=D --name-only -- .env
"@
}

if ($cmdLo -match 'git\s+log\s+-p\s+[^|]*\.env') {
  Block-Command "git log -p .env (printer historiske values)" "  git log --oneline -- backend/.env"
}

# --- Vercel inspect (kan inkludere build-time env) ---
if ($cmdLo -match 'vercel\s+inspect\s+') {
  if (-not ($cmdLo -match 'jq' -or $cmdLo -match '> ?/dev/null')) {
    Block-Command "vercel inspect (kan inkludere build-time env)" @"
  vercel inspect <url> 2>&1 | jq '{name, status, url, createdAt}'
"@
  }
}

# --- Dotenv debug-print ---
if ($cmdLo -match 'console\.log\([^)]*process\.env[^)]*\)') {
  Block-Command "console.log(process.env) (printer alle env-vars med values)" @"
  console.log(Object.keys(process.env).sort())
"@
}

exit 0
