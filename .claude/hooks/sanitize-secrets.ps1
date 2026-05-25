# PostToolUse hook (PowerShell version)
#
# Scanner tool-output for kendte secret-patterns og redact'er værdier FØR
# Claude ser dem. Functional parity med sanitize-secrets.sh.
#
# Adfærd:
#   - INGEN match  -> exit 0 (silent passthrough)
#   - MATCH funnet -> exit 2 med stderr = redacted-summary +
#                     append-line til .claude/secret-leak-incidents.log
#
# Refs: #634 AC2.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"  # Vil ikke crashe hook ved subtile fejl

# Læs stdin (PostToolUse JSON). Fail-open hvis tom.
$inputText = [Console]::In.ReadToEnd()
if ([string]::IsNullOrEmpty($inputText)) {
  exit 0
}

# Performance: short-circuit på små outputs (status codes, OK messages)
if ($inputText.Length -lt 100) {
  exit 0
}

# Truncate på 2MB for performance
$maxBytes = 2097152
if ($inputText.Length -gt $maxBytes) {
  $inputText = $inputText.Substring(0, $maxBytes)
}

# Patterns — parity med .sh version
$patterns = @(
  @{ Name = "supabase-secret";       Regex = "sb_secret_[A-Za-z0-9_-]{30,}" },
  @{ Name = "supabase-publishable";  Regex = "sb_publishable_[A-Za-z0-9_-]{30,}" },
  @{ Name = "jwt-supabase-legacy";   Regex = "eyJh[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}" },
  @{ Name = "jwt";                   Regex = "eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}" },
  @{ Name = "sentry-dsn";            Regex = "https://[a-f0-9]{32}@[a-z0-9.\-]+\.ingest(?:\.[a-z]{2})?\.sentry\.io/[0-9]+" },
  @{ Name = "discord-bot-token";     Regex = "\b[MN][A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,38}\b" },
  @{ Name = "github-pat";            Regex = "\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b" },
  @{ Name = "aws-access-key";        Regex = "\bAKIA[0-9A-Z]{16}\b" },
  @{ Name = "slack-token";           Regex = "\bxox[abprs]-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24,}\b" },
  @{ Name = "openai-key";            Regex = "\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b" },
  @{ Name = "anthropic-key";         Regex = "\bsk-ant-[A-Za-z0-9_-]{90,}\b" },
  @{ Name = "stripe-key";            Regex = "\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{24,}\b" }
)

$findings = New-Object System.Collections.Generic.List[object]
$redacted = $inputText

foreach ($p in $patterns) {
  $matchResults = [regex]::Matches($inputText, $p.Regex)
  foreach ($m in $matchResults) {
    $value = $m.Value
    if ($value.Length -gt 16) {
      $preview = $value.Substring(0, 8) + "..." + $value.Substring($value.Length - 4)
    } else {
      $preview = $value.Substring(0, [Math]::Min(4, $value.Length)) + "..."
    }
    $findings.Add([PSCustomObject]@{ Type = $p.Name; Preview = $preview })
    $redacted = $redacted.Replace($value, "[REDACTED:$($p.Name)]")
  }
}

# High-entropy fallback. Scan AFTER named patterns (på redacted text).
# CRITICAL: `/` ekskluderet fra char-class (URLs matcher ellers — sync med .sh).
$highEntropy = [regex]::Matches($redacted, '\b(?=(?:[A-Za-z0-9_+=-]*[A-Z]){2,})(?=(?:[A-Za-z0-9_+=-]*[a-z]){2,})(?=(?:[A-Za-z0-9_+=-]*[0-9]){2,})[A-Za-z0-9_+=-]{40,}\b')
$allow = @(
  '^[a-f0-9]{40}$',                              # Git SHA
  '^(?:LA_|MDQ6|MDc6|IC_|I_|PR_)[A-Za-z0-9_=]+$',# GitHub node IDs
  '(?:FIXTURE_DO_NOT_USE|TEST_SECRET_NOT_REAL)'  # Fixture markers
)

foreach ($m in $highEntropy) {
  $value = $m.Value
  if ($value -like "*REDACTED:*") { continue }
  $isAllowed = $false
  foreach ($a in $allow) {
    if ($value -match $a) { $isAllowed = $true; break }
  }
  if ($isAllowed) { continue }
  $preview = $value.Substring(0, 8) + "..." + $value.Substring($value.Length - 4)
  $findings.Add([PSCustomObject]@{ Type = "high-entropy"; Preview = $preview })
  $redacted = $redacted.Replace($value, "[REDACTED:high-entropy]")
}

if ($findings.Count -eq 0) {
  exit 0
}

# Leak detected. Log + alert + block.
$repoRoot = (Get-Location).Path
# Find repo-root ved at gå op til .claude/
$dir = $PSScriptRoot
while ($dir -and -not (Test-Path (Join-Path $dir ".claude"))) {
  $parent = Split-Path -Parent $dir
  if ($parent -eq $dir) { break }
  $dir = $parent
}
if ($dir) { $repoRoot = $dir }

$logFile = Join-Path $repoRoot ".claude\secret-leak-incidents.log"
$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"

$types = ($findings | Select-Object -ExpandProperty Type -Unique | Sort-Object) -join ","
$count = $findings.Count

$summary = @"
count=$count types=$types
"@
foreach ($f in $findings | Select-Object -First 5) {
  $summary += "`n  - $($f.Type): $($f.Preview)"
}

# Append to incident log (best-effort)
try {
  $logDir = Split-Path -Parent $logFile
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $logEntry = "---`ntimestamp: $ts`n$summary`n"
  Add-Content -Path $logFile -Value $logEntry -ErrorAction SilentlyContinue
} catch {
  # Non-fatal
}

# Emit blocking-error to stderr
$msg = @"
🔴 SECRET LEAK DETECTED — tool output blocked by sanitize-secrets.ps1

Found secret-patterns in tool output. Output suppressed to prevent leak.

$summary

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
"@
[Console]::Error.WriteLine($msg)

exit 2
