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

# Best-effort JSON parse of the PostToolUse payload to extract tool_name.
# Falls back to text-only scanning if stdin isn't valid JSON.
$toolName = ""
try {
  $payload = $inputText | ConvertFrom-Json -ErrorAction Stop
  if ($payload -and $payload.PSObject.Properties.Name -contains "tool_name") {
    $toolName = [string]$payload.tool_name
  }
} catch {
  # Not JSON — that's fine, text-only scan.
}

# --- Image-mode detection (parity med .sh) ----------------------------------
# Why: HIGH_ENTROPY regex matches any 40+-char base64-like string. JPEG/PNG
# bytes encoded as base64 trip it for HUNDREDS of fragments per screenshot
# (#666 false-positive incident 2026-05-26: count=587 on Chrome MCP
# browser_batch). Skip the high-entropy fallback when output is clearly an
# image; named patterns still run for defense-in-depth.
$imageToolRegex = '(?i)^mcp__Claude_in_Chrome__(?:browser_batch|computer|gif_creator|upload_image|read_page)$|^mcp__Claude_Preview__preview_screenshot$|screenshot'
$isImageTool = $false
if ($toolName) {
  $isImageTool = [regex]::IsMatch($toolName, $imageToolRegex)
}

$imageMarkers = @(
  'data:image/',
  '"type":"image"',
  "'type': 'image'",
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  '/9j/4AA',        # base64 JPEG SOI + JFIF
  'iVBORw0KG',      # base64 PNG signature
  'R0lGODlh',       # base64 GIF87a/89a header
  'UklGR',          # base64 WebP RIFF
  'Successfully captured screenshot'
)
$hasImageMarker = $false
foreach ($marker in $imageMarkers) {
  if ($inputText.Contains($marker)) { $hasImageMarker = $true; break }
}
$imageMode = $isImageTool -or $hasImageMarker
$imageModeReason = if ($isImageTool) { "tool_name" } elseif ($hasImageMarker) { "marker" } else { "" }

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
# Skipped entirely in image-mode (#666 false-positive fix).
$highEntropy = [regex]::Matches($redacted, '\b(?=(?:[A-Za-z0-9_+=-]*[A-Z]){2,})(?=(?:[A-Za-z0-9_+=-]*[a-z]){2,})(?=(?:[A-Za-z0-9_+=-]*[0-9]){2,})[A-Za-z0-9_+=-]{40,}\b')
$allow = @(
  '^[a-f0-9]{40}$',                              # Git SHA
  '^(?:LA_|MDQ6|MDc6|IC_|I_|PR_)[A-Za-z0-9_=]+$',# GitHub node IDs
  '(?:FIXTURE_DO_NOT_USE|TEST_SECRET_NOT_REAL)'  # Fixture markers
)

$highEntropySkipped = 0
if ($imageMode) {
  $highEntropySkipped = $highEntropy.Count
} else {
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
}

# Resolve repo root (used for both stats + incident logs).
$repoRoot = (Get-Location).Path
$dir = $PSScriptRoot
while ($dir -and -not (Test-Path (Join-Path $dir ".claude"))) {
  $parent = Split-Path -Parent $dir
  if ($parent -eq $dir) { break }
  $dir = $parent
}
if ($dir) { $repoRoot = $dir }
$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"

# Forward-guard stats log: write a line whenever image-mode triggered OR a
# leak fired. Quiet on the (vast majority) of plain text tool-calls.
if ($imageMode -or $findings.Count -gt 0) {
  $statsFile = Join-Path $repoRoot ".claude\secret-leak-stats.log"
  $leakFlag = if ($findings.Count -gt 0) { "True" } else { "False" }
  $reasonField = if ($imageModeReason) { $imageModeReason } else { "-" }
  $toolField = if ($toolName) { $toolName } else { "-" }
  $statsLine = "$ts image_mode=$imageMode reason=$reasonField skipped_he=$highEntropySkipped leak=$leakFlag count=$($findings.Count) tool=$toolField"
  try {
    $statsDir = Split-Path -Parent $statsFile
    if (-not (Test-Path $statsDir)) { New-Item -ItemType Directory -Path $statsDir -Force | Out-Null }
    Add-Content -Path $statsFile -Value $statsLine -ErrorAction SilentlyContinue
  } catch {
    # Non-fatal — stats are observability, not security.
  }
}

if ($findings.Count -eq 0) {
  exit 0
}

# Leak detected. Log + alert + block. ($repoRoot + $ts already resolved above.)
$logFile = Join-Path $repoRoot ".claude\secret-leak-incidents.log"

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
