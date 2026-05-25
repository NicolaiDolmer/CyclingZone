# probe-railway-keys.ps1
#
# Safe wrapper omkring `railway variables --json`. Printer KUN key-navne,
# ALDRIG values. Required for at undgå #620-style leak hvor `railway variables --json`
# dumpede SENTRY_DSN + SUPABASE_SERVICE_KEY + DISCORD_BOT_TOKEN i klartekst.
#
# Brug:
#   pwsh -File scripts/probe-railway-keys.ps1
#   pwsh -File scripts/probe-railway-keys.ps1 -Service CyclingZone
#   pwsh -File scripts/probe-railway-keys.ps1 -Filter SUPABASE
#
# Output (eksempel):
#   Railway variables (service: CyclingZone) — 18 keys
#     DATABASE_URL
#     DISCORD_BOT_TOKEN
#     SENTRY_DSN
#     SUPABASE_SERVICE_KEY
#     SUPABASE_URL
#     ...
#
# Refs: #634 AC3 (forebyg #620).

[CmdletBinding()]
param(
  [string]$Service = "CyclingZone",
  [string]$Environment = "production",
  [string]$Filter = "",
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Verify railway CLI
$railwayCmd = Get-Command railway -ErrorAction SilentlyContinue
if (-not $railwayCmd) {
  Write-Error "railway CLI not found. Install: https://docs.railway.app/develop/cli"
  exit 1
}

# Verify auth (railway whoami fails fast if not logged in)
$whoami = & railway whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "railway not authenticated. Run: railway login"
  exit 1
}

# Verify project linked
$status = & railway status --json 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "railway project not linked. Run: railway link"
  exit 1
}

# Fetch variables. CRITICAL: pipe DIRECTLY til ConvertFrom-Json så raw output
# (med values) ALDRIG hits stdout / transcript. ConvertFrom-Json + filter er
# in-memory only.
$rawJson = $null
try {
  # Strict capture: stdout only. stderr går separat.
  $rawJson = & railway variables --json --service $Service --environment $Environment 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Error "railway variables failed (exit=$LASTEXITCODE). Check service/environment names."
    exit 1
  }
} catch {
  Write-Error "railway variables error: $($_.Exception.Message)"
  exit 1
}

# Parse + extract ONLY keys. Values discarded immediately.
$keys = $null
try {
  $parsed = $rawJson | ConvertFrom-Json
  $keys = $parsed.PSObject.Properties.Name | Sort-Object
} catch {
  Write-Error "Failed to parse railway variables JSON. Output suppressed for safety."
  exit 1
} finally {
  # Defensive: clear raw values from memory ASAP
  $rawJson = $null
  $parsed = $null
}

# Optional filter (case-insensitive substring match on key name)
if ($Filter) {
  $keys = $keys | Where-Object { $_ -match $Filter }
}

# Output
if ($Json) {
  $keys | ConvertTo-Json -Compress
} else {
  Write-Host "Railway variables (service: $Service, env: $Environment) — $($keys.Count) keys"
  if ($Filter) { Write-Host "  filter: '$Filter'" }
  $keys | ForEach-Object { Write-Host "  $_" }
}

exit 0
